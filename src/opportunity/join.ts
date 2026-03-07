import { FillOutcome, IntentEvent, JoinProvenance, JoinedIntentOutcome } from "./contracts";

type JoinIndex = {
  byRequestId: Map<string, FillOutcome>;
  byDepositId: Map<string, FillOutcome>;
  byTxHash: Map<string, FillOutcome>;
};

function buildFillIndex(fills: FillOutcome[]): JoinIndex {
  const byRequestId = new Map<string, FillOutcome>();
  const byDepositId = new Map<string, FillOutcome>();
  const byTxHash = new Map<string, FillOutcome>();

  for (const fill of fills) {
    if (fill.requestId) byRequestId.set(fill.requestId, fill);
    if (fill.depositId) byDepositId.set(fill.depositId, fill);
    if (fill.inTxHash) byTxHash.set(fill.inTxHash, fill);
    if (fill.outTxHash) byTxHash.set(fill.outTxHash, fill);
  }

  return { byRequestId, byDepositId, byTxHash };
}

function provenance(linkType: JoinProvenance["linkType"], linkValue: string): JoinProvenance {
  const confidence =
    linkType === "request_id" || linkType === "deposit_id"
      ? 1
      : linkType === "tx_hash"
        ? 0.98
        : 0.5;
  return { linkType, linkValue, confidence };
}

export function joinIntentsToFills(
  intents: IntentEvent[],
  fills: FillOutcome[]
): { joined: JoinedIntentOutcome[]; unmatchedIntentIds: string[] } {
  const index = buildFillIndex(fills);
  const joined: JoinedIntentOutcome[] = [];
  const unmatchedIntentIds: string[] = [];

  for (const intent of intents) {
    let fill: FillOutcome | undefined;
    let prov: JoinProvenance | undefined;

    if (intent.sourceRequestId) {
      fill = index.byRequestId.get(intent.sourceRequestId);
      if (fill) prov = provenance("request_id", intent.sourceRequestId);
    }

    if (!fill && intent.sourceDepositId) {
      fill = index.byDepositId.get(intent.sourceDepositId);
      if (fill) prov = provenance("deposit_id", intent.sourceDepositId);
    }

    if (!fill) {
      const inTx = (intent.rawPayload.inTxHash as string | undefined) ?? "";
      if (inTx) {
        fill = index.byTxHash.get(inTx);
        if (fill) prov = provenance("tx_hash", inTx);
      }
    }

    if (!fill || !prov) {
      unmatchedIntentIds.push(intent.canonicalIntentId);
      continue;
    }

    joined.push({ intent, fill, provenance: prov });
  }

  return { joined, unmatchedIntentIds };
}
