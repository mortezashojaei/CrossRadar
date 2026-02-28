import { fetchJson } from "./http";

export type TokenQuote = {
  priceUsd: number | null;
  decimals: number | null;
};

const DEFAULT_DECIMALS = 18;
const COINGECKO_API_BASE = "https://api.coingecko.com/api/v3";

const chainIdToPlatform: Record<number, string> = {
  1: "ethereum",
  10: "optimistic-ethereum",
  56: "binance-smart-chain",
  100: "xdai",
  137: "polygon-pos",
  8453: "base",
  42161: "arbitrum-one",
  43114: "avalanche",
  59144: "linea",
  81457: "blast",
  1101: "polygon-zkevm",
  999: "hyperliquid-evm",
};

export class CoinGeckoClient {
  private quoteCache = new Map<string, Promise<TokenQuote | null>>();

  constructor(private readonly apiKey?: string) {}

  supportsChain(chainId: number): boolean {
    return Boolean(chainIdToPlatform[chainId]);
  }

  async getTokenQuote(
    chainId: number,
    address: string
  ): Promise<TokenQuote | null> {
    const platform = chainIdToPlatform[chainId];
    if (!platform) return null;
    const normalized = address.toLowerCase();
    const cacheKey = `${platform}:${normalized}`;
    if (!this.quoteCache.has(cacheKey)) {
      this.quoteCache.set(cacheKey, this.fetchTokenQuote(platform, normalized));
    }
    return this.quoteCache.get(cacheKey) ?? null;
  }

  private async fetchTokenQuote(
    platform: string,
    address: string
  ): Promise<TokenQuote | null> {
    const url = `${COINGECKO_API_BASE}/coins/${platform}/contract/${address}`;
    try {
      const headers = this.apiKey
        ? { "x-cg-pro-api-key": this.apiKey }
        : undefined;
      const data = await fetchJson<any>(url, { headers, timeoutMs: 15000 }, 1);
      const priceUsd = this.toNumber(data?.market_data?.current_price?.usd);
      const decimals = this.toNumber(
        data?.detail_platforms?.[platform]?.decimal_place
      );
      return {
        priceUsd,
        decimals: Number.isInteger(decimals) ? decimals : null,
      };
    } catch (error) {
      console.warn("CoinGecko fetch failed", { platform, address, error });
      return null;
    }
  }

  private toNumber(value: unknown): number | null {
    if (value == null) return null;
    const num = typeof value === "number" ? value : Number(value);
    return Number.isFinite(num) ? num : null;
  }
}

export function getDefaultDecimals(): number {
  return DEFAULT_DECIMALS;
}
