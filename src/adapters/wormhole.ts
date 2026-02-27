import { fetchJson } from "../core/http";
import { isWithinWindow } from "../core/window";
import { median, minutesBetween, ratio } from "../core/stats";
import { Adapter, RouteKey, RouteMetrics, RawEvent } from "./types";

/**
 * WormholeScan API approximation:
 * `/transfers/recent` returns recent bridge transfers with `timestamp` and
 * `completed_at` (if finalized).
 */
type WormholeTransfer = {
  timestamp?: string;
  completed_at?: string | null;
  status?: string;
  notional?: { usd?: number };
};

type WormholeResponse = {
  transfers?: WormholeTransfer[];
};

const supportedRoutes: RouteKey[] = [
  { protocol: "Wormhole", srcChain: "SOL", dstChain: "ETH" },
  { protocol: "Wormhole", srcChain: "ETH", dstChain: "SOL" },
];

export class WormholeAdapter implements Adapter {
  protocol = "Wormhole";

  constructor(private readonly baseUrl: string) {}

  listSupportedRoutes(): RouteKey[] {
    return supportedRoutes;
  }

  async fetchRecentEvents(
    route: RouteKey,
    windowStart: Date,
    windowEnd: Date
  ): Promise<RawEvent[]> {
    const url = `${this.baseUrl}/transfers/recent?srcChain=${route.srcChain}&dstChain=${route.dstChain}&limit=200`;
    const res = await fetchJson<WormholeResponse>(url, {}, 1);
    return (res.transfers ?? []).filter((transfer) => {
      const ts = transfer.timestamp ? new Date(transfer.timestamp) : null;
      return ts ? isWithinWindow(ts, { start: windowStart, end: windowEnd }) : false;
    });
  }

  async computeMetrics(
    events: RawEvent[],
    route: RouteKey,
    windowStart: Date,
    windowEnd: Date
  ): Promise<RouteMetrics> {
    let usdVolume = 0;
    const completion: number[] = [];
    let successes = 0;

    for (const raw of events as WormholeTransfer[]) {
      const created = raw.timestamp ? new Date(raw.timestamp) : null;
      const completed = raw.completed_at ? new Date(raw.completed_at) : null;
      if (created && completed) {
        completion.push(minutesBetween(created, completed));
      }
      if (raw.notional?.usd) {
        usdVolume += raw.notional.usd;
      }
      if ((raw.status ?? "").toLowerCase() === "completed") {
        successes += 1;
      }
    }

    return {
      key: route,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      txCount: events.length,
      usdVolume: usdVolume || null,
      medianCompletionMinutes: median(completion),
      successRate: ratio(successes, events.length),
      notes: events.length ? undefined : ["no wormhole transfers"],
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
}
