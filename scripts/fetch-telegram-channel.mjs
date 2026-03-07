#!/usr/bin/env node

import fs from "node:fs/promises";

const channel = process.argv[2] || "crossradarstatus";
const maxPages = Number(process.argv[3] || 200);

function decodeHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseMessages(html, channelName) {
  const pattern = new RegExp(
    `data-post="${channelName}\\/(\\d+)"[\\s\\S]*?<div class="tgme_widget_message_text js-message_text"[^>]*>([\\s\\S]*?)<\\/div>[\\s\\S]*?<time datetime="([^"]+)"`,
    "g"
  );

  const out = [];
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const id = Number(match[1]);
    if (!Number.isFinite(id)) continue;
    const text = decodeHtml(match[2] || "");
    const datetime = match[3] || null;
    out.push({ id, datetime, text });
  }
  return out;
}

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function main() {
  const base = `https://t.me/s/${channel}`;
  const all = new Map();
  let before = null;

  for (let page = 0; page < maxPages; page++) {
    const url = before ? `${base}?before=${before}` : base;
    const html = await fetchPage(url);
    const messages = parseMessages(html, channel);
    if (!messages.length) break;

    for (const msg of messages) {
      if (!all.has(msg.id)) all.set(msg.id, msg);
    }

    const minId = Math.min(...messages.map((m) => m.id));
    if (!Number.isFinite(minId) || minId === before) break;
    before = minId;
  }

  const sorted = Array.from(all.values()).sort((a, b) => a.id - b.id);
  const outDir = new URL("../data/", import.meta.url).pathname;
  await fs.mkdir(outDir, { recursive: true });
  const jsonPath = `${outDir}${channel}-messages.json`;
  const txtPath = `${outDir}${channel}-messages.txt`;

  await fs.writeFile(
    jsonPath,
    JSON.stringify({ channel, count: sorted.length, messages: sorted }, null, 2)
  );
  const txt = sorted
    .map((m) => `#${m.id} ${m.datetime || ""}\n${m.text}\n`)
    .join("\n---\n\n");
  await fs.writeFile(txtPath, txt);

  console.log(JSON.stringify({ channel, count: sorted.length, jsonPath, txtPath }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
