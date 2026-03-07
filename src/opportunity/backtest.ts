import { decideOpportunity } from "./engine";
import { LaneMetrics, RiskLimits } from "./contracts";

export type BacktestIntentSample = {
  metric: LaneMetrics;
  failRisk: number;
  realizedPnlUsd: number;
  conservativeBaselinePnlUsd: number;
};

export type BacktestResult = {
  sampleCount: number;
  strategyPnlUsd: number;
  baselinePnlUsd: number;
  deltaPnlUsd: number;
  quoteCount: number;
  quoteWideCount: number;
  skipCount: number;
  precision: number;
};

export function runBacktest(samples: BacktestIntentSample[], risk: RiskLimits): BacktestResult {
  let strategyPnlUsd = 0;
  let baselinePnlUsd = 0;
  let quoteCount = 0;
  let quoteWideCount = 0;
  let skipCount = 0;
  let predictedPositiveCount = 0;
  let realizedPositiveCount = 0;

  for (const sample of samples) {
    const decision = decideOpportunity(sample.metric, risk, sample.failRisk);
    baselinePnlUsd += sample.conservativeBaselinePnlUsd;

    if (decision.action === "skip") {
      strategyPnlUsd += sample.conservativeBaselinePnlUsd;
      skipCount += 1;
      continue;
    }

    if (decision.action === "quote") quoteCount += 1;
    if (decision.action === "quote_wide") quoteWideCount += 1;

    predictedPositiveCount += 1;
    if (sample.realizedPnlUsd > 0) realizedPositiveCount += 1;
    strategyPnlUsd += sample.realizedPnlUsd;
  }

  return {
    sampleCount: samples.length,
    strategyPnlUsd,
    baselinePnlUsd,
    deltaPnlUsd: strategyPnlUsd - baselinePnlUsd,
    quoteCount,
    quoteWideCount,
    skipCount,
    precision: predictedPositiveCount === 0 ? 0 : realizedPositiveCount / predictedPositiveCount,
  };
}
