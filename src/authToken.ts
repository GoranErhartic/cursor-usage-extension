import { homedir } from "node:os";
import { join } from "node:path";
import { readKeyValue } from "./sqliteReader";

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
    readonly code: "missing" | "db" | "timeout",
  ) {
    super(message);
    this.name = "AuthTokenError";
  }
}

async function readTokenOnce(dbPath: string): Promise<string> {
  const token = (await readKeyValue(dbPath, "ItemTable", TOKEN_KEY))?.trim();
  if (!token) {
    throw new AuthTokenError("No Cursor access token in state database.", "missing");
  }
  return token;
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
