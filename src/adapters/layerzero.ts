import { fetchJson } from "../core/http";
import { isWithinWindow } from "../core/window";
import { median, minutesBetween, ratio } from "../core/stats";
import { Adapter, RouteKey, RouteMetrics, RawEvent } from "./types";

/**
 * LayerZero Scan API (best effort):
 * We query `/messages/latest` with source/destination chain slugs and limit=200.
 * Records expose `created_at` and (optionally) `executed_at` timestamps.
 */
type LayerZeroMessage = {
  created_at?: string;
  executed_at?: string | null;
  status?: string;
};

type LayerZeroResponse = {
  data?: LayerZeroMessage[];
};

const supportedRoutes: RouteKey[] = [
  { protocol: "LayerZero", srcChain: "ETH", dstChain: "BASE" },
  { protocol: "LayerZero", srcChain: "ETH", dstChain: "OP" },
];

export class LayerZeroAdapter implements Adapter {
  protocol = "LayerZero";

  constructor(private readonly baseUrl: string) {}

  listSupportedRoutes(): RouteKey[] {
    return supportedRoutes;
  }

  async fetchRecentEvents(
    route: RouteKey,
    windowStart: Date,
    windowEnd: Date
  ): Promise<RawEvent[]> {
    const url = `${this.baseUrl}/messages/latest?srcChain=${route.srcChain}&dstChain=${route.dstChain}&limit=200`;
    const res = await fetchJson<LayerZeroResponse>(url, {}, 1);
    return (res.data ?? []).filter((message) => {
      const created = message.created_at ? new Date(message.created_at) : null;
      return created ? isWithinWindow(created, { start: windowStart, end: windowEnd }) : false;
    });
  }

  async computeMetrics(
    events: RawEvent[],
    route: RouteKey,
    windowStart: Date,
    windowEnd: Date
  ): Promise<RouteMetrics> {
    let successes = 0;
    const completion: number[] = [];

    for (const raw of events as LayerZeroMessage[]) {
      const created = raw.created_at ? new Date(raw.created_at) : null;
      const executed = raw.executed_at ? new Date(raw.executed_at) : null;
      if (created && executed) {
        completion.push(minutesBetween(created, executed));
      }
      if ((raw.status ?? "").toLowerCase() === "executed") {
        successes += 1;
      }
    }

    return {
      key: route,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      txCount: events.length,
      usdVolume: null,
      medianCompletionMinutes: median(completion),
      successRate: ratio(successes, events.length),
      notes: events.length ? undefined : ["no LayerZero messages"],
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
