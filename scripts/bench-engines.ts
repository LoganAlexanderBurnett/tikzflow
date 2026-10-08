// Repeatable engine benchmark. Starts its own Vite server, then for each
// engine runs several trials, each in a fresh browser context (empty HTTP
// cache), and records load time, cold and warm compile times, the files
// fetched, and their sizes raw and Brotli-compressed.
//
// Usage: node scripts/bench-engines.ts [engine ...] [--trials=3] [--runs=6] [--browser=msedge|chromium|firefox]
// Results: spike/engines/results/<engine>.json and a summary on stdout.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";
import { chromium, firefox, type Browser } from "@playwright/test";
import { createServer } from "vite";
import type { BenchResult } from "../spike/engines/bench.ts";

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const engines = args.filter((a) => !a.startsWith("--"));
const trials = Number(opt("trials", "3"));
const runs = Number(opt("runs", "6"));
const browserName = opt("browser", "msedge");
/** Extra query string for the bench page, e.g. --query=console=0 */
const query = opt("query", "");
const outTag = opt("tag", "");

const root = join(import.meta.dirname, "..");
const outDir = join(root, "spike", "engines", "results");
// Edge results keep the plain names; other browsers get a suffix so they never overwrite them.
const suffix = (browserName === "msedge" ? "" : `.${browserName}`) + (outTag ? `.${outTag}` : "");

interface FileStat {
  url: string;
  bytes: number;
  brotliBytes: number;
}

interface Trial extends BenchResult {
  files: FileStat[];
  wallMs: number;
}

// Brotli at quality 11 takes minutes on the 100 MB busytex bundle, so results
// are cached by path, size and modification time.
const cachePath = join(root, "vendor", ".brotli-cache.json");
const brotliCache: Record<string, number> = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};

function fileStat(url: string): FileStat {
  const path = join(root, decodeURIComponent(url));
  const { size, mtimeMs } = statSync(path);
  const key = `${url}:${size}:${mtimeMs}`;
  if (brotliCache[key] === undefined) {
    const body = readFileSync(path);
    brotliCache[key] = brotliCompressSync(body, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: body.length },
    }).length;
    writeFileSync(cachePath, JSON.stringify(brotliCache, null, 1));
  }
  return { url, bytes: size, brotliBytes: brotliCache[key]! };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : NaN;
};

async function launch(): Promise<Browser> {
  if (browserName === "firefox") return firefox.launch();
  if (browserName === "chromium") return chromium.launch();
  return chromium.launch({ channel: browserName });
}

async function trial(browser: Browser, base: string, engine: string): Promise<Trial> {
  const context = await browser.newContext();
  // Only record URLs here; sizes come from disk afterwards. Playwright can't
  // return bodies of large worker fetches, and compressing inside the handler
  // would block this process, which also runs the Vite server.
  const fetched = new Set<string>();
  context.on("response", (res) => {
    const url = new URL(res.url());
    if (url.pathname.startsWith("/vendor/") && res.status() === 200) fetched.add(url.pathname);
  });
  const page = await context.newPage();
  const t0 = Date.now();
  await page.goto(`${base}/spike/engines/bench.html?engine=${engine}&runs=${runs}${query ? `&${query}` : ""}`);
  await page.waitForFunction(() => window.__bench !== undefined, null, { timeout: 600_000 });
  const result = (await page.evaluate(() => window.__bench))!;
  const wallMs = Date.now() - t0;
  // Save the compiled output next to the results for visual comparison.
  const output = await page.evaluate(() => {
    const o = window.__output;
    if (o?.kind === "svg") return { ext: "svg", data: o.svg };
    if (o?.kind === "pdf") return { ext: "pdf", data: btoa(String.fromCharCode(...o.pdf)) };
    return null;
  });
  if (output) {
    const bytes = output.ext === "pdf" ? Buffer.from(output.data, "base64") : output.data;
    writeFileSync(join(outDir, `${engine}${suffix}.${output.ext}`), bytes);
  }
  await context.close();
  const files = [...fetched].map(fileStat);
  return { ...result, files: files.sort((a, b) => b.bytes - a.bytes), wallMs };
}

const server = await createServer({ root, logLevel: "warn", server: { port: 5199, strictPort: true } });
await server.listen();
const base = "http://localhost:5199";
const browser = await launch();
console.log(`browser: ${browserName} ${browser.version()}`);
mkdirSync(outDir, { recursive: true });

try {
  for (const engine of engines.length ? engines : ["tikzjax"]) {
    const results: Trial[] = [];
    for (let i = 0; i < trials; i++) {
      const r = await trial(browser, base, engine);
      results.push(r);
      const [cold, ...warm] = r.compileMs;
      console.log(
        `${engine} trial ${i + 1}: ${r.ok ? "ok" : `FAILED ${r.error ?? ""}`} load ${r.loadMs.toFixed(0)} ms, ` +
          `cold compile ${cold?.toFixed(0)} ms, warm median ${median(warm).toFixed(0)} ms`,
      );
    }
    const first = results[0]!;
    const totalBytes = first.files.reduce((s, f) => s + f.bytes, 0);
    const totalBrotli = first.files.reduce((s, f) => s + f.brotliBytes, 0);
    const summary = {
      engine,
      browser: `${browserName} ${browser.version()}`,
      date: new Date().toISOString(),
      ok: results.every((r) => r.ok),
      probe: first.probe,
      loadMsMedian: median(results.map((r) => r.loadMs)),
      coldCompileMsMedian: median(results.map((r) => r.compileMs[0] ?? NaN)),
      warmCompileMsMedian: median(results.flatMap((r) => r.compileMs.slice(1))),
      download: {
        files: first.files.length,
        bytes: totalBytes,
        brotliBytes: totalBrotli,
        largestFile: first.files[0] ?? null,
      },
      outputKind: first.outputKind,
      outputBytes: first.outputBytes,
      trials: results.map(({ log, ...r }) => ({ ...r, logTail: log.slice(-2000) })),
    };
    writeFileSync(join(outDir, `${engine}${suffix}.json`), JSON.stringify(summary, null, 2) + "\n");
    const mb = (n: number) => (n / 1048576).toFixed(2);
    console.log(
      `${engine}: ${summary.ok ? "OK" : "FAILED"} · pgf ${summary.probe?.pgf ?? "?"} · ` +
        `download ${summary.download.files} files, ${mb(totalBytes)} MB raw / ${mb(totalBrotli)} MB brotli ` +
        `(largest ${summary.download.largestFile?.url} ${mb(summary.download.largestFile?.bytes ?? 0)} MB) · ` +
        `load ${summary.loadMsMedian.toFixed(0)} ms · cold ${summary.coldCompileMsMedian.toFixed(0)} ms · ` +
        `warm ${summary.warmCompileMsMedian.toFixed(0)} ms`,
    );
  }
} finally {
  await browser.close();
  await server.close();
}
