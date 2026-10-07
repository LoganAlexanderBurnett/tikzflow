// Loads one engine, compiles the sample `runs` times, and publishes timings on
// window.__bench for the Playwright runner (scripts/bench-engines.ts).
// Usage: /spike/engines/bench.html?engine=tikzjax&runs=5

import type { CompileResult, Engine } from "./engine.ts";

export interface BenchResult {
  engine: string;
  ok: boolean;
  /** load(): fetch + decompress + instantiate, before any compile. */
  loadMs: number;
  /** Each compile in order; the first one is the cold compile. */
  compileMs: number[];
  outputKind: string;
  outputBytes: number;
  probe: CompileResult["probe"];
  error?: string;
  log: string;
}

declare global {
  interface Window {
    __bench?: BenchResult;
  }
}

const ENGINES: Record<string, () => Promise<Engine>> = {
  tikzjax: async () => new (await import("./tikzjax.ts")).TikzJax(),
};

const params = new URLSearchParams(location.search);
const name = params.get("engine");
const runs = Number(params.get("runs") ?? 5);
const status = document.getElementById("status")!;
const output = document.getElementById("output")!;
const logEl = document.getElementById("log")!;

async function run(engine: Engine): Promise<BenchResult> {
  const result: BenchResult = {
    engine: engine.name, ok: false, loadMs: 0, compileMs: [], outputKind: "none",
    outputBytes: 0, probe: null, log: "",
  };
  let t = performance.now();
  await engine.load();
  result.loadMs = performance.now() - t;
  status.textContent = `${engine.name}: loaded in ${result.loadMs.toFixed(0)} ms, compiling…`;

  let last: CompileResult | null = null;
  for (let i = 0; i < runs; i++) {
    t = performance.now();
    last = await engine.compile();
    result.compileMs.push(performance.now() - t);
    if (!last.ok) break;
  }
  result.ok = last?.ok ?? false;
  result.probe = last?.probe ?? null;
  result.log = last?.log ?? "";
  if (last?.output.kind === "svg") {
    result.outputKind = "svg";
    result.outputBytes = last.output.svg.length;
    output.innerHTML = last.output.svg;
  } else if (last?.output.kind === "pdf") {
    result.outputKind = "pdf";
    result.outputBytes = last.output.pdf.length;
    const url = URL.createObjectURL(new Blob([last.output.pdf as BlobPart], { type: "application/pdf" }));
    output.innerHTML = `<iframe src="${url}" width="600" height="500"></iframe>`;
  }
  return result;
}

if (name && ENGINES[name]) {
  status.textContent = `${name}: loading…`;
  try {
    const result = await run(await ENGINES[name]());
    const [cold, ...warm] = result.compileMs;
    const warmAvg = warm.length ? warm.reduce((a, b) => a + b, 0) / warm.length : NaN;
    status.innerHTML =
      `<span class="${result.ok ? "ok" : "bad"}">${result.ok ? "Compiled" : "FAILED"}</span> · ` +
      `load ${result.loadMs.toFixed(0)} ms · first compile ${cold?.toFixed(0)} ms · ` +
      `warm avg ${warmAvg.toFixed(0)} ms over ${warm.length} · ${result.outputKind} ${result.outputBytes} bytes\n` +
      `probe: ${JSON.stringify(result.probe)}`;
    logEl.textContent = result.log;
    window.__bench = result;
  } catch (e) {
    status.innerHTML = `<span class="bad">Error:</span> ${String(e)}`;
    window.__bench = {
      engine: name, ok: false, loadMs: 0, compileMs: [], outputKind: "none", outputBytes: 0,
      probe: null, error: String(e), log: "",
    };
  }
}
