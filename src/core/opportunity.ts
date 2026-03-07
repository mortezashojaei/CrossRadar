import { RouteMetrics } from "../adapters/types";

export type OpportunitySignal = {
  metrics: RouteMetrics;
  edgeBps: number | null;
  opportunityScore: number;
  confidence: number;
  risk: "low" | "medium" | "high";
  notes: string[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function scoreOpportunity(metrics: RouteMetrics): OpportunitySignal {
  const tx = metrics.txCount;
  const success = metrics.successRate;
  const median = metrics.medianCompletionMinutes;
  const volume = metrics.usdVolume ?? 0;

  const notes = [...(metrics.notes ?? [])];

  if (tx <= 0) {
    return {
      metrics,
      edgeBps: null,
      opportunityScore: 0,
      confidence: 0,
      risk: "high",
      notes: notes.length ? notes : ["no flow in window"],
    };
  }

  const failureBps = success == null ? 40 : (1 - success) * 10000;
  const latencyBps = median == null ? 0 : median * 0.8;
  const activityBps = Math.log(tx + 1) * 2.5;

  const edgeBpsRaw = 4 + failureBps * 0.35 + latencyBps + activityBps;
  const edgeBps = Number(clamp(edgeBpsRaw, 0, 600).toFixed(2));

  const liquidityFactor = volume > 0 ? clamp(Math.log10(volume + 10) / 5, 0.2, 1) : 0.25;
  const sampleFactor = clamp(Math.log(tx + 1) / 4, 0.1, 1);
  const opportunityScore = Number((edgeBps * liquidityFactor * sampleFactor).toFixed(2));

  const confidenceBase = (sampleFactor * 0.6 + liquidityFactor * 0.4) * 100;
  const confidencePenalty = success == null ? 15 : 0;
  const confidence = Number(clamp(confidenceBase - confidencePenalty, 0, 100).toFixed(1));

  let risk: OpportunitySignal["risk"] = "low";
  if (success != null && success < 0.95) risk = "high";
  else if (success != null && success < 0.98) risk = "medium";

  return {
    metrics,
    edgeBps,
    opportunityScore,
    confidence,
    risk,
    notes,
  };
}
