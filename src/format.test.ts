import { describe, expect, it } from "vitest";
import { formatCents, formatUsage, percentUsed } from "./format";

describe("formatCents", () => {
  it("formats fractional dollars", () => {
    expect(formatCents(10555)).toBe("$105.55");
  });

  it("drops .00 for whole dollars", () => {
    expect(formatCents(20000)).toBe("$200");
    expect(formatCents(100)).toBe("$1");
  });
});

describe("formatUsage", () => {
  it("formats used/limit", () => {
    expect(formatUsage(10555, 20000)).toBe("$105.55/$200");
  });

  it("formats used only when limit is zero", () => {
    expect(formatUsage(500, 0)).toBe("$5");
  });
});

describe("percentUsed", () => {
  it("returns percentage", () => {
    expect(percentUsed(8000, 10000)).toBe(80);
  });

  it("returns null when limit is zero", () => {
    expect(percentUsed(100, 0)).toBeNull();
  });
});
