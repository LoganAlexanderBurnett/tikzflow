import { describe, expect, it } from "vitest";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import { summarize } from "../src/model/summary.ts";
import { layoutLabel } from "../src/text/label.ts";
import { ColorTable } from "../src/tikz/colors.ts";
import type { LaidOutNode, PictureLayout } from "../src/tikz/layout.ts";
import { anchorPoint } from "../src/tikz/shapes.ts";
import { NORMAL_FONT } from "../src/tikz/state.ts";
import { CM, evalLength, evalQuantity } from "../src/tikz/units.ts";
import { corpusNames, loadCorpusFile } from "./corpus.ts";

function layout(src: string, index = 0): PictureLayout {
  const doc = analyzeDocument(src);
  const l = layoutDocumentPicture(doc, index);
  if (!l) throw new Error("no picture");
  return l;
}

function node(l: PictureLayout, id: string): LaidOutNode {
  const n = l.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`no node ${id}: ${l.nodes.map((x) => x.id).join(", ")}`);
  return n;
}

const anchor = (n: LaidOutNode, a: string) => anchorPoint(n.shape, a)!;
const pic = (body: string, opts = "") => `\\begin{tikzpicture}${opts}\n${body}\n\\end{tikzpicture}`;

describe("units", () => {
  it("converts TeX units to pt", () => {
    expect(evalLength("1cm")).toBeCloseTo(28.45274, 4);
    expect(evalLength("10mm")).toBeCloseTo(28.45274, 4);
    expect(evalLength("1in")).toBeCloseTo(72.27, 4);
    expect(evalLength("1em")).toBeCloseTo(10, 4);
    expect(evalLength("-0.5cm")).toBeCloseTo(-14.22637, 4);
    expect(evalLength("2*3mm")).toBeCloseTo(6 * 2.845274, 4);
    expect(evalLength("1cm+2pt")).toBeCloseTo(30.45274, 4);
    expect(evalLength("-\\pgflinewidth\\space")).toBeCloseTo(-0.4, 4);
  });
  it("tells plain numbers from dimensions", () => {
    expect(evalQuantity("1.5")).toEqual({ value: 1.5, dimensioned: false });
    expect(evalQuantity("1.5cm")!.dimensioned).toBe(true);
    expect(evalQuantity("\\foo")).toBeNull();
  });
});

describe("colors", () => {
  const colors = new ColorTable();
  it("mixes like xcolor", () => {
    expect(colors.parse("blue!20")).toEqual([0.8, 0.8, 1]);
    expect(colors.parse("red!50!black")).toEqual([0.5, 0, 0]);
    expect(colors.parse("-red")).toEqual([0, 1, 1]);
    expect(colors.parse("red!30!blue!40!white")!.map((v) => Math.round(v * 100) / 100)).toEqual([0.72, 0.6, 0.88]);
  });
  it("reads \\definecolor models", () => {
    colors.define("brand", "HTML", "1F77B4");
    expect(colors.parse("brand")!.map((v) => Math.round(v * 255))).toEqual([31, 119, 180]);
    colors.define("x", "RGB", "0,157,209");
    expect(colors.parse("x!50")!.map((v) => Math.round(v * 255))).toEqual([128, 206, 232]);
  });
  it("rejects unknown names", () => {
    expect(colors.parse("nosuchcolor")).toBeNull();
  });
});

describe("labels", () => {
  const env = { macros: new Map(), color: () => null };
  it("measures text with Computer Modern metrics", () => {
    const l = layoutLabel("A", { font: NORMAL_FONT }, env);
    expect(l.width).toBeCloseTo(7.5, 2);
    expect(l.height).toBeCloseTo(6.83, 2);
    expect(l.depth).toBe(0);
  });
  it("breaks lines at \\\\ and centres them when asked", () => {
    const l = layoutLabel("Long line\\\\x", { font: NORMAL_FONT, align: "center" }, env);
    expect(l.lines).toHaveLength(2);
    expect(l.lines[1]!.x).toBeGreaterThan(0);
    expect(l.lines[1]!.baseline - l.lines[0]!.baseline).toBeCloseTo(12, 5);
  });
  it("wraps at the text width", () => {
    const l = layoutLabel("one two three four five six", { font: NORMAL_FONT, textWidth: 40 }, env);
    expect(l.width).toBe(40);
    expect(l.lines.length).toBeGreaterThan(2);
    for (const line of l.lines) expect(line.width).toBeLessThanOrEqual(40.01);
  });
  it("measures inline math", () => {
    const l = layoutLabel("$x^2$", { font: NORMAL_FONT }, env);
    expect(l.lines[0]!.runs[0]!.kind).toBe("math");
    expect(l.width).toBeGreaterThan(8);
    expect(l.width).toBeLessThan(12);
  });
  it("expands user macros and reports unknown ones", () => {
    const macros = new Map([["\\step", { params: 1, body: "Step #1" }]]);
    const l = layoutLabel("\\step{2} \\foo", { font: NORMAL_FONT }, { macros, color: () => null });
    expect(l.lines[0]!.runs.map((r) => (r.kind === "math" ? "" : r.text)).join("")).toContain("Step 2");
    expect(l.issues).toEqual(["\\foo"]);
  });
});

describe("node geometry", () => {
  it("sizes a rectangle from its text plus inner sep", () => {
    const n = node(layout(pic("\\node[draw] (a) {A};")), "a");
    expect(2 * n.shape.hw).toBeCloseTo(7.5 + 2 * 3.33333, 2);
    expect(2 * n.shape.hh).toBeCloseTo(6.83 + 2 * 3.33333, 2);
  });
  it("applies minimum sizes", () => {
    const n = node(layout(pic("\\node[draw, minimum width=2cm, minimum height=1cm] (a) {x};")), "a");
    expect(2 * n.shape.hw).toBeCloseTo(2 * CM, 3);
    expect(2 * n.shape.hh).toBeCloseTo(CM, 3);
  });
  it("puts a node's anchor on its at point", () => {
    const n = node(layout(pic("\\node[anchor=north west] (a) at (1,2) {A};")), "a");
    const nw = anchor(n, "north west");
    expect(nw.x).toBeCloseTo(CM, 3);
    expect(nw.y).toBeCloseTo(2 * CM, 3);
  });
  it("transforms coordinates by scope shifts", () => {
    const l = layout(pic("\\begin{scope}[xshift=4cm]\\node (a) at (0,0) {A};\\end{scope}\\node (b) at (0,0) {B};"));
    expect(node(l, "a").shape.center.x).toBeCloseTo(4 * CM, 3);
    expect(node(l, "b").shape.center.x).toBeCloseTo(0, 3);
  });
  it("scales coordinates but not node sizes", () => {
    const l = layout(pic("\\node[draw] (a) at (1,0) {A};", "[scale=2]"));
    expect(node(l, "a").shape.center.x).toBeCloseTo(2 * CM, 3);
    expect(2 * node(l, "a").shape.hw).toBeCloseTo(7.5 + 6.6667, 2);
  });
});

describe("positioning", () => {
  it("below=of measures node distance between the borders", () => {
    const l = layout(pic("\\node[draw] (a) {A};\n\\node[draw, below=of a] (b) {Bg};"));
    expect(anchor(node(l, "a"), "south").y - anchor(node(l, "b"), "north").y).toBeCloseTo(CM, 3);
    expect(node(l, "b").shape.center.x).toBeCloseTo(0, 3);
  });
  it("below=5mm of uses the given distance", () => {
    const l = layout(pic("\\node (a) {A};\n\\node[below=5mm of a] (b) {B};"));
    expect(anchor(node(l, "a"), "south").y - anchor(node(l, "b"), "north").y).toBeCloseTo(5 * 2.845274, 3);
  });
  it("on grid measures between centres", () => {
    const l = layout(pic("\\node (a) {A};\n\\node[below=of a] (b) {B};", "[on grid, node distance=2cm]"));
    expect(node(l, "a").shape.center.y - node(l, "b").shape.center.y).toBeCloseTo(2 * CM, 3);
  });
  it("node distance with two values sets vertical and horizontal distances", () => {
    const l = layout(pic("\\node (a) {A};\n\\node[right=of a] (b) {B};\n\\node[below=of a] (c) {C};", "[node distance=1cm and 2cm]"));
    expect(anchor(node(l, "b"), "west").x - anchor(node(l, "a"), "east").x).toBeCloseTo(2 * CM, 3);
    expect(anchor(node(l, "a"), "south").y - anchor(node(l, "c"), "north").y).toBeCloseTo(CM, 3);
  });
  it("diagonal placement uses the corner anchors", () => {
    const l = layout(pic("\\node[draw] (a) {A};\n\\node[draw, below left=of a] (b) {B};"));
    const sw = anchor(node(l, "a"), "south west");
    const ne = anchor(node(l, "b"), "north east");
    expect(sw.x - ne.x).toBeCloseTo(CM, 3);
    expect(sw.y - ne.y).toBeCloseTo(CM, 3);
  });
  it("a later anchor= overrides the anchor a positioning key sets", () => {
    const l = layout(pic("\\node (a) {A};\n\\node[below=1cm of a.south west, anchor=north west] (b) {B};"));
    const a = anchor(node(l, "a"), "south west");
    const b = anchor(node(l, "b"), "north west");
    expect(b.x).toBeCloseTo(a.x, 3);
    expect(a.y - b.y).toBeCloseTo(CM, 3);
  });
  it("on grid and node distance only count if they come before the positioning key", () => {
    // Checked against pdfTeX: a later "on grid" or "node distance" doesn't change below=of.
    const l = layout(
      pic(
        [
          "\\node (a) at (0,0) {A};\\node[below=of a, on grid] (b) {B};",
          "\\node (a2) at (3,0) {A};\\node[on grid, below=of a2] (c) {C};",
          "\\node (a3) at (6,0) {A};\\node[below=of a3, node distance=25mm] (d) {D};",
          "\\node (a4) at (9,0) {A};\\node[node distance=25mm, below=of a4] (e) {E};",
          "\\node (a5) at (12,0) {A};\\node[below of=a5, node distance=25mm] (f) {F};",
        ].join("\n"),
        "[every node/.style={draw, minimum height=12mm}]",
      ),
    );
    const gap = (top: string, bottom: string) => anchor(node(l, top), "south").y - anchor(node(l, bottom), "north").y;
    expect(gap("a", "b")).toBeCloseTo(CM, 3);
    expect(node(l, "a2").shape.center.y - node(l, "c").shape.center.y).toBeCloseTo(CM, 3);
    expect(gap("a3", "d")).toBeCloseTo(CM, 3);
    expect(gap("a4", "e")).toBeCloseTo(2.5 * CM, 3);
    expect(node(l, "a5").shape.center.y - node(l, "f").shape.center.y).toBeCloseTo(2.5 * CM, 3);
  });
  it("old below of= measures centre to centre", () => {
    const l = layout(pic("\\node (a) {A};\n\\node[below of=a] (b) {B};", "[node distance=2cm]"));
    expect(node(l, "a").shape.center.y - node(l, "b").shape.center.y).toBeCloseTo(2 * CM, 3);
  });
  it("of can take a perpendicular coordinate", () => {
    const l = layout(pic("\\node (a) {A};\n\\node at (3,-2) (c) {C};\n\\node[right=of a -| c] (b) {B};"));
    expect(anchor(node(l, "b"), "west").x).toBeCloseTo(node(l, "c").shape.center.x + CM, 3);
    expect(node(l, "b").shape.center.y).toBeCloseTo(0, 3);
  });
});

describe("styles", () => {
  it("applies \\tikzset, \\tikzstyle and every node styles", () => {
    const src = [
      "\\tikzset{box/.style={draw, fill=red!20, minimum width=2cm}}",
      "\\tikzstyle{round}=[box, circle]",
      pic("\\node[box] (a) {A};\n\\node[round] (b) at (3,0) {B};", "[every node/.style={font=\\small}]"),
    ].join("\n");
    const l = layout(src);
    expect(node(l, "a").fill).toEqual([1, 0.8, 0.8]);
    expect(node(l, "a").stroke).toEqual([0, 0, 0]);
    expect(node(l, "b").shape.kind).toBe("circle");
    expect(node(l, "a").text!.lines[0]!.runs[0]!.style.size).toBe(9);
  });
  it("substitutes style arguments and defaults", () => {
    const src = "\\tikzset{tint/.style={fill=#1!20}, tint/.default=blue}\n" + pic("\\node[tint] (a) {A};\\node[tint=red] (b) {B};");
    const l = layout(src);
    expect(node(l, "a").fill).toEqual([0.8, 0.8, 1]);
    expect(node(l, "b").fill).toEqual([1, 0.8, 0.8]);
  });
  it("reports keys it doesn't know without guessing", () => {
    const l = layout(pic("\\node[draw, frobnicate=3] (a) {A};"));
    expect(node(l, "a").unknownKeys).toEqual(["frobnicate=3"]);
  });
});

describe("paths", () => {
  it("clips edges to node borders", () => {
    const l = layout(pic("\\node[draw] (a) {A};\\node[draw] (b) at (3,0) {B};\\draw (a) -- (b);"));
    const p = l.paths[0]!;
    const nums = p.d.match(/-?[\d.]+/g)!.map(Number);
    expect(nums[0]).toBeCloseTo(anchor(node(l, "a"), "east").x, 2);
    expect(nums[2]).toBeCloseTo(anchor(node(l, "b"), "west").x, 2);
    expect(p.edges).toEqual([["a", "b"]]);
  });
  it("routes -| through the corner", () => {
    const l = layout(pic("\\node (a) {A};\\node (b) at (2,-2) {B};\\draw (a) -| (b);"));
    const d = l.paths[0]!.d;
    expect(d).toContain(`L ${Math.round(2 * CM * 1000) / 1000} 0`);
  });
  it("adds arrow tips at the end and shortens the line", () => {
    const l = layout(pic("\\draw[->] (0,0) -- (1,0);"));
    const p = l.paths[0]!;
    expect(p.tips).toHaveLength(1);
    expect(p.tips[0]!.at.x).toBeCloseTo(CM, 3);
    const end = Number(p.d.match(/L (-?[\d.]+)/)![1]);
    expect(end).toBeLessThan(CM);
  });
  it("places path labels midway after an operation", () => {
    const l = layout(pic("\\draw (0,0) -- node[above] {x} (2,0);"));
    const label = l.pathNodes[0]!;
    expect(label.shape.center.x).toBeCloseTo(CM, 3);
    expect(anchor(label, "south").y).toBeCloseTo(0, 3);
  });
  it("evaluates calc coordinates", () => {
    const l = layout(pic("\\node (a) {};\\node (b) at (2,0) {};\\coordinate (m) at ($(a)!0.5!(b)$);\\coordinate (n) at ($(a)+(0,1)$);"));
    expect(node(l, "m").shape.center.x).toBeCloseTo(CM, 3);
    expect(node(l, "n").shape.center.y).toBeCloseTo(CM, 3);
  });
  it("draws each edge operation as its own path", () => {
    const l = layout(pic("\\node (a) {A};\\node (b) at (2,0) {B};\\node (c) at (0,2) {C};\\path (a) edge[->] (b) edge (c);"));
    const edges = l.paths.flatMap((p) => p.edges);
    expect(edges).toEqual([
      ["a", "b"],
      ["a", "c"],
    ]);
  });
});

describe("chains", () => {
  it("places nodes on a chain next to each other and joins them", () => {
    const l = layout(pic("\\node[on chain, join] (a) {A};\n\\node[on chain, join] (b) {B};\n\\node[on chain, join] {C};", "[start chain=going below, node distance=5mm]"));
    const a = node(l, "a");
    const b = node(l, "b");
    const c = node(l, "chain-3");
    expect(anchor(a, "south").y - anchor(b, "north").y).toBeCloseTo(5 * 2.845274, 3);
    expect(anchor(b, "south").y - anchor(c, "north").y).toBeCloseTo(5 * 2.845274, 3);
    expect(l.paths.flatMap((p) => p.edges)).toEqual([
      ["a", "b"],
      ["b", "chain-3"],
    ]);
    expect(b.locked).toMatch(/chain/);
  });
  it("continues from a node pulled in with \\chainin", () => {
    const l = layout(pic("\\node (x) at (3,0) {X};\n\\begin{scope}[start chain=going right]\\chainin (x);\\node[on chain, join] (y) {Y};\\end{scope}"));
    expect(anchor(node(l, "y"), "west").x - anchor(node(l, "x"), "east").x).toBeCloseTo(CM, 3);
    expect(l.paths.flatMap((p) => p.edges)).toEqual([["x", "y"]]);
    expect(l.opaque).toEqual([]);
  });
  it("never offers implicit chain names as reference targets", () => {
    const l = layout(pic("\\node[on chain] {A};\n\\node (b) at (3,0) {B};", "[start chain]"));
    expect(node(l, "chain-1").implicitName).toBe(true);
  });
});

describe("summary", () => {
  it("counts editable nodes, edges and kept blocks", () => {
    const src = pic("\\node (a) {A};\\node[below=of a] (b) {B};\\draw (a) -- (b);\\foreach \\i in {1,2} \\node at (\\i,0) {\\i};");
    const doc = analyzeDocument(src);
    const s = summarize(doc, layoutDocumentPicture(doc, 0)!);
    expect(s.headline).toBe("2 nodes and 1 edge editable; 1 block kept as-is");
  });
});

describe("corpus", () => {
  it.each(corpusNames())("lays out %s without throwing", (name) => {
    const { text } = loadCorpusFile(name);
    const doc = analyzeDocument(text);
    expect(doc.syntax.pictures.length).toBeGreaterThan(0);
    doc.syntax.pictures.forEach((_, i) => {
      const l = layoutDocumentPicture(doc, i)!;
      for (const n of l.nodes) {
        expect(Number.isFinite(n.shape.center.x) && Number.isFinite(n.shape.center.y), n.id).toBe(true);
      }
      for (const p of l.paths) expect(p.d).not.toMatch(/NaN|Infinity/);
    });
  });
});
