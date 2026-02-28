import { RelayAdapter } from "../src/adapters/relay";
import { resolveChainIdFromInput } from "../src/core/chain-aliases";

async function main() {
  const baseUrl = process.env.RELAY_BASE_URL ?? "https://api.relay.link";
  const adapter = new RelayAdapter(baseUrl);
  const now = new Date();
  const start = new Date(now.getTime() - 15 * 60 * 1000);
  const routes = await adapter.getTopRoutesForWindow(start, now, 5);
  console.log(JSON.stringify(routes, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
