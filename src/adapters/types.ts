import { z } from "zod";

export type RouteKey = {
  protocol: string;
  srcChain: string;
  dstChain: string;
};

export type RouteMetrics = {
  key: RouteKey;
  windowStart: string;
  windowEnd: string;
  txCount: number;
  usdVolume: number | null;
  medianCompletionMinutes: number | null;
  successRate: number | null;
  notes?: string[];
};

export const routeKeySchema = z.object({
  protocol: z.string(),
  srcChain: z.string(),
  dstChain: z.string(),
});

export type AdapterContext = {
  baseUrl: string;
  windowMinutes: number;
};

export type RawEvent = Record<string, unknown>;

export interface Adapter {
  protocol: string;
  listSupportedRoutes(): RouteKey[];
  fetchRecentEvents(
    route: RouteKey,
    windowStart: Date,
    windowEnd: Date
  ): Promise<RawEvent[]>;
  computeMetrics(
    events: RawEvent[],
    route: RouteKey,
    windowStart: Date,
    windowEnd: Date
  ): Promise<RouteMetrics>;
  getMetricsForWindow(
    route: RouteKey,
    windowStart: Date,
    windowEnd: Date
  ): Promise<RouteMetrics>;
}

export const adapterErrorMetrics = (
  route: RouteKey,
  windowStart: Date,
  windowEnd: Date,
  note: string
): RouteMetrics => ({
  key: route,
  windowStart: windowStart.toISOString(),
  windowEnd: windowEnd.toISOString(),
  txCount: 0,
  usdVolume: null,
  medianCompletionMinutes: null,
  successRate: null,
  notes: [note],
});
