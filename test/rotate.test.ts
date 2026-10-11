// Turned nodes in the quick preview (M4 step 7, D83 item 1, D87), as pdfTeX
// places them (spike/engines/probes/p10-rotated-nodes.tex).
import { describe, expect, it } from "vitest";
import { planLane } from "../src/edit/lanes.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import { anchorPoint, borderInDirection, makeShape, shapeBounds } from "../src/tikz/shapes.ts";
import { PT_PER_UNIT } from "../src/tikz/units.ts";

const CM = PT_PER_UNIT.cm!;
const near = (p: { x: number; y: number }, q: { x: number; y: number }) => {
  expect(p.x).toBeCloseTo(q.x, 3);
  expect(p.y).toBeCloseTo(q.y, 3);
};
const pic = (body: string) => `\\begin{tikzpicture}\n${body}\\end{tikzpicture}\n`;
const nodes = (text: string) => layoutDocumentPicture(analyzeDocument(text), 0)!;

describe("turned shapes", () => {
  const box = { ...makeShape({ kind: "rectangle", textWidth: 20, textHeight: 6, textDepth: 2, innerXSep: 0, innerYSep: 0, outerXSep: 0, outerYSep: 0, minWidth: 0, minHeight: 0, roundedCorners: 0, aspect: 1, trapeziumLeftAngle: 60, trapeziumRightAngle: 60, shapeBorderRotate: 0 }, { x: 10, y: 5 }), rotate: 90 };

  it("turns anchors and borders about the center", () => {
    // 20 wide and 8 high, turned a quarter: its east anchor is now above the center.
    near(anchorPoint(box, "east")!, { x: 10, y: 15 });
    near(anchorPoint(box, "north")!, { x: 6, y: 5 });
    near(anchorPoint(box, "north east")!, { x: 6, y: 15 });
    near(anchorPoint(box, "0")!, { x: 10, y: 15 });
    near(borderInDirection(box, 1, 0), { x: 14, y: 5 });
  });

  it("bounds the turned box", () => {
    const b = shapeBounds(box);
    expect([b.minX, b.maxX, b.minY, b.maxY].map((v) => Math.round(v * 1000) / 1000)).toEqual([6, 14, -5, 15]);
  });
});

describe("turned nodes", () => {
  it("turns a node about its at point, which its own rotate doesn't move", () => {
    const l = nodes(pic("\\node[draw, rotate=90] (a) at (4,0) {Ninety};\n"));
    const a = l.nodes[0]!;
    expect(a.shape.rotate).toBeCloseTo(90);
    expect(a.rotate).toBeCloseTo(90);
    near(a.shape.center, { x: 4 * CM, y: 0 });
    expect(a.unrendered).not.toContain("rotate");
  });

  it("puts a turned node's anchor on its at point", () => {
    const a = nodes(pic("\\node[draw, rotate=30, anchor=west] (a) at (6,0) {Thirty};\n")).nodes[0]!;
    near(anchorPoint(a.shape, "west")!, { x: 6 * CM, y: 0 });
  });

  it("doesn't turn nodes in a turned scope, unless transform shape", () => {
    const l = nodes(pic("\\begin{scope}[rotate=30]\n\\node[draw] (a) at (0,0) {A};\n\\node[draw, transform shape] (b) at (3,0) {B};\n\\end{scope}\n"));
    expect(l.nodes[0]!.shape.rotate).toBeUndefined();
    expect(l.nodes[1]!.shape.rotate).toBeCloseTo(30);
  });

  it("turns a label by its own rotate, with its own anchor", () => {
    const l = nodes(pic("\\node[draw, minimum width=2cm, minimum height=2cm, label={[rotate=90, anchor=south]west:Title}] (lane) at (0,0) {};\n"));
    const t = l.nodes[0]!.extras[0]!;
    expect(t.rotate).toBeCloseTo(90);
    // The turned label's foot (its south anchor) is on the box's west side.
    near(anchorPoint(t.shape, "south")!, anchorPoint(l.nodes[0]!.shape, "west")!);
  });

  it("titles row lanes turned to read upwards (D83 item 1)", () => {
    const text = `\\documentclass{article}\n\\usepackage{tikz}\n\\usetikzlibrary{positioning, fit, backgrounds}\n\\begin{document}\n${pic("\\node[draw] (a) {A};\n\\node[draw, right=of a] (b) {B};\n\\draw[->] (a) -- (b);\n")}\\end{document}\n`;
    const r = planLane(text, 0, ["a", "b"], "Sales");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toContain("label={[lane title, rotate=90, anchor=south]west:Sales}");
  });
});
