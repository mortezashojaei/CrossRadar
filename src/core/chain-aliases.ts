import { findChainIdByName, getChainNameById } from "./chains";

const aliasToId: Record<string, number> = {
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
  hyperliquid: 999,
  hyper: 999,
};

const idToAlias: Record<number, string> = {
  1: "ETH",
  10: "OPT",
  56: "BSC",
  1101: "ZKEVM",
  137: "POLYGON",
  8453: "BASE",
  42161: "ARB",
  43114: "AVAX",
  534352: "SCROLL",
  59144: "LINEA",
  81457: "BLAST",
};

export function resolveChainIdFromInput(chain: string): number {
  const trimmed = chain.trim();
  const normalized = trimmed.toLowerCase();
  if (/^\d+$/.test(normalized)) {
    return Number(normalized);
  }
  const manual = aliasToId[normalized];
  if (manual) {
    return manual;
  }
  const viemId = findChainIdByName(trimmed);
  if (viemId != null) {
    return viemId;
  }
  throw new Error(
    `Unknown chain ${chain}. Use a numeric chain id or update the alias map.`
  );
}

export function aliasFromChainId(chainId: number): string {
  return idToAlias[chainId] ?? getChainNameById(chainId);
}
