import { OpportunitySignal } from "../core/opportunity";

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

function riskEmoji(risk: OpportunitySignal["risk"]): string {
  if (risk === "high") return "🔴";
  if (risk === "medium") return "🟡";
  return "🟢";
}

export function formatReport(
  items: OpportunitySignal[],
  windowStart: Date,
  windowEnd: Date
): string {
  const header = `*${escapeMarkdown(
    `Bridge Opportunity Finder — Last ${Math.round(
      (windowEnd.getTime() - windowStart.getTime()) / 60000
    )} Minutes (UTC)`
  )}*`;
  const timestamp = `_${escapeMarkdown(windowEnd.toISOString())}_`;

  const ranked = [...items]
    .sort((a, b) => b.opportunityScore - a.opportunityScore)
    .slice(0, 12);

  if (!ranked.length) {
    return `${header}\n${timestamp}\n\nNo opportunity signals in this window\.`;
  }

  const body = ranked
    .map((signal) => {
      const { metrics } = signal;
      const routeLabel = `${metrics.key.protocol} ${metrics.key.srcChain}→${metrics.key.dstChain}`;
      const lines = [
        `${riskEmoji(signal.risk)} *${escapeMarkdown(routeLabel)}*`,
        `• opportunity_score: ${formatNumber(signal.opportunityScore)}`,
        `• est_edge_bps: ${formatNumber(signal.edgeBps)}`,
        `• confidence: ${formatNumber(signal.confidence, 1)}\%`,
        `• tx_count: ${formatInteger(metrics.txCount)}`,
        `• usd_volume: ${formatNumber(metrics.usdVolume)}`,
        `• median_minutes: ${formatNumber(metrics.medianCompletionMinutes)}`,
      ];

      const notes = new Set<string>();
      (signal.notes ?? []).forEach((note) => notes.add(note));
      if (notes.size) {
        lines.push(`• notes: ${escapeMarkdown(Array.from(notes).join("; "))}`);
      }

      return lines.join("\n");
    })
    .join("\n\n");

  return `${header}\n${timestamp}\n\n${body}`;
}
