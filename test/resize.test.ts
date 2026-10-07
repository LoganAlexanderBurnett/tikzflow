// Milestone 2a step 4: resizing nodes. The sizes written are round, the node
// ends up the size that was asked for (to the millimetre), nothing else
// changes, and text rewraps only when the drag should rewrap it.
import { describe, expect, it } from "vitest";
import { diffRange } from "../src/edit/changes.ts";
import { planResize, resizeBlocker, type SizeWant } from "../src/edit/resize.ts";
import type { Scope } from "../src/edit/properties.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import type { LaidOutNode, PictureLayout } from "../src/tikz/layout.ts";
import { PT_PER_UNIT } from "../src/tikz/units.ts";
import { SAMPLE } from "../src/ui/sample.ts";
import { loadCorpusFile } from "./corpus.ts";

const MM = PT_PER_UNIT.mm!;
const pic = (body: string, opts = "") => `\\begin{tikzpicture}${opts}\n${body}\n\\end{tikzpicture}\n`;

function layout(text: string): PictureLayout {
  return layoutDocumentPicture(analyzeDocument(text), 0)!;
}
const node = (text: string, id: string): LaidOutNode => layout(text).nodes.find((n) => n.id === id)!;
const size = (n: LaidOutNode) => ({ w: 2 * n.shape.hw, h: 2 * n.shape.hh });

function resize(text: string, id: string, want: SizeWant, scope: Scope = { kind: "nodes", ids: [id] }) {
  const doc = analyzeDocument(text);
  return planResize(doc, 0, layoutDocumentPicture(doc, 0)!, id, want, scope);
}

function ok(text: string, id: string, want: SizeWant, scope?: Scope) {
  const r = resize(text, id, want, scope);
  if (!r.ok) throw new Error(r.reason);
  return r;
}

describe("widening and heightening", () => {
  it("writes a whole-millimetre minimum width and height", () => {
    const text = pic("\\node[draw] (a) at (0,0) {Hello};");
    const n = node(text, "a");
    const r = ok(text, "a", { w: size(n).w + 31.37, h: size(n).h + 20.19 });
    expect(r.text).toMatch(/\\node\[draw, minimum width=\d+(\.\d)?(mm|cm), minimum height=\d+(\.\d)?(mm|cm)\] \(a\) at \(0,0\) \{Hello\};/);
    const after = size(node(r.text, "a"));
    expect(Math.abs(after.w - (size(n).w + 31.37))).toBeLessThan(0.6 * MM);
    expect(Math.abs(after.h - (size(n).h + 20.19))).toBeLessThan(0.6 * MM);
    expect(r.written.length).toBe(2);
  });

  it("only touches the node's own options", () => {
    const text = pic("% keep me\n\\node (b) at (0,0) {B}; % and me\n\\node[draw] (a) at (3,0) {Hello};\n\\draw (a) -- (b);");
    const r = ok(text, "a", { w: 120 });
    const d = diffRange(text, r.text)!;
    const a = node(text, "a");
    expect(d.from).toBeGreaterThanOrEqual(a.statement.from);
    expect(d.to).toBeLessThanOrEqual(a.statement.to);
  });

  it("updates an existing minimum width in place", () => {
    const text = pic("\\node[draw, minimum width=3cm, fill=red] (a) at (0,0) {Hello};");
    const r = ok(text, "a", { w: 5 * 10 * MM });
    expect(r.text).toContain("\\node[draw, minimum width=5cm, fill=red] (a)");
  });

  it("never writes raw measured values", () => {
    const text = pic("\\node[draw] (a) at (0,0) {Hello};");
    for (const w of [91.2345678, 100.00001, 133.7, 150.5555]) {
      const r = ok(text, "a", { w, h: w / 2 });
      for (const item of r.written) expect(item).toMatch(/^[a-z ]+=\d+(\.\d)?(mm|cm)$/);
      expect(r.text).not.toMatch(/\d{4,}/);
    }
  });

  it("overrides a minimum width that a style gives", () => {
    const text = pic("\\node[box] (a) at (0,0) {Hello};", "[box/.style={draw,minimum width=4cm}]");
    const r = ok(text, "a", { w: 6 * 10 * MM });
    expect(r.text).toContain("\\node[box, minimum width=6cm] (a)");
  });

  it("goes back to the natural width when asked for less than the text", () => {
    const text = pic("\\node[draw, minimum width=4cm] (a) at (0,0) {Hello};");
    const natural = node(text, "a").sizing.natural.w;
    const r = ok(text, "a", { w: natural - 5 });
    expect(Math.abs(size(node(r.text, "a")).w - natural)).toBeLessThan(MM);
  });

  it("can't make a box shorter than its text", () => {
    const text = pic("\\node[draw] (a) at (0,0) {Hello};");
    const n = node(text, "a");
    const r = ok(text, "a", { h: 2 });
    expect(r.changes).toEqual([]);
    expect(size(node(r.text, "a")).h).toBeCloseTo(size(n).h, 5);
  });
});

describe("rewrapping", () => {
  const long = "\\node[draw] (a) at (0,0) {Read the input data from the file};";

  it("narrowing a one-line label sets a text width and wraps it", () => {
    const text = pic(long);
    const before = node(text, "a");
    const r = ok(text, "a", { w: size(before).w / 2 });
    expect(r.text).toMatch(/\\node\[draw, text width=\d+(\.\d)?(mm|cm)\] \(a\)/);
    const after = node(r.text, "a");
    expect(after.text!.lines.length).toBeGreaterThan(1);
    expect(size(after).w).toBeLessThan(size(before).w * 0.7);
  });

  it("widening a node that has a text width widens the text width", () => {
    const text = pic("\\node[draw, text width=2cm] (a) at (0,0) {Read the input data from the file};");
    const before = node(text, "a");
    const r = ok(text, "a", { w: size(before).w + 20 * MM });
    expect(r.text).toMatch(/\\node\[draw, text width=4cm\] \(a\)/);
    expect(node(r.text, "a").text!.lines.length).toBeLessThan(before.text!.lines.length);
  });

  it("never narrows the text below its widest word", () => {
    const text = pic("\\node[draw, text width=3cm] (a) at (0,0) {Extraordinarily wide word};");
    const r = ok(text, "a", { w: 5 });
    const after = node(r.text, "a");
    for (const l of after.text!.lines) expect(l.width).toBeLessThanOrEqual(after.text!.width + 0.01);
  });

  it("does not wrap a single word that can't break", () => {
    const text = pic("\\node[draw] (a) at (0,0) {Start};");
    const r = ok(text, "a", { w: 10 });
    expect(r.text).not.toContain("text width");
  });

  it("changes a minimum width that would keep a narrowed box wide", () => {
    const text = pic("\\node[draw, text width=4cm, minimum width=5cm] (a) at (0,0) {Read the input data from the file};");
    const r = ok(text, "a", { w: 3 * 10 * MM });
    expect(Math.abs(size(node(r.text, "a")).w - 30 * MM)).toBeLessThan(1.5 * MM);
  });
});

describe("shapes", () => {
  it("circles resize by diameter with minimum size", () => {
    const text = pic("\\node[circle, draw] (c) at (0,0) {A};", "", );
    const r = ok(text, "c", { w: 40 * MM, h: 30 * MM });
    expect(r.text).toContain("\\node[circle, draw, minimum size=4cm] (c)");
    expect(Math.abs(size(node(r.text, "c")).w - 40 * MM)).toBeLessThan(MM);
  });

  it("diamonds and rounded rectangles reach the size asked for", () => {
    const text = pic("\\node[diamond, draw] (d) at (0,0) {Go?};\n\\node[rounded rectangle, draw] (r) at (4,0) {Done};");
    // These two need their libraries; the layout draws them anyway.
    for (const id of ["d", "r"]) {
      const n = node(text, id);
      const r = ok(text, id, { w: size(n).w + 18 * MM, h: size(n).h + 9 * MM });
      const after = size(node(r.text, id));
      expect(Math.abs(after.w - (size(n).w + 18 * MM))).toBeLessThan(1.1 * MM);
      expect(Math.abs(after.h - (size(n).h + 9 * MM))).toBeLessThan(1.1 * MM);
    }
  });

  it("a node placed with an anchor keeps its anchor point fixed", () => {
    const text = pic("\\node (a) at (0,0) {A};\n\\node[draw, below=of a] (b) {B};");
    const before = node(text, "b");
    const r = ok(text, "b", { w: size(before).w + 20 * MM, h: size(before).h + 20 * MM });
    const after = node(r.text, "b");
    // below=of a puts b's north anchor under a: the top edge stays put.
    expect(after.shape.center.y + after.shape.hh).toBeCloseTo(before.shape.center.y + before.shape.hh, 1);
    expect(after.shape.center.x).toBeCloseTo(before.shape.center.x, 1);
  });
});

describe("refusals", () => {
  it("fit nodes have no size to drag", () => {
    const text = pic("\\node (a) at (0,0) {A};\n\\node (b) at (2,0) {B};\n\\node[draw, fit=(a) (b)] (box) {};");
    const n = node(text, "box");
    expect(resizeBlocker(n)).toMatch(/fits/);
    expect(resize(text, "box", { w: 100 }).ok).toBe(false);
  });

  it("shapes the preview only approximates can't be dragged", () => {
    const text = pic("\\node[star, draw] (s) at (0,0) {S};");
    expect(resizeBlocker(node(text, "s"))).toMatch(/approximately/);
  });

  it("a size from a style argument is left to the code", () => {
    const text = pic("\\node[box=3cm] (a) at (0,0) {Hello};", "[box/.style={draw,minimum width=#1}]");
    const r = resize(text, "a", { w: 120 }, { kind: "style", name: "box" });
    expect(r.ok).toBe(false);
  });
});

describe("style scope", () => {
  const text = pic("\\node[proc] (a) at (0,0) {Alpha};\n\\node[proc] (b) at (0,-2) {Beta};\n\\node[proc, minimum width=9cm] (c) at (0,-4) {Gamma};", "[proc/.style={draw, minimum width=3cm}]");

  it("edits the style in place, so every node using it changes", () => {
    const r = ok(text, "a", { w: 5 * 10 * MM }, { kind: "style", name: "proc" });
    expect(r.text).toContain("proc/.style={draw, minimum width=5cm}");
    expect(r.text).toContain("\\node[proc] (a)");
    expect(Math.abs(size(node(r.text, "b")).w - 50 * MM)).toBeLessThan(MM);
    expect(r.notes.join(" ")).toMatch(/1 of the 3 proc nodes set their own size/);
  });

  it("appends the width to a style that has none", () => {
    const t = pic("\\node[proc] (a) at (0,0) {Alpha};", "[proc/.style={draw}]");
    const r = ok(t, "a", { w: 50 * MM }, { kind: "style", name: "proc" });
    expect(r.text).toContain("proc/.style={draw, minimum width=5cm}");
  });

  it("says so when the node sets its own size and the style can't change it", () => {
    const r = resize(text, "c", { w: 5 * 10 * MM }, { kind: "style", name: "proc" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/sets its own size/);
  });
});

describe("the sample and the corpus", () => {
  it("resizes every statement node of the sample, one at a time, without touching anything else", () => {
    const l = layout(SAMPLE);
    for (const n of l.nodes.filter((x) => x.kind === "statement" && !resizeBlocker(x))) {
      const r = resize(SAMPLE, n.id, { w: size(n).w + 10 * MM, h: size(n).h + 6 * MM });
      expect(r.ok, n.id).toBe(true);
      if (!r.ok) continue;
      const d = diffRange(SAMPLE, r.text)!;
      expect(d.from, n.id).toBeGreaterThanOrEqual(n.statement.from);
      expect(d.to, n.id).toBeLessThanOrEqual(n.statement.to);
      for (const other of r.layout.nodes) if (other.id !== n.id) expect(other.id).toBeTruthy();
    }
  });

  it("every resizable node of the research figure widens by 1 cm", () => {
    const text = loadCorpusFile("self-hybrid-surrogate.tex").text;
    const l = layout(text);
    let done = 0;
    for (const n of l.nodes.filter((x) => x.kind === "statement" && !resizeBlocker(x))) {
      const r = resize(text, n.id, { w: size(n).w + 10 * MM });
      if (!r.ok) continue;
      done++;
      const d = diffRange(text, r.text);
      if (d) {
        expect(d.from, n.id).toBeGreaterThanOrEqual(n.statement.from);
        expect(d.to, n.id).toBeLessThanOrEqual(n.statement.to);
      }
      for (const item of r.written) expect(item, n.id).toMatch(/^[a-z ]+=\d+(\.\d)?(mm|cm)$/);
    }
    expect(done).toBeGreaterThan(15);
  });
});
