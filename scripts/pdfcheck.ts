// Runs spike/engines/pdfcheck.html in Edge: the PDF export (D72) against the
// SVG it was made from, for the comparison diagrams (or --set=corpus: every
// corpus picture). pdf.js draws the PDF, the browser the SVG; both are
// diffed. Saves a PNG per picture (SVG | PDF | diff) and pdfcheck.json.
//
// Usage: node scripts/pdfcheck.ts [--set=diagrams|corpus] [--only=09-matrix]
// Output: spike/engines/results/pdfcheck/<set>/*.png and pdfcheck.json
// Needs the engine: npm run fetch-engines -- engine

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import type { PdfCheckResult } from "../spike/engines/pdfcheck.ts";

const args = process.argv.slice(2);
const opt = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const set = opt("set") ?? "diagrams";
const only = opt("only");

const root = join(import.meta.dirname, "..");
const outDir = join(root, "spike", "engines", "results", "pdfcheck", set);
mkdirSync(outDir, { recursive: true });

const server = await createServer({ root, logLevel: "warn", server: { port: 5197, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ channel: "msedge" });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(`http://localhost:5197/spike/engines/pdfcheck.html?set=${set}${only ? `&only=${only}` : ""}`);
  await page.waitForFunction(() => window.__pdfcheck !== undefined, null, { timeout: 600_000, polling: 500 });
  const results = (await page.evaluate(() => window.__pdfcheck))!;
  const summary: Array<Omit<PdfCheckResult, "composite">> = [];
  let worst = 0;
  for (const { composite, ...rest } of results) {
    if (composite) writeFileSync(join(outDir, `${rest.name}.png`), Buffer.from(composite.split(",")[1]!, "base64"));
    summary.push(rest);
    const s = rest.stats;
    if (s) worst = Math.max(worst, s.mismatchPct);
    console.log(
      `${rest.name}: ${rest.ok && s ? `${s.mismatchPct}% (missing ${s.missing}, extra ${s.extra}, colour ${s.color}; ${rest.pdfBytes} B PDF vs ${rest.svgBytes} B SVG, ${rest.ms} ms)` : `FAILED ${rest.log}`}${rest.warnings.length ? ` [${rest.warnings.join("; ")}]` : ""}`,
    );
  }
  console.log(`${results.length} pictures, worst ${worst}%`);
  writeFileSync(join(outDir, "pdfcheck.json"), JSON.stringify({ set, browser: `msedge ${browser.version()}`, date: new Date().toISOString(), results: summary }, null, 2) + "\n");
} finally {
  await browser.close();
  await server.close();
}
