import { describe, expect, it } from "vitest";
import { applyChanges, diffRange } from "../src/edit/changes.ts";
import { formatDistance, planMove } from "../src/edit/move.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import type { LaidOutNode } from "../src/tikz/layout.ts";
import { anchorPoint, type Point } from "../src/tikz/shapes.ts";
import { CM } from "../src/tikz/units.ts";

const pic = (body: string, opts = "") => `\\begin{tikzpicture}${opts}\n${body}\n\\end{tikzpicture}\n`;

function nodes(text: string, index = 0): Map<string, LaidOutNode> {
  const l = layoutDocumentPicture(analyzeDocument(text), index)!;
  return new Map(l.nodes.map((n) => [n.id, n]));
}

/** The centre `id` would have if its north anchor sat `gap` below `of`'s south anchor. */
function below(text: string, id: string, of: string, gap: number): Point {
  const ns = nodes(text);
  const a = ns.get(of)!;
  const b = ns.get(id)!;
  const south = anchorPoint(a.shape, "south")!;
  return { x: a.shape.center.x, y: south.y - gap - (b.shape.hh + b.shape.outerY) };
}

function move(text: string, id: string, to: Point) {
  const r = planMove(text, 0, id, to);
  if (!r) throw new Error("move refused");
  expect(applyChanges(text, r.changes)).toBe(r.text);
  return r;
}

describe("formatting", () => {
  it("writes distances the way people do", () => {
    expect(formatDistance(5 * 2.845274)).toBe("5mm");
    expect(formatDistance(1.5 * CM)).toBe("1.5cm");
    expect(formatDistance(2 * CM)).toBe("2cm");
    expect(formatDistance(0.1)).toBe("0pt");
  });
});

describe("planMove", () => {
  it("snapped below another node at node distance becomes below=of", () => {
    const text = pic("\\node (a) {A};\n\\node (b) at (3,-2) {B};");
    const r = move(text, "b", below(text, "b", "a", CM));
    expect(r.text).toBe(pic("\\node (a) {A};\n\\node[below=of a] (b) {B};"));
  });

  it("another gap is written as a distance", () => {
    const text = pic("\\node (a) {A};\n\\node (b) at (3,-2) {B};");
    const r = move(text, "b", below(text, "b", "a", 1.5 * CM));
    expect(r.text).toContain("\\node[below=1.5cm of a] (b) {B};");
  });

  it("replaces an existing positioning key in place", () => {
    const text = pic("\\node[draw] (a) {A};\n\\node[draw, below=of a, fill=red] (b) {B};");
    const ns = nodes(text);
    const a = ns.get("a")!;
    const b = ns.get("b")!;
    const east = anchorPoint(a.shape, "east")!;
    const r = move(text, "b", { x: east.x + CM + b.shape.hw + b.shape.outerX, y: a.shape.center.y });
    expect(r.text).toContain("\\node[draw, right=of a, fill=red] (b) {B};");
    // Only the positioning item changed.
    const d = diffRange(text, r.text)!;
    expect(text.slice(d.from, d.to)).toBe("below");
    expect(d.insert).toBe("right");
  });

  it("aligned with two different nodes becomes a perpendicular coordinate", () => {
    const text = pic("\\node (a) {A};\n\\node (c) at (4,-3) {C};\n\\node (b) at (1,1) {B};");
    const ns = nodes(text);
    const r = move(text, "b", { x: ns.get("a")!.shape.center.x, y: ns.get("c")!.shape.center.y });
    expect(r.text).toContain("\\node (b) at (a |- c) {B};");
  });

  it("keeps plain coordinates for nodes placed with numbers", () => {
    const text = pic("\\node [style=Process] (0) at (0, 3) {Start};\n\\node [style=Process] (2) at (3, 1.5) {Fix};");
    const ns = nodes(text);
    const c = ns.get("2")!.shape.center;
    const r = move(text, "2", { x: c.x + CM, y: c.y + 0.37 * CM });
    expect(r.text).toContain("\\node [style=Process] (2) at (4, 1.87) {Fix};");
  });

  it("accounts for the node's anchor when writing coordinates", () => {
    const text = pic("\\node (p) at (-2,-1.5) [left] {Arrow};");
    const c = nodes(text).get("p")!.shape.center;
    const r = move(text, "p", { x: c.x - CM, y: c.y });
    expect(r.text).toContain("\\node (p) at (-3,-1.5) [left] {Arrow};");
  });

  it("a free drop near a node becomes a diagonal relation", () => {
    const text = pic("\\node[draw] (a) {A};\n\\node[draw, below=of a] (b) {B};");
    const ns = nodes(text);
    const c = ns.get("b")!.shape.center;
    const r = move(text, "b", { x: c.x + 2 * CM, y: c.y - 0.3 * CM });
    expect(r.spec.kind).toBe("positioning");
    expect(r.text).toMatch(/\\node\[draw, below right=[\d.]+(mm|cm) and [\d.]+(mm|cm) of a\] \(b\) \{B\};/);
  });

  it("never refers to a node that depends on the moved one", () => {
    const text = pic("\\node (a) {A};\n\\node[below=of a] (b) {B};");
    const ns = nodes(text);
    const bc = ns.get("b")!.shape.center;
    // Move a under b: b is positioned relative to a, so a can't refer to b.
    const r = move(text, "a", { x: bc.x, y: bc.y - 2 * CM });
    expect(r.text).not.toMatch(/of b/);
    expect(r.spec.kind).toBe("absolute");
  });

  it("does not move locked nodes", () => {
    const text = pic("\\node (a) {A};\n\\node[draw, fit=(a)] (f) {};");
    expect(planMove(text, 0, "f", { x: 10, y: 10 })).toBeNull();
  });

  it("keeps comments inside option lists", () => {
    const text = pic("\\node (a) {A};\n\\node[draw, % frame\n  below=2cm of a,\n  fill=red] (b) {B};");
    const r = move(text, "b", below(text, "b", "a", CM));
    expect(r.text).toContain("% frame");
    expect(r.text).toContain("below=of a");
  });

  it("removes an option list that only held the position", () => {
    const text = pic("\\node (a) {A};\n\\node (c) at (4,-3) {C};\n\\node[below=of a] (b) {B};");
    const ns = nodes(text);
    const r = move(text, "b", { x: ns.get("a")!.shape.center.x, y: ns.get("c")!.shape.center.y });
    expect(r.text).toContain("\\node (b) at (a |- c) {B};");
  });

  it("works in scaled pictures", () => {
    const text = pic("\\node (a) {A};\n\\node (b) at (3,-2) {B};", "[scale=0.5]");
    const r = move(text, "b", below(text, "b", "a", CM * 0.5));
    // node distance is scaled with the picture, so the gap equals it.
    expect(r.text).toContain("\\node[below=of a] (b) {B};");
  });
});
