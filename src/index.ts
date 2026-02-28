import { config, getFallbackRoutes } from "./config";
import { logger } from "./logger";
import { computeWindowRange } from "./core/window";
import { scoreMetrics } from "./core/scoring";
import { formatReport, DecoratedMetrics } from "./reporting/format";
import { postToTelegram } from "./reporting/telegram";
import { AcrossAdapter } from "./adapters/across";
import { RelayAdapter } from "./adapters/relay";
import { adapterErrorMetrics, Adapter, RouteKey, RawEvent } from "./adapters/types";
import { CoinGeckoClient } from "./core/pricing";

const adapterInstances = new Map<string, Adapter>();
const coinGeckoClient = new CoinGeckoClient(config.COINGECKO_API_KEY);
adapterInstances.set(
  "across",
  new AcrossAdapter(config.ACROSS_BASE_URL, coinGeckoClient)
);
adapterInstances.set("relay", new RelayAdapter(config.RELAY_BASE_URL));

function getAdapter(protocol: string): Adapter | undefined {
  return adapterInstances.get(protocol.toLowerCase());
}

type RoutePlan = {
  route: RouteKey;
  events?: RawEvent[];
};

type DynamicAdapter = Adapter & {
  getTopRoutesForWindow(
    windowStart: Date,
    windowEnd: Date,
    maxRoutes: number
  ): Promise<{ route: RouteKey; events: RawEvent[] }[]>;
};

function isDynamicAdapter(adapter: Adapter): adapter is DynamicAdapter {
  return typeof adapter.getTopRoutesForWindow === "function";
}

async function planRoutes(
  windowStart: Date,
  windowEnd: Date
): Promise<RoutePlan[]> {
  if (!config.DYNAMIC_ROUTES) {
    return config.routes.map((route) => ({ route }));
  }

  const dynamicPlans: RoutePlan[] = [];
  const attemptedProtocols = new Set<string>();
  const successfulProtocols = new Set<string>();

  for (const adapter of adapterInstances.values()) {
    if (!isDynamicAdapter(adapter)) continue;
    attemptedProtocols.add(adapter.protocol);
    try {
      const top = await adapter.getTopRoutesForWindow(
        windowStart,
        windowEnd,
        config.MAX_ROUTES
      );
      if (!top.length) {
        logger.warn({ protocol: adapter.protocol }, "no dynamic routes found");
        continue;
      }
      successfulProtocols.add(adapter.protocol);
      logger.info(
        { protocol: adapter.protocol, routes: top.map((item) => item.route) },
        "selected dynamic routes"
      );
      for (const item of top) {
        dynamicPlans.push({ route: item.route, events: item.events });
      }
    } catch (error) {
      logger.error(
        { protocol: adapter.protocol, err: error },
        "dynamic route selection failed"
      );
    }
  }

  const unique = new Map<string, RoutePlan>();
  for (const plan of dynamicPlans) {
    const key = `${plan.route.protocol}:${plan.route.srcChain}->${plan.route.dstChain}`;
    if (!unique.has(key)) {
      unique.set(key, plan);
    }
  }

  for (const protocol of attemptedProtocols) {
    if (successfulProtocols.has(protocol)) continue;
    const fallbacks = getFallbackRoutes(protocol).length
      ? getFallbackRoutes(protocol)
      : config.routes.filter(
          (route) => route.protocol.toLowerCase() === protocol.toLowerCase()
        );
    if (fallbacks.length) {
      logger.info({ protocol, routes: fallbacks }, "using fallback routes");
      for (const route of fallbacks) {
        const key = `${route.protocol}:${route.srcChain}->${route.dstChain}`;
        if (!unique.has(key)) {
          unique.set(key, { route });
        }
      }
    }
  }

  for (const route of config.routes) {
    const key = `${route.protocol}:${route.srcChain}->${route.dstChain}`;
    if (!unique.has(key)) {
      unique.set(key, { route });
    }
  }

  if (unique.size) {
    return Array.from(unique.values());
  }

  return config.routes.map((route) => ({ route }));
}

async function runOnce(): Promise<void> {
  const { start, end } = computeWindowRange(config.WINDOW_MINUTES);
  logger.info({ start, end }, "running bridge health cycle");

  const decorated: DecoratedMetrics[] = [];
  const routePlans = await planRoutes(start, end);

  for (const plan of routePlans) {
    const { route, events } = plan;
    const adapter = getAdapter(route.protocol);
    if (!adapter) {
      logger.warn({ route }, "no adapter for protocol");
      const metrics = adapterErrorMetrics(route, start, end, "adapter missing");
      decorated.push({ metrics, status: scoreMetrics(metrics) });
      continue;
    }

    const supported = adapter.listSupportedRoutes();
    const supportedRoute =
      !supported.length ||
      supported.some(
        (item) =>
          item.srcChain === route.srcChain && item.dstChain === route.dstChain
      );
    if (!supportedRoute) {
      logger.warn({ route }, "route not officially supported by adapter");
    }

    try {
      const metrics = events
        ? await adapter.computeMetrics(events, route, start, end)
        : await adapter.getMetricsForWindow(route, start, end);
      decorated.push({ metrics, status: scoreMetrics(metrics) });
    } catch (error) {
      logger.error({ route, err: error }, "adapter error");
      const metrics = adapterErrorMetrics(
        route,
        start,
        end,
        `adapter error: ${(error as Error).message}`
      );
      decorated.push({ metrics, status: scoreMetrics(metrics) });
    }
  }

  const message = formatReport(
    decorated,
    start,
    end
  );

  console.log("\n" + message + "\n");
  await postToTelegram(message, config, logger);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const loop = process.argv.includes("--loop");
  if (!loop) {
    await runOnce();
    return;
  }
  while (true) {
    await runOnce();
    await delay(config.RUN_EVERY_MINUTES * 60 * 1000);
  }
}

main().catch((error) => {
  logger.error(error, "fatal error");
  process.exit(1);
});
