# Quote-vs-Fill Opportunity Engine — Feasibility & Access Assessment

## Executive Summary
- **Partially feasible now** using current CrossRadar codebase as a starting point for *lane-level health telemetry* (recent Across deposits + Relay requests), but **not yet feasible for solver-grade EV decisions** because the PRD's blocking prerequisites are currently unmet.
- The biggest technical gaps are exactly the PRD's own blockers: no persisted quote snapshots, no deterministic quote→fill join flow, incomplete all-in cost attribution, and no historical backtest corpus.
- Environment-level outbound HTTPS restrictions (CONNECT 403 / ENETUNREACH) currently prevent live API verification from this runtime. This is a delivery blocker for any near-real-time production pipeline validation.

## What Is Already Possible With Current Repo

### 1) Route-level ingestion for recent activity is already implemented
- Across adapter reads recent `deposits` from the public indexer and captures origin/destination chain IDs, deposit/fill timestamps, status, and token amounts/prices when present.
- Relay adapter reads `requests/v2` and captures status, created/updated timestamps, in/out tx traces, and selected USD amount fields.

**Implication:** You can already produce a *health radar* signal per lane (traffic, success, latency), and this can seed lane selection for later EV work.

### 2) Chain normalization foundation exists (but is not enough yet)
- There is a chain alias resolution layer (`ETH`, `ARB`, etc.) and generated chain map for ID/name lookup.

**Implication:** Good baseline for lane joins, but token normalization and protocol-specific canonical token mapping are still missing for quote-vs-fill accounting.

### 3) You have a Relay sample fixture with rich per-intent metadata
- The fixture includes nested amounts, route details, in/out tx arrays, and fee metadata surfaces in some records.

**Implication:** You can design and test parsers for intent schema offline, even before live API reachability is restored.

## Requirement-by-Requirement Feasibility (PRD V1)

| PRD Requirement | Current Status | Feasible Now? | Key Gaps / Blockers |
|---|---|---:|---|
| Intent ingestion (chain pair, token in/out, amount in, quote snapshot, fill outcome, status, latency) | Partial | ⚠️ Partial | Fill/status/latency are available; **quote snapshot at intent time is not captured** anywhere in current pipeline. |
| Cost model (gas, protocol/gateway fees, fail/retry, inventory/rebalance) | Minimal | ❌ No | Current code computes only rough USD volume; no per-intent gas/fee ledger and no inventory/rebalance model. |
| Edge/EV engine | Not implemented | ❌ No | No gross edge / net EV / risk-adjusted edge computation exists yet. |
| Opportunity ranking + thresholds | Not implemented | ❌ No | Health ranking exists, EV ranking does not. |
| Decision output (`quote`, `quote_wide`, `skip`) | Not implemented | ❌ No | No bot-facing decision schema currently emitted. |
| Backtest mode | Not implemented | ❌ No | No historical warehouse or deterministic replay path. |
| <=60s freshness | Not implemented for intents | ⚠️ Conditional | Runtime loop exists, but with no robust event capture, persistence, or replay guarantees. |
| 99% reliability and auditability | Not implemented | ❌ No | No persistent pipeline state, run tracking, or source lineage per recommendation. |

## Pre-Requirement Blockers (from PRD) vs. Current Reality

### 1) Reliable quote snapshot source
**Status:** Blocked.
- Current adapters read post-hoc request/deposit feeds; they do not capture the *best executable quote at intent timestamp*.
- Without this, edge cannot be measured correctly (only rough realized outcomes can be observed).

### 2) Deterministic fill outcome join key
**Status:** Partially blocked.
- Relay has request IDs and tx traces in fixtures, which is promising.
- Across currently ingests deposits only; deterministic quote→intent→fill linkage is not implemented in schema/pipeline.

### 3) Unified chain/token normalization
**Status:** Partial.
- Chain normalization exists.
- Token normalization is not unified across protocols (symbol/address/decimals canonicalization and wrapped/native equivalence are missing).

### 4) Cost attribution
**Status:** Blocked.
- No all-in cost table in current model.
- Need per-intent gas accounting, fee extraction normalization, fail/retry expected loss, and inventory/rebalance overhead modeling.

### 5) Historical backtest dataset (2–4 weeks)
**Status:** Blocked.
- Current service is stateless and does not persist raw intents.

### 6) Risk limits config
**Status:** Blocked.
- No risk controls (lane notional caps, open inventory caps, daily loss caps) in current runtime.

## Access & API Reachability Findings in This Environment

### What was attempted
- Direct HTTPS calls to public Relay and Across endpoints.
- Node `fetch` and `curl` attempts from the container.

### Result
- Outbound connectivity is currently constrained from this runtime:
  - `curl` returns `CONNECT tunnel failed, response 403` for both Relay and Across public endpoints.
  - Node fetch fails with `ENETUNREACH`.

### Impact
- Live endpoint schema validation, quote endpoint exploration, and coverage measurement cannot be completed from this environment right now.
- Offline analysis can continue using repository fixtures and code, but production confidence remains blocked until network egress is fixed or an internal proxy allowlist is provided.

## What You Can Build Immediately (Even Before Full API Access)

1. **Data contracts + warehouse schema now**
   - Create `intent_events`, `quote_snapshots`, `fill_outcomes`, `cost_events`, and `lane_metrics_5m` tables.
   - Add protocol-specific raw payload columns (`jsonb`) for auditability.

2. **Parser hardening against known Relay payload variability**
   - Implement extraction from both top-level and nested paths.
   - Track per-field completeness metrics (coverage dashboard).

3. **Join-quality QA framework**
   - Build deterministic key strategy and emit `% join coverage` as a hard gate.

4. **Backtest harness scaffolding**
   - Deterministic replay against frozen fixtures/exports.

## Concrete External Blockers to Resolve First

1. **Network/API egress from runtime**
   - Must allow HTTPS access to at least Across indexer + Relay API (and any quote endpoints you pick).

2. **Quote snapshot ingestion path**
   - Add active quote polling/snapshot capture at intent time (or consume a quote stream if available).

3. **Persistent storage**
   - Postgres for MVP; ClickHouse if volume/latency pressure appears.

4. **Cost attribution sources**
   - Gas (on-chain receipts + price normalization), protocol fees, app fees, retry/fail penalties, inventory/rebalance cost source.

5. **Risk config and policy engine**
   - Lane caps, global inventory caps, stop-loss policy, and confidence threshold gating before bot integration.

## Suggested Go / No-Go Criteria for Starting Solver Bot Logic

Proceed to bot logic only when all are true:
- Quote snapshot capture coverage on target lanes >= 95%.
- Quote→fill deterministic join coverage >= 95%.
- Gas+fee completeness >= 98%.
- At least 2–4 weeks of immutable historical intent data available.
- Risk limits config enforced and tested in simulation.

## Bottom Line
- **Today:** You can extend CrossRadar into a robust *data foundation* project quickly.
- **Not today:** You cannot responsibly run a quote/skip solver strategy from current data surfaces alone.
- **Highest priority:** Restore live API reachability and implement quote snapshot + cost attribution capture; those two unlock almost everything else in the PRD.
