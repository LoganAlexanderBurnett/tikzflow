// SPDX-License-Identifier: GPL-3.0-or-later
// The engine worker (D67): TeX compiled to WebAssembly (tex.wasm), started
// from the saved format (core.dump), reading TeX files and fonts from the
// engine's folder on demand, and the DVI it writes turned into SVG.
// Everything it fetches is cached for the session; the service worker
// (step 9) keeps it across sessions.

/// <reference lib="webworker" />

import { dviFonts, dviToSvg } from "./dvisvg.ts";
import type { FontData } from "./fontdata.ts";
import { parseTexLog, texAborted } from "./log.ts";
import type { CompileOutcome, EngineIndex, FromWorker, ToWorker } from "./protocol.ts";
import { PAGES, runTex } from "./texlib.ts";

declare const self: DedicatedWorkerGlobalScope;

let base = "";
let index: EngineIndex | null = null;
let texFiles = new Set<string>();
let fontNames = new Set<string>();
let engine: Promise<{ module: WebAssembly.Module; dump: Uint8Array; memory: WebAssembly.Memory }> | null = null;
const files = new Map<string, Promise<Uint8Array | null>>();
const fonts = new Map<string, Promise<FontData | null>>();

const post = (m: FromWorker) => self.postMessage(m);

/** Fetches a file, inflating it if it is gzipped (a server may have inflated it already). */
async function fetchBytes(path: string, gzipped: boolean): Promise<Uint8Array<ArrayBuffer> | null> {
  const res = await fetch(`${base}${path}`);
  if (!res.ok) return null;
  const raw = new Uint8Array(await res.arrayBuffer());
  if (!gzipped || raw[0] !== 0x1f || raw[1] !== 0x8b) return raw;
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function loadEngine() {
  engine ??= (async () => {
    const [wasm, dump] = await Promise.all([fetchBytes("tex.wasm.gz", true), fetchBytes("core.dump.gz", true)]);
    if (!wasm || !dump) throw new Error("The engine's files (tex.wasm, core.dump) couldn't be loaded.");
    if (dump.length !== PAGES * 65536) throw new Error(`core.dump is ${dump.length} bytes, expected ${PAGES * 65536}.`);
    const module = await WebAssembly.compile(wasm);
    return { module, dump, memory: new WebAssembly.Memory({ initial: PAGES, maximum: PAGES }) };
  })();
  engine.catch(() => {
    engine = null;
  });
  return engine;
}

/** A TeX file by name: from the engine's folder if it has it, else missing (no request). */
function texFile(name: string): Uint8Array | null | Promise<Uint8Array | null> {
  if (!texFiles.has(name)) return null;
  let p = files.get(name);
  if (!p) {
    p = fetchBytes(`tex_files/${name}.gz`, true);
    files.set(name, p);
  }
  return p;
}

function font(name: string): Promise<FontData | null> {
  let p = fonts.get(name);
  if (!p) {
    p = fontNames.has(name)
      ? fetchBytes(`fonts/${name}.json.gz`, true).then((b) => (b ? (JSON.parse(new TextDecoder().decode(b)) as FontData) : null))
      : Promise.resolve(null);
    fonts.set(name, p);
  }
  return p;
}

async function compile(tex: string): Promise<CompileOutcome> {
  const started = performance.now();
  const { module, dump, memory } = await loadEngine();
  new Uint8Array(memory.buffer).set(dump);
  const run = await runTex(module, memory, {
    terminal: "input.tex\n\\end\n",
    files: new Map([["input.tex", new TextEncoder().encode(tex)]]),
    lookup: texFile,
  });
  const texDone = performance.now();
  const log = new TextDecoder("latin1").decode(run.written.get("input.log") ?? new Uint8Array());
  const dvi = run.written.get("input.dvi");
  let svg: ReturnType<typeof dviToSvg> | null = null;
  if (dvi && dvi.length) {
    const needed = dviFonts(dvi).map((f) => f.name);
    const loaded = new Map(await Promise.all(needed.map(async (n) => [n, await font(n)] as const)));
    svg = dviToSvg(dvi, (n) => loaded.get(n) ?? undefined, { idPrefix: "tfc" });
  }
  const done = performance.now();
  return {
    ok: !!svg,
    svg: svg?.svg ?? null,
    viewBox: svg?.viewBox ?? null,
    picture: svg?.picture ?? null,
    log,
    errors: parseTexLog(log),
    aborted: texAborted(log),
    missingFiles: run.missing,
    missingFonts: svg?.missingFonts ?? [],
    timing: { texMs: texDone - started, svgMs: done - texDone, totalMs: done - started },
  };
}

self.onmessage = async ({ data }: MessageEvent<ToWorker>) => {
  if (data.type === "init") {
    base = data.base.endsWith("/") ? data.base : `${data.base}/`;
    try {
      const bytes = await fetchBytes("index.json", false);
      if (!bytes) throw new Error("The engine isn't installed here (no index.json).");
      index = JSON.parse(new TextDecoder().decode(bytes)) as EngineIndex;
      texFiles = new Set(index.texFiles);
      fontNames = new Set(index.fonts);
      post({ type: "ready", index });
      void loadEngine().catch(() => {});
    } catch (e) {
      post({ type: "failed", id: null, message: e instanceof Error ? e.message : String(e) });
    }
    return;
  }
  // One compile at a time: they share TeX's memory.
  const { id, tex } = data;
  queue = queue.then(async () => {
    try {
      post({ type: "result", id, outcome: await compile(tex) });
    } catch (e) {
      post({ type: "failed", id, message: e instanceof Error ? e.message : String(e) });
    }
  });
};

let queue: Promise<void> = Promise.resolve();
