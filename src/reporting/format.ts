import { RouteMetrics } from "../adapters/types";
import { HealthStatus } from "../core/scoring";

export type DecoratedMetrics = {
  metrics: RouteMetrics;
  status: HealthStatus;
};

const markdownEscapes = /([_\-*\[\]()~`>#+=|{}.!])/g;

export function escapeMarkdown(text: string): string {
  return text.replace(markdownEscapes, "\\$1");
}

function formatNumber(value: number | null, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "N/A";
  return escapeMarkdown(value.toFixed(digits));
}

function formatInteger(value: number): string {
  if (Number.isNaN(value)) return "N/A";
  return escapeMarkdown(Math.trunc(value).toString());
}

function formatPercent(value: number | null, digits = 1): string {
  if (value == null || Number.isNaN(value)) return "N/A";
  return `${escapeMarkdown((value * 100).toFixed(digits))}\\%`;
}

export function formatReport(
  items: DecoratedMetrics[],
  windowStart: Date,
  windowEnd: Date
): string {
  const header = `*${escapeMarkdown(
    `Bridge Health — Last ${Math.round(
      (windowEnd.getTime() - windowStart.getTime()) / 60000
    )} Minutes (UTC)`
  )}*`;
  const timestamp = `_${escapeMarkdown(windowEnd.toISOString())}_`;

  const body = items
    .map(({ metrics, status }) => {
      const routeLabel = `${metrics.key.protocol} ${metrics.key.srcChain}→${metrics.key.dstChain}`;
      const tx = formatInteger(metrics.txCount);
      const usd = formatNumber(metrics.usdVolume);
      const median = formatNumber(metrics.medianCompletionMinutes);
      const success = formatPercent(metrics.successRate);
      const lines = [
        `${status.emoji} *${escapeMarkdown(routeLabel)}*`,
        `• tx_count: ${tx}`,
        `• usd_volume: ${usd}`,
        `• median_minutes: ${median}`,
        `• success_rate: ${success}`,
      ];

      const notes = new Set<string>();
      if (status.note) notes.add(status.note);
      (metrics.notes ?? []).forEach((note) => notes.add(note));
      if (notes.size) {
        lines.push(`• notes: ${escapeMarkdown(Array.from(notes).join("; "))}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");

  return `${header}\n${timestamp}\n\n${body}`;
}
