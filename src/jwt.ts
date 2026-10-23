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
