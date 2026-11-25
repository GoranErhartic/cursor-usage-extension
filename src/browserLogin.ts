import { createHash, randomBytes, randomUUID } from "node:crypto";

export const LOGIN_URL = "https://cursor.com/loginDeepControl";
export const POLL_URL = "https://api2.cursor.sh/auth/poll";
export const REFRESH_URL = "https://api2.cursor.sh/oauth/token";
const CLIENT_ID = "KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB";
const REQUEST_TIMEOUT_MS = 15_000;

export interface LoginHandshake {
  uuid: string;
  /** Secret. Never log. */
  verifier: string;
  challenge: string;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class LoginError extends Error {
  constructor(
    message: string,
    readonly code: "policy" | "timeout" | "cancelled" | "network" | "bad-response",
  ) {
    super(message);
    this.name = "LoginError";
  }
}

export function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function createLoginHandshake(): LoginHandshake {
  const verifier = randomBytes(32).toString("base64url");
  return { uuid: randomUUID(), verifier, challenge: challengeFor(verifier) };
}

export function buildLoginUrl(handshake: LoginHandshake): string {
  const url = new URL(LOGIN_URL);
  url.searchParams.set("challenge", handshake.challenge);
  url.searchParams.set("uuid", handshake.uuid);
  url.searchParams.set("mode", "login");
  return url.toString();
}

export interface PollOptions {
  fetch?: FetchLike;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
  /** Total time to wait for the user to finish signing in. */
  timeoutMs?: number;
  intervalMs?: number;
  now?: () => number;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

function isTokens(body: unknown): body is { accessToken: string; refreshToken: string } {
  if (!body || typeof body !== "object") {
    return false;
  }
  const b = body as Record<string, unknown>;
  return (
    typeof b.accessToken === "string" &&
    b.accessToken !== "" &&
    typeof b.refreshToken === "string" &&
    b.refreshToken !== ""
  );
}

/** Polls until the browser sign-in completes. 404 means "not yet". */
export async function pollForLoginTokens(
  handshake: LoginHandshake,
  options: PollOptions = {},
): Promise<Tokens> {
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const deadline = now() + timeoutMs;
  const url = new URL(POLL_URL);
  url.searchParams.set("uuid", handshake.uuid);
  url.searchParams.set("verifier", handshake.verifier);

  while (true) {
    if (options.signal?.aborted) {
      throw new LoginError("Sign-in cancelled.", "cancelled");
    }
    if (now() >= deadline) {
      throw new LoginError("Sign-in timed out.", "timeout");
    }
    let response: Response | undefined;
    try {
      response = await doFetch(url.toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: options.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
          : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      if (options.signal?.aborted) {
        throw new LoginError("Sign-in cancelled.", "cancelled");
      }
      // Transient network error: keep polling until the deadline.
    }
    if (response) {
      if (response.status === 200) {
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          throw new LoginError("Unexpected sign-in response.", "bad-response");
        }
        if (!isTokens(body)) {
          throw new LoginError("Unexpected sign-in response.", "bad-response");
        }
        return { accessToken: body.accessToken, refreshToken: body.refreshToken };
      }
      if (response.status === 403) {
        throw new LoginError("Your account's sign-in policy blocked this login.", "policy");
      }
      if (response.status !== 404) {
        throw new LoginError(`Sign-in service returned ${response.status}.`, "bad-response");
      }
    }
    await sleep(intervalMs, options.signal);
  }
}

export type RefreshResult =
  | { kind: "ok"; accessToken: string; refreshToken?: string }
  | { kind: "logout" }
  | { kind: "policy" }
  | { kind: "transient" };

/** Exchanges the refresh token for a new access token. Never throws. */
export async function refreshSession(
  refreshToken: string,
  doFetch: FetchLike = fetch,
): Promise<RefreshResult> {
  let response: Response;
  try {
    response = await doFetch(REFRESH_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-cursor-client-type": "ide" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: CLIENT_ID,
        refresh_token: refreshToken,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { kind: "transient" };
  }
  if (response.status === 403) {
    return { kind: "policy" };
  }
  if (!response.ok) {
    return { kind: "transient" };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: "transient" };
  }
  if (!body || typeof body !== "object") {
    return { kind: "transient" };
  }
  const b = body as Record<string, unknown>;
  if (b.shouldLogout === true) {
    return { kind: "logout" };
  }
  if (typeof b.access_token !== "string" || b.access_token === "") {
    return { kind: "transient" };
  }
  const result: RefreshResult = { kind: "ok", accessToken: b.access_token };
  if (typeof b.refresh_token === "string" && b.refresh_token !== "") {
    result.refreshToken = b.refresh_token;
  }
  return result;
}
