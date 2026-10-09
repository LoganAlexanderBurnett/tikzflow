// Renders every diagram in ./diagrams with busytex (reference, PDF via pdf.js),
// TikZJax (SVG, raw and with fixBoxStroke) and our own engine (M3, D66, D67:
// tex.wasm with our format and driver, our DVI to SVG), rasterises them at
// the same scale, and diffs each against the reference. Results are published
// on window.__compare for scripts/compare-engines.ts.
// Usage: /spike/engines/compare.html[?only=09-matrix][&engines=ours,tikzjax][&engine=<folder under /engine/>]

import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import { EngineClient } from "../../src/engine/client.ts";
import { engineBase } from "../../src/engine/release.ts";
import { Busytex } from "./busytex.ts";
import type { Job } from "./engine.ts";
import { composite, type DiffStats, diff, rasterSvg, SCALE, toCanvas, trim } from "./imagediff.ts";
import { fixBoxStroke, TikzJax } from "./tikzjax.ts";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type { DiffStats };

export interface DiagramResult {
  name: string;
  busytexOk: boolean;
  tikzjaxOk?: boolean;
  oursOk?: boolean;
  busytexLog?: string;
  tikzjaxLog?: string;
  oursLog?: string;
  raw?: DiffStats;
  fixed?: DiffStats;
  ours?: DiffStats;
  oursMs?: number;
  /** PNG data URL: reference | each engine | its diff. */
  composite?: string;
}

declare global {
  interface Window {
    __compare?: DiagramResult[];
  }
}

const sources = import.meta.glob("./diagrams/*.tex", { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;

function jobFor(source: string): Job {
  const libs = /^% libraries:(.*)$/m.exec(source)?.[1] ?? "";
  return {
    body: source,
    libraries: libs.split(",").map((s) => s.trim()).filter(Boolean),
    classOptions: "tikz,border=0pt",
  };
}

/** Our engine's input.tex for a job: what follows the format's preamble. */
function oursInput(job: Job): string {
  return [
    "\\scrollmode\n\\usepackage{amsmath}\n",
    job.libraries.length ? `\\usetikzlibrary{${job.libraries.join(",")}}\n` : "",
    "\\begin{document}\n",
    job.body,
    "\\end{document}\n",
  ].join("");
}

// ------------------------------------------------------------- rasterising

async function rasterPdf(pdf: Uint8Array): Promise<HTMLCanvasElement> {
  const doc = await pdfjs.getDocument({ data: pdf.slice() }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: SCALE });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, viewport, background: "#fff" }).promise;
  return canvas;
}

// ------------------------------------------------------------- run

const status = document.getElementById("status")!;
const list = document.getElementById("list")!;
const params = new URLSearchParams(location.search);
const only = params.get("only");
const engines = new Set((params.get("engines") ?? "ours,tikzjax").split(","));

const busytex = new Busytex();
const tikzjax = engines.has("tikzjax") ? new TikzJax() : null;
const ours = engines.has("ours") ? new EngineClient(engineBase(params.get("engine"))) : null;
status.textContent = "Loading engines…";
await Promise.all([busytex.load(), tikzjax?.load(), ours?.ready()]);

const results: DiagramResult[] = [];
for (const [path, source] of Object.entries(sources).sort()) {
  const name = path.replace(/^.*\//, "").replace(/\.tex$/, "");
  if (only && !name.includes(only)) continue;
  status.textContent = `Compiling ${name}…`;
  const job = jobFor(source);
  const b = await busytex.compile(job);
  const result: DiagramResult = { name, busytexOk: b.ok };
  if (!b.ok) result.busytexLog = b.log.slice(-1500);
  const panels: Array<[string, HTMLCanvasElement]> = [];
  const captions: string[] = [];
  const ref = b.ok && b.output.kind === "pdf" ? trim(await rasterPdf(b.output.pdf)) : null;
  if (ref) panels.push(["busytex (reference)", toCanvas(ref)]);

  if (ours) {
    const started = performance.now();
    const o = await ours.compile(oursInput(job));
    result.oursMs = Math.round(performance.now() - started);
    result.oursOk = !!o?.ok && !o.errors.length;
    if (!result.oursOk) result.oursLog = o ? `${o.errors.map((e) => `! ${e.message} l.${e.line}`).join("\n")}\n${o.log.slice(-1500)}` : "replaced";
    if (ref && o?.svg) {
      const t = trim(await rasterSvg(o.svg, false));
      const d = diff(ref, t);
      result.ours = d.stats;
      panels.push(["ours", toCanvas(t)], ["diff: ours", toCanvas(d.image)]);
      captions.push(`ours ${d.stats.mismatchPct}% (${result.oursMs} ms)`);
    }
  }
  if (tikzjax) {
    const t = await tikzjax.compile(job);
    result.tikzjaxOk = t.ok;
    if (!t.ok) result.tikzjaxLog = t.log.slice(-1500);
    if (ref && t.ok && t.output.kind === "svg") {
      const rawT = trim(await rasterSvg(t.output.svg));
      const fixT = trim(await rasterSvg(fixBoxStroke(t.output.svg)));
      const rawD = diff(ref, rawT);
      const fixD = diff(ref, fixT);
      result.raw = rawD.stats;
      result.fixed = fixD.stats;
      panels.push(["TikZJax (stroke fix)", toCanvas(fixT)], ["diff: TikZJax fixed", toCanvas(fixD.image)]);
      captions.push(`TikZJax raw ${rawD.stats.mismatchPct}% · fixed ${fixD.stats.mismatchPct}%`);
    }
  }
  const fig = document.createElement("figure");
  fig.innerHTML = `<figcaption>${name}: ${ref ? captions.join(" · ") : "busytex FAILED"}</figcaption>`;
  if (panels.length > 1) {
    const comp = composite(panels);
    result.composite = comp.toDataURL("image/png");
    fig.append(comp);
  }
  list.append(fig);
  results.push(result);
}
status.textContent = `Done: ${results.length} diagrams.`;
window.__compare = results;
