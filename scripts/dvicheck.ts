// Runs spike/engines/dvicheck.html in Edge: our DVI to SVG converter against
// the real dvisvgm on a CI run's reference DVI files (D66). Saves a PNG per
// diagram (dvisvgm | ours | diff) and dvicheck.json.
//
// Usage: node scripts/dvicheck.ts [--run=run3] [--only=09-matrix]
//   --run: the folder under vendor/engine-ci holding the CI artifact
//          (gh run download <id> --name engine --dir vendor/engine-ci/<folder>)
// Output: spike/engines/results/dvicheck/*.png and dvicheck.json

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import type { DviCheckResult } from "../spike/engines/dvicheck.ts";

const args = process.argv.slice(2);
const opt = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const run = opt("run") ?? "run3";
const only = opt("only");

const root = join(import.meta.dirname, "..");
const outDir = join(root, "spike", "engines", "results", "dvicheck");
mkdirSync(outDir, { recursive: true });

const server = await createServer({ root, logLevel: "warn", server: { port: 5198, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ channel: "msedge" });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(`http://localhost:5198/spike/engines/dvicheck.html?run=${run}${only ? `&only=${only}` : ""}`);
  await page.waitForFunction(() => window.__dvicheck !== undefined, null, { timeout: 300_000, polling: 500 });
  const results = (await page.evaluate(() => window.__dvicheck))!;
  const summary: Array<Omit<DviCheckResult, "composite">> = [];
  for (const { composite, ...rest } of results) {
    if (composite) writeFileSync(join(outDir, `${rest.name}.png`), Buffer.from(composite.split(",")[1]!, "base64"));
    summary.push(rest);
    const s = rest.stats;
    console.log(`${rest.name}: ${s ? `${s.mismatchPct}% (missing ${s.missing}, extra ${s.extra}, colour ${s.color}; size ${s.refSizePt.join("x")} vs ${s.testSizePt.join("x")} pt, offset ${s.offsetPt.join(",")})` : "n/a"}; ${rest.glyphs} glyphs, ${rest.ms} ms`);
  }
  writeFileSync(join(outDir, "dvicheck.json"), JSON.stringify({ run, browser: `msedge ${browser.version()}`, date: new Date().toISOString(), results: summary }, null, 2) + "\n");
} finally {
  await browser.close();
  await server.close();
}
