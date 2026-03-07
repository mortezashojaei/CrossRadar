# PRD: Quote-vs-Fill Opportunity Engine (for Solver Profitability)

## 1) Problem
Current bridge health data (tx count, success rate, completion time) shows where traffic and instability exist, but it does **not** directly show where profitable solver opportunities exist.

To capture profit, we need to identify when users are being filled materially worse than fair market quotes, adjusted for risk and execution cost.

---

## 2) Goal
Build an internal product that continuously computes **per-lane, per-size expected edge** from intent-level data, so we can deploy a selective resolver/solver strategy only where EV is positive.

### Success Criteria
- Detect lanes and time windows where realized fills are consistently worse than fair quote by at least configurable threshold.
- Output ranked opportunities with confidence score and required minimum spread.
- Power automated “quote / skip” decisions for a solver bot.

---

## 3) Single Most Important Signal
**Quote vs Actual Fill Outcome (per intent).**

For each intent:
1. What was the best fair executable quote at intent time?
2. What was actual fill amount/time/status?
3. What was all-in cost (gas, fees, failure penalties, inventory/rebalance)?

Edge = (fair quote implied out) - (actual user out) adjusted for fees/risk

If this edge is persistently positive for a lane/size/time bucket, that is the profit opportunity.

---

## 4) Users
- Primary: Internal quant/solver operator (you)
- Secondary: Bot execution engine that consumes ranked opportunities and risk thresholds

---

## 5) Scope (V1)
### In Scope
- Ingest intent-level records from Relay/Across lanes we target
- Reconstruct quote-vs-fill edge
- Compute EV and confidence per lane/size/time bucket
- Rank top opportunities
- Export signals via JSON/API for bot decisions

### Out of Scope (V1)
- Capital allocation optimization across all chains
- Full insurance underwriting
- Retail-facing dashboard polish

---

## 6) Functional Requirements
1. **Intent Ingestion**
   - Collect: chain pair, token in/out, amount in, timestamp, user quote snapshot, final fill, status, completion latency.

2. **Cost Model**
   - Include: gas, protocol fees, gateway fees, expected fail/retry cost, inventory carry and rebalance cost.

3. **Edge/EV Engine**
   - Compute:
     - grossEdgeBps
     - netEdgeUsd
     - expectedValueUsd
     - riskAdjustedEdge (penalize unstable lanes)

4. **Opportunity Ranking**
   - Rank by EV and confidence.
   - Minimum thresholds (configurable):
     - min intents in sample
     - min EV USD
     - max fail-risk

5. **Decision Output**
   - Emit per lane/size:
     - `action`: quote | quote_wide | skip
     - `minSpreadBps`
     - `maxSize`
     - `confidence`

6. **Backtest Mode**
   - Replay historical intents to estimate expected PnL vs conservative baseline.

---

## 7) Non-Functional Requirements
- Freshness: <= 60 seconds delay from intent events
- Reliability: 99% successful pipeline runs
- Auditability: every recommendation traceable to source intents
- Reproducibility: deterministic backtest on frozen datasets

---

## 8) Data Model (Core)
### `intent_events`
- intent_id
- protocol
- src_chain_id, dst_chain_id
- token_in, token_out
- amount_in
- quote_out_best
- quote_timestamp
- fill_out_actual
- fill_timestamp
- status (success/failure/refund)
- fees_total_usd
- gas_total_usd
- latency_seconds

### `lane_metrics_5m`
- protocol, src_chain_id, dst_chain_id
- size_bucket
- sample_count
- fill_success_rate
- p50_latency, p95_latency
- gross_edge_bps
- net_edge_usd
- ev_usd
- confidence

---

## 9) Pre-Requirements (Must Resolve Before Writing Bot Logic)
These are blockers; resolve them first.

1. **Reliable Quote Snapshot Source**
   - Must record best executable quote at intent time.
   - Without this, no real edge estimation.

2. **Fill Outcome Join Key**
   - Must map quote/intents to final fill or failure deterministically.

3. **Unified Chain/Token Normalization**
   - Standard chain IDs and token identifiers across Across/Relay to avoid broken joins.

4. **Cost Attribution**
   - Must capture all-in costs (gas + fees + rebalance) per intent.

5. **Historical Dataset for Backtest**
   - At least 2–4 weeks of intent-level records for initial confidence.

6. **Risk Limits Config**
   - Max notional per lane, max open inventory, daily loss cap.

---

## 10) Pre-Req Resolution Plan (Execute First)
### Phase A (Data Foundation, ~1 week)
- Build collectors for quote snapshots + fill outcomes.
- Add normalization tables for chain/token.
- Store to PostgreSQL (or ClickHouse if high volume).

### Phase B (Validation, ~3–5 days)
- Validate quote-fill joins >= 95% coverage.
- Validate fee/gas completeness >= 98%.
- Generate first lane-level sanity report.

### Exit Criteria to Start PRD Execution Build
- We can compute quote-vs-fill edge for top 10 lanes with complete cost attribution.

---

## 11) MVP Milestones
1. **M1**: Data ingestion + normalized schema + daily QA report
2. **M2**: Edge/EV calculator + lane leaderboard
3. **M3**: Backtest + threshold tuning
4. **M4**: Bot decision feed (quote/skip with min spread)

---

## 12) Risks & Mitigations
- **Missing quote snapshots** → Block production use until captured reliably
- **API shape drift** → Contract tests + schema versioning
- **False-positive opportunities** → Confidence gating + min sample thresholds
- **Inventory drag** → Add inventory cost to EV before ranking

---

## 13) KPIs
- Opportunity precision (predicted positive EV that remains positive in execution)
- Net PnL per lane and per size bucket
- Missed-opportunity rate
- Failure-adjusted return
- Capital efficiency (PnL / deployed inventory)

---

## 14) Recommendation
Proceed only after pre-req Phase A/B is complete. The biggest value unlock is not another dashboard; it is robust quote-vs-fill capture + cost attribution. That dataset is the profit engine.
