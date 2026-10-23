import { open, type FileHandle } from "node:fs/promises";

/**
 * Minimal read-only SQLite reader: looks up one value by key in a two-column
 * table (key, value) such as VS Code's `ItemTable`. Only reads the pages it
 * needs, so it stays cheap on large state databases. No native deps.
 *
 * Limitations: UTF-8 databases only; ignores any un-checkpointed WAL content.
 */

const HEADER_MAGIC = "SQLite format 3\0";
const MAX_DEPTH = 64;

export class SqliteFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SqliteFormatError";
  }
}

function readVarint(buf: Buffer, offset: number): [value: number, next: number] {
  let value = 0;
  for (let i = 0; i < 8; i++) {
    const byte = buf[offset + i];
    if (byte === undefined) {
      throw new SqliteFormatError("Truncated varint");
    }
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) {
      return [value, offset + i + 1];
    }
  }
  const last = buf[offset + 8];
  if (last === undefined) {
    throw new SqliteFormatError("Truncated varint");
  }
  return [value * 256 + last, offset + 9];
}

type Column = string | Buffer | number | null;

function serialSize(type: number): number {
  if (type <= 4) return type; // 0 -> 0, 1..4 -> 1..4
  if (type === 5) return 6;
  if (type === 6 || type === 7) return 8;
  if (type >= 12) return type % 2 === 0 ? (type - 12) / 2 : (type - 13) / 2;
  return 0; // 8, 9 (constants)
}

function decodeColumn(type: number, buf: Buffer, offset: number): Column {
  const size = serialSize(type);
  if (type === 0) return null;
  if (type === 8) return 0;
  if (type === 9) return 1;
  if (type >= 1 && type <= 5) {
    return buf.readIntBE(offset, size);
  }
  if (type === 6) return Number(buf.readBigInt64BE(offset));
  if (type === 7) return buf.readDoubleBE(offset);
  if (type >= 12) {
    const slice = buf.subarray(offset, offset + size);
    return type % 2 === 0 ? Buffer.from(slice) : slice.toString("utf8");
  }
  throw new SqliteFormatError("Unsupported serial type");
}

/** Decode the first `count` columns of a record. */
function parseRecord(payload: Buffer, count: number): Column[] {
  const [headerSize, headerStart] = readVarint(payload, 0);
  const types: number[] = [];
  let pos = headerStart;
  while (pos < headerSize && types.length < count) {
    const [t, next] = readVarint(payload, pos);
    types.push(t);
    pos = next;
  }
  const out: Column[] = [];
  let dataPos = headerSize;
  for (const t of types) {
    out.push(decodeColumn(t, payload, dataPos));
    dataPos += serialSize(t);
  }
  return out;
}

class Pager {
  private constructor(
    private readonly fh: FileHandle,
    readonly pageSize: number,
    readonly usable: number,
  ) {}

  static async open(fh: FileHandle): Promise<Pager> {
    const header = Buffer.alloc(100);
    const { bytesRead } = await fh.read(header, 0, 100, 0);
    if (bytesRead < 100 || header.toString("latin1", 0, 16) !== HEADER_MAGIC) {
      throw new SqliteFormatError("Not a SQLite database");
    }
    const rawSize = header.readUInt16BE(16);
    const pageSize = rawSize === 1 ? 65536 : rawSize;
    const encoding = header.readUInt32BE(56);
    if (encoding !== 1) {
      throw new SqliteFormatError("Only UTF-8 databases are supported");
    }
    return new Pager(fh, pageSize, pageSize - header[20]!);
  }

  async page(n: number): Promise<Buffer> {
    const buf = Buffer.alloc(this.pageSize);
    const { bytesRead } = await this.fh.read(buf, 0, this.pageSize, (n - 1) * this.pageSize);
    if (bytesRead < this.pageSize) {
      throw new SqliteFormatError(`Page ${n} out of range`);
    }
    return buf;
  }
}

interface LeafCell {
  /** Locally stored payload bytes. */
  local: Buffer;
  totalSize: number;
  overflowPage: number;
}

function readLeafCell(pager: Pager, page: Buffer, cellOffset: number): LeafCell {
  const [totalSize, afterSize] = readVarint(page, cellOffset);
  const [, afterRowid] = readVarint(page, afterSize);
  const maxLocal = pager.usable - 35;
  if (totalSize <= maxLocal) {
    return {
      local: page.subarray(afterRowid, afterRowid + totalSize),
      totalSize,
      overflowPage: 0,
    };
  }
  const minLocal = Math.floor(((pager.usable - 12) * 32) / 255) - 23;
  const k = minLocal + ((totalSize - minLocal) % (pager.usable - 4));
  const localSize = k <= maxLocal ? k : minLocal;
  return {
    local: page.subarray(afterRowid, afterRowid + localSize),
    totalSize,
    overflowPage: page.readUInt32BE(afterRowid + localSize),
  };
}

async function fullPayload(pager: Pager, cell: LeafCell): Promise<Buffer> {
  if (!cell.overflowPage) {
    return cell.local;
  }
  const chunks = [cell.local];
  let remaining = cell.totalSize - cell.local.length;
  let next = cell.overflowPage;
  for (let hops = 0; next && remaining > 0; hops++) {
    if (hops > 1_000_000) {
      throw new SqliteFormatError("Overflow chain too long");
    }
    const p = await pager.page(next);
    const take = Math.min(remaining, pager.usable - 4);
    chunks.push(p.subarray(4, 4 + take));
    remaining -= take;
    next = p.readUInt32BE(0);
  }
  return Buffer.concat(chunks);
}

/** Depth-first walk over a table b-tree, calling `visit` for every leaf cell. */
async function walkTable(
  pager: Pager,
  root: number,
  visit: (cell: LeafCell) => Promise<boolean> | boolean,
): Promise<boolean> {
  async function walk(pageNo: number, depth: number): Promise<boolean> {
    if (depth > MAX_DEPTH) {
      throw new SqliteFormatError("b-tree too deep");
    }
    const page = await pager.page(pageNo);
    const base = pageNo === 1 ? 100 : 0;
    const type = page[base];
    const cellCount = page.readUInt16BE(base + 3);
    if (type === 0x0d) {
      const ptrs = base + 8;
      for (let i = 0; i < cellCount; i++) {
        const cell = readLeafCell(pager, page, page.readUInt16BE(ptrs + i * 2));
        if (await visit(cell)) return true;
      }
      return false;
    }
    if (type === 0x05) {
      const ptrs = base + 12;
      for (let i = 0; i < cellCount; i++) {
        const cellOffset = page.readUInt16BE(ptrs + i * 2);
        if (await walk(page.readUInt32BE(cellOffset), depth + 1)) return true;
      }
      return walk(page.readUInt32BE(base + 8), depth + 1);
    }
    throw new SqliteFormatError(`Unexpected page type ${String(type)}`);
  }
  return walk(root, 0);
}

async function findTableRoot(pager: Pager, table: string): Promise<number | undefined> {
  let root: number | undefined;
  await walkTable(pager, 1, async (cell) => {
    const [type, name, , rootPage] = parseRecord(await fullPayload(pager, cell), 4);
    if (type === "table" && name === table && typeof rootPage === "number") {
      root = rootPage;
      return true;
    }
    return false;
  });
  return root;
}

/**
 * Returns the value for `key` from `table(key, value)` or undefined if absent.
 * Throws SqliteFormatError if the file isn't a readable SQLite database.
 */
export async function readKeyValue(
  dbPath: string,
  table: string,
  key: string,
): Promise<string | undefined> {
  const fh = await open(dbPath, "r");
  try {
    const pager = await Pager.open(fh);
    const root = await findTableRoot(pager, table);
    if (root === undefined) {
      return undefined;
    }
    let result: string | undefined;
    await walkTable(pager, root, async (cell) => {
      // The key is a short leading column; avoid loading overflow unless it matches.
      let cols: Column[];
      try {
        cols = parseRecord(cell.local, 1);
      } catch {
        return false;
      }
      if (cols[0] !== key) return false;
      const [, value] = parseRecord(await fullPayload(pager, cell), 2);
      result = Buffer.isBuffer(value) ? value.toString("utf8") : value == null ? "" : String(value);
      return true;
    });
    return result;
  } finally {
    await fh.close();
  }
}
