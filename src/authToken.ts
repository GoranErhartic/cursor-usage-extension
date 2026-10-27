import { execFile } from "node:child_process";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { readFile } from "node:fs/promises";
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
const ISSUES_URL = "https://github.com/GoranErhartic/cursor-usage-extension/issues";
/** Chromium's hardcoded Linux fallback password when no keyring is available ("v10"). */
const LINUX_FALLBACK_PASSWORD = "peanuts";

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

/** Reads the safeStorage password from the Linux Secret Service (libsecret) keyring. */
export async function readLinuxKeyringPassword(): Promise<string> {
  const { stdout } = await execFileAsync("secret-tool", ["lookup", "application", "cursor"]);
  const password = stdout.trim();
  if (!password) {
    throw new Error("Empty keyring password");
  }
  return password;
}

export function defaultLocalStatePath(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  return join(env.APPDATA || join(home, "AppData", "Roaming"), "Cursor", "Local State");
}

/**
 * Reads the AES-256 key Chromium keeps in `Local State` (`os_crypt.encrypted_key`),
 * which is protected with Windows DPAPI for the current user.
 */
export async function readWindowsKey(localStatePath: string = defaultLocalStatePath()): Promise<Buffer> {
  const state = JSON.parse(await readFile(localStatePath, "utf8")) as {
    os_crypt?: { encrypted_key?: string };
  };
  const encoded = state.os_crypt?.encrypted_key;
  if (!encoded) {
    throw new Error("No os_crypt.encrypted_key in Local State");
  }
  const blob = Buffer.from(encoded, "base64");
  if (blob.subarray(0, 5).toString("latin1") !== "DPAPI") {
    throw new Error("Unsupported key protection");
  }
  const { stdout } = await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Add-Type -AssemblyName System.Security; " +
        "$b=[Convert]::FromBase64String($env:CURSOR_USAGE_DPAPI_BLOB); " +
        "$k=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser'); " +
        "[Convert]::ToBase64String($k)",
    ],
    { env: { ...process.env, CURSOR_USAGE_DPAPI_BLOB: blob.subarray(5).toString("base64") }, windowsHide: true },
  );
  const key = Buffer.from(stdout.trim(), "base64");
  if (key.length !== 32) {
    throw new Error("Unexpected key length");
  }
  return key;
}

export interface SafeStorageProviders {
  /** macOS: Keychain password. Linux: keyring password (v11 values). */
  getPassword?: () => Promise<string>;
  /** Windows: the DPAPI-unprotected AES-256 key. */
  getWindowsKey?: () => Promise<Buffer>;
}

function decryptionFailure(platform: NodeJS.Platform, detail: string): AuthTokenError {
  const hint =
    platform === "darwin"
      ? " Allow Keychain access to 'Cursor Safe Storage' and refresh."
      : platform === "linux"
        ? " Make sure a Secret Service keyring (e.g. GNOME Keyring or KWallet) is unlocked and 'secret-tool' is installed, then refresh."
        : " Make sure you are running as the same Windows user that signed in to Cursor, then refresh.";
  return new AuthTokenError(
    `Failed to obtain the decoded JWT session token from Cursor's encrypted storage (${detail}).${hint} ` +
      `If it keeps failing, please report it at ${ISSUES_URL} including your OS and Cursor version.`,
    "encrypted",
  );
}

function decryptCbc(password: string, iterations: number, body: Buffer): string {
  const key = pbkdf2Sync(password, "saltysalt", iterations, 16, "sha1");
  const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8").trim();
}

function decryptGcm(key: Buffer, body: Buffer): string {
  if (body.length < 12 + 16) {
    throw new Error("Payload too short");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, body.subarray(0, 12));
  decipher.setAuthTag(body.subarray(body.length - 16));
  return Buffer.concat([decipher.update(body.subarray(12, body.length - 16)), decipher.final()])
    .toString("utf8")
    .trim();
}

/**
 * Decrypts a `cursor-safe-storage:v1:` value using the Chromium OSCrypt scheme of the
 * current platform (macOS: PBKDF2/AES-128-CBC with Keychain password; Linux: same with
 * keyring password or "peanuts"; Windows: AES-256-GCM with DPAPI-protected key).
 * Plain (unwrapped) values are returned unchanged.
 */
export async function decryptSafeStorageValue(
  value: string,
  platform: NodeJS.Platform = process.platform,
  providers: SafeStorageProviders | (() => Promise<string>) = {},
): Promise<string> {
  if (!value.startsWith(SAFE_STORAGE_PREFIX)) {
    return value;
  }
  const { getPassword, getWindowsKey }: SafeStorageProviders =
    typeof providers === "function" ? { getPassword: providers } : providers;
  try {
    const payload = Buffer.from(value.slice(SAFE_STORAGE_PREFIX.length), "base64");
    const version = payload.subarray(0, 3).toString("latin1");
    const body = payload.subarray(3);
    switch (platform) {
      case "darwin":
        if (version !== "v10") {
          throw new Error(`unsupported scheme ${version}`);
        }
        return decryptCbc(await (getPassword ?? readKeychainPassword)(), 1003, body);
      case "linux":
        if (version === "v10") {
          return decryptCbc(LINUX_FALLBACK_PASSWORD, 1, body);
        }
        if (version === "v11") {
          return decryptCbc(await (getPassword ?? readLinuxKeyringPassword)(), 1, body);
        }
        throw new Error(`unsupported scheme ${version}`);
      case "win32":
        if (version !== "v10") {
          throw new Error(`unsupported scheme ${version}`);
        }
        return decryptGcm(await (getWindowsKey ?? readWindowsKey)(), body);
      default:
        throw new Error(`unsupported platform ${platform}`);
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : "unknown error";
    throw decryptionFailure(platform, detail);
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
