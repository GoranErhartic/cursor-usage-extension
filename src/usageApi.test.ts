import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchUsageSummary,
  fetchUsageSummaryWithCookie,
  UsageFetchError,
} from "./usageApi";
import { fakeJwt } from "./testHelpers";

const token = fakeJwt({ sub: "auth0|test-user" });

describe("fetchUsageSummary", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses individualUsage.overall", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          billingCycleStart: "2026-10-01T00:00:00.000Z",
          billingCycleEnd: "2026-11-01T00:00:00.000Z",
          individualUsage: {
            overall: { enabled: true, used: 10555, limit: 20000, remaining: 9445 },
          },
        }),
      }),
    );

    const result = await fetchUsageSummary(token);
    expect(result.overall).toEqual({
      enabled: true,
      used: 10555,
      limit: 20000,
      remaining: 9445,
    });
    expect(result.billingCycleStart).toBe("2026-10-01T00:00:00.000Z");
  });

  it("falls back to top-level overall", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          overall: { enabled: true, used: 1, limit: 2, remaining: 1 },
        }),
      }),
    );

    const result = await fetchUsageSummary(token);
    expect(result.overall.used).toBe(1);
  });

  it("maps 401 to unauthorized", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({}),
      }),
    );

    await expect(fetchUsageSummary(token)).rejects.toMatchObject({
      code: "unauthorized",
    });
  });

  it("rejects bad response shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ overall: { used: "nope" } }),
      }),
    );

    await expect(fetchUsageSummary(token)).rejects.toBeInstanceOf(UsageFetchError);
  });
});

describe("fetchUsageSummaryWithCookie", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the cookie value unchanged and parses the usage", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ overall: { enabled: true, used: 5, limit: 10, remaining: 5 } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchUsageSummaryWithCookie("user_1%3A%3Aa.b.c");
    expect(result.overall.used).toBe(5);
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers.Cookie).toBe("WorkosCursorSessionToken=user_1%3A%3Aa.b.c");
  });

  it("maps a rejected cookie to unauthorized without retrying with other values", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchUsageSummaryWithCookie("user_1%3A%3Aa.b.c")).rejects.toMatchObject({
      code: "unauthorized",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty cookie before calling the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchUsageSummaryWithCookie("")).rejects.toMatchObject({ code: "no-token" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
