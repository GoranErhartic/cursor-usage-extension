import { execFile } from "node:child_process";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { readKeyValue } from "./sqliteReader";

const execFileAsync = promisify(execFile);

const TOKEN_KEY = "cursorAuth/accessToken";
const STATE_DB_SEGMENTS = ["Cursor", "User", "globalStorage", "state.vscdb"];

export function defaultStateDbPath(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  switch (platform) {
    case "darwin":
      return join(home, "Library", "Application Support", ...STATE_DB_SEGMENTS);
    case "win32":
      return join(env.APPDATA || join(home, "AppData", "Roaming"), ...STATE_DB_SEGMENTS);
    default:
      return join(env.XDG_CONFIG_HOME || join(home, ".config"), ...STATE_DB_SEGMENTS);
  }
}

export const DEFAULT_STATE_DB_PATH = defaultStateDbPath();

export class AuthTokenError extends Error {
  constructor(
    message: string,
    readonly code: "missing" | "db" | "timeout" | "encrypted",
  ) {
    super(message);
    this.name = "AuthTokenError";
  }
}

/** Recent Cursor versions store the token encrypted with Electron safeStorage. */
export const SAFE_STORAGE_PREFIX = "cursor-safe-storage:v1:";
const KEYCHAIN_SERVICE = "Cursor Safe Storage";

/** Reads the safeStorage password from the macOS login Keychain. */
export async function readKeychainPassword(): Promise<string> {
  const { stdout } = await execFileAsync("security", [
    "find-generic-password",
    "-w",
    "-s",
    KEYCHAIN_SERVICE,
  ]);
  return stdout.trim();
}

/**
 * Decrypts a `cursor-safe-storage:v1:` value (Chromium "v10" scheme on macOS:
 * PBKDF2-SHA1 / AES-128-CBC). Plain (unwrapped) values are returned unchanged.
 */
export async function decryptSafeStorageValue(
  value: string,
  platform: NodeJS.Platform = process.platform,
  getPassword: () => Promise<string> = readKeychainPassword,
): Promise<string> {
  if (!value.startsWith(SAFE_STORAGE_PREFIX)) {
    return value;
  }
  if (platform !== "darwin") {
    throw new AuthTokenError(
      "Cursor encrypted its access token; decryption is only supported on macOS.",
      "encrypted",
    );
  }
  try {
    const payload = Buffer.from(value.slice(SAFE_STORAGE_PREFIX.length), "base64");
    if (payload.subarray(0, 3).toString("latin1") !== "v10") {
      throw new Error("Unsupported encryption scheme");
    }
    const password = await getPassword();
    const key = pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
    const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
    return Buffer.concat([decipher.update(payload.subarray(3)), decipher.final()])
      .toString("utf8")
      .trim();
  } catch {
    throw new AuthTokenError(
      "Could not decrypt Cursor's access token. Allow Keychain access to 'Cursor Safe Storage' and refresh.",
      "encrypted",
    );
  }
}

async function readTokenOnce(dbPath: string): Promise<string> {
  const stored = (await readKeyValue(dbPath, "ItemTable", TOKEN_KEY))?.trim();
  if (!stored) {
    throw new AuthTokenError("No Cursor access token in state database.", "missing");
  }
  return decryptSafeStorageValue(stored);
}

export async function readAccessToken(dbPath: string): Promise<string> {
  try {
    return await readTokenOnce(dbPath);
  } catch (err) {
    if (err instanceof AuthTokenError) {
      throw err;
    }
    // Retry once: Cursor may be mid-write.
    try {
      return await readTokenOnce(dbPath);
    } catch (retryErr) {
      if (retryErr instanceof AuthTokenError) {
        throw retryErr;
      }
      throw new AuthTokenError(
        "Could not read Cursor state database. Sign in to Cursor or check cursorUsage.stateDbPath.",
        "db",
      );
    }
  }
}
