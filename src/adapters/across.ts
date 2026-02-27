import { fetchJson } from "../core/http";
import { isWithinWindow } from "../core/window";
import { median, minutesBetween, ratio } from "../core/stats";
import { Adapter, RouteKey, RouteMetrics, RawEvent } from "./types";

const DEFAULT_LIMIT = 500;
const FETCH_TIMEOUT_MS = 15000;

const chainAliasToId: Record<string, number> = {
  eth: 1,
  ethereum: 1,
  arbitrum: 42161,
  arb: 42161,
  optimism: 10,
  opt: 10,
  base: 8453,
  polygon: 137,
  matic: 137,
  poly: 137,
  bsc: 56,
  binance: 56,
  linea: 59144,
  blast: 81457,
  scroll: 534352,
  zkevm: 1101,
  avalanche: 43114,
  avax: 43114,
};

type IndexerDeposit = {
  depositBlockTimestamp?: string | null;
  fillBlockTimestamp?: string | null;
  status?: string | null;
  inputPriceUsd?: string | number | null;
  outputPriceUsd?: string | number | null;
  inputAmount?: string | null;
  outputAmount?: string | null;
};

export class AcrossAdapter implements Adapter {
  protocol = "Across";

  constructor(private readonly baseUrl: string) {}

  listSupportedRoutes(): RouteKey[] {
    return [];
  }

  async fetchRecentEvents(
    route: RouteKey,
    windowStart: Date,
    windowEnd: Date
  ): Promise<RawEvent[]> {
    const originId = this.resolveChainId(route.srcChain);
    const destinationId = this.resolveChainId(route.dstChain);
    const base = this.baseUrl.replace(/\/$/, "");
    const url = new URL(`${base}/deposits`);
    url.searchParams.set("limit", String(DEFAULT_LIMIT));
    url.searchParams.set("skip", "0");
    url.searchParams.set("originChainId", String(originId));
    url.searchParams.set("destinationChainId", String(destinationId));

    const deposits = await fetchJson<IndexerDeposit[]>(
      url.toString(),
      { timeoutMs: FETCH_TIMEOUT_MS },
      1
    );
    return deposits.filter((deposit) => {
      const created = this.resolveDepositDate(deposit);
      return created
        ? isWithinWindow(created, { start: windowStart, end: windowEnd })
        : false;
    });
  }

  async computeMetrics(
    events: RawEvent[],
    route: RouteKey,
    windowStart: Date,
    windowEnd: Date
  ): Promise<RouteMetrics> {
    const completionSamples: number[] = [];
    let successes = 0;

    for (const raw of events as IndexerDeposit[]) {
      const created = this.resolveDepositDate(raw);
      if (!created) continue;
      const fillTime = this.resolveFillDate(raw);
      if (fillTime) {
        completionSamples.push(minutesBetween(created, fillTime));
      }
      if ((raw.status ?? "").toLowerCase() === "filled") {
        successes += 1;
      }
    }

    return {
      key: route,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      txCount: events.length,
      usdVolume: null,
      medianCompletionMinutes: median(completionSamples),
      successRate: ratio(successes, events.length),
      notes: events.length ? undefined : ["no deposits in window"],
    };
  }

  async getMetricsForWindow(
    route: RouteKey,
    windowStart: Date,
    windowEnd: Date
  ): Promise<RouteMetrics> {
    const events = await this.fetchRecentEvents(route, windowStart, windowEnd);
    return this.computeMetrics(events, route, windowStart, windowEnd);
  }

  private resolveChainId(chain: string): number {
    const normalized = chain.trim().toLowerCase();
    if (/^\d+$/.test(normalized)) {
      return Number(normalized);
    }
    const id = chainAliasToId[normalized];
    if (!id) {
      throw new Error(
        `Unknown chain ${chain}. Use a numeric chain id or extend chainAliasToId.`
      );
    }
    return id;
  }

  private resolveDepositDate(deposit: IndexerDeposit): Date | null {
    if (!deposit.depositBlockTimestamp) return null;
    return new Date(deposit.depositBlockTimestamp);
  }

  private resolveFillDate(deposit: IndexerDeposit): Date | null {
    if (!deposit.fillBlockTimestamp) return null;
    return new Date(deposit.fillBlockTimestamp);
  }
}
