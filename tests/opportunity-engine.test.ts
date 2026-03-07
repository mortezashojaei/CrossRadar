import { describe, expect, it } from "vitest";
import { computeEdgeMetrics, decideOpportunity } from "../src/opportunity/engine";
import { buildQualityReport } from "../src/opportunity/quality";
import { joinIntentsToFills } from "../src/opportunity/join";
import { FillOutcome, IntentEvent, LaneMetrics, RiskLimits } from "../src/opportunity/contracts";

describe("joinIntentsToFills", () => {
  it("joins by request id before tx hash", () => {
    const intents: IntentEvent[] = [
      {
        canonicalIntentId: "i-1",
        protocol: "relay",
        sourceRequestId: "r-123",
        srcChainId: 1,
        dstChainId: 10,
        tokenIn: "USDC",
        tokenOut: "USDC",
        amountIn: 1000n,
        intentTimestamp: new Date("2024-01-01T00:00:00Z"),
        status: "success",
        rawPayload: { inTxHash: "0xaaa" },
      },
    ];

    const fills: FillOutcome[] = [
      {
        protocol: "relay",
        requestId: "r-123",
        inTxHash: "0xbbb",
        srcChainId: 1,
        dstChainId: 10,
        tokenIn: "USDC",
        tokenOut: "USDC",
        amountIn: 1000n,
        fillAmountOut: 995n,
        status: "success",
        rawPayload: {},
      },
    ];

    const result = joinIntentsToFills(intents, fills);
    expect(result.unmatchedIntentIds).toEqual([]);
    expect(result.joined).toHaveLength(1);
    expect(result.joined[0].provenance.linkType).toBe("request_id");
    expect(result.joined[0].provenance.confidence).toBe(1);
  });
});

describe("computeEdgeMetrics", () => {
  it("computes EV and risk adjusted edge", () => {
    const metrics = computeEdgeMetrics({
      quoteAmountOutUsd: 101,
      fillAmountOutUsd: 100,
      successProbability: 0.95,
      failureLossUsd: 3,
      confidenceScore: 0.8,
      stabilityMultiplier: 0.9,
      costs: [
        { costType: "gas", amountUsd: 0.2 },
        { costType: "protocol_fee", amountUsd: 0.1 },
      ],
    });

    expect(metrics.grossEdgeUsd).toBeCloseTo(1);
    expect(metrics.totalCostsUsd).toBeCloseTo(0.3);
    expect(metrics.netEdgeUsd).toBeCloseTo(0.7);
    expect(metrics.expectedValueUsd).toBeCloseTo(0.515);
    expect(metrics.riskAdjustedEdge).toBeCloseTo(0.3708);
  });
});

describe("buildQualityReport", () => {
  it("fails checks when below thresholds", () => {
    const report = buildQualityReport(
      {
        totalCandidateIntents: 100,
        joinedWithQuoteIntents: 80,
        deterministicJoinCount: 96,
        tokenResolutionSuccessCount: 90,
        gasFeeCompleteCount: 98,
      },
      {
        quoteCoveragePct: 95,
        deterministicJoinPct: 95,
        tokenResolutionPct: 99,
        gasFeeCompletenessPct: 98,
      }
    );

    expect(report.passed).toBe(false);
    expect(report.failingChecks).toEqual([
      "quoteCoveragePct",
      "tokenResolutionPct",
    ]);
  });
});

describe("decideOpportunity", () => {
  it("returns quote when edge and policy checks pass", () => {
    const metric: LaneMetrics = {
      protocol: "relay",
      srcChainId: 1,
      dstChainId: 10,
      sizeBucket: "medium",
      bucketStartIso: "2024-01-01T00:00:00.000Z",
      sampleCount: 30,
      successRate: 0.98,
      grossEdgeUsd: 40,
      netEdgeUsd: 30,
      expectedValueUsd: 20,
      riskAdjustedEdge: 10,
      confidence: 0.9,
    };

    const risk: RiskLimits = {
      laneCapsUsd: { "relay:1->10": 50000 },
      globalInventoryCapUsd: 250000,
      dailyLossCapUsd: 10000,
      minConfidence: 0.7,
      maxFailRisk: 0.08,
      quoteThresholdUsd: 5,
    };

    const decision = decideOpportunity(metric, risk, 0.03);
    expect(decision.action).toBe("quote");
    expect(decision.maxSizeUsd).toBe(50000);
  });
});
