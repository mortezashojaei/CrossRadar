import { describe, expect, it } from "vitest";
import { scoreMetrics } from "../src/core/scoring";
import { RouteMetrics } from "../src/adapters/types";

const baseMetrics: RouteMetrics = {
  key: { protocol: "Across", srcChain: "ETH", dstChain: "ARB" },
  windowStart: new Date().toISOString(),
  windowEnd: new Date().toISOString(),
  txCount: 10,
  usdVolume: 1000,
  medianCompletionMinutes: 3,
  successRate: 0.995,
};

describe("scoreMetrics", () => {
  it("flags low success as red", () => {
    const status = scoreMetrics({ ...baseMetrics, successRate: 0.9 });
    expect(status.emoji).toBe("🔴");
  });

  it("flags slow median as yellow", () => {
    const status = scoreMetrics({ ...baseMetrics, medianCompletionMinutes: 7 });
    expect(status.emoji).toBe("🟡");
  });

  it("returns white when no data", () => {
    const status = scoreMetrics({
      ...baseMetrics,
      txCount: 0,
      successRate: null,
      medianCompletionMinutes: null,
    });
    expect(status.emoji).toBe("⚪");
  });
});
