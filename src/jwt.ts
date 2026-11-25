/** Decode JWT payload without verifying signature (local session token only). */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** User id for WorkosCursorSessionToken cookie (strip auth0| prefix). */
export function userIdFromAccessToken(accessToken: string): string | null {
  const payload = decodeJwtPayload(accessToken);
  const sub = payload?.sub;
  if (typeof sub !== "string" || !sub) {
    return null;
  }
  return sub.replace(/^auth0\|/, "");
}

export function buildSessionCookieValue(accessToken: string): string | null {
  const userId = userIdFromAccessToken(accessToken);
  if (!userId) {
    return null;
  }
  return `${userId}%3A%3A${accessToken}`;
}

const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const USER_ID_PATTERN = /^[A-Za-z0-9_.|%-]+$/;

/**
 * Turns a value copied from the browser into the canonical `WorkosCursorSessionToken`
 * value (`userId%3A%3Ajwt`). Accepts the raw cookie value (`%3A%3A` or `::` separator),
 * the full `WorkosCursorSessionToken=...` pair, or a bare JWT (user id read from its `sub`).
 * Returns null when the input does not look like a session cookie.
 */
export function normalizeSessionCookie(input: string): string | null {
  let value = input.trim().replace(/;$/, "").trim();
  value = value.replace(/^(["'])(.*)\1$/, "$2");
  value = value.replace(/^WorkosCursorSessionToken=/, "");
  value = value.replace(/::/g, "%3A%3A").replace(/%3a%3a/gi, "%3A%3A");

  const separated = value.match(/^(.+?)%3A%3A(.+)$/);
  if (separated) {
    const userId = separated[1].replace(/^auth0(\||%7C)/i, "");
    const token = separated[2];
    if (!USER_ID_PATTERN.test(userId) || !JWT_PATTERN.test(token)) {
      return null;
    }
    return `${userId}%3A%3A${token}`;
  }

  if (JWT_PATTERN.test(value)) {
    return buildSessionCookieValue(value);
  }
  return null;
}
