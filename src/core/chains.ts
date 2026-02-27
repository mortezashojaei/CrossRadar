import chainMap from "../data/chainMap.json" assert { type: "json" };

type ChainMetadata = {
  name: string;
  slug?: string;
};

const idToMetadata: Record<string, ChainMetadata> = chainMap;

const nameToId = new Map<string, number>();
for (const [id, metadata] of Object.entries(idToMetadata)) {
  const numericId = Number(id);
  nameToId.set(metadata.name.toLowerCase(), numericId);
  if (metadata.slug) {
    nameToId.set(metadata.slug.toLowerCase(), numericId);
  }
}

export function getChainNameById(chainId: number): string {
  const metadata = idToMetadata[String(chainId)];
  return metadata?.name ?? `Chain ${chainId}`;
}

export function findChainIdByName(name: string): number | null {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return null;
  return nameToId.get(normalized) ?? null;
}
