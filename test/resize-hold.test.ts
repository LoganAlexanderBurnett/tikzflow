// Milestone 2a step 4 follow-up: resizing keeps the edge opposite the handle
// where it is, like PowerPoint or Figma (D40). Where the node's anchor already
// holds that edge only the size is written; otherwise the move planner
// repositions the node in the same edit.
import { describe, expect, it } from "vitest";
import { applyChanges, composeChanges, diffRange } from "../src/edit/changes.ts";
import type { Scope } from "../src/edit/properties.ts";
import { type Hold, planResize, resizeBlocker, type SizeWant } from "../src/edit/resize.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import type { LaidOutNode, PictureLayout } from "../src/tikz/layout.ts";
import { PT_PER_UNIT } from "../src/tikz/units.ts";
import { loadCorpusFile } from "./corpus.ts";

const MM = PT_PER_UNIT.mm!;
const pic = (body: string, opts = "") => `\\usetikzlibrary{positioning}\n\\begin{tikzpicture}${opts}\n${body}\n\\end{tikzpicture}\n`;
const layout = (text: string): PictureLayout => layoutDocumentPicture(analyzeDocument(text), 0)!;
const node = (text: string, id: string): LaidOutNode => layout(text).nodes.find((n) => n.id === id)!;
const edges = (n: LaidOutNode) => ({ l: n.shape.center.x - n.shape.hw, r: n.shape.center.x + n.shape.hw, b: n.shape.center.y - n.shape.hh, t: n.shape.center.y + n.shape.hh });

/** The handle's hold: the corner or side opposite the one dragged. */
const SE: Hold = { x: -1, y: 1 };
const NW: Hold = { x: 1, y: -1 };
const E: Hold = { x: -1, y: 0 };
const CENTER: Hold = { x: 0, y: 0 };

function resize(text: string, id: string, want: SizeWant, hold: Hold | undefined, scope: Scope = { kind: "nodes", ids: [id] }) {
  const doc = analyzeDocument(text);
  const r = planResize(doc, 0, layoutDocumentPicture(doc, 0)!, id, want, scope, hold);
  if (!r.ok) throw new Error(r.reason);
  // The merged changes must apply to the original text and give the text reported.
  expect(applyChanges(text, r.changes)).toBe(r.text);
  return r;
}

function near(a: number, b: number, tol = 0.6 * MM) {
  expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThanOrEqual(tol);
}

describe("composeChanges", () => {
  it("merges two edits in a row into changes against the original", () => {
    const base = "abcdefghij";
    const first = [{ from: 2, to: 4, insert: "XYZ" }];
    const second = [{ from: 7, to: 8, insert: "-" }];
    const mid = applyChanges(base, first);
    const out = composeChanges(base, first, second);
    expect(applyChanges(base, out)).toBe(applyChanges(mid, second));
  });

  it("handles a second edit that replaces text the first inserted", () => {
    const base = "[draw] x";
    const first = [{ from: 5, to: 5, insert: ", minimum width=3cm" }];
    const mid = applyChanges(base, first);
    const at = mid.indexOf("3cm");
    const second = [{ from: at, to: at + 3, insert: "5cm" }];
    expect(applyChanges(base, composeChanges(base, first, second))).toBe("[draw, minimum width=5cm] x");
  });
});

describe("holding the opposite edge", () => {
  it("writes only the size when the anchor already holds the edge (below=of puts the anchor at north)", () => {
    const text = pic("\\node[draw] (a) at (0,0) {Top};\n\\node[draw, below=of a] (b) {Bottom};");
    const b = node(text, "b");
    // Dragging the south side: the north edge is held by the anchor.
    const r = resize(text, "b", { h: 2 * b.shape.hh + 15 * MM }, { x: 0, y: 1 });
    expect(r.position).toBeUndefined();
    near(edges(node(r.text, "b")).t, edges(b).t, 0.01);
    expect(r.text).toContain("below=of a");
    const d = diffRange(text, r.text)!;
    expect(d.insert).toMatch(/minimum height/);
    expect(r.text).not.toMatch(/shift/);
  });

  it("keeps the far corner in place for a node centred on its coordinates, with the position written in the same edit", () => {
    const text = pic("\\node[draw] (a) at (2,1) {Hello};");
    const a = node(text, "a");
    const before = edges(a);
    const r = resize(text, "a", { w: 2 * a.shape.hw + 20 * MM, h: 2 * a.shape.hh + 10 * MM }, SE);
    const after = edges(node(r.text, "a"));
    // Dragging the south-east corner: the north-west corner is held.
    near(after.l, before.l);
    near(after.t, before.t);
    near(after.r - after.l, 2 * a.shape.hw + 20 * MM);
    near(after.t - after.b, 2 * a.shape.hh + 10 * MM);
    expect(r.position).toBeDefined();
    expect(r.written.length).toBe(2);
    // One edit: the size items and the new coordinates are all inside the node's statement.
    const d = diffRange(text, r.text)!;
    expect(d.from).toBeGreaterThanOrEqual(a.statement.from);
    expect(d.to).toBeLessThanOrEqual(a.statement.to);
  });

  it("keeps the opposite side for a side handle, and the other axis centred", () => {
    const text = pic("\\node[draw] (a) at (0,0) {Hello};");
    const a = node(text, "a");
    const before = edges(a);
    const r = resize(text, "a", { w: 2 * a.shape.hw + 30 * MM }, E);
    const after = edges(node(r.text, "a"));
    near(after.l, before.l);
    near(after.b, before.b, 0.01);
    near(after.t, before.t, 0.01);
    near(after.r, before.r + 30 * MM);
  });

  it("works toward the north-west too (west and north are the dragged edges)", () => {
    const text = pic("\\node[draw] (a) at (3,2) {Hello};");
    const a = node(text, "a");
    const before = edges(a);
    const r = resize(text, "a", { w: 2 * a.shape.hw + 12 * MM, h: 2 * a.shape.hh + 8 * MM }, NW);
    const after = edges(node(r.text, "a"));
    near(after.r, before.r);
    near(after.b, before.b);
    near(after.t - after.b, 2 * a.shape.hh + 8 * MM);
  });

  it("keeps the relation and adds a shift when the node is placed relative to another", () => {
    const text = pic("\\node[draw] (a) at (0,0) {Top};\n\\node[draw, below=of a] (b) {Bottom};");
    const b = node(text, "b");
    const before = edges(b);
    // South-east corner dragged: the west and north edges are held. North is
    // held by the anchor; west needs a shift because the node grows around its centre line.
    const r = resize(text, "b", { w: 2 * b.shape.hw + 20 * MM, h: 2 * b.shape.hh + 6 * MM }, SE);
    const after = edges(node(r.text, "b"));
    near(after.l, before.l);
    near(after.t, before.t);
    // The relation is kept as written; only a shift is added.
    expect(r.text).toMatch(/below=of a, xshift=-?[\d.]+(mm|cm)/);
    expect(r.position).toMatch(/xshift/);
  });

  it("repeated resizes update the same shift", () => {
    let text = pic("\\node[draw] (a) at (0,0) {Top};\n\\node[draw, below=of a] (b) {Bottom};");
    const left = edges(node(text, "b")).l;
    for (const grow of [10, 20, 30]) {
      const b = node(text, "b");
      text = resize(text, "b", { w: 2 * b.shape.hw + grow * MM }, E).text;
    }
    near(edges(node(text, "b")).l, left, 1.1 * MM);
    expect(text.match(/xshift/g)?.length).toBe(1);
  });

  it("with the centre held (Ctrl) the node grows both ways and doesn't move", () => {
    const text = pic("\\node[draw] (a) at (0,0) {Hello};");
    const a = node(text, "a");
    const r = resize(text, "a", { w: 2 * a.shape.hw + 20 * MM, h: 2 * a.shape.hh + 10 * MM }, CENTER);
    const after = node(r.text, "a");
    near(after.shape.center.x, a.shape.center.x, 0.01);
    near(after.shape.center.y, a.shape.center.y, 0.01);
    expect(r.position).toBeUndefined();
    expect(r.text).toContain("at (0,0)");
  });

  it("with the centre held, a node placed below another gets a shift that keeps its middle", () => {
    const text = pic("\\node[draw] (a) at (0,0) {Top};\n\\node[draw, below=of a] (b) {Bottom};");
    const b = node(text, "b");
    const r = resize(text, "b", { h: 2 * b.shape.hh + 10 * MM }, CENTER);
    const after = node(r.text, "b");
    near(after.shape.center.y, b.shape.center.y, 1.1 * MM);
    near(after.shape.center.x, b.shape.center.x, 0.01);
  });

  it("circles hold the edge opposite the handle on one axis and stay centred on the other", () => {
    const text = pic("\\node[draw, circle] (a) at (0,0) {A};");
    const a = node(text, "a");
    const before = edges(a);
    const r = resize(text, "a", { w: 2 * a.shape.hw + 20 * MM }, E);
    const after = edges(node(r.text, "a"));
    near(after.l, before.l);
    near((after.t + after.b) / 2, (before.t + before.b) / 2, 0.01);
  });

  it("leaves a node whose position is locked growing from its anchor, and says so", () => {
    const text = pic("\\node[draw, right=of nothing] (a) {Hello};");
    const a = node(text, "a");
    expect(a.lock).toBeDefined();
    expect(resizeBlocker(a)).toBeNull();
    // Dragging the west side holds the east edge, which the anchor (west) does not.
    const r = resize(text, "a", { w: 2 * a.shape.hw + 20 * MM }, { x: 1, y: 0 });
    expect(r.position).toBeUndefined();
    expect(r.notes.join(" ")).toMatch(/locked/);
    expect(r.text).toContain("right=of nothing");
  });

  it("without a hold, behaves as before: the node grows around its anchor", () => {
    const text = pic("\\node[draw] (a) at (0,0) {Hello};");
    const a = node(text, "a");
    const r = resize(text, "a", { w: 2 * a.shape.hw + 20 * MM }, undefined);
    near(node(r.text, "a").shape.center.x, a.shape.center.x, 0.01);
    expect(r.position).toBeUndefined();
  });

  it("in style scope the dragged node holds its edge while every user of the style resizes", () => {
    const text = pic(
      "\\tikzset{process/.style={draw, rectangle}}\n\\node[process] (a) at (0,0) {Hello};\n\\node[process] (b) at (4,0) {There};",
    );
    const a = node(text, "a");
    const before = edges(a);
    const r = resize(text, "a", { w: 2 * a.shape.hw + 20 * MM }, E, { kind: "style", name: "process" });
    const after = edges(node(r.text, "a"));
    near(after.l, before.l);
    near(after.r, before.r + 20 * MM);
    // The other node takes the style's new minimum width and grows around its own centre.
    near(node(r.text, "b").shape.hw * 2, node(r.text, "a").shape.hw * 2, 0.01);
    expect(r.text).toContain("process/.style={draw, rectangle, minimum width=");
  });
});

describe("holding an edge across the corpus", () => {
  it("every resizable, unlocked node of the research figure grows east with its west edge held, in one edit", () => {
    const text = loadCorpusFile("self-hybrid-surrogate.tex").text;
    const l = layout(text);
    let held = 0;
    let positioned = 0;
    for (const n of l.nodes.filter((x) => x.kind === "statement" && !x.lock && !resizeBlocker(x))) {
      const doc = analyzeDocument(text);
      const r = planResize(doc, 0, layoutDocumentPicture(doc, 0)!, n.id, { w: 2 * n.shape.hw + 10 * MM }, { kind: "nodes", ids: [n.id] }, E);
      if (!r.ok) continue;
      expect(applyChanges(text, r.changes), n.id).toBe(r.text);
      const after = r.layout.nodes.find((x) => x.id === n.id)!;
      const target = edges(n).l;
      if (Math.abs(edges(after).l - target) <= 1.1 * MM) held++;
      if (r.position) positioned++;
      // Nothing outside the node's statement and the preamble changes.
      const d = diffRange(text, r.text);
      if (d && !r.notes.some((x) => /positioning/.test(x))) {
        expect(d.from, n.id).toBeGreaterThanOrEqual(n.statement.from);
        expect(d.to, n.id).toBeLessThanOrEqual(n.statement.to);
      }
    }
    expect(held).toBeGreaterThan(10);
    expect(positioned).toBeGreaterThan(0);
  });
});
