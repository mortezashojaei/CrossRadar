import { QualityReport, QualitySnapshot, QualityThresholds } from "./contracts";

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return (numerator / denominator) * 100;
}

export function buildQualityReport(
  snapshot: QualitySnapshot,
  thresholds: QualityThresholds
): QualityReport {
  const quoteCoveragePct = pct(
    snapshot.joinedWithQuoteIntents,
    snapshot.totalCandidateIntents
  );
  const deterministicJoinPct = pct(
    snapshot.deterministicJoinCount,
    snapshot.totalCandidateIntents
  );
  const tokenResolutionPct = pct(
    snapshot.tokenResolutionSuccessCount,
    snapshot.totalCandidateIntents
  );
  const gasFeeCompletenessPct = pct(
    snapshot.gasFeeCompleteCount,
    snapshot.totalCandidateIntents
  );

  const failingChecks: string[] = [];
  if (quoteCoveragePct < thresholds.quoteCoveragePct) {
    failingChecks.push("quoteCoveragePct");
  }
  if (deterministicJoinPct < thresholds.deterministicJoinPct) {
    failingChecks.push("deterministicJoinPct");
  }
  if (tokenResolutionPct < thresholds.tokenResolutionPct) {
    failingChecks.push("tokenResolutionPct");
  }
  if (gasFeeCompletenessPct < thresholds.gasFeeCompletenessPct) {
    failingChecks.push("gasFeeCompletenessPct");
  }

  return {
    quoteCoveragePct,
    deterministicJoinPct,
    tokenResolutionPct,
    gasFeeCompletenessPct,
    passed: failingChecks.length === 0,
    failingChecks,
  };
}
