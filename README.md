# CrossRadar — Bridge Health Radar

Autonomous stateless service that samples recent activity from major bridge protocols (Across, LayerZero, Wormhole), scores their health over the last N minutes, and posts a formatted summary to Telegram.

## Features
- Fetches per-route metrics (tx count, USD volume, median completion, success rate) every run using public APIs.
- Classifies health with 🟢 / 🟡 / 🔴 (and ⚪ when insufficient data) and optional insights.
- Stateless: every run queries "recent" endpoints and filters in-memory.
- Outputs Markdown-formatted Telegram message (also printed to stdout).
- Dry-run automatically if Telegram env vars are missing.
- Tests (Vitest) for stats, scoring, and Markdown escaping.
- Optional GitHub Actions workflow + `pnpm dev` loop for cron-style deployments.

## Requirements
- Node.js 22+
- pnpm 9+ (managed via `corepack enable`)

## Environment Variables
| Variable | Description |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | Target chat/channel ID (use negative ID for channels) |
| `ACROSS_BASE_URL` | Defaults to `https://across.to/api` |
| `LAYERZERO_SCAN_BASE_URL` | Defaults to `https://api.layerzeroscan.com/api/v1` |
| `WORMHOLESCAN_BASE_URL` | Defaults to `https://api.wormholescan.io/api/v1` |
| `WINDOW_MINUTES` | Lookback window (default 15) |
| `RUN_EVERY_MINUTES` | Loop cadence for `pnpm dev` (default 5) |
| `ROUTES` | JSON array of `{ protocol, srcChain, dstChain }` entries |

### Sample `.env`
```bash
TELEGRAM_BOT_TOKEN=123:abc
TELEGRAM_CHAT_ID=-987654321
WINDOW_MINUTES=15
RUN_EVERY_MINUTES=5
ROUTES='[
  {"protocol":"Across","srcChain":"ETH","dstChain":"ARB"},
  {"protocol":"LayerZero","srcChain":"ETH","dstChain":"BASE"},
  {"protocol":"Wormhole","srcChain":"SOL","dstChain":"ETH"}
]'
```

## Telegram Setup
1. Talk to [@BotFather](https://t.me/BotFather) → `/newbot` → copy the HTTP API token.
2. Add the bot to your channel/group and promote it if posting to a channel.
3. Get `chat_id`:
   - For groups: send a message, then call `https://api.telegram.org/bot<token>/getUpdates` and inspect `chat.id`.
   - For channels: use [`@RawDataBot`](https://t.me/RawDataBot) or the same getUpdates flow (channel IDs are negative).
4. Export `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` before running.

## Development
Install deps:
```bash
pnpm install
```

### One-off run (prints + posts)
```bash
pnpm start
```

### Loop every RUN_EVERY_MINUTES (defaults to 5)
```bash
pnpm dev
```

### Tests
```bash
pnpm test
```

## Example Output
```
Bridge Health — Last 15 Minutes (UTC)
2026-02-26T23:10:00.000Z

🟢 Across ETH→ARB
• tx_count: 18
• usd_volume: 91234.11
• median_minutes: 3.2
• success_rate: 100.0%

🟡 LayerZero ETH→BASE
• tx_count: 9
• usd_volume: N/A
• median_minutes: 6.5
• success_rate: 97.8%
• notes: latency creeping

🔴 Wormhole SOL→ETH
• tx_count: 4
• usd_volume: 1123.00
• median_minutes: 12.0
• success_rate: 90.0%
• notes: success rate dropped
```

## Deployment
### GitHub Actions (scheduled every 5 minutes)
Update repository secrets for `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and any API overrides. Workflow file: `.github/workflows/bridge-health.yml`.

### Cron / systemd
Run `pnpm start` every 5 minutes (or use `pnpm dev` in a long-running process manager such as PM2 or systemd). Example cron:
```
*/5 * * * * cd /opt/crossradar && pnpm start >> /var/log/crossradar.log 2>&1
```

## Notes & TODOs
- Adapter schemas are best-effort and may need tweaks if upstream APIs change. Each adapter documents assumptions at the top of the file.
- Success-rate and completion metrics gracefully degrade to `null` when unavailable; status falls back to ⚪ with notes.
