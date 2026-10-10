import { describe, expect, it } from "vitest";
import { applyChanges } from "../src/edit/changes.ts";
import { groupBlocker, groupMembers, planGroupMove } from "../src/edit/group.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import { pictureEdges } from "../src/model/edges.ts";
import type { Point } from "../src/tikz/shapes.ts";
import { CM, PT_PER_UNIT } from "../src/tikz/units.ts";

const MM = PT_PER_UNIT.mm!;
const doc = (body: string) => `\\documentclass{article}\n\\usepackage{tikz}\n\\usetikzlibrary{positioning,fit}\n\\begin{document}\n\\begin{tikzpicture}\n${body}\n\\end{tikzpicture}\n\\end{document}\n`;

function centers(text: string): Map<string, Point> {
  const l = layoutDocumentPicture(analyzeDocument(text), 0)!;
  return new Map(l.nodes.map((n) => [n.id, n.shape.center]));
}

function moveGroup(text: string, ids: string[], delta: Point) {
  const r = planGroupMove(text, 0, ids, delta);
  if (!r.ok) throw new Error(r.reason);
  expect(applyChanges(text, r.changes)).toBe(r.text);
  return r;
}

/** Every id in `moved` lands `delta` away (to the millimetre), every id in `kept` stays exactly. */
function expectMoved(before: string, after: string, moved: string[], kept: string[], delta: Point) {
  const a = centers(before);
  const b = centers(after);
  for (const id of moved) {
    expect(Math.abs(b.get(id)!.x - a.get(id)!.x - delta.x), `${id} x`).toBeLessThan(0.8 * MM);
    expect(Math.abs(b.get(id)!.y - a.get(id)!.y - delta.y), `${id} y`).toBeLessThan(0.8 * MM);
  }
  for (const id of kept) {
    expect(Math.hypot(b.get(id)!.x - a.get(id)!.x, b.get(id)!.y - a.get(id)!.y), `${id} stays`).toBeLessThan(0.05);
  }
}

describe("planGroupMove", () => {
  it("rewrites only the member placed against a node outside the group; the one placed against a member follows", () => {
    const text = doc("\\node[draw] (a) {A};\n\\node[draw, below=of a] (b) {B};\n\\node[draw, below=of b] (c) {C};\n\\node[draw, right=3cm of a] (d) {D};");
    const delta = { x: 2 * CM, y: 0 };
    const r = moveGroup(text, ["b", "c"], delta);
    expect(r.written.map((w) => w.id)).toEqual(["b"]);
    // c's line is untouched.
    expect(r.text).toContain("\\node[draw, below=of b] (c) {C};");
    expectMoved(text, r.text, ["b", "c"], ["a", "d"], delta);
  });

  it("writes members in code order, so a later member may be placed against an earlier one", () => {
    const text = doc("\\node[draw] (a) at (0,0) {A};\n\\node[draw] (b) at (0,-2) {B};\n\\node[draw] (c) at (3,-2) {C};");
    const delta = { x: 0, y: -1 * CM };
    const r = moveGroup(text, ["b", "c"], delta);
    expect(r.written.map((w) => w.id)).toEqual(["b", "c"]);
    expectMoved(text, r.text, ["b", "c"], ["a"], delta);
  });

  it("keeps plain-coordinate pictures in plain coordinates", () => {
    const text = doc("\\node[draw] (a) at (0,0) {A};\n\\node[draw] (b) at (2,0) {B};\n\\node[draw] (z) at (0,-4) {Z};");
    const delta = { x: 1 * CM, y: -1 * CM };
    const r = moveGroup(text, ["a", "b"], delta);
    expect(r.text).toContain("\\node[draw] (a) at (1,-1) {A};");
    expect(r.text).toContain("\\node[draw] (b) at (3,-1) {B};");
    expectMoved(text, r.text, ["a", "b"], ["z"], delta);
  });

  it("nodes outside the selection that depend on a member follow it, as with a single drag", () => {
    const text = doc("\\node[draw] (a) at (0,0) {A};\n\\node[draw] (b) at (3,0) {B};\n\\node[draw, below=of b] (c) {C};");
    const delta = { x: 0, y: 1 * CM };
    const r = moveGroup(text, ["a", "b"], delta);
    expect(r.text).toContain("\\node[draw, below=of b] (c) {C};");
    expectMoved(text, r.text, ["a", "b", "c"], [], delta);
  });

  it("a member that only partly follows (at (a |- x) with x outside) is rewritten too", () => {
    const text = doc("\\node[draw] (x) at (0,-3) {X};\n\\node[draw] (a) at (3,0) {A};\n\\node[draw] (b) at (a |- x) {B};");
    const delta = { x: 1 * CM, y: 1 * CM };
    const r = moveGroup(text, ["a", "b"], delta);
    expect(r.written.map((w) => w.id).sort()).toEqual(["a", "b"]);
    expectMoved(text, r.text, ["a", "b"], ["x"], delta);
  });

  it("moves absolute corners of an edge between two members, and leaves edges to outside nodes alone", () => {
    const text = doc("\\node[draw] (a) at (0,0) {A};\n\\node[draw] (b) at (4,-2) {B};\n\\node[draw] (z) at (8,0) {Z};\n\\draw[->] (a) -- (0,-2) -- (b);\n\\draw[->] (b) -- (8,-2) -- (z);");
    const delta = { x: 1 * CM, y: 0 };
    const r = moveGroup(text, ["a", "b"], delta);
    expect(r.corners).toBe(1);
    expect(r.text).toContain("\\draw[->] (a) -- (1,-2) -- (b);");
    expect(r.text).toContain("\\draw[->] (b) -- (8,-2) -- (z);");
    expectMoved(text, r.text, ["a", "b"], ["z"], delta);
  });

  it("relative corners (++) and perpendicular corners need no rewrite", () => {
    const text = doc("\\node[draw] (a) at (0,0) {A};\n\\node[draw] (b) at (4,-2) {B};\n\\draw[->] (a) -- ++(0,-2) -- (b);\n\\draw[->] (a) |- (b);");
    const delta = { x: 1 * CM, y: 1 * CM };
    const r = moveGroup(text, ["a", "b"], delta);
    expect(r.corners).toBe(0);
    expect(r.text).toContain("\\draw[->] (a) -- ++(0,-2) -- (b);");
    const l = layoutDocumentPicture(analyzeDocument(r.text), 0)!;
    const before = layoutDocumentPicture(analyzeDocument(text), 0)!;
    const mid = (layout: typeof l) => pictureEdges(layout)[0]!.route.stops[1]!.point;
    expect(mid(l).x - mid(before).x).toBeCloseTo(delta.x, 0);
    expect(mid(l).y - mid(before).y).toBeCloseTo(delta.y, 0);
  });

  it("dragging a fit node moves what it fits, and the fit node follows", () => {
    const text = doc("\\node[draw] (a) at (0,0) {A};\n\\node[draw, below=of a] (b) {B};\n\\node[draw] (z) at (5,0) {Z};\n\\node[draw, dashed, fit=(a)(b)] (g) {};");
    const l = layoutDocumentPicture(analyzeDocument(text), 0)!;
    expect(groupMembers(l, ["g"])).toEqual({ members: ["a", "b"], boxes: ["g"] });
    const delta = { x: -1 * CM, y: 0 };
    const r = moveGroup(text, ["g"], delta);
    expect(r.written.map((w) => w.id)).toEqual(["a"]);
    expect(r.text).toContain("\\node[draw, dashed, fit=(a)(b)] (g) {};");
    expectMoved(text, r.text, ["a", "b", "g"], ["z"], delta);
  });

  it("nested fit nodes are followed down to their members", () => {
    const text = doc("\\node[draw] (a) at (0,0) {A};\n\\node[draw] (b) at (2,0) {B};\n\\node[fit=(a)] (fa) {};\n\\node[fit=(fa)(b)] (outer) {};");
    const l = layoutDocumentPicture(analyzeDocument(text), 0)!;
    expect(groupMembers(l, ["outer"])).toEqual({ members: ["a", "b"], boxes: ["fa", "outer"] });
  });

  it("refuses a group with a node that can't move, and says which", () => {
    const text = doc("\\matrix (m) [matrix of nodes] { a \\\\ };\n\\node[draw] (a) at (0,-2) {A};\n\\node[draw, right=of m-1-1] (b) {B};");
    const l = layoutDocumentPicture(analyzeDocument(text), 0)!;
    expect(l.nodes.find((n) => n.id === "b")!.lock?.kind).toBe("opaque-ref");
    expect(groupBlocker(l, ["a", "b"])).toMatch(/^b can't be moved: /);
    const r = planGroupMove(text, 0, ["a", "b"], { x: CM, y: 0 });
    expect(r.ok).toBe(false);
  });

  it("pins a member locked by an undefined name where it lands", () => {
    const text = doc("\\node[draw] (a) at (0,0) {A};\n\\node[draw, right=of nowhere] (b) {B};");
    const delta = { x: 0, y: -1 * CM };
    const r = moveGroup(text, ["a", "b"], delta);
    expect(r.text).toMatch(/\\node\[draw\] \(b\) at \([-\d.]+,[-\d.]+\) \{B\};/);
  });

  it("changes nothing outside the members' statements, apart from loading positioning", () => {
    const text = doc("% keep me\n\\node[draw] (a) {A}; % and me\n\\node[draw, below=of a] (b) {B};\n\\node[draw, right=of b] (c) {C};");
    const r = moveGroup(text, ["b", "c"], { x: 5 * MM, y: -3 * MM });
    expect(r.text).toContain("% keep me\n\\node[draw] (a) {A}; % and me\n");
    for (const c of r.changes) expect(text.slice(c.from, c.to)).not.toContain("(a) {A}");
  });
});
