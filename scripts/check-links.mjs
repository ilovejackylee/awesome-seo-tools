#!/usr/bin/env node
/**
 * Check HTTP status of markdown links in README.md
 * Usage: node scripts/check-links.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const readmePath = resolve(root, "README.md");
const reportPath = resolve(__dirname, "link-report.json");

const TIMEOUT_MS = 12000;
const CONCURRENCY = 8;

const text = readFileSync(readmePath, "utf8");
const re = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
const links = [];
const seen = new Set();

for (const match of text.matchAll(re)) {
  const url = match[2];
  if (seen.has(url)) continue;
  seen.add(url);
  links.push({ title: match[1], url });
}

async function check(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "SEO-Tools-Collection-LinkCheck/1.0" },
    });
    if (res.status === 405 || res.status === 403 || res.status === 400) {
      res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { "user-agent": "SEO-Tools-Collection-LinkCheck/1.0" },
      });
    }
    return { url, status: res.status, ok: res.ok };
  } catch (err) {
    return { url, status: 0, ok: false, error: err.name || String(err) };
  } finally {
    clearTimeout(timer);
  }
}

async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

console.log(`Checking ${links.length} unique links...\n`);

const raw = await mapPool(links, CONCURRENCY, (item) => check(item.url));
const report = links.map((item, idx) => ({ ...item, ...raw[idx] }));
const failed = report.filter((r) => !r.ok);

writeFileSync(reportPath, JSON.stringify(report, null, 2));

for (const r of report) {
  const mark = r.ok ? "OK " : "FAIL";
  const extra = r.error ? ` (${r.error})` : "";
  console.log(`${mark}  ${r.status || "ERR"}  ${r.url}${extra}`);
}

console.log(`\nDone. ${report.length - failed.length}/${report.length} passed.`);
if (failed.length) {
  console.log(`Failed: ${failed.length}`);
  console.log(`Report: ${reportPath}`);
  process.exitCode = 1;
} else {
  console.log(`Report: ${reportPath}`);
}
