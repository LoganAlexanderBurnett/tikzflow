// Compares the native layout with pdfTeX for every corpus picture: node
// centres and sizes. Needs the engines from `npm run fetch-engines` and
// `node scripts/pack-texmf.ts`.
// Usage: npm run fidelity [-- --only=<file part>] [-- --verbose]
// Output: a table on stdout, and spike/engines/results/fidelity.json.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import type { FidelityResult } from "../spike/engines/fidelity.ts";

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only="))?.split("=")[1];
const verbose = args.includes("--verbose");
const root = join(import.meta.dirname, "..");

const server = await createServer({ root, logLevel: "warn", server: { port: 5198, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ channel: "msedge" });
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(`http://localhost:5198/spike/engines/fidelity.html${only ? `?only=${only}` : ""}`);
  await page.waitForFunction(() => window.__fidelity !== undefined, null, { timeout: 900_000, polling: 1000 });
  const results = (await page.evaluate(() => window.__fidelity))!;
  mkdirSync(join(root, "spike", "engines", "results"), { recursive: true });
  writeFileSync(join(root, "spike", "engines", "results", "fidelity.json"), JSON.stringify(results, null, 1));
  let all = 0;
  let within1 = 0;
  for (const r of results as FidelityResult[]) {
    const worst = r.nodes.reduce((m, n) => Math.max(m, n.center), 0);
    const sizeWorst = r.nodes.reduce((m, n) => Math.max(m, Math.abs(n.size[0]), Math.abs(n.size[1])), 0);
    all += r.nodes.length;
    within1 += r.nodes.filter((n) => n.center <= 1 && Math.abs(n.size[0]) <= 1 && Math.abs(n.size[1]) <= 1).length;
    console.log(
      `${`${r.file} #${r.picture}`.padEnd(40)} ${r.ok ? "compiled" : "FAILED  "} nodes ${String(r.nodes.length).padStart(3)}` +
        `  worst centre ${worst.toFixed(2).padStart(7)} pt  worst size ${sizeWorst.toFixed(2).padStart(7)} pt` +
        (r.missing.length ? `  missing ${r.missing.join(",")}` : "") +
        (r.error ? `  ${r.error}` : ""),
    );
    if (verbose) {
      for (const n of r.nodes.filter((x) => x.center > 1 || Math.abs(x.size[0]) > 1 || Math.abs(x.size[1]) > 1)) {
        console.log(`    ${n.name.padEnd(20)} centre off ${n.center.toFixed(2)} pt, size off ${n.size.map((v) => v.toFixed(2)).join(" x ")} pt`);
      }
    }
  }
  console.log(`\n${within1} of ${all} nodes within 1 pt of pdfTeX (centre and size).`);
} finally {
  await browser.close();
  await server.close();
}
