import { fetchJson } from "../core/http";
import { isWithinWindow } from "../core/window";
import { median, minutesBetween, ratio } from "../core/stats";
import { aliasFromChainId, resolveChainIdFromInput } from "../core/chain-aliases";
import { CoinGeckoClient, getDefaultDecimals } from "../core/pricing";
import { Adapter, RouteKey, RouteMetrics, RawEvent, RouteSample } from "./types";
import { formatUnits } from "viem";

const DEFAULT_LIMIT = 500;
const FETCH_TIMEOUT_MS = 15000;

type IndexerDeposit = {
  originChainId?: number | string | null;
  sourceChainId?: number | string | null;
  destinationChainId?: number | string | null;
  destChainId?: number | string | null;
  depositBlockTimestamp?: string | null;
  fillBlockTimestamp?: string | null;
  status?: string | null;
  inputPriceUsd?: string | number | null;
  outputPriceUsd?: string | number | null;
  inputAmount?: string | null;
  outputAmount?: string | null;
  inputToken?: string | null;
  outputToken?: string | null;
};

export class AcrossAdapter implements Adapter {
  protocol = "Across";

  constructor(
    private readonly baseUrl: string,
    private readonly priceClient?: CoinGeckoClient
  ) {}

  listSupportedRoutes(): RouteKey[] {
    return [];
  }

  async fetchRecentEvents(
    route: RouteKey,
    windowStart: Date,
    windowEnd: Date
  ): Promise<RawEvent[]> {
    const originId = resolveChainIdFromInput(route.srcChain);
    const destinationId = resolveChainIdFromInput(route.dstChain);
    return this.fetchWindowDeposits(windowStart, windowEnd, {
      originChainId: originId,
      destinationChainId: destinationId,
    });
  }

  async getTopRoutesForWindow(
    windowStart: Date,
    windowEnd: Date,
    maxRoutes: number
  ): Promise<RouteSample[]> {
    const deposits = await this.fetchWindowDeposits(windowStart, windowEnd);
    const grouped = new Map<string, { route: RouteKey; events: RawEvent[] }>();

    for (const deposit of deposits) {
      const route = this.routeFromDeposit(deposit);
      if (!route) continue;
      const key = `${route.srcChain}->${route.dstChain}`;
      let bucket = grouped.get(key);
      if (!bucket) {
        bucket = { route, events: [] };
        grouped.set(key, bucket);
      }
      bucket.events.push(deposit);
    }

    return Array.from(grouped.values())
      .sort((a, b) => b.events.length - a.events.length)
      .slice(0, maxRoutes);
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

    const originChainId = resolveChainIdFromInput(route.srcChain);
    const usdVolume = await this.computeUsdVolume(
      events as IndexerDeposit[],
      originChainId
    );

    return {
      key: route,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      txCount: events.length,
      usdVolume,
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

  private async fetchWindowDeposits(
    windowStart: Date,
    windowEnd: Date,
    filters?: { originChainId?: number; destinationChainId?: number }
  ): Promise<IndexerDeposit[]> {
    const base = this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`;
    const url = new URL("deposits", base);
    url.searchParams.set("limit", String(DEFAULT_LIMIT));
    url.searchParams.set("skip", "0");
    if (filters?.originChainId) {
      url.searchParams.set("originChainId", String(filters.originChainId));
    }
    if (filters?.destinationChainId) {
      url.searchParams.set(
        "destinationChainId",
        String(filters.destinationChainId)
      );
    }

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

  private async computeUsdVolume(
    events: IndexerDeposit[],
    chainId: number
  ): Promise<number | null> {
    if (!events.length) return null;
    let total = 0;
    for (const event of events) {
      const usd = await this.estimateDepositUsd(event, chainId);
      if (usd != null) {
        total += usd;
      }
    }
    return total > 0 ? total : null;
  }

  private async estimateDepositUsd(
    event: IndexerDeposit,
    chainId: number
  ): Promise<number | null> {
    if (!event.inputAmount) return null;
    const amount = this.parseAmount(event.inputAmount);
    if (amount == null) return null;

    let priceUsd = this.toNumber(event.inputPriceUsd);
    let decimals: number | null = null;

    const normalizedAddress = this.normalizeAddress(event.inputToken);
    if (
      normalizedAddress &&
      this.priceClient &&
      this.priceClient.supportsChain(chainId)
    ) {
      const quote = await this.priceClient.getTokenQuote(
        chainId,
        normalizedAddress
      );
      if (quote) {
        if (priceUsd == null && quote.priceUsd != null) {
          priceUsd = quote.priceUsd;
        }
        if (quote.decimals != null) {
          decimals = quote.decimals;
        }
      }
    }

    if (priceUsd == null) return null;
    const resolvedDecimals = decimals ?? getDefaultDecimals();
    const humanAmount = Number(formatUnits(amount, resolvedDecimals));
    if (!Number.isFinite(humanAmount)) return null;
    return humanAmount * priceUsd;
  }

  private parseAmount(value: string): bigint | null {
    try {
      return BigInt(value);
    } catch {
      return null;
    }
  }

  private normalizeAddress(value?: string | null): string | null {
    if (!value) return null;
    return value.toLowerCase();
  }

  private toNumber(value?: string | number | null): number | null {
    if (value == null) return null;
    const num = typeof value === "number" ? value : Number(value);
    return Number.isFinite(num) ? num : null;
  }

  private routeFromDeposit(deposit: IndexerDeposit): RouteKey | null {
    const origin = this.normalizeChainId(
      deposit.originChainId ?? deposit.sourceChainId
    );
    const destination = this.normalizeChainId(
      deposit.destinationChainId ?? deposit.destChainId
    );
    if (origin == null || destination == null) return null;
    return {
      protocol: this.protocol,
      srcChain: aliasFromChainId(origin),
      dstChain: aliasFromChainId(destination),
    };
  }

  private normalizeChainId(value?: number | string | null): number | null {
    if (value == null) return null;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed.length) return null;
      return Number(trimmed);
    }
    return Number(value);
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
