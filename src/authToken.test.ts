import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCipheriv, pbkdf2Sync } from "node:crypto";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuthTokenError,
  decryptSafeStorageValue,
  defaultStateDbPath,
  readAccessToken,
  SAFE_STORAGE_PREFIX,
} from "./authToken";

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

  describe("decryptSafeStorageValue", () => {
    const password = "test-keychain-password";
    const plain = "header.payload.signature";

    function encrypt(text: string): string {
      const key = pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
      const cipher = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
      const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
      return SAFE_STORAGE_PREFIX + Buffer.concat([Buffer.from("v10"), body]).toString("base64");
    }

    it("decrypts a wrapped v10 value", async () => {
      await expect(
        decryptSafeStorageValue(encrypt(plain), "darwin", async () => password),
      ).resolves.toBe(plain);
    });

    it("passes plain values through without touching the keychain", async () => {
      const getPassword = vi.fn(async () => password);
      await expect(decryptSafeStorageValue(plain, "darwin", getPassword)).resolves.toBe(plain);
      expect(getPassword).not.toHaveBeenCalled();
    });

    it("decrypts Linux v11 (keyring) and v10 (fallback) values", async () => {
      const enc = (pw: string, tag: string) => {
        const key = pbkdf2Sync(pw, "saltysalt", 1, 16, "sha1");
        const c = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
        const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
        return SAFE_STORAGE_PREFIX + Buffer.concat([Buffer.from(tag), body]).toString("base64");
      };
      await expect(
        decryptSafeStorageValue(enc(password, "v11"), "linux", { getPassword: async () => password }),
      ).resolves.toBe(plain);
      await expect(decryptSafeStorageValue(enc("peanuts", "v10"), "linux")).resolves.toBe(plain);
    });

    it("decrypts a Windows AES-256-GCM value", async () => {
      const key = Buffer.alloc(32, 7);
      const nonce = Buffer.alloc(12, 3);
      const c = createCipheriv("aes-256-gcm", key, nonce);
      const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
      const value =
        SAFE_STORAGE_PREFIX +
        Buffer.concat([Buffer.from("v10"), nonce, ct, c.getAuthTag()]).toString("base64");
      await expect(
        decryptSafeStorageValue(value, "win32", { getWindowsKey: async () => key }),
      ).resolves.toBe(plain);
      await expect(
        decryptSafeStorageValue(value, "win32", { getWindowsKey: async () => Buffer.alloc(32) }),
      ).rejects.toThrow(/report it at .*issues/);
    });

    it("gives a reportable error on unsupported platforms", async () => {
      await expect(
        decryptSafeStorageValue(encrypt(plain), "freebsd" as NodeJS.Platform),
      ).rejects.toThrow(/Failed to obtain the decoded JWT session token.*report it/s);
    });

    it("fails clearly on wrong password or keychain denial", async () => {
      await expect(
        decryptSafeStorageValue(encrypt(plain), "darwin", async () => "wrong"),
      ).rejects.toMatchObject({ code: "encrypted" });
      await expect(
        decryptSafeStorageValue(encrypt(plain), "darwin", async () => {
          throw new Error("denied");
        }),
      ).rejects.toMatchObject({ code: "encrypted" });
    });
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
