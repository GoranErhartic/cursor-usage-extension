import { describe, expect, it } from "vitest";
import {
  buildSessionCookieValue,
  decodeJwtPayload,
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
