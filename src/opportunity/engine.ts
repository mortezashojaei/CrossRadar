import {
  EdgeComputationInput,
  EdgeMetrics,
  LaneMetrics,
  OpportunityDecision,
  RiskLimits,
  SizeBucket,
} from "./contracts";

const COST_FLOOR = 0;

export type RankingThresholds = {
  minSampleCount: number;
  minEvUsd: number;
  maxFailRisk: number;
};

export type RankedOpportunity = {
  metric: LaneMetrics;
  failRisk: number;
};

export function computeEdgeMetrics(input: EdgeComputationInput): EdgeMetrics {
  const grossEdgeUsd = input.quoteAmountOutUsd - input.fillAmountOutUsd;
  const totalCostsUsd = input.costs.reduce(
    (sum, item) => sum + Math.max(COST_FLOOR, item.amountUsd),
    0
  );
  const netEdgeUsd = grossEdgeUsd - totalCostsUsd;
  const expectedValueUsd =
    input.successProbability * netEdgeUsd -
    (1 - input.successProbability) * input.failureLossUsd;
  const riskAdjustedEdge =
    expectedValueUsd * input.confidenceScore * input.stabilityMultiplier;

  return {
    grossEdgeUsd,
    totalCostsUsd,
    netEdgeUsd,
    expectedValueUsd,
    riskAdjustedEdge,
  };
}

export function mapAmountToSizeBucket(amountInUsd: number): SizeBucket {
  if (amountInUsd < 1_000) return "small";
  if (amountInUsd < 10_000) return "medium";
  return "large";
}

export function aggregateLaneMetrics(metrics: LaneMetrics[]): LaneMetrics[] {
  const grouped = new Map<string, LaneMetrics[]>();
  for (const metric of metrics) {
    const key = `${metric.protocol}:${metric.srcChainId}->${metric.dstChainId}:${metric.sizeBucket}:${metric.bucketStartIso}`;
    const existing = grouped.get(key) ?? [];
    existing.push(metric);
    grouped.set(key, existing);
  }

  return Array.from(grouped.values()).map((group) => {
    const head = group[0];
    const sampleCount = group.reduce((sum, item) => sum + item.sampleCount, 0);
    const weighted = (pick: (m: LaneMetrics) => number) =>
      group.reduce((sum, item) => sum + pick(item) * item.sampleCount, 0) /
      sampleCount;

    return {
      ...head,
      sampleCount,
      successRate: weighted((m) => m.successRate),
      grossEdgeUsd: weighted((m) => m.grossEdgeUsd),
      netEdgeUsd: weighted((m) => m.netEdgeUsd),
      expectedValueUsd: weighted((m) => m.expectedValueUsd),
      riskAdjustedEdge: weighted((m) => m.riskAdjustedEdge),
      confidence: weighted((m) => m.confidence),
    };
  });
}

export function rankOpportunities(
  metrics: LaneMetrics[],
  failRiskByLane: Record<string, number>,
  thresholds: RankingThresholds
): RankedOpportunity[] {
  return metrics
    .map((metric) => ({ metric, failRisk: failRiskByLane[laneId(metric)] ?? 1 }))
    .filter(
      ({ metric, failRisk }) =>
        metric.sampleCount >= thresholds.minSampleCount &&
        metric.expectedValueUsd >= thresholds.minEvUsd &&
        failRisk <= thresholds.maxFailRisk
    )
    .sort((a, b) => {
      if (b.metric.expectedValueUsd !== a.metric.expectedValueUsd) {
        return b.metric.expectedValueUsd - a.metric.expectedValueUsd;
      }
      return b.metric.confidence - a.metric.confidence;
    });
}

function laneId(metric: Pick<LaneMetrics, "protocol" | "srcChainId" | "dstChainId">): string {
  return `${metric.protocol}:${metric.srcChainId}->${metric.dstChainId}`;
}

export function decideOpportunity(
  metric: LaneMetrics,
  risk: RiskLimits,
  failRisk: number
): OpportunityDecision {
  if (metric.confidence < risk.minConfidence) {
    return {
      action: "skip",
      minSpreadBps: 0,
      maxSizeUsd: 0,
      confidence: metric.confidence,
      reason: "confidence below policy minimum",
    };
  }

  if (failRisk > risk.maxFailRisk) {
    return {
      action: "skip",
      minSpreadBps: 0,
      maxSizeUsd: 0,
      confidence: metric.confidence,
      reason: "fail risk above policy maximum",
    };
  }

  const cap = risk.laneCapsUsd[laneId(metric)] ?? 0;
  if (cap <= 0) {
    return {
      action: "skip",
      minSpreadBps: 0,
      maxSizeUsd: 0,
      confidence: metric.confidence,
      reason: "lane cap missing or zero",
    };
  }

  const minSpreadBps = metric.grossEdgeUsd <= 0 ? 0 : Math.ceil((metric.grossEdgeUsd / cap) * 10_000);

  if (metric.riskAdjustedEdge >= risk.quoteThresholdUsd) {
    return {
      action: "quote",
      minSpreadBps,
      maxSizeUsd: cap,
      confidence: metric.confidence,
      reason: "risk-adjusted edge above quote threshold",
    };
  }

  if (metric.riskAdjustedEdge > 0) {
    return {
      action: "quote_wide",
      minSpreadBps: Math.max(minSpreadBps, 1),
      maxSizeUsd: Math.min(cap, risk.globalInventoryCapUsd),
      confidence: metric.confidence,
      reason: "positive edge but below quote threshold",
    };
  }

  return {
    action: "skip",
    minSpreadBps: 0,
    maxSizeUsd: 0,
    confidence: metric.confidence,
    reason: "non-positive risk-adjusted edge",
  };
}
