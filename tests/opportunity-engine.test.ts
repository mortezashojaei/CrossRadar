import { describe, expect, it } from "vitest";
import {
  computeEdgeMetrics,
  decideOpportunity,
  rankOpportunities,
} from "../src/opportunity/engine";
import { buildQualityReport } from "../src/opportunity/quality";
import { joinIntentsToFills } from "../src/opportunity/join";
import { runBacktest } from "../src/opportunity/backtest";
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

describe("rankOpportunities", () => {
  it("filters by thresholds and sorts by EV then confidence", () => {
    const metrics: LaneMetrics[] = [
      {
        protocol: "relay",
        srcChainId: 1,
        dstChainId: 10,
        sizeBucket: "medium",
        bucketStartIso: "2024-01-01T00:00:00.000Z",
        sampleCount: 30,
        successRate: 0.99,
        grossEdgeUsd: 20,
        netEdgeUsd: 18,
        expectedValueUsd: 15,
        riskAdjustedEdge: 12,
        confidence: 0.8,
      },
      {
        protocol: "across",
        srcChainId: 1,
        dstChainId: 42161,
        sizeBucket: "small",
        bucketStartIso: "2024-01-01T00:00:00.000Z",
        sampleCount: 12,
        successRate: 0.97,
        grossEdgeUsd: 8,
        netEdgeUsd: 5,
        expectedValueUsd: 3,
        riskAdjustedEdge: 2,
        confidence: 0.95,
      },
    ];

    const ranked = rankOpportunities(
      metrics,
      {
        "relay:1->10": 0.02,
        "across:1->42161": 0.03,
      },
      {
        minSampleCount: 20,
        minEvUsd: 10,
        maxFailRisk: 0.08,
      }
    );

    expect(ranked).toHaveLength(1);
    expect(ranked[0].metric.protocol).toBe("relay");
  });
});

describe("runBacktest", () => {
  it("replays deterministic strategy pnl vs baseline", () => {
    const risk: RiskLimits = {
      laneCapsUsd: { "relay:1->10": 50000 },
      globalInventoryCapUsd: 250000,
      dailyLossCapUsd: 10000,
      minConfidence: 0.7,
      maxFailRisk: 0.08,
      quoteThresholdUsd: 5,
    };

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

    const result = runBacktest(
      [
        {
          metric,
          failRisk: 0.03,
          realizedPnlUsd: 5,
          conservativeBaselinePnlUsd: 1,
        },
        {
          metric: { ...metric, riskAdjustedEdge: -1, expectedValueUsd: -1 },
          failRisk: 0.03,
          realizedPnlUsd: -3,
          conservativeBaselinePnlUsd: 0.5,
        },
      ],
      risk
    );

    expect(result.strategyPnlUsd).toBeCloseTo(5.5);
    expect(result.baselinePnlUsd).toBeCloseTo(1.5);
    expect(result.deltaPnlUsd).toBeCloseTo(4);
    expect(result.quoteCount).toBe(1);
    expect(result.skipCount).toBe(1);
    expect(result.precision).toBe(1);
  });
});
