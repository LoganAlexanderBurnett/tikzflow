// What the state machine template needed (D95): the automata library's states, "initial" and
// "accepting"; loops; and, found on the way, a few places where the quick preview strayed from TikZ:
// labels inheriting "above" from their path, the default outer sep, \pgflinewidth, and the trapezium's
// size. Positions are checked against pdfTeX by spike/engines/probes/p11-automata.tex (npm run fidelity).
import { describe, expect, it } from "vitest";
import { planMakeCurved } from "../src/edit/curves.ts";
import { planDelete } from "../src/edit/delete.ts";
import { endBlocker } from "../src/edit/edges.ts";
import { planAddLabel } from "../src/edit/labels.ts";
import { planMakeOrthogonal } from "../src/edit/orthogonal.ts";
import { planStraighten } from "../src/edit/vertices.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import { LOOP_REASON, pictureEdges, segmentsD } from "../src/model/edges.ts";
import { summarize } from "../src/model/summary.ts";
import type { PictureLayout } from "../src/tikz/layout.ts";
import { anchorPoint } from "../src/tikz/shapes.ts";
import { evalLength } from "../src/tikz/units.ts";

const doc = (body: string, libs = "automata, positioning") => `\\documentclass{standalone}\n\\usepackage{tikz}\n\\usetikzlibrary{${libs}}\n\\begin{document}\n\\begin{tikzpicture}\n${body}\n\\end{tikzpicture}\n\\end{document}\n`;
const lay = (text: string): PictureLayout => layoutDocumentPicture(analyzeDocument(text), 0)!;
const node = (l: PictureLayout, name: string) => l.nodes.find((n) => n.name === name)!;
const EM = 10;

describe("the automata library", () => {
  it("draws a state as a circle at least 2.5em across, and knows every key", () => {
    const text = doc("\\node[state] (q) {$q$};");
    const l = lay(text);
    const q = node(l, "q");
    expect(q.shape.kind).toBe("circle");
    expect(q.stroke).toBeDefined();
    expect(2 * q.shape.hw).toBeCloseTo(2.5 * EM, 3);
    expect(summarize(analyzeDocument(text), l, 0).unknownKeys).toEqual([]);
  });

  it("follows the document's own every state", () => {
    const l = lay(doc("\\tikzset{every state/.style={fill=red, minimum size=12mm}}\n\\node[state] (q) {$q$};"));
    expect(node(l, "q").fill).toEqual([1, 0, 0]);
    expect(2 * node(l, "q").shape.hw).toBeCloseTo(evalLength("12mm")!, 3);
  });

  it("knows the styles only where the library is loaded", () => {
    const text = doc("\\node[state] (q) {$q$};", "positioning");
    expect(summarize(analyzeDocument(text), lay(text), 0).unknownKeys).toEqual([{ key: "state", count: 1 }]);
  });

  it("draws accepting as a double line, with pgf's outer sep", () => {
    const l = lay(doc("\\node[state, accepting, thick] (q) {$q$};"));
    const q = node(l, "q");
    expect(q.double).toEqual({ color: [1, 1, 1], distance: 0.6 });
    // .5\pgflinewidth+.3pt, with the line width "thick" set before it ran.
    expect(q.shape.outerX).toBeCloseTo(0.4 + 0.3, 6);
  });

  it("draws initial as an arrow from its text into the state, 3ex out on the chosen side", () => {
    const l = lay(doc("\\node[state, initial] (a) {a};\n\\node[state, initial above, initial text=go, right=of a] (b) {b};"));
    const a = node(l, "a");
    const arrow = l.paths.find((p) => p.id === `initial@${a.id}`)!;
    expect(arrow.tips).toHaveLength(1);
    expect(arrow.edges).toEqual([]);
    const text = a.extras.find((x) => x.id === `${a.id}/initial`)!;
    const west = anchorPoint(a.shape, "180")!;
    // The text's east side is 3ex left of the state's border.
    expect(text.shape.center.x + text.shape.hw).toBeCloseTo(west.x - 3 * 4.30554, 3);
    const b = node(l, "b");
    const above = b.extras.find((x) => x.id === `${b.id}/initial`)!;
    expect(above.shape.center.x).toBeCloseTo(b.shape.center.x, 3);
    expect(above.shape.center.y).toBeGreaterThan(b.shape.center.y + b.shape.hh);
  });
});

describe("loops", () => {
  const text = doc("\\node[state] (q) {q};\n\\node[state, right=of q] (r) {r};\n\\draw[->] (q) to[loop above] node {a} (q);\n\\path[->] (r) edge[loop right] node {b} ();\n\\draw[->] (q) -- (r);", "automata, positioning");

  it("end where they start, as edges of their own form, with the target written or empty", () => {
    const l = lay(text);
    const loops = pictureEdges(l).filter((e) => e.mode === "loop");
    expect(loops.map((e) => [e.source, e.target])).toEqual([
      [node(l, "q").id, node(l, "q").id],
      [node(l, "r").id, node(l, "r").id],
    ]);
    expect(summarize(analyzeDocument(text), l, 0).headline).toBe("2 nodes and 3 edges editable");
    // loop above: out at 105°, in at 75°, the control points 8 times 0.3915 of the gap away (at least 5mm).
    const d = segmentsD(loops[0]!.segs.map((i) => loops[0]!.route.segs[i]!));
    expect(d).toMatch(/^M .* C .*/);
  });

  it("put their labels where the loop key says", () => {
    const l = lay(text);
    const a = l.pathNodes.find((n) => n.text && JSON.stringify(n.text).includes('"a"'))!;
    const q = node(l, "q");
    // "loop above" says "above": the label's south sits on the top of the loop.
    expect(a.shape.center.y - a.shape.hh).toBeGreaterThan(q.shape.center.y + q.shape.hh + evalLength("5mm")!);
  });

  it("can't be reshaped, re-ended or straightened, and say why", () => {
    const l = lay(text);
    const loop = pictureEdges(l).find((e) => e.mode === "loop")!;
    expect(planMakeOrthogonal(text, 0, loop.id)).toEqual({ ok: false, reason: LOOP_REASON });
    expect(planMakeCurved(text, 0, loop.id)).toEqual({ ok: false, reason: LOOP_REASON });
    expect(planStraighten(text, 0, loop.id)).toEqual({ ok: false, reason: LOOP_REASON });
    expect(endBlocker(loop, "to")).toBe(LOOP_REASON);
  });

  it("can be labeled and deleted", () => {
    const l = lay(text);
    const loop = pictureEdges(l).find((e) => e.mode === "loop" && e.labels.length === 0) ?? pictureEdges(l).find((e) => e.mode === "loop")!;
    const seg = loop.route.segs[loop.segs[0]!]!;
    const added = planAddLabel(text, 0, loop.id, { x: (seg.c1!.x + seg.c2!.x) / 2, y: (seg.c1!.y + seg.c2!.y) / 2 }, "x");
    expect(added.ok).toBe(true);
    const deleted = planDelete(text, 0, { kind: "edge", id: loop.id });
    expect(deleted.ok).toBe(true);
  });
});

describe("TikZ details the templates showed up", () => {
  it("a bare above on a path or its to sets the anchor of its labels, and turns auto off", () => {
    const l = lay(doc("\\node (a) {a};\n\\node (b) at (3,0) {b};\n\\draw[auto] (a) to[above] node[name=x] {x} (b);"));
    const x = l.pathNodes.find((n) => n.name === "x")!;
    expect(x.shape.center.y - x.shape.hh - x.shape.outerY).toBeCloseTo(0, 3);
  });

  it("the default outer sep is half the node's own line width", () => {
    const l = lay(doc("\\node[draw] (a) {a};\n\\node[draw, ultra thick] (b) at (2,0) {b};\n\\node[draw, outer sep=2pt, thick] (c) at (4,0) {c};"));
    expect(node(l, "a").shape.outerX).toBeCloseTo(0.2, 6);
    expect(node(l, "b").shape.outerX).toBeCloseTo(0.8, 6);
    expect(node(l, "c").shape.outerX).toBeCloseTo(2, 6);
  });

  it("a trapezium made taller by minimum height grows wider too, unless it stretches", () => {
    const shape = (opts: string) => node(lay(doc(`\\node[draw, trapezium, ${opts}] (t) {Read $n$};`, "shapes.geometric")), "t").shape;
    const plain = shape("trapezium left angle=70, trapezium right angle=110");
    const tall = shape("trapezium left angle=70, trapezium right angle=110, minimum height=9mm");
    const stretched = shape("trapezium left angle=70, trapezium right angle=110, minimum height=9mm, trapezium stretches");
    const k = tall.hh / plain.hh;
    expect(k).toBeGreaterThan(1.3);
    expect(tall.hw).toBeCloseTo(plain.hw * k, 3);
    expect(stretched.hh).toBeCloseTo(tall.hh, 3);
    expect(stretched.hw).toBeLessThan(tall.hw);
  });
});
