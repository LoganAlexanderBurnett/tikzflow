// Runs spike/engines/compare.html in Edge via Playwright and saves, per
// diagram, a PNG composite (busytex | TikZJax | diffs) plus a JSON summary.
//
// Usage: node scripts/compare-engines.ts [--only=09-matrix] [--browser=msedge|chromium|firefox]
// Output: spike/engines/results/compare/*.png and compare.json

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, firefox } from "@playwright/test";
import { createServer } from "vite";
import type { DiagramResult } from "../spike/engines/compare.ts";

const args = process.argv.slice(2);
const opt = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const browserName = opt("browser") ?? "msedge";
const only = opt("only");

const root = join(import.meta.dirname, "..");
const outDir = join(root, "spike", "engines", "results", "compare");
mkdirSync(outDir, { recursive: true });

const server = await createServer({ root, logLevel: "warn", server: { port: 5197, strictPort: true } });
await server.listen();
const browser =
  browserName === "firefox"
    ? await firefox.launch()
    : browserName === "chromium"
      ? await chromium.launch()
      : await chromium.launch({ channel: browserName });

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(`http://localhost:5197/spike/engines/compare.html${only ? `?only=${only}` : ""}`);
  await page.waitForFunction(() => window.__compare !== undefined, null, { timeout: 900_000, polling: 1000 });
  const results = (await page.evaluate(() => window.__compare))!;
  const summary: Array<Omit<DiagramResult, "composite">> = [];
  for (const { composite, ...rest } of results) {
    if (composite) writeFileSync(join(outDir, `${rest.name}.png`), Buffer.from(composite.split(",")[1]!, "base64"));
    summary.push(rest);
    const f = (s?: DiagramResult["raw"]) =>
      s ? `${s.mismatchPct}% (missing ${s.missing}, extra ${s.extra}, colour ${s.color}; size ref ${s.refSizePt.join("x")} vs ${s.testSizePt.join("x")} pt)` : "n/a";
    console.log(`${rest.name}: busytex ${rest.busytexOk ? "ok" : "FAILED"}, TikZJax ${rest.tikzjaxOk ? "ok" : "FAILED"}`);
    if (rest.raw) console.log(`  raw   ${f(rest.raw)}\n  fixed ${f(rest.fixed)}`);
  }
  writeFileSync(join(outDir, "compare.json"), JSON.stringify({ browser: `${browserName} ${browser.version()}`, date: new Date().toISOString(), results: summary }, null, 2) + "\n");
} finally {
  await browser.close();
  await server.close();
}
