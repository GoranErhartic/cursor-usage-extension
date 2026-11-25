import { describe, expect, it } from "vitest";
import {
  buildSessionCookieValue,
  decodeJwtPayload,
  normalizeSessionCookie,
  userIdFromAccessToken,
} from "./jwt";

function fakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

describe("decodeJwtPayload", () => {
  it("decodes payload", () => {
    const token = fakeJwt({ sub: "auth0|user_123" });
    expect(decodeJwtPayload(token)?.sub).toBe("auth0|user_123");
  });

  it("returns null for invalid token", () => {
    expect(decodeJwtPayload("not-a-jwt")).toBeNull();
  });
});

describe("userIdFromAccessToken", () => {
  it("strips auth0 prefix", () => {
    const token = fakeJwt({ sub: "auth0|abc" });
    expect(userIdFromAccessToken(token)).toBe("abc");
  });

  it("keeps sub without prefix", () => {
    const token = fakeJwt({ sub: "user_xyz" });
    expect(userIdFromAccessToken(token)).toBe("user_xyz");
  });
});

describe("buildSessionCookieValue", () => {
  it("builds userId%3A%3Atoken", () => {
    const token = fakeJwt({ sub: "auth0|uid" });
    expect(buildSessionCookieValue(token)).toBe(`uid%3A%3A${token}`);
  });
});

describe("normalizeSessionCookie", () => {
  const jwt = fakeJwt({ sub: "auth0|user_123" });

  it("accepts the canonical raw cookie value", () => {
    expect(normalizeSessionCookie(`user_123%3A%3A${jwt}`)).toBe(`user_123%3A%3A${jwt}`);
  });

  it("re-encodes a :: separator", () => {
    expect(normalizeSessionCookie(`user_123::${jwt}`)).toBe(`user_123%3A%3A${jwt}`);
  });

  it("accepts a lowercase-encoded separator", () => {
    expect(normalizeSessionCookie(`user_123%3a%3a${jwt}`)).toBe(`user_123%3A%3A${jwt}`);
  });

  it("strips the cookie name, quotes and trailing semicolon", () => {
    expect(normalizeSessionCookie(`"WorkosCursorSessionToken=user_123%3A%3A${jwt}";`)).toBe(
      `user_123%3A%3A${jwt}`,
    );
  });

  it("strips an auth0 prefix from the user id", () => {
    expect(normalizeSessionCookie(`auth0|user_123%3A%3A${jwt}`)).toBe(`user_123%3A%3A${jwt}`);
  });

  it("derives the user id from a bare JWT", () => {
    expect(normalizeSessionCookie(jwt)).toBe(`user_123%3A%3A${jwt}`);
  });

  it("rejects values that are not session cookies", () => {
    expect(normalizeSessionCookie("")).toBeNull();
    expect(normalizeSessionCookie("hello world")).toBeNull();
    expect(normalizeSessionCookie(`user_123%3A%3Anot-a-jwt`)).toBeNull();
    expect(normalizeSessionCookie(fakeJwt({}))).toBeNull();
  });
});
