# Quote-vs-Fill Opportunity Engine — Feasibility & Unblocking Research

## Executive Summary
- **CrossRadar can already produce lane-health telemetry** (volume, success rate, completion latency) from Across deposits and Relay requests.
- **CrossRadar cannot yet produce solver-grade quote/skip decisions** because the core pre-reqs in the PRD are still missing in code and data model: quote snapshots, deterministic quote→fill linkage, full cost attribution, persistence/backtesting, and risk policy enforcement.
- **Runtime network egress is blocked in this environment** (`CONNECT tunnel failed, response 403`; Node fetch failure), so live endpoint discovery and contract validation are currently blocked from this container.
- The fastest way to unblock delivery is to execute a **data-foundation-first sequence**:
  1) persistent raw event capture,
  2) quote snapshot collector,
  3) deterministic join keys + QA gates,
  4) cost ledger,
  5) backtest corpus and risk policy engine.

---

## 1) Current-State Evidence From Repository

### 1.1 What the adapters already capture

#### Relay adapter (`src/adapters/relay.ts`)
- Pulls from `/requests/v2` with pagination + continuation token handling.
- Captures request identifiers, status, chain IDs, created/updated timestamps, in/out tx arrays, and selected USD amount fields from multiple nested paths.
- Produces route-level metrics (`txCount`, `usdVolume`, median completion, success rate).

**Implication:** Good foundation for intent/fill outcome tracking and lane-level health analytics, but no quote snapshot ingestion path exists.

#### Across adapter (`src/adapters/across.ts`)
- Pulls recent deposits from indexer endpoint and filters by window.
- Captures origin/destination chain ids, status proxy (`filled`), timestamps, token + amount values, and estimates USD volume using input token price fields + optional price client lookup.

**Implication:** Useful for route health and observed fills; insufficient for quote-time edge estimation.

### 1.2 What the domain model currently optimizes for
- Existing scoring logic ranks by health characteristics (activity, completion speed, success rate), not EV edge.
- Current tests validate formatting/scoring/stat behavior, not quote-vs-fill reconstruction.

**Implication:** The runtime is a strong observability monitor, not yet a solver decision engine.

---

## 2) Blocker-by-Blocker Deep Dive (Root Cause → Unblock Plan)

## Blocker A — Reliable Quote Snapshot Source

### Why blocked
- No collector currently records the best executable quote at intent timestamp.
- Current pipeline is mostly post-hoc (requests/deposits), so gross edge cannot be measured deterministically.

### Unblock plan
1. Add `quote_snapshots` ingestion job with strict polling cadence per target lane/size bucket.
2. Persist both normalized fields and raw payload (`jsonb`) for future parser evolution.
3. Add freshness + completeness SLAs:
   - quote timestamp skew <= 2s vs collector clock,
   - >=95% snapshot coverage for target intents.

### Proposed schema (MVP)
```sql
create table quote_snapshots (
  quote_id text primary key,
  protocol text not null,
  src_chain_id int not null,
  dst_chain_id int not null,
  token_in text not null,
  token_out text not null,
  amount_in numeric(78,0) not null,
  quoted_amount_out numeric(78,0) not null,
  quote_timestamp timestamptz not null,
  expires_at timestamptz null,
  route_hash text null,
  raw_payload jsonb not null,
  created_at timestamptz not null default now()
);
create index on quote_snapshots (protocol, src_chain_id, dst_chain_id, quote_timestamp desc);
```

### QA gates
- `quote_snapshot_coverage_pct` (joined intents with usable quote / all candidate intents).
- `quote_payload_parse_success_pct`.

---

## Blocker B — Deterministic Quote→Intent→Fill Join Key

### Why blocked
- Relay and Across expose different identifiers and life-cycle fields.
- Current code does route-level grouping; it does not persist a canonical intent identity graph.

### Unblock plan
1. Introduce canonical identity model:
   - `canonical_intent_id` (internal UUID).
   - `source_protocol`, `source_request_id`, `source_deposit_id` (nullable depending on protocol).
   - tx-hash level linkage table for fallback joins.
2. Join priority order:
   - **P0 deterministic IDs** (explicit protocol IDs).
   - **P1 tx-hash linkage** (`inTx`/`outTx` pairs).
   - **P2 fuzzy temporal+amount fallback** (for diagnostics only, never for production EV).
3. Store join provenance and confidence.

### Proposed schema (MVP)
```sql
create table intent_events (
  canonical_intent_id uuid primary key,
  protocol text not null,
  source_request_id text null,
  source_deposit_id text null,
  src_chain_id int not null,
  dst_chain_id int not null,
  token_in text not null,
  token_out text not null,
  amount_in numeric(78,0) not null,
  intent_timestamp timestamptz not null,
  status text not null,
  fill_timestamp timestamptz null,
  fill_amount_out numeric(78,0) null,
  raw_payload jsonb not null,
  created_at timestamptz not null default now()
);

create table intent_join_links (
  canonical_intent_id uuid not null,
  link_type text not null, -- request_id | deposit_id | tx_hash | fuzzy
  link_value text not null,
  confidence numeric(5,4) not null,
  primary key (canonical_intent_id, link_type, link_value)
);
```

### QA gates
- `deterministic_join_pct >= 95%` on target lanes before enabling solver outputs.
- `fuzzy_join_pct` must trend toward zero for production decisions.

---

## Blocker C — Unified Chain/Token Normalization

### Why blocked
- Chain alias support exists, but token identity remains protocol-specific.
- Edge calculations fail if wrapped/native aliases and decimal mismatches are unresolved.

### Unblock plan
1. Add canonical token dimension keyed by `(chain_id, address_normalized)` + symbol metadata.
2. Add equivalence mapping for wrapped/native representations where required by strategy.
3. Enforce decimal normalization at ingest boundary; reject/flag inconsistent payloads.

### Proposed schema (MVP)
```sql
create table dim_tokens (
  chain_id int not null,
  token_address text not null,
  symbol text null,
  decimals int not null,
  canonical_token_id text not null,
  is_native bool not null default false,
  primary key (chain_id, token_address)
);

create table token_equivalences (
  canonical_token_id text not null,
  equivalent_token_id text not null,
  reason text not null,
  primary key (canonical_token_id, equivalent_token_id)
);
```

### QA gates
- `token_resolution_success_pct >= 99%` for active lanes.
- hard fail on unknown decimals for any record entering EV engine.

---

## Blocker D — Cost Attribution (All-in)

### Why blocked
- Current implementation focuses on rough USD totals and completion metrics.
- No per-intent cost ledger (gas, protocol fee, retry/failure cost, inventory/rebalance cost).

### Unblock plan
1. Build `cost_events` table keyed by `canonical_intent_id`.
2. Store each cost component as separate rows for transparent attribution.
3. Introduce inventory/rebalance model as configurable policy function.

### Proposed schema (MVP)
```sql
create table cost_events (
  canonical_intent_id uuid not null,
  cost_type text not null, -- gas | protocol_fee | app_fee | retry_penalty | inventory_carry | rebalance
  amount_usd numeric(38,10) not null,
  amount_native numeric(78,0) null,
  native_token text null,
  source text not null,
  observed_at timestamptz not null,
  raw_payload jsonb null,
  primary key (canonical_intent_id, cost_type, source, observed_at)
);
```

### QA gates
- `gas_fee_completeness_pct >= 98%`.
- Reconciled net PnL checks on sample windows.

---

## Blocker E — Historical Dataset for Backtesting

### Why blocked
- Service is stateless at runtime; no immutable historical warehouse exists.
- Existing fixtures are useful for parser tests but insufficient for statistical confidence.

### Unblock plan
1. Persist raw + normalized events for 2–4 weeks minimum.
2. Add immutable snapshot partitions (`event_date`) for deterministic replay.
3. Build replay runner that recomputes EV signals from frozen data only.

### QA gates
- replay determinism checks (same input snapshot => byte-identical output JSON).
- minimum sample thresholds per lane/size bucket.

---

## Blocker F — Risk Limits Config + Policy Engine

### Why blocked
- No risk policy object currently gates output actions.

### Unblock plan
1. Add declarative risk config:
   - per-lane notional caps,
   - global inventory cap,
   - daily max loss,
   - min confidence thresholds.
2. Execute policy evaluation post-EV calculation and pre-decision emission.
3. Record policy explanations for auditability.

### Proposed config fragment
```yaml
risk:
  lane_caps_usd:
    "relay:1->10": 50000
  global_inventory_cap_usd: 250000
  daily_loss_cap_usd: 10000
  min_confidence: 0.70
  max_fail_risk: 0.08
```

---

## 3) End-to-End Architecture to Unblock in Phases

## Phase 0 (1–2 days): Contract-first scaffolding
- Define TypeScript interfaces and SQL migrations for `intent_events`, `quote_snapshots`, `fill_outcomes` (or intent status columns), `cost_events`, and `lane_metrics_5m`.
- Add `raw_payload` + source timestamps everywhere.

## Phase 1 (3–5 days): Collectors + persistence
- Implement durable ingestion workers:
  - Relay requests collector,
  - Across deposits/fills collector,
  - Quote snapshot collector.
- Add idempotent upserts and dedupe keys.

## Phase 2 (2–4 days): Join engine + data quality gates
- Build deterministic join graph.
- Emit quality KPIs every run:
  - quote coverage,
  - deterministic join coverage,
  - token resolution coverage,
  - gas/fee completeness.

## Phase 3 (3–5 days): EV engine + policy gating
- Compute per-intent:
  - gross edge,
  - total costs,
  - net EV,
  - risk-adjusted EV.
- Aggregate to lane/size/time buckets and emit decision feed.

## Phase 4 (3–5 days): Backtest + calibration
- Replay 2–4 weeks frozen data.
- Tune thresholds for precision/recall vs conservative baseline.

---

## 4) Recommended Data Contracts (Unambiguous Definitions)

- `grossEdgeUsd = fair_quote_out_usd - actual_fill_out_usd`
- `netEdgeUsd = grossEdgeUsd - (gas + protocol_fee + app_fee + retry_penalty + inventory_carry + rebalance)`
- `expectedValueUsd = p_success * netEdgeUsd - (1 - p_success) * failure_loss_usd`
- `riskAdjustedEdge = expectedValueUsd * confidence_score * stability_multiplier`

**Decision mapping (example):**
- `quote` if `riskAdjustedEdge >= quote_threshold`
- `quote_wide` if `0 < riskAdjustedEdge < quote_threshold`
- `skip` otherwise

---

## 5) Research Findings on Environment Access (Current Runtime)

### Commands executed
- `curl -I https://api.relay.link/requests/v2`
- `curl -I https://across.to`
- `node -e "fetch('https://api.relay.link/requests/v2?limit=1')..."`

### Observed behavior
- `curl`: `CONNECT tunnel failed, response 403`
- Node fetch: request failure (no successful status returned)

### Practical effect
- Live contract verification cannot be completed from this environment.
- Continue implementation against strict contracts + fixtures now; perform endpoint validation once egress allowlist/proxy is provided.

---

## 6) Immediate Repo Tasks to Unblock Delivery (Priority Order)

1. **Introduce persistence layer + migrations** for all core entities.
2. **Add quote snapshot collector interface** (protocol-agnostic) and start storing raw quotes.
3. **Create deterministic join module** with provenance + confidence.
4. **Implement token normalization tables and resolvers**.
5. **Implement cost ledger extractors** and fallback estimation policy.
6. **Add QA report job** that fails CI/runtime when coverage thresholds drop below guardrails.
7. **Only then** implement bot-facing `quote | quote_wide | skip` feed.

---

## 7) Go/No-Go Criteria for Starting Solver Bot Logic

Proceed only when all are true on target lanes:
- Quote snapshot coverage >= 95%.
- Deterministic quote→fill join coverage >= 95%.
- Gas + fee completeness >= 98%.
- Token normalization success >= 99%.
- Minimum 2–4 weeks immutable intent history.
- Risk policy gates enforced and validated in replay.

---

## Bottom Line
- **Feasible now:** Build the full data foundation, quality gates, and replay framework on top of current CrossRadar adapters.
- **Not feasible yet:** Production solver decisions without quote snapshots, deterministic joins, and complete cost attribution.
- **Highest leverage next step:** Implement persistence + quote snapshot capture first; these remove the largest blockers and unlock EV engine development.
