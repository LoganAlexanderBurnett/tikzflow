// Native-preview fidelity check: compiles every corpus picture with pdfTeX
// (busytex), has TeX print the compass anchors of each named node, and
// compares them with the native layout's anchors. Results go to
// window.__fidelity for scripts/fidelity.ts.
// Usage: /spike/engines/fidelity.html[?only=<file name part>]

import { analyzeDocument, layoutDocumentPicture, librariesBefore } from "../../src/model/document.ts";
import { decode } from "../../src/source/encoding.ts";
import { anchorPoint } from "../../src/tikz/shapes.ts";
import { Busytex } from "./busytex.ts";
import type { Job } from "./engine.ts";

/** north, south, east, west anchors as [x, y] each: 8 numbers. */
type Anchors = [number, number, number, number, number, number, number, number];

export interface NodeDiff {
  name: string;
  /** Centre difference (midpoint of the compass anchors), in pt. */
  center: number;
  /** Width (west to east) and height (south to north) differences, in pt. */
  size: [number, number];
  tex: Anchors;
  native: Anchors;
}

export interface FidelityResult {
  file: string;
  picture: number;
  ok: boolean;
  error?: string;
  nodes: NodeDiff[];
  missing: string[];
}

declare global {
  interface Window {
    __fidelity?: FidelityResult[];
  }
}

// The corpus, plus targeted probes that pin down one TeX behaviour each.
const sources = {
  ...(import.meta.glob("../../corpus/*.tex", { query: "?url", import: "default", eager: true }) as Record<string, string>),
  ...(import.meta.glob("./probes/*.tex", { query: "?url", import: "default", eager: true }) as Record<string, string>),
};
const only = new URLSearchParams(location.search).get("only");
const SIMPLE = /^[A-Za-z0-9_\-:.]+$/;
const COMPASS = ["north", "south", "east", "west"] as const;

/** Libraries assumed for pictures pasted without their preamble. */
const BARE_LIBRARIES = ["positioning", "shapes.geometric", "shapes.misc", "arrows.meta", "calc", "fit", "backgrounds", "matrix", "chains"];

function jobFor(text: string, picIndex: number): { job: Job; names: string[] } {
  const doc = analyzeDocument(text);
  const pic = doc.syntax.pictures[picIndex]!;
  const layout = layoutDocumentPicture(doc, picIndex)!;
  const names = [...new Set(layout.nodes.filter((n) => n.name && SIMPLE.test(n.name)).map((n) => n.name!))];
  const probes = names
    .map(
      (n) =>
        COMPASS.map((a, i) => `\\path (${n}.${a});\\pgfgetlastxy{\\tfx${"abcd"[i]}}{\\tfy${"abcd"[i]}}`).join("") +
        `\\typeout{TFNODE{${n}}{\\tfxa}{\\tfya}{\\tfxb}{\\tfyb}{\\tfxc}{\\tfyc}{\\tfxd}{\\tfyd}}`,
    )
    .join("\n");
  const picText = text.slice(pic.from, pic.end.from) + probes + "\n" + text.slice(pic.end.from, pic.to);
  const before = text.slice(0, pic.from);
  const bare = !/\\documentclass/.test(before);
  // The preamble: definitions the picture uses, as written.
  let preamble = doc.syntax.preamble
    .filter((p) => p.range.to <= pic.from && p.kind !== "library")
    .map((p) => text.slice(p.range.from, p.range.to))
    .join("\n");
  // TikZiT output relies on layers declared in its preamble file.
  if (/pgfonlayer\}\{(node|edge)layer/.test(picText)) preamble += "\n\\pgfdeclarelayer{edgelayer}\\pgfdeclarelayer{nodelayer}\\pgfsetlayers{edgelayer,nodelayer,main}";
  const size = /\\documentclass\s*\[[^\]]*\b(1[012]pt)\b/.exec(before)?.[1];
  const libraries = [...new Set([...librariesBefore(doc, pic), ...(bare ? BARE_LIBRARIES : [])])];
  return {
    job: {
      body: picText + "\n",
      libraries,
      packages: { amssymb: "" },
      preamble: "\\nonstopmode\n" + preamble,
      classOptions: `tikz,border=0pt${size ? `,${size}` : ""}`,
    },
    names,
  };
}

function parseLog(log: string): Map<string, Anchors> {
  const flat = log.replace(/\r?\n/g, "");
  const out = new Map<string, Anchors>();
  const num = String.raw`\{(-?[\d.]+)pt\}`;
  for (const m of flat.matchAll(new RegExp(String.raw`TFNODE\{([^}]*)\}` + num.repeat(8), "g"))) {
    out.set(m[1]!, m.slice(2, 10).map(Number) as Anchors);
  }
  return out;
}

const mid = (a: Anchors) => [(a[4] + a[6]) / 2, (a[1] + a[3]) / 2];

async function run() {
  const engine = new Busytex();
  await engine.load();
  const results: FidelityResult[] = [];
  for (const [path, url] of Object.entries(sources)) {
    const file = path.split("/").pop()!;
    if (only && !file.includes(only)) continue;
    const { text } = decode(new Uint8Array(await (await fetch(url)).arrayBuffer()));
    const doc = analyzeDocument(text);
    for (let i = 0; i < doc.syntax.pictures.length; i++) {
      const built = jobFor(text, i);
      const res = await engine.compile(built.job);
      const tex = parseLog(res.log);
      const layout = layoutDocumentPicture(doc, i)!;
      const nodes: NodeDiff[] = [];
      const missing: string[] = [];
      for (const name of built.names) {
        const t = tex.get(name);
        const n = [...layout.nodes].reverse().find((x) => x.name === name)!;
        if (!t) {
          missing.push(name);
          continue;
        }
        const native = COMPASS.flatMap((a) => {
          const p = anchorPoint(n.shape, a) ?? n.shape.center;
          return [p.x, p.y];
        }) as Anchors;
        const tc = mid(t);
        const nc = mid(native);
        nodes.push({
          name,
          center: Math.hypot(tc[0]! - nc[0]!, tc[1]! - nc[1]!),
          size: [native[4] - native[6] - (t[4] - t[6]), native[1] - native[3] - (t[1] - t[3])],
          tex: t,
          native,
        });
      }
      const result: FidelityResult = { file, picture: i, ok: tex.size > 0, nodes, missing };
      if (!tex.size) result.error = res.log.split("\n").filter((l) => l.startsWith("!")).slice(0, 2).join(" | ") || "no output";
      results.push(result);
    }
  }
  window.__fidelity = results;
  document.body.textContent = `done: ${results.length} pictures`;
}

void run();
