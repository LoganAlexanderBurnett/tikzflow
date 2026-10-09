// Checks the PDF export (src/export/svg2pdf.ts, D72): every comparison
// diagram and every corpus picture is compiled with our engine, its SVG is
// converted to PDF, and pdf.js's drawing of the PDF is diffed against the
// browser's own drawing of the SVG (the reference). Results go to
// window.__pdfcheck for scripts/pdfcheck.ts.
// Usage: /spike/engines/pdfcheck.html[?only=09-matrix][&set=diagrams|corpus]

import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import { EngineClient } from "../../src/engine/client.ts";
import { buildCompileInput } from "../../src/engine/input.ts";
import { engineBase } from "../../src/engine/release.ts";
import { tidySvg } from "../../src/export/svg.ts";
import { svgToPdf } from "../../src/export/svg2pdf.ts";
import { analyzeDocument } from "../../src/model/document.ts";
import { composite, type DiffStats, diff, rasterSvg, SCALE, toCanvas, trim } from "./imagediff.ts";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface PdfCheckResult {
  name: string;
  ok: boolean;
  log?: string;
  stats?: DiffStats;
  warnings: string[];
  pdfBytes?: number;
  svgBytes?: number;
  ms?: number;
  composite?: string;
}

declare global {
  interface Window {
    __pdfcheck?: PdfCheckResult[];
  }
}

const diagrams = import.meta.glob("./diagrams/*.tex", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const corpus = import.meta.glob("../../corpus/*.tex", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

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

const status = document.getElementById("status")!;
const list = document.getElementById("list")!;
const params = new URLSearchParams(location.search);
const only = params.get("only");
const set = params.get("set") ?? "diagrams";

const client = new EngineClient(engineBase(params.get("engine")));
status.textContent = "Loading the engine…";
const index = await client.ready();
const files = new Set(index.texFiles);

const results: PdfCheckResult[] = [];
const sources = Object.entries(set === "corpus" ? corpus : diagrams).sort();
for (const [path, source] of sources) {
  const name = path.replace(/^.*\//, "").replace(/\.tex$/, "");
  if (only && !name.includes(only)) continue;
  status.textContent = `${name}…`;
  let tex: string;
  if (set === "corpus") {
    const input = buildCompileInput(analyzeDocument(source), 0, (f) => files.has(f));
    if (!input) continue;
    tex = input.tex;
  } else {
    const libs = /^% libraries:(.*)$/m.exec(source)?.[1] ?? "";
    const list2 = libs.split(",").map((s) => s.trim()).filter(Boolean);
    tex = `\\scrollmode\n\\usepackage{amsmath}\n${list2.length ? `\\usetikzlibrary{${list2.join(",")}}\n` : ""}\\begin{document}\n${source}\\end{document}\n`;
  }
  const outcome = await client.compile(tex);
  if (!outcome?.svg) {
    results.push({ name, ok: false, log: outcome ? outcome.log.slice(-800) : "replaced", warnings: [] });
    continue;
  }
  try {
    const t0 = performance.now();
    // What the export does: TeX's SVG tidied (nesting repaired), then converted.
    const svg = tidySvg(outcome.svg, 0).svg;
    const pdf = await svgToPdf(svg);
    const ms = Math.round((performance.now() - t0) * 10) / 10;
    const ref = trim(await rasterSvg(svg, false));
    const got = trim(await rasterPdf(pdf.pdf));
    const d = diff(ref, got);
    const comp = composite([
      ["SVG (reference)", toCanvas(ref)],
      ["PDF (pdf.js)", toCanvas(got)],
      ["diff", toCanvas(d.image)],
    ]);
    const fig = document.createElement("figure");
    fig.innerHTML = `<figcaption>${name}: ${d.stats.mismatchPct}% (${pdf.pdf.length} bytes PDF, ${svg.length} bytes SVG, ${ms} ms${pdf.warnings.length ? `; ${pdf.warnings.join("; ")}` : ""})</figcaption>`;
    fig.append(comp);
    list.append(fig);
    results.push({ name, ok: true, stats: d.stats, warnings: pdf.warnings, pdfBytes: pdf.pdf.length, svgBytes: svg.length, ms, composite: comp.toDataURL("image/png") });
  } catch (e) {
    results.push({ name, ok: false, log: e instanceof Error ? e.stack ?? e.message : String(e), warnings: [] });
  }
}
status.textContent = `Done: ${results.length} pictures.`;
window.__pdfcheck = results;
