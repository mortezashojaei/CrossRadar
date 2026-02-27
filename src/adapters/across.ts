import { fetchJson } from "../core/http";
import { isWithinWindow } from "../core/window";
import { median, minutesBetween, ratio } from "../core/stats";
import {
  Adapter,
  RouteKey,
  RouteMetrics,
  RawEvent,
} from "./types";

/**
 * Across API notes:
 * - Public docs expose `/v2/deposits` which returns recent deposit/fill info.
 * - We rely on `timestamp` (deposit) and `filled.timestamp` for completion.
 * - If schema changes, we capture adapters errors via notes.
 */
type AcrossDeposit = {
  timestamp?: number;
  deposit?: { timestamp?: number };
  fill?: { timestamp?: number };
  status?: string;
  amountUsd?: number;
  input?: { amountUsd?: number };
  output?: { amountUsd?: number };
};

type AcrossResponse = {
  deposits?: AcrossDeposit[];
};

const supportedRoutes: RouteKey[] = [
  { protocol: "Across", srcChain: "ETH", dstChain: "ARB" },
  { protocol: "Across", srcChain: "ETH", dstChain: "OPT" },
];

export class AcrossAdapter implements Adapter {
  protocol = "Across";

  constructor(private readonly baseUrl: string) {}

  listSupportedRoutes(): RouteKey[] {
    return supportedRoutes;
  }

  async fetchRecentEvents(
    route: RouteKey,
    windowStart: Date,
    windowEnd: Date
  ): Promise<RawEvent[]> {
    const url = `${this.baseUrl}/v2/deposits?fromChain=${route.srcChain}&toChain=${route.dstChain}&limit=200`;
    const res = await fetchJson<AcrossResponse>(url, {}, 1);
    return (res.deposits ?? []).filter((deposit) => {
      const created = this.resolveDate(deposit);
      return created ? isWithinWindow(created, { start: windowStart, end: windowEnd }) : false;
    });
  }

  async computeMetrics(
    events: RawEvent[],
    route: RouteKey,
    windowStart: Date,
    windowEnd: Date
  ): Promise<RouteMetrics> {
    const completionSamples: number[] = [];
    let usdVolume = 0;
    let successes = 0;

    for (const raw of events as AcrossDeposit[]) {
      const created = this.resolveDate(raw);
      if (!created) continue;
      const fillTime = this.resolveFillDate(raw);
      if (fillTime) {
        completionSamples.push(minutesBetween(created, fillTime));
      }
      const usd =
        raw.amountUsd ?? raw.output?.amountUsd ?? raw.input?.amountUsd ?? null;
      if (usd) usdVolume += usd;
      if ((raw.status ?? "").toLowerCase().includes("filled")) {
        successes += 1;
      }
    }

    return {
      key: route,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      txCount: events.length,
      usdVolume: usdVolume || null,
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

  private resolveDate(deposit: AcrossDeposit): Date | null {
    const ms = deposit.timestamp ?? deposit.deposit?.timestamp;
    return this.toDate(ms);
  }

  private resolveFillDate(deposit: AcrossDeposit): Date | null {
    return this.toDate(deposit.fill?.timestamp);
  }

  private toDate(value?: number): Date | null {
    if (!value) return null;
    const normalized = value > 1_000_000_000_000 ? value : value * 1000;
    return new Date(normalized);
  }
}
