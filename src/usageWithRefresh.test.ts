import { describe, expect, it, vi } from "vitest";
import { UsageFetchError, type UsageSummary } from "./usageApi";
import { fetchUsageWithRefresh } from "./usageWithRefresh";

const summary: UsageSummary = {
  overall: { enabled: true, used: 1, limit: 2, remaining: 1 },
};
const unauthorized = () => new UsageFetchError("no", "unauthorized");
const tokens = { accessToken: "old", refreshToken: "rt" };

function deps(over: Partial<Parameters<typeof fetchUsageWithRefresh>[0]> = {}) {
  return {
    tokens,
    fetchUsage: vi.fn().mockResolvedValue(summary),
    refresh: vi.fn(),
    save: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

describe("fetchUsageWithRefresh", () => {
  it("does not refresh when the first call succeeds", async () => {
    const d = deps();
    expect(await fetchUsageWithRefresh(d)).toBe(summary);
    expect(d.refresh).not.toHaveBeenCalled();
  });

  it("refreshes, saves and retries once", async () => {
    const d = deps({
      fetchUsage: vi.fn().mockRejectedValueOnce(unauthorized()).mockResolvedValueOnce(summary),
      refresh: vi.fn().mockResolvedValue({ kind: "ok", accessToken: "new" }),
    });
    expect(await fetchUsageWithRefresh(d)).toBe(summary);
    expect(d.save).toHaveBeenCalledWith({ accessToken: "new", refreshToken: "rt" });
    expect(d.fetchUsage).toHaveBeenLastCalledWith("new");
  });

  it("does not loop when the retry is still unauthorized", async () => {
    const d = deps({
      fetchUsage: vi.fn().mockRejectedValue(unauthorized()),
      refresh: vi.fn().mockResolvedValue({ kind: "ok", accessToken: "new" }),
    });
    await expect(fetchUsageWithRefresh(d)).rejects.toMatchObject({ code: "unauthorized" });
    expect(d.fetchUsage).toHaveBeenCalledTimes(2);
    expect(d.refresh).toHaveBeenCalledTimes(1);
  });

  it("clears tokens on logout and policy", async () => {
    for (const kind of ["logout", "policy"] as const) {
      const d = deps({
        fetchUsage: vi.fn().mockRejectedValue(unauthorized()),
        refresh: vi.fn().mockResolvedValue({ kind }),
      });
      await expect(fetchUsageWithRefresh(d)).rejects.toMatchObject({ code: "no-token" });
      expect(d.clear).toHaveBeenCalled();
    }
  });

  it("keeps tokens on a transient refresh failure", async () => {
    const d = deps({
      fetchUsage: vi.fn().mockRejectedValue(unauthorized()),
      refresh: vi.fn().mockResolvedValue({ kind: "transient" }),
    });
    await expect(fetchUsageWithRefresh(d)).rejects.toMatchObject({ code: "network" });
    expect(d.clear).not.toHaveBeenCalled();
  });

  it("does not refresh on non-auth errors", async () => {
    const d = deps({ fetchUsage: vi.fn().mockRejectedValue(new UsageFetchError("x", "network")) });
    await expect(fetchUsageWithRefresh(d)).rejects.toMatchObject({ code: "network" });
    expect(d.refresh).not.toHaveBeenCalled();
  });
});
