import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  buildLoginUrl,
  createLoginHandshake,
  LoginError,
  pollForLoginTokens,
  refreshSession,
  REFRESH_URL,
} from "./browserLogin";

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

describe("handshake", () => {
  it("challenge is base64url(sha256(verifier)) and URL carries the params", () => {
    const h = createLoginHandshake();
    expect(h.challenge).toBe(createHash("sha256").update(h.verifier).digest("base64url"));
    const url = new URL(buildLoginUrl(h));
    expect(url.origin + url.pathname).toBe("https://cursor.com/loginDeepControl");
    expect(url.searchParams.get("challenge")).toBe(h.challenge);
    expect(url.searchParams.get("uuid")).toBe(h.uuid);
    expect(url.searchParams.get("mode")).toBe("login");
    expect(url.toString()).not.toContain(h.verifier);
  });
});

describe("pollForLoginTokens", () => {
  const h = createLoginHandshake();
  const sleep = async () => undefined;

  it("polls through 404 then returns tokens, sending uuid and verifier", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(404))
      .mockResolvedValueOnce(json(200, { accessToken: "a", refreshToken: "r" }));
    const tokens = await pollForLoginTokens(h, { fetch, sleep });
    expect(tokens).toEqual({ accessToken: "a", refreshToken: "r" });
    expect(fetch).toHaveBeenCalledTimes(2);
    const url = new URL(fetch.mock.calls[0][0] as string);
    expect(url.searchParams.get("uuid")).toBe(h.uuid);
    expect(url.searchParams.get("verifier")).toBe(h.verifier);
  });

  it("stops on 403 policy", async () => {
    const fetch = vi.fn().mockResolvedValue(json(403));
    await expect(pollForLoginTokens(h, { fetch, sleep })).rejects.toMatchObject({
      code: "policy",
    });
  });

  it("times out", async () => {
    let t = 0;
    const fetch = vi.fn().mockResolvedValue(json(404));
    await expect(
      pollForLoginTokens(h, { fetch, sleep, timeoutMs: 10, now: () => (t += 6) }),
    ).rejects.toMatchObject({ code: "timeout" });
  });

  it("aborts", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const fetch = vi.fn();
    const err = await pollForLoginTokens(h, { fetch, sleep, signal: ctrl.signal }).catch((e) => e);
    expect(err).toBeInstanceOf(LoginError);
    expect(err.code).toBe("cancelled");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a malformed 200", async () => {
    const fetch = vi.fn().mockResolvedValue(json(200, { accessToken: "a" }));
    await expect(pollForLoginTokens(h, { fetch, sleep })).rejects.toMatchObject({
      code: "bad-response",
    });
  });
});

describe("refreshSession", () => {
  it("sends the expected request and returns a new token, keeping old refresh token", async () => {
    const fetch = vi.fn().mockResolvedValue(json(200, { access_token: "new", shouldLogout: false }));
    const res = await refreshSession("rt", fetch);
    expect(res).toEqual({ kind: "ok", accessToken: "new" });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(REFRESH_URL);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "content-type": "application/json",
      "x-cursor-client-type": "ide",
    });
    expect(JSON.parse(init.body)).toEqual({
      grant_type: "refresh_token",
      client_id: "KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB",
      refresh_token: "rt",
    });
  });

  it("returns a rotated refresh token when present", async () => {
    const fetch = vi.fn().mockResolvedValue(json(200, { access_token: "n", refresh_token: "r2" }));
    expect(await refreshSession("rt", fetch)).toEqual({
      kind: "ok",
      accessToken: "n",
      refreshToken: "r2",
    });
  });

  it("logout on shouldLogout", async () => {
    const fetch = vi.fn().mockResolvedValue(json(200, { access_token: "", shouldLogout: true }));
    expect(await refreshSession("rt", fetch)).toEqual({ kind: "logout" });
  });

  it("policy on 403", async () => {
    expect(await refreshSession("rt", vi.fn().mockResolvedValue(json(403)))).toEqual({
      kind: "policy",
    });
  });

  it("transient on 5xx and network failure", async () => {
    expect(await refreshSession("rt", vi.fn().mockResolvedValue(json(503)))).toEqual({
      kind: "transient",
    });
    expect(await refreshSession("rt", vi.fn().mockRejectedValue(new Error("x")))).toEqual({
      kind: "transient",
    });
  });
});
