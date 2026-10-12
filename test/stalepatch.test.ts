// M5 step 5 (D96): the summary counts group and lane boxes as groups, not as nodes that can't be
// edited; and the patch that keeps TeX's last picture on the canvas while the next compile runs
// (what changed is cut out of it and drawn natively, D69 item 4).
import { describe, expect, it } from "vitest";
import { planMove } from "../src/edit/move.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import { summarize } from "../src/model/summary.ts";
import { templateText } from "../src/templates/index.ts";
import type { PictureLayout } from "../src/tikz/layout.ts";
import { dBox, stalePatch } from "../src/ui/stalepatch.ts";

const lay = (text: string): PictureLayout => layoutDocumentPicture(analyzeDocument(text), 0)!;
const headline = (text: string) => summarize(analyzeDocument(text), lay(text), 0).main;
const pic = (body: string) => `\\begin{tikzpicture}\n${body}\n\\end{tikzpicture}\n`;

describe("the summary's headline (D96)", () => {
  it("counts group and lane boxes as groups", () => {
    expect(headline(templateText("swimlane-process")!)).toBe("7 nodes, 3 groups and 7 edges editable");
    expect(headline(templateText("left-to-right-pipeline")!)).toBe("7 nodes, 1 group and 6 edges editable");
    expect(headline(templateText("prisma-2020")!)).toBe("9 nodes, 3 groups and 8 edges editable");
    expect(headline(templateText("basic-process")!)).toBe("6 nodes and 6 edges editable");
  });

  it("keeps \"of\" for nodes that really can't be dragged, and doesn't list groups as locked", () => {
    const text = pic("\\node[draw] (a) at (0,0) {A};\n\\node[draw, right=of nowhere] (b) {B};\n\\node[draw, fit=(a)] (g) {};\n\\draw (a) -- (b);");
    const s = summarize(analyzeDocument(text), lay(text), 0);
    expect(s.main).toBe("1 node of 2, 1 group and 1 edge editable");
    expect(s.locked.map((l) => l.id)).toEqual(["b"]);
  });

  it("doesn't count a box that fits a block kept as-is as a group", () => {
    const text = pic("\\matrix (m) [matrix of nodes] { a \\\\ };\n\\node[draw, fit=(m)] (g) {};");
    const s = summarize(analyzeDocument(text), lay(text), 0);
    expect(s.groups).toBe(0);
    expect(s.main).toBe("0 nodes of 1 and 0 edges editable; 1 block kept as-is");
  });
});

describe("the patch over TeX's last picture (D96)", () => {
  const sample = templateText("basic-process")!;

  it("is empty when nothing drawn changed", () => {
    const p = stalePatch(lay(sample), lay(sample.replace("% Drag a node", "% Move a node")));
    expect(p).toEqual({ marks: [], draw: new Set() });
  });

  it("cuts out a recolored node and draws it, and what crosses it, natively", () => {
    const p = stalePatch(lay(sample), lay(sample.replace("(base)  {Answer $1$}", "(base) [fill=red!20] {Answer $1$}")))!;
    expect(p.draw.has("base")).toBe(true);
    expect(p.draw.has("start")).toBe(false);
    // Only the node is cut out (as it was and as it is: the same box twice). The edges touching it are
    // drawn inside the cut, not cut out themselves.
    expect(p.marks.filter((m) => m.kind === "box")).toHaveLength(2);
    expect(p.marks.some((m) => m.kind === "line")).toBe(false);
  });

  it("follows a node being dragged: its old and new places and its edges, by what they draw, not their ids", () => {
    const before = lay(sample);
    const base = before.nodes.find((n) => n.id === "base")!;
    const moved = planMove(sample, 0, "base", { x: base.shape.center.x + 40, y: base.shape.center.y + 30 })!;
    expect(moved.text).not.toBe(sample);
    const p = stalePatch(before, lay(moved.text))!;
    expect(p).not.toBeNull();
    expect(p.draw.has("base")).toBe(true);
    // The two edges at base moved (old and new geometry: four lines), the rest still match TeX's picture.
    expect(p.marks.filter((m) => m.kind === "line")).toHaveLength(4);
    expect(p.draw.has("start")).toBe(false);
    expect(p.draw.has("read")).toBe(false);
  });

  it("cuts only a sliver out of a node an edge's end meets, so its label stays TeX's", () => {
    const text = pic("\\node[draw] (a) at (0,0) {A};\n\\node[draw] (b) at (3,0) {B};\n\\draw[->] (a) -- (b);");
    const p = stalePatch(lay(text), lay(text.replace("{B}", "{Bee}")))!;
    // a is drawn natively, but only inside the cut-outs; b is cut out whole, as it was and as it is.
    expect(p.draw.has("a")).toBe(true);
    const a = lay(text).nodes.find((n) => n.id === "a")!;
    const boxes = p.marks.flatMap((m) => (m.kind === "box" ? [m.box] : []));
    expect(boxes.some((b) => b.x0 <= a.shape.center.x && a.shape.center.x <= b.x1 && b.y0 <= a.shape.center.y && a.shape.center.y <= b.y1)).toBe(false);
  });

  it("gives up when nearly everything changed (another document)", () => {
    expect(stalePatch(lay(sample), lay(templateText("hierarchy")!))).toBeNull();
  });

  it("measures paths with arcs and curves", () => {
    expect(dBox("M 0 0 L 10 5")).toEqual({ x0: 0, y0: 0, x1: 10, y1: 5 });
    expect(dBox("M 0 0 C 5 20 10 -3 12 0")).toEqual({ x0: 0, y0: -3, x1: 12, y1: 20 });
    const arc = dBox("M 10 0 A 10 10 0 1 0 -10 0 Z")!;
    expect(arc.y0).toBeLessThanOrEqual(-10);
    expect(arc.y1).toBeGreaterThanOrEqual(10);
  });
});
