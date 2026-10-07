// Milestone 2a step 2: fixes from testing Milestone 1. Locked-node
// explanations and one-click fixes, syntax errors, undefined references,
// unused coordinates, and the marker for options the preview can't draw.
import { describe, expect, it } from "vitest";
import { diffRange } from "../src/edit/changes.ts";
import { attachCandidates, planAttach, planPin } from "../src/edit/move.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import { closestName, explainLock, undrawable } from "../src/model/explain.ts";
import { coordNames, unresolvedReferences, unusedCoordinates } from "../src/model/references.ts";
import { summarize } from "../src/model/summary.ts";
import type { LaidOutNode, PictureLayout } from "../src/tikz/layout.ts";
import { loadCorpusFile } from "./corpus.ts";

const pic = (body: string, opts = "") => `\\begin{tikzpicture}${opts}\n${body}\n\\end{tikzpicture}\n`;

function layout(text: string, index = 0): PictureLayout {
  const l = layoutDocumentPicture(analyzeDocument(text), index);
  if (!l) throw new Error("no picture");
  return l;
}

function node(l: PictureLayout, id: string): LaidOutNode {
  const n = l.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`no node ${id}`);
  return n;
}

function unresolved(text: string) {
  const doc = analyzeDocument(text);
  return unresolvedReferences(text, doc.syntax.pictures[0]!, layout(text)).map((u) => `${u.name}:${u.kind}:${u.refs.length}`);
}

const hybrid = loadCorpusFile("self-hybrid-surrogate.tex").text;

describe("coordNames", () => {
  it("finds the names a coordinate refers to", () => {
    expect(coordNames("a").map((r) => r.name)).toEqual(["a"]);
    expect(coordNames("a.north east").map((r) => r.name)).toEqual(["a"]);
    expect(coordNames("a.south -| b.west").map((r) => r.name)).toEqual(["a", "b"]);
    expect(coordNames("$(a)!0.5!(b.east)$").map((r) => r.name)).toEqual(["a", "b"]);
    expect(coordNames("[xshift=2mm,yshift=-1mm]model.north west").map((r) => r.name)).toEqual(["model"]);
  });
  it("ignores numbers, polar coordinates and macros", () => {
    expect(coordNames("1,2")).toEqual([]);
    expect(coordNames("30:1cm")).toEqual([]);
    expect(coordNames("\\x,0")).toEqual([]);
    expect(coordNames("n\\i")).toEqual([]);
    expect(coordNames("2cm")).toEqual([]);
  });
  it("gives offsets of the names", () => {
    const inner = "[xshift=2mm] a.east |- b";
    expect(coordNames(inner).map((r) => inner.slice(r.at, r.at + r.name.length))).toEqual(["a", "b"]);
  });
});

describe("undefined references", () => {
  it("lists the four in the research figure, including those in paths", () => {
    expect(unresolved(hybrid)).toEqual(["model:undefined:1", "prevkinleft:undefined:1", "pkin:undefined:1", "outkin:undefined:2"]);
  });

  it("tells names defined later from names never defined", () => {
    expect(unresolved(pic("\\draw (a) -- (b);\n\\node (a) {A};"))).toEqual(["a:later:1", "b:undefined:1"]);
  });

  it("never reports names that code kept as-is may define", () => {
    const loop = pic("\\foreach \\i in {1,2} \\node (n\\i) at (\\i,0) {};\n\\draw (n1) -- (n2);");
    expect(unresolved(loop)).toEqual([]);
    const matrix = pic("\\matrix (m) [matrix of nodes] { a \\\\ b \\\\ };\n\\draw (m-1-1) -- (m-2-1);");
    expect(unresolved(matrix)).toEqual([]);
  });

  it("knows TikZ's own names and remember picture", () => {
    expect(unresolved(pic("\\node (a) {A};\n\\draw (a) -- (current bounding box.north);"))).toEqual([]);
    expect(unresolved(pic("\\draw (other) -- (1,1);", "[remember picture]"))).toEqual([]);
  });

  it("counts a coordinate on a path that stopped drawing as defined", () => {
    expect(unresolved(pic("\\draw (missing) -- (1,0) coordinate (c);\n\\draw (c) -- (2,2);"))).toEqual(["missing:undefined:1"]);
  });

  it("is in the summary", () => {
    const doc = analyzeDocument(hybrid);
    const s = summarize(doc, layout(hybrid));
    expect(s.unresolved.map((u) => u.name)).toEqual(["model", "prevkinleft", "pkin", "outkin"]);
    expect(s.main).toBe("33 nodes of 34 and 10 edges editable; 2 blocks kept as-is");
    expect(s.headline).toBe(`${s.main}; 2 syntax errors`);
  });
});

describe("syntax errors", () => {
  it("records where each error is, once per place", () => {
    const doc = analyzeDocument(hybrid);
    const lines = doc.errors.map((e) => hybrid.slice(0, e.from).split("\n").length);
    expect(lines).toEqual([91, 256]);
    expect(doc.errorCount).toBe(2);
    const broken = analyzeDocument(loadCorpusFile("self-broken.tex").text);
    expect(broken.errorCount).toBe(broken.errors.length);
    expect(new Set(broken.errors.map((e) => e.from)).size).toBe(broken.errors.length);
  });
});

describe("locked nodes", () => {
  it("explain an undefined reference and say LaTeX would fail too", () => {
    const text = pic("\\node (a) {A};\n\\node[below=of b] (c) {C};");
    const l = layout(text);
    const c = node(l, "c");
    expect(c.lock).toMatchObject({ kind: "undefined-ref", ref: "b" });
    const help = explainLock(l, c, ["a"])!;
    expect(help.title).toBe('"b" doesn\'t exist');
    expect(help.body).toContain("LaTeX would stop here too");
    expect(help.canPin && help.canAttach).toBe(true);
  });

  it("explain a reference to a node defined later", () => {
    const text = pic("\\node[below=of b] (c) {C};\n\\node (b) {B};");
    const l = layout(text);
    const help = explainLock(l, node(l, "c"))!;
    expect(help.title).toBe('"b" comes later in the code');
    expect(help.body).toContain("only defined further down");
  });

  it("don't blame the code for references into blocks kept as-is", () => {
    const text = pic("\\matrix (m) [matrix of nodes] { a \\\\ };\n\\node[below=of m-1-1] (c) {C};");
    const l = layout(text);
    const help = explainLock(l, node(l, "c"))!;
    expect(node(l, "c").lock?.kind).toBe("opaque-ref");
    expect(help.body).toContain("LaTeX handles that fine");
    expect(help.canPin || help.canAttach).toBe(false);
  });

  it("suggest the name that was probably meant", () => {
    expect(closestName("pkin", ["temporal", "pkin2", "pke"])).toBe("pkin2");
    expect(closestName("outkin", ["kout", "outstate"])).toBeUndefined();
    expect(closestName("modl", ["model", "mode"])).toBe("model");
  });

  it("pin at current position writes plain coordinates and unlocks the node", () => {
    const l = layout(hybrid);
    const locked = l.nodes.find((n) => n.lock?.kind === "undefined-ref")!;
    const r = planPin(hybrid, 0, locked.id)!;
    expect(r).not.toBeNull();
    const d = diffRange(hybrid, r.text)!;
    // Only the at clause changed; the anchor and the label stay.
    expect(hybrid.slice(d.from, d.to)).toContain("model.north west");
    expect(d.from).toBeGreaterThanOrEqual(locked.statement.from);
    expect(d.to).toBeLessThanOrEqual(locked.statement.to);
    expect(r.text).toMatch(/\\node\[lab, anchor=north west\] at \([\d.-]+,[\d.-]+\)\r?\n {2}\{Hybrid Physics\+ML Surrogate/);
    const after = node(layout(r.text), locked.id);
    expect(after.locked).toBeUndefined();
    expect(Math.hypot(after.shape.center.x - locked.shape.center.x, after.shape.center.y - locked.shape.center.y)).toBeLessThan(1);
  });

  it("pinning with a position writes the drop position, not the drawn one", () => {
    const text = pic("\\node (a) {A};\n\\node[draw, below=of b, fill=red] (c) {C};");
    const r = planPin(text, 0, "c", { x: 85.35, y: -56.9 })!;
    expect(r.text).toMatch(/\\node\[draw, fill=red\] \(c\) at \(3,-2\) \{C\};/);
    const after = node(layout(r.text), "c");
    expect(after.locked).toBeUndefined();
    expect(after.shape.center.x).toBeCloseTo(85.35, 0);
    expect(after.shape.center.y).toBeCloseTo(-56.9, 0);
  });

  it("pinning at a drop position accounts for the node's anchor", () => {
    const l = layout(hybrid);
    const locked = l.nodes.find((n) => n.lock?.kind === "undefined-ref")!;
    const want = { x: locked.shape.center.x + 40, y: locked.shape.center.y - 28 };
    const r = planPin(hybrid, 0, locked.id, want)!;
    expect(r.text).toContain("anchor=north west] at (");
    const after = node(layout(r.text), locked.id);
    expect(Math.hypot(after.shape.center.x - want.x, after.shape.center.y - want.y)).toBeLessThan(1.5);
    expect(after.locked).toBeUndefined();
  });

  it("pin replaces an unresolved positioning option", () => {
    const text = pic("\\node (a) {A};\n\\node[draw, below=of b, fill=red] (c) {C};");
    const r = planPin(text, 0, "c")!;
    expect(r.text).toMatch(/\\node\[draw, fill=red\] \(c\) at \([\d.-]+,[\d.-]+\) \{C\};/);
  });

  it("attach to another node renames the reference and keeps the rest", () => {
    const text = pic("\\node (a) {A};\n\\node (a2) at (2,0) {A2};\n\\node[draw, below=5mm of b, xshift=1mm] (c) {C};");
    const l = layout(text);
    expect(attachCandidates(l, node(l, "c")).map((n) => n.name)).toEqual(["a", "a2"]);
    const r = planAttach(text, 0, "c", "b", "a2")!;
    expect(r.text).toContain("\\node[draw, below=5mm of a2, xshift=1mm] (c) {C};");
    expect(node(layout(r.text), "c").locked).toBeUndefined();
  });

  it("attach works inside an at clause with options and anchors", () => {
    const r = planAttach(hybrid, 0, layout(hybrid).nodes.find((n) => n.lock?.ref === "model")!.id, "model", "v1")!;
    expect(r.text).toContain("at ([xshift=2mm,yshift=-1mm]v1.north west)");
  });

  it("attach is refused when the node would stay locked", () => {
    const text = pic("\\node[below=of b] (c) {C};\n\\node (d) {D};");
    expect(planAttach(text, 0, "c", "b", "d")).toBeNull();
  });
});

describe("coordinates", () => {
  it("are unused when nothing refers to them", () => {
    const doc = analyzeDocument(hybrid);
    const l = layout(hybrid);
    const unused = unusedCoordinates(hybrid, doc.syntax.pictures[0]!, l);
    expect([...unused].sort()).toEqual(["v1", "v2", "v3"]);
  });

  it("count uses in code kept as-is", () => {
    const text = pic("\\coordinate (o) at (0,0);\n\\coordinate (p) at (1,0);\n\\foreach \\i in {1,2} \\draw (o) -- (\\i,1);");
    const doc = analyzeDocument(text);
    expect([...unusedCoordinates(text, doc.syntax.pictures[0]!, layout(text))]).toEqual(["p"]);
  });
});

describe("undrawable options", () => {
  it("lists options and shapes the preview can't draw", () => {
    const text = pic("\\node[draw, double, star] (a) {A};\n\\node[draw, decorate, decoration=zigzag] (b) {B};\n\\node[draw] (c) {C};");
    const l = layout(text);
    expect(undrawable(node(l, "a"))).toEqual(["double", "the star shape (drawn as a rectangle)"]);
    expect(undrawable(node(l, "b"))).toEqual(["decorate", "decoration"]);
    expect(undrawable(node(l, "c"))).toEqual([]);
  });
});
