// Native-preview fidelity check: compiles every corpus picture with pdfTeX
// (busytex), has TeX print the compass anchors of each named node, and
// compares them with the native layout's anchors. Results go to
// window.__fidelity for scripts/fidelity.ts.
// Usage: /spike/engines/fidelity.html[?only=<file name part>]

import { analyzeDocument, layoutDocumentPicture, librariesBefore } from "../../src/model/document.ts";
import { followsByDesign } from "../../src/edit/links.ts";
import { decode } from "../../src/source/encoding.ts";
import type { PictureLayout } from "../../src/tikz/layout.ts";
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
  /** The largest distance between TeX's and the native north east, north west, south east and south west (D98), in pt. */
  corners: number;
  /** TeX's and the native north east, north west, south east and south west, as [x, y] each. */
  texCorners?: Anchors | undefined;
  nativeCorners?: Anchors;
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
  /**
   * For a picture rewritten by a drag that moves one node alone, or by Detach (the golden files of
   * test/golden-links.test.ts, D107): how far TeX puts each other node from where it put it in the
   * source. Nodes on paths and group and lane boxes are left out, as in the editor's own check.
   */
  kept?: { source: string; moved: string[]; compared: number; worst: number; worstName: string | null };
}

/** One rewritten picture: test/fixtures/golden/links/cases.json. */
interface LinkCase {
  file: string;
  source: string;
  picture: number;
  /** The dragged node and its annotations (D107), which move; none for Detach. */
  moved: string[];
}

declare global {
  interface Window {
    __fidelity?: FidelityResult[];
  }
}

// The corpus, the templates (D95), plus targeted probes that pin down one TeX behaviour each.
const sources = {
  // The blank diagram draws nothing, so it has nothing to compare.
  ...Object.fromEntries(Object.entries(import.meta.glob("../../src/templates/*.tex", { query: "?url", import: "default", eager: true }) as Record<string, string>).filter(([k]) => !k.endsWith("/blank.tex"))),
  ...(import.meta.glob("../../corpus/*.tex", { query: "?url", import: "default", eager: true }) as Record<string, string>),
  ...(import.meta.glob("./probes/*.tex", { query: "?url", import: "default", eager: true }) as Record<string, string>),
};
// Pictures rewritten so that followers stay where they are (D105, D107), with the source each came from.
const linkCases = import.meta.glob("../../test/fixtures/golden/links/cases.json", { import: "default", eager: true }) as Record<string, LinkCase[]>;
const linkFiles = import.meta.glob("../../test/fixtures/golden/links/*.tex", { query: "?url", import: "default", eager: true }) as Record<string, string>;
const only = new URLSearchParams(location.search).get("only");
const SIMPLE = /^[A-Za-z0-9_\-:.]+$/;
const COMPASS = ["north", "south", "east", "west"] as const;
const CORNERS = ["north east", "north west", "south east", "south west"] as const;

/** Libraries assumed for pictures pasted without their preamble. */
const BARE_LIBRARIES = ["positioning", "shapes.geometric", "shapes.misc", "arrows.meta", "calc", "fit", "backgrounds", "matrix", "chains"];

/** Every node TeX can be asked about by name: statement nodes, the labels written inside paths, and named `label=` nodes. */
function namedNodes(layout: PictureLayout) {
  const all = [...layout.nodes, ...layout.pathNodes];
  return [...all, ...all.flatMap((n) => n.extras)].filter((n) => n.name && !n.implicitName && SIMPLE.test(n.name));
}

function jobFor(text: string, picIndex: number): { job: Job; names: string[] } {
  const doc = analyzeDocument(text);
  const pic = doc.syntax.pictures[picIndex]!;
  const layout = layoutDocumentPicture(doc, picIndex)!;
  const names = [...new Set(namedNodes(layout).map((n) => n.name!))];
  const probes = names
    .map(
      (n) =>
        COMPASS.map((a, i) => `\\path (${n}.${a});\\pgfgetlastxy{\\tfx${"abcd"[i]}}{\\tfy${"abcd"[i]}}`).join("") +
        `\\typeout{TFNODE{${n}}{\\tfxa}{\\tfya}{\\tfxb}{\\tfyb}{\\tfxc}{\\tfyc}{\\tfxd}{\\tfyd}}` +
        CORNERS.map((a, i) => `\\path (${n}.${a});\\pgfgetlastxy{\\tfx${"abcd"[i]}}{\\tfy${"abcd"[i]}}`).join("") +
        `\\typeout{TFCORNER{${n}}{\\tfxa}{\\tfya}{\\tfxb}{\\tfyb}{\\tfxc}{\\tfyc}{\\tfxd}{\\tfyd}}`,
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

function parseLog(log: string, tag = "TFNODE"): Map<string, Anchors> {
  const flat = log.replace(/\r?\n/g, "");
  const out = new Map<string, Anchors>();
  const num = String.raw`\{(-?[\d.]+)pt\}`;
  for (const m of flat.matchAll(new RegExp(tag + String.raw`\{([^}]*)\}` + num.repeat(8), "g"))) {
    out.set(m[1]!, m.slice(2, 10).map(Number) as Anchors);
  }
  return out;
}

const mid = (a: Anchors) => [(a[4] + a[6]) / 2, (a[1] + a[3]) / 2];

/**
 * busytex, started again when a compile comes back with no TeX error and no output: after one
 * fatal error its worker can be left unable to compile anything (seen in the links section).
 */
class Tex {
  #engine: Busytex | null = null;
  async #start(): Promise<Busytex> {
    this.#engine?.dispose();
    this.#engine = new Busytex();
    await this.#engine.load();
    return this.#engine;
  }
  async compile(job: Job) {
    const res = await (this.#engine ?? (await this.#start())).compile(job);
    if (res.ok || /^!/m.test(res.log)) return res;
    return (await this.#start()).compile(job);
  }
}

/** Compiles picture `i` of `text` and compares TeX's anchors with the native layout's. Also returns TeX's anchors by name. */
async function comparePicture(engine: Tex, file: string, text: string, i: number): Promise<{ result: FidelityResult; tex: Map<string, Anchors> }> {
  const doc = analyzeDocument(text);
  const built = jobFor(text, i);
  const res = await engine.compile(built.job);
  const tex = parseLog(res.log);
  const texCorners = parseLog(res.log, "TFCORNER");
  const layout = layoutDocumentPicture(doc, i)!;
  const nodes: NodeDiff[] = [];
  const missing: string[] = [];
  for (const name of built.names) {
    const t = tex.get(name);
    const n = namedNodes(layout).reverse().find((x) => x.name === name)!;
    if (!t) {
      missing.push(name);
      continue;
    }
    const native = COMPASS.flatMap((a) => {
      const p = anchorPoint(n.shape, a) ?? n.shape.center;
      return [p.x, p.y];
    }) as Anchors;
    const tk = texCorners.get(name);
    const nk = CORNERS.flatMap((a) => {
      const p = anchorPoint(n.shape, a) ?? n.shape.center;
      return [p.x, p.y];
    });
    const corners = tk ? Math.max(...[0, 1, 2, 3].map((i) => Math.hypot(tk[2 * i]! - nk[2 * i]!, tk[2 * i + 1]! - nk[2 * i + 1]!))) : 0;
    const tc = mid(t);
    const nc = mid(native);
    nodes.push({
      name,
      center: Math.hypot(tc[0]! - nc[0]!, tc[1]! - nc[1]!),
      size: [native[4] - native[6] - (t[4] - t[6]), native[1] - native[3] - (t[1] - t[3])],
      corners,
      texCorners: tk,
      nativeCorners: nk as Anchors,
      tex: t,
      native,
    });
  }
  const result: FidelityResult = { file, picture: i, ok: tex.size > 0, nodes, missing };
  if (!tex.size) result.error = res.log.split("\n").filter((l) => l.startsWith("!")).slice(0, 2).join(" | ") || "no output";
  return { result, tex };
}

const fetchText = async (url: string) => decode(new Uint8Array(await (await fetch(url)).arrayBuffer())).text;

async function run() {
  const engine = new Tex();
  const results: FidelityResult[] = [];
  /** TeX's anchors per source picture ("corpus/x.tex#0"), for the rewritten pictures below. */
  const sourceTex = new Map<string, Map<string, Anchors>>();
  for (const [path, url] of Object.entries(sources)) {
    const file = path.split("/").pop()!;
    if (only && !file.includes(only)) continue;
    const text = await fetchText(url);
    const doc = analyzeDocument(text);
    for (let i = 0; i < doc.syntax.pictures.length; i++) {
      const { result, tex } = await comparePicture(engine, file, text, i);
      results.push(result);
      sourceTex.set(`${path.replace(/^(\.\.\/)+|^\.\//, "")}#${i}`, tex);
    }
  }
  // Pictures rewritten so a dragged node's followers stay where they are, and detached nodes (D107):
  // compared with the native layout like any picture, and with TeX's own positions before the edit.
  const cases = Object.values(linkCases)[0] ?? [];
  const sourceUrl = new Map(Object.entries(sources).map(([p, u]) => [p.replace(/^(\.\.\/)+/, "").replace(/^\.\/probes\//, "spike/engines/probes/"), u]));
  for (const c of cases) {
    const file = `links/${c.file}`;
    if (only && !file.includes(only) && !c.source.includes(only)) continue;
    const url = linkFiles[`../../test/fixtures/golden/links/${c.file}`];
    const srcUrl = sourceUrl.get(c.source);
    if (!url || !srcUrl) continue;
    const key = `${c.source}#${c.picture}`;
    const srcText = await fetchText(srcUrl);
    if (!sourceTex.has(key)) sourceTex.set(key, (await comparePicture(engine, c.source.split("/").pop()!, srcText, c.picture)).tex);
    const before = sourceTex.get(key)!;
    const { result, tex } = await comparePicture(engine, file, await fetchText(url), c.picture);
    // What the editor's check leaves out: nodes on paths, group and lane boxes, the coordinates lanes share.
    const srcLayout = layoutDocumentPicture(analyzeDocument(srcText), c.picture)!;
    const skip = new Set<string>([...followsByDesign(srcText, srcLayout)].flatMap((id) => srcLayout.nodes.find((n) => n.id === id)?.name ?? []));
    for (const n of [...srcLayout.pathNodes, ...srcLayout.nodes.filter((x) => x.kind === "path" || x.lock?.kind === "path")]) if (n.name) skip.add(n.name);
    for (const n of srcLayout.nodes) for (const x of n.extras) if (x.name) skip.add(x.name);
    for (const m of c.moved) skip.add(m);
    let worst = 0;
    let worstName: string | null = null;
    let compared = 0;
    for (const [name, a] of before) {
      const b = tex.get(name);
      if (!b || skip.has(name)) continue;
      compared++;
      const [ax, ay] = mid(a);
      const [bx, by] = mid(b);
      const d = Math.hypot(ax! - bx!, ay! - by!);
      if (d > worst) {
        worst = d;
        worstName = name;
      }
    }
    result.kept = { source: c.source, moved: c.moved, compared, worst, worstName };
    results.push(result);
  }
  window.__fidelity = results;
  document.body.textContent = `done: ${results.length} pictures`;
}

void run();
