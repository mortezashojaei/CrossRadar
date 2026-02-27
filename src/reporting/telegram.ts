import { fetch } from "undici";
import { AppConfig } from "../config";
import pino from "pino";

export async function postToTelegram(
  text: string,
  config: AppConfig,
  logger: pino.Logger
): Promise<void> {
  if (config.dryRun) {
    logger.warn(
      { component: "telegram" },
      "TELEGRAM env vars missing – running in dry mode"
    );
    return;
  }

  const url = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: config.TELEGRAM_CHAT_ID,
    text,
    parse_mode: "MarkdownV2",
    disable_web_page_preview: true,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const payload = await res.text();
    throw new Error(`Telegram error ${res.status}: ${payload}`);
  }
}
