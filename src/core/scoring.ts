import { RouteMetrics } from "../adapters/types";

export type HealthStatus = {
  emoji: string;
  label: string;
  note?: string;
  score: number | null;
};

export function scoreMetrics(metrics: RouteMetrics): HealthStatus {
  const success = metrics.successRate;
  const median = metrics.medianCompletionMinutes;
  let emoji = "🟢";
  let note: string | undefined;

  if (success == null && median == null) {
    emoji = "⚪";
    note = "insufficient data";
  } else if (success != null && success < 0.95) {
    emoji = "🔴";
    note = "success rate dropped";
  } else if (median != null && median > 10) {
    emoji = "🔴";
    note = "median time rising";
  } else if (success != null && success < 0.98) {
    emoji = "🟡";
    note = "success rate soft";
  } else if (median != null && median > 5) {
    emoji = "🟡";
    note = "latency creeping";
  }

  const txFactor = Math.log(metrics.txCount + 1);
  const medianPenalty = median != null ? 0.7 * median : 0;
  const successPenalty = success != null ? 10 * (1 - success) : 0;
  const score = Number((txFactor - medianPenalty - successPenalty).toFixed(2));

  return { emoji, label: emoji, note, score };
}
