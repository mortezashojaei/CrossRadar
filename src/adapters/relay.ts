import { fetchJson } from "../core/http";
import { isWithinWindow } from "../core/window";
import { median, minutesBetween, ratio } from "../core/stats";
import { aliasFromChainId, resolveChainIdFromInput } from "../core/chain-aliases";
import { Adapter, RouteKey, RouteMetrics, RawEvent, RouteSample } from "./types";
import { logger } from "../logger";

const DEFAULT_LIMIT = 50;
const MAX_PAGES = 10;
const FETCH_TIMEOUT_MS = 15000;
const SUCCESS_STATUSES = new Set(["success"]);

type RelayTransaction = {
  timestamp?: number | string | null;
  chainId?: number | string | null;
};

type RelayCurrencyAmount = {
  amountUsd?: string | number | null;
  amountUsdCurrent?: string | number | null;
};

type RelayRequest = {
  id?: string;
  status?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  originChainId?: number | string | null;
  destinationChainId?: number | string | null;
  inTxs?: RelayTransaction[];
  outTxs?: RelayTransaction[];
  currencyIn?: RelayCurrencyAmount;
  currencyOut?: RelayCurrencyAmount;
  refundCurrencyData?: RelayCurrencyAmount;
};

type RelayResponse = {
  requests?: RelayRequest[];
  continuation?: string | null;
};

export class RelayAdapter implements Adapter {
  protocol = "Relay";

  constructor(private readonly baseUrl: string) {}

  listSupportedRoutes(): RouteKey[] {
    return [];
  }

  async fetchRecentEvents(
    route: RouteKey,
    windowStart: Date,
    windowEnd: Date
  ): Promise<RawEvent[]> {
    const originChainId = resolveChainIdFromInput(route.srcChain);
    const destinationChainId = resolveChainIdFromInput(route.dstChain);
    return this.fetchRequests(windowStart, windowEnd, {
      originChainId,
      destinationChainId,
    });
  }

  async computeMetrics(
    events: RawEvent[],
    route: RouteKey,
    windowStart: Date,
    windowEnd: Date
  ): Promise<RouteMetrics> {
    const requests = events as RelayRequest[];
    const completionSamples: number[] = [];
    let successes = 0;

    for (const request of requests) {
      const created = this.getCreatedDate(request);
      if (!created) continue;
      const completion = this.getCompletionDate(request);
      if (completion) {
        completionSamples.push(minutesBetween(created, completion));
      }
      if (this.isSuccess(request.status)) {
        successes += 1;
      }
    }

    const usdVolume = this.computeUsdVolume(requests);

    return {
      key: route,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      txCount: requests.length,
      usdVolume,
      medianCompletionMinutes: median(completionSamples),
      successRate: ratio(successes, requests.length),
      notes: requests.length ? undefined : ["no requests in window"],
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

  async getTopRoutesForWindow(
    windowStart: Date,
    windowEnd: Date,
    maxRoutes: number
  ): Promise<RouteSample[]> {
    const requests = await this.fetchRequests(windowStart, windowEnd);
    const grouped = new Map<string, { route: RouteKey; events: RelayRequest[] }>();

    for (const request of requests) {
      const route = this.routeFromRequest(request);
      if (!route) continue;
      const key = `${route.srcChain}->${route.dstChain}`;
      let bucket = grouped.get(key);
      if (!bucket) {
        bucket = { route, events: [] };
        grouped.set(key, bucket);
      }
      bucket.events.push(request);
    }

    return Array.from(grouped.values())
      .sort((a, b) => b.events.length - a.events.length)
      .slice(0, maxRoutes)
      .map(({ route, events }) => ({ route, events }));
  }

  private async fetchRequests(
    windowStart: Date,
    windowEnd: Date,
    filters?: { originChainId?: number; destinationChainId?: number }
  ): Promise<RelayRequest[]> {
    const base = this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`;
    const events: RelayRequest[] = [];
    let continuation: string | undefined;
    let page = 0;
    const startTimestamp = Math.floor(windowStart.getTime() / 1000);
    const endTimestamp = Math.ceil(windowEnd.getTime() / 1000);

    while (page < MAX_PAGES) {
      const url = new URL("requests/v2", base);
      url.searchParams.set("limit", String(DEFAULT_LIMIT));
      url.searchParams.set("sortBy", "createdAt");
      url.searchParams.set("sortDirection", "desc");
      url.searchParams.set("startTimestamp", String(startTimestamp));
      url.searchParams.set("endTimestamp", String(endTimestamp));
      if (filters?.originChainId) {
        url.searchParams.set("originChainId", String(filters.originChainId));
      }
      if (filters?.destinationChainId) {
        url.searchParams.set(
          "destinationChainId",
          String(filters.destinationChainId)
        );
      }
      if (continuation) {
        url.searchParams.set("continuation", continuation);
      }

      const response = await fetchJson<RelayResponse>(
        url.toString(),
        { timeoutMs: FETCH_TIMEOUT_MS },
        1
      );

      const requests = response.requests ?? [];
      logger.debug(
        {
          protocol: this.protocol,
          page,
          fetched: requests.length,
          continuation: Boolean(response.continuation),
        },
        "relay api page"
      );
      for (const request of requests) {
        const created = this.getCreatedDate(request);
        if (!created) continue;
        if (
          isWithinWindow(created, { start: windowStart, end: windowEnd })
        ) {
          events.push(request);
        }
      }

      if (!response.continuation) {
        break;
      }
      continuation = response.continuation;
      page += 1;
    }

    return events;
  }

  private getCreatedDate(request: RelayRequest): Date | null {
    if (request.createdAt) {
      const created = new Date(request.createdAt);
      if (!Number.isNaN(created.getTime())) {
        return created;
      }
    }
    const inbound = this.getFirstTransactionDate(request.inTxs);
    return inbound;
  }

  private getCompletionDate(request: RelayRequest): Date | null {
    const outbound = this.getFirstTransactionDate(request.outTxs);
    if (outbound) {
      return outbound;
    }
    if (request.updatedAt) {
      const updated = new Date(request.updatedAt);
      if (!Number.isNaN(updated.getTime())) {
        return updated;
      }
    }
    return null;
  }

  private getFirstTransactionDate(
    txs?: RelayTransaction[]
  ): Date | null {
    if (!txs || !txs.length) return null;
    const timestamps = txs
      .map((tx) => this.toNumber(tx.timestamp))
      .filter((value): value is number => value != null)
      .map((value) => this.timestampToDate(value));
    const valid = timestamps.filter((date): date is Date => Boolean(date));
    if (!valid.length) return null;
    return valid.sort((a, b) => a.getTime() - b.getTime())[0];
  }

  private timestampToDate(value: number): Date | null {
    if (!Number.isFinite(value)) return null;
    const ms = value > 1e12 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private isSuccess(status?: string | null): boolean {
    if (!status) return false;
    return SUCCESS_STATUSES.has(status.toLowerCase());
  }

  private computeUsdVolume(requests: RelayRequest[]): number | null {
    if (!requests.length) return null;
    let total = 0;
    for (const request of requests) {
      const usd = this.extractUsdAmount(request);
      if (usd != null) {
        total += usd;
      }
    }
    return total > 0 ? total : null;
  }

  private routeFromRequest(request: RelayRequest): RouteKey | null {
    const origin =
      this.normalizeChainId(request.originChainId) ??
      this.getFirstChainId(request.inTxs);
    const destination =
      this.normalizeChainId(request.destinationChainId) ??
      this.getFirstChainId(request.outTxs);
    if (origin == null || destination == null) return null;
    return {
      protocol: this.protocol,
      srcChain: aliasFromChainId(origin),
      dstChain: aliasFromChainId(destination),
    };
  }

  private getFirstChainId(txs?: RelayTransaction[]): number | null {
    if (!txs || !txs.length) return null;
    const value = txs
      .map((tx) => this.normalizeChainId(tx.chainId))
      .find((id): id is number => id != null);
    return value ?? null;
  }

  private normalizeChainId(value?: number | string | null): number | null {
    if (value == null) return null;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed.length) return null;
      const maybeNumber = Number(trimmed);
      return Number.isFinite(maybeNumber) ? maybeNumber : null;
    }
    return Number(value);
  }

  private extractUsdAmount(request: RelayRequest): number | null {
    const candidates = [
      request.currencyIn?.amountUsdCurrent,
      request.currencyIn?.amountUsd,
      request.currencyOut?.amountUsdCurrent,
      request.currencyOut?.amountUsd,
      request.refundCurrencyData?.amountUsd,
    ];
    for (const value of candidates) {
      const num = this.toNumber(value);
      if (num != null) {
        return num;
      }
    }
    return null;
  }

  private toNumber(value?: string | number | null): number | null {
    if (value == null) return null;
    const num = typeof value === "number" ? value : Number(value);
    return Number.isFinite(num) ? num : null;
  }
}
