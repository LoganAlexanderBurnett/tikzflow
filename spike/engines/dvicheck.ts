// Checks our DVI to SVG converter (src/engine/dvisvg.ts, D66) against the
// real dvisvgm, on the DVI files CI's engine wrote for the comparison
// diagrams (engine/build/references.ts). Both SVGs are rasterised and diffed,
// dvisvgm's as the reference. Results go to window.__dvicheck for
// scripts/dvicheck.ts.
// Usage: /spike/engines/dvicheck.html?run=<folder under vendor/engine-ci>[&only=09-matrix]

import { dviToSvg, dviFonts } from "../../src/engine/dvisvg.ts";
import type { FontData } from "../../src/engine/fontdata.ts";
import { composite, type DiffStats, diff, rasterSvg, toCanvas, trim } from "./imagediff.ts";

export interface DviCheckResult {
  name: string;
  stats: DiffStats | null;
  glyphs: number;
  missingFonts: string[];
  ms: number;
  composite?: string;
}

declare global {
  interface Window {
    __dvicheck?: DviCheckResult[];
  }
}

const params = new URLSearchParams(location.search);
const run = params.get("run") ?? "run3";
const only = params.get("only");
const root = `/vendor/engine-ci/${run}`;
const status = document.getElementById("status")!;
const list = document.getElementById("list")!;

async function bytes(url: string): Promise<Uint8Array | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const raw = new Uint8Array(await res.arrayBuffer());
  if (raw[0] !== 0x1f || raw[1] !== 0x8b) return raw;
  return new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
}

const fonts = new Map<string, FontData | undefined>();
async function loadFonts(dvi: Uint8Array) {
  for (const f of dviFonts(dvi)) {
    if (fonts.has(f.name)) continue;
    const b = await bytes(`${root}/fonts/${f.name}.json.gz`);
    fonts.set(f.name, b ? (JSON.parse(new TextDecoder().decode(b)) as FontData) : undefined);
  }
}

/** dvisvgm draws glyphs from <path> definitions too; they inherit a stroke unless told not to (ours set none). */
const unstroked = (svg: string) => svg.replace(/<path id=(['"])g/g, "<path stroke='none' id=$1g");

const names = ["01-fills", "02-line-styles", "03-opacity", "04-arrow-tips", "05-fit-backgrounds", "06-clipping", "07-rounded-corners", "08-node-shapes", "09-matrix", "10-flowchart", "11-text-and-math", "12-transforms", "13-curves-and-nesting"];
const results: DviCheckResult[] = [];
for (const name of names) {
  if (only && !name.includes(only)) continue;
  status.textContent = `${name}…`;
  const dvi = await bytes(`${root}/reference/${name}.dvi`);
  const ref = await (await fetch(`${root}/reference/${name}.dvisvgm.svg`)).text();
  if (!dvi) continue;
  await loadFonts(dvi);
  const t0 = performance.now();
  const ours = dviToSvg(dvi, (n) => fonts.get(n));
  const ms = Math.round((performance.now() - t0) * 10) / 10;
  const refT = trim(await rasterSvg(unstroked(ref), false));
  const oursT = trim(await rasterSvg(ours.svg, false));
  const d = diff(refT, oursT);
  const comp = composite([
    ["dvisvgm (reference)", toCanvas(refT)],
    ["ours", toCanvas(oursT)],
    ["diff", toCanvas(d.image)],
  ]);
  const fig = document.createElement("figure");
  fig.innerHTML = `<figcaption>${name}: ${d.stats.mismatchPct}% (${ours.glyphs} glyphs, ${ms} ms)</figcaption>`;
  fig.append(comp);
  list.append(fig);
  results.push({ name, stats: d.stats, glyphs: ours.glyphs, missingFonts: ours.missingFonts, ms, composite: comp.toDataURL("image/png") });
}
status.textContent = `Done: ${results.length} diagrams.`;
window.__dvicheck = results;
