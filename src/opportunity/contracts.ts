export type Protocol = "across" | "relay" | (string & {});

export type IntentStatus = "success" | "failure" | "refund";

export type JoinLinkType = "request_id" | "deposit_id" | "tx_hash" | "fuzzy";

export type JoinProvenance = {
  linkType: JoinLinkType;
  linkValue: string;
  confidence: number;
};

export type QuoteSnapshot = {
  quoteId: string;
  protocol: Protocol;
  srcChainId: number;
  dstChainId: number;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  quotedAmountOut: bigint;
  quoteTimestamp: Date;
  expiresAt?: Date;
  routeHash?: string;
  rawPayload: Record<string, unknown>;
};

export type IntentEvent = {
  canonicalIntentId: string;
  protocol: Protocol;
  sourceRequestId?: string;
  sourceDepositId?: string;
  srcChainId: number;
  dstChainId: number;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  intentTimestamp: Date;
  status: IntentStatus;
  fillTimestamp?: Date;
  fillAmountOut?: bigint;
  rawPayload: Record<string, unknown>;
};

export type FillOutcome = {
  protocol: Protocol;
  requestId?: string;
  depositId?: string;
  inTxHash?: string;
  outTxHash?: string;
  srcChainId: number;
  dstChainId: number;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  fillAmountOut?: bigint;
  status: IntentStatus;
  fillTimestamp?: Date;
  rawPayload: Record<string, unknown>;
};

export type CostType =
  | "gas"
  | "protocol_fee"
  | "app_fee"
  | "retry_penalty"
  | "inventory_carry"
  | "rebalance";

export type CostEvent = {
  canonicalIntentId: string;
  costType: CostType;
  amountUsd: number;
  source: string;
  observedAt: Date;
  rawPayload?: Record<string, unknown>;
};

export type JoinedIntentOutcome = {
  intent: IntentEvent;
  fill: FillOutcome;
  provenance: JoinProvenance;
};

export type EdgeComputationInput = {
  quoteAmountOutUsd: number;
  fillAmountOutUsd: number;
  successProbability: number;
  failureLossUsd: number;
  confidenceScore: number;
  stabilityMultiplier: number;
  costs: Array<Pick<CostEvent, "costType" | "amountUsd">>;
};

export type EdgeMetrics = {
  grossEdgeUsd: number;
  totalCostsUsd: number;
  netEdgeUsd: number;
  expectedValueUsd: number;
  riskAdjustedEdge: number;
};

export type SizeBucket = "small" | "medium" | "large";

export type LaneBucketKey = {
  protocol: Protocol;
  srcChainId: number;
  dstChainId: number;
  sizeBucket: SizeBucket;
  bucketStartIso: string;
};

export type LaneMetrics = LaneBucketKey & {
  sampleCount: number;
  successRate: number;
  grossEdgeUsd: number;
  netEdgeUsd: number;
  expectedValueUsd: number;
  riskAdjustedEdge: number;
  confidence: number;
};

export type DecisionAction = "quote" | "quote_wide" | "skip";

export type OpportunityDecision = {
  action: DecisionAction;
  minSpreadBps: number;
  maxSizeUsd: number;
  confidence: number;
  reason: string;
};

export type RiskLimits = {
  laneCapsUsd: Record<string, number>;
  globalInventoryCapUsd: number;
  dailyLossCapUsd: number;
  minConfidence: number;
  maxFailRisk: number;
  quoteThresholdUsd: number;
};

export type QualitySnapshot = {
  totalCandidateIntents: number;
  joinedWithQuoteIntents: number;
  deterministicJoinCount: number;
  tokenResolutionSuccessCount: number;
  gasFeeCompleteCount: number;
};

export type QualityThresholds = {
  quoteCoveragePct: number;
  deterministicJoinPct: number;
  tokenResolutionPct: number;
  gasFeeCompletenessPct: number;
};

export type QualityReport = {
  quoteCoveragePct: number;
  deterministicJoinPct: number;
  tokenResolutionPct: number;
  gasFeeCompletenessPct: number;
  passed: boolean;
  failingChecks: string[];
};
