import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { AuthTokenError, defaultStateDbPath, readAccessToken } from "./authToken";

const execFileAsync = promisify(execFile);

describe("readAccessToken", () => {
  let dir: string;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reads token from ItemTable", async () => {
    dir = await mkdtemp(join(tmpdir(), "cursor-usage-"));
    const dbPath = join(dir, "state.vscdb");
    await execFileAsync("sqlite3", [
      dbPath,
      "CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT);",
    ]);
    await execFileAsync("sqlite3", [
      dbPath,
      "INSERT INTO ItemTable (key, value) VALUES ('cursorAuth/accessToken', 'test-token-value');",
    ]);

    const token = await readAccessToken(dbPath);
    expect(token).toBe("test-token-value");
  });

  it("throws when token missing", async () => {
    dir = await mkdtemp(join(tmpdir(), "cursor-usage-"));
    const dbPath = join(dir, "state.vscdb");
    await execFileAsync("sqlite3", [
      dbPath,
      "CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT);",
    ]);

    await expect(readAccessToken(dbPath)).rejects.toBeInstanceOf(AuthTokenError);
  });

  it("finds token in a multi-page table with overflow values", async () => {
    dir = await mkdtemp(join(tmpdir(), "cursor-usage-"));
    const dbPath = join(dir, "state.vscdb");
    const sql = [
      "CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);",
      "WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM n WHERE i < 3000)",
      "INSERT INTO ItemTable SELECT 'k' || i, CASE WHEN i % 50 = 0 THEN printf('%.*c', 50000, 'x') ELSE 'v' || i END FROM n;",
      `INSERT INTO ItemTable VALUES ('cursorAuth/accessToken', printf('%.*c', 20000, 't'));`,
    ].join("\n");
    await execFileAsync("sqlite3", [dbPath, sql]);

    expect(await readAccessToken(dbPath)).toBe("t".repeat(20_000));
  });

  it("throws db error for non-sqlite file", async () => {
    dir = await mkdtemp(join(tmpdir(), "cursor-usage-"));
    const dbPath = join(dir, "state.vscdb");
    await writeFile(dbPath, "not a database".padEnd(200, " "));
    await expect(readAccessToken(dbPath)).rejects.toMatchObject({ code: "db" });
  });

  it("resolves per-platform default paths", () => {
    expect(defaultStateDbPath("darwin", {}, "/h")).toBe(
      "/h/Library/Application Support/Cursor/User/globalStorage/state.vscdb",
    );
    expect(defaultStateDbPath("linux", {}, "/h")).toBe(
      "/h/.config/Cursor/User/globalStorage/state.vscdb",
    );
    expect(defaultStateDbPath("linux", { XDG_CONFIG_HOME: "/x" }, "/h")).toBe(
      "/x/Cursor/User/globalStorage/state.vscdb",
    );
    expect(defaultStateDbPath("win32", { APPDATA: "/a" }, "/h")).toBe(
      join("/a", "Cursor", "User", "globalStorage", "state.vscdb"),
    );
  });
});
