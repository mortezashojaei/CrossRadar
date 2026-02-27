import { z } from "zod";
import { routeKeySchema, RouteKey } from "./adapters/types";

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  ACROSS_BASE_URL: z.string().default("https://indexer.api.across.to"),
  WINDOW_MINUTES: z.coerce.number().positive().int().default(15),
  RUN_EVERY_MINUTES: z.coerce.number().positive().int().default(5),
  ROUTES: z.string().optional(),
  LOG_LEVEL: z.string().optional(),
});

const defaultRoutes: RouteKey[] = [
  { protocol: "Across", srcChain: "ETH", dstChain: "ARB" },
  { protocol: "Across", srcChain: "ETH", dstChain: "OPT" },
];

function parseRoutes(raw?: string): RouteKey[] {
  if (!raw) return defaultRoutes;
  try {
    const parsed = JSON.parse(raw);
    return z.array(routeKeySchema).parse(parsed);
  } catch (error) {
    throw new Error(`Invalid ROUTES env: ${(error as Error).message}`);
  }
}

export type AppConfig = z.infer<typeof envSchema> & {
  routes: RouteKey[];
  dryRun: boolean;
};

export function loadConfig(): AppConfig {
  const env = envSchema.parse(process.env);
  const routes = parseRoutes(env.ROUTES);
  const dryRun = !env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID;
  return { ...env, routes, dryRun };
}

export const config = loadConfig();
