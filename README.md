# CrossRadar — Bridge Health Radar

Autonomous stateless service that samples recent activity from Across (via the public indexer API), scores the last N minutes of health, and posts a formatted summary to Telegram.

## Features
- Fetches per-route metrics (tx count, median completion, success rate) for Across routes using public endpoints.
- Automatically highlights up to the top 5 most-active routes each run (dynamic selection can be disabled via env).
- Classifies health with 🟢 / 🟡 / 🔴 (and ⚪ when insufficient data) plus optional insights.
- Stateless: every run queries "recent" data and filters in-memory.
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
| `ACROSS_BASE_URL` | Defaults to `https://indexer.api.across.to` |
| `WINDOW_MINUTES` | Lookback window (default 15) |
| `RUN_EVERY_MINUTES` | Loop cadence for `pnpm dev` (default 5) |
| `MAX_ROUTES` | Maximum number of routes to report when dynamic selection is enabled (default 5) |
| `DYNAMIC_ROUTES` | When `true` (default), CrossRadar inspects recent Across deposits and reports up to `MAX_ROUTES` busiest routes; set to `false` to use the static `ROUTES` list. |
| `ROUTES` | JSON array of `{ protocol, srcChain, dstChain }` entries. `srcChain`/`dstChain` can be common names (ETH, ARB, OPT, BASE, etc.) or numeric chain IDs. Only used when `DYNAMIC_ROUTES=false` or no dynamic data is available. |

### Sample `.env`
(Default dynamic behaviour requires only Telegram + optional timing vars. The snippet below shows how to pin a single static route.)
```bash
TELEGRAM_BOT_TOKEN=123:abc
TELEGRAM_CHAT_ID=-987654321
WINDOW_MINUTES=15
RUN_EVERY_MINUTES=5
DYNAMIC_ROUTES=false
ROUTES='[
  {"protocol":"Across","srcChain":"ETH","dstChain":"ARB"}
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
• usd_volume: N/A
• median_minutes: 3.2
• success_rate: 100.0%

🟡 Across ETH→OPT
• tx_count: 3
• usd_volume: N/A
• median_minutes: 6.5
• success_rate: 90.0%
• notes: latency creeping
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
- The Across adapter relies on the public indexer (`https://indexer.api.across.to`). If schemas change, update `src/adapters/across.ts`.
- Dynamic route selection pulls the most recent 500 deposits and sorts by activity; increase `MAX_ROUTES` (<=20) if you need more coverage.
- Success-rate and completion metrics gracefully degrade to `null` when unavailable; status falls back to ⚪ with notes.
