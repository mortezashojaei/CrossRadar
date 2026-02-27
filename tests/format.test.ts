import { describe, expect, it } from "vitest";
import { formatReport } from "../src/reporting/format";
import { RouteMetrics } from "../src/adapters/types";
import { scoreMetrics } from "../src/core/scoring";

const metrics: RouteMetrics = {
  key: { protocol: "Across", srcChain: "ETH", dstChain: "ARB" },
  windowStart: new Date().toISOString(),
  windowEnd: new Date().toISOString(),
  txCount: 2,
  usdVolume: 123.45,
  medianCompletionMinutes: 4,
  successRate: 1,
  notes: ["special_characters *here*"],
};

describe("formatReport", () => {
  it("escapes markdown", () => {
    const text = formatReport(
      [
        {
          metrics,
          status: scoreMetrics(metrics),
        },
      ],
      new Date(metrics.windowStart),
      new Date(metrics.windowEnd)
    );
    expect(text).toContain("special\\_characters");
  });
});
