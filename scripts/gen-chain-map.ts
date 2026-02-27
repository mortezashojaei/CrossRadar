#!/usr/bin/env tsx
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as chains from "viem/chains";

type ChainExport = {
  id: number;
  name: string;
  slug?: string;
};

const overrides: Record<number, { name: string; slug?: string }> = {
  // Across uses chain id 999 for Hyperliquid EVM (viem labels it Zora Goerli testnet)
  999: { name: "Hyperliquid EVM", slug: "hyperliquid" },
};

function isChainExport(value: unknown): value is ChainExport {
  return (
    !!value &&
    typeof value === "object" &&
    "id" in value &&
    typeof (value as Record<string, unknown>).id === "number" &&
    "name" in value &&
    typeof (value as Record<string, unknown>).name === "string"
  );
}

async function main() {
  const map: Record<number, { name: string; slug?: string }> = {};

  for (const value of Object.values(chains)) {
    if (!isChainExport(value)) continue;
    const slug =
      typeof value.slug === "string"
        ? value.slug
        : typeof (value as { network?: string }).network === "string"
          ? (value as { network?: string }).network
          : undefined;
    map[value.id] = { name: value.name, ...(slug ? { slug } : {}) };
  }

  for (const [id, metadata] of Object.entries(overrides)) {
    map[Number(id)] = metadata;
  }

  const dirname = path.dirname(fileURLToPath(import.meta.url));
  const outPath = path.resolve(dirname, "../src/data/chainMap.json");
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(map, null, 2) + "\n", "utf8");
  console.log(`Wrote ${Object.keys(map).length} chain entries to ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
