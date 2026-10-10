import { describe, expect, it } from "vitest";
import { applyChanges } from "../src/edit/changes.ts";
import { chainPlaced, planChainConversion, planChainMove } from "../src/edit/chains.ts";
import { planGroupMove } from "../src/edit/group.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import { loadCorpusFile } from "./corpus.ts";

const doc = (opts: string, body: string) =>
  `\\documentclass{article}\n\\usepackage{tikz}\n\\usetikzlibrary{positioning,chains}\n\\begin{document}\n\\begin{tikzpicture}[${opts}]\n${body}\n\\end{tikzpicture}\n\\end{document}\n`;

const layout = (text: string, pic = 0) => layoutDocumentPicture(analyzeDocument(text), pic)!;

function convert(text: string, id: string, pic = 0) {
  const r = planChainConversion(text, pic, id);
  if (!r.ok) throw new Error(r.reason);
  expect(applyChanges(text, r.changes)).toBe(r.text);
  // Nothing moves, and nothing the chain placed is still locked.
  const a = layout(text, pic);
  const b = layout(r.text, pic);
  a.nodes.forEach((n, i) => expect(Math.hypot(b.nodes[i]!.shape.center.x - n.shape.center.x, b.nodes[i]!.shape.center.y - n.shape.center.y), n.id).toBeLessThan(0.01));
  for (const id of r.converted) expect(b.nodes.find((n) => n.id === id)!.lock?.kind, id).not.toBe("chain");
  // Every node the chain placed is converted; other chains are left alone.
  const node = a.nodes.find((n) => n.id === id)!;
  expect(r.converted.length).toBe(chainPlaced(a, node).length);
  expect(b.nodes.filter((n) => n.lock?.kind === "chain").length).toBe(a.nodes.filter((n) => n.lock?.kind === "chain").length - r.converted.length);
  return r;
}

describe("the chain's placement in the interpreter", () => {
  it("a position written after on chain wins; one written before it doesn't", () => {
    const text = doc("start chain=going below, node distance=8mm", "\\node[on chain] (a) {A};\n\\node[on chain, right=of a] (b) {B};\n\\node[right=of b, on chain] (c) {C};");
    const l = layout(text);
    const node = (id: string) => l.nodes.find((n) => n.id === id)!;
    expect(node("b").chain?.placed).toBe(false);
    expect(node("b").locked).toBeUndefined();
    expect(node("c").chain?.placed).toBe(true);
    expect(node("c").lock?.kind).toBe("chain");
    // c goes below b, not right of it.
    expect(node("c").shape.center.x).toBeCloseTo(node("b").shape.center.x, 3);
  });

  it("every chain node, named or not, is also chain-n, and the latest is chain-end", () => {
    const text = doc("start chain=going right", "\\node[on chain] (a) {A};\n\\node[on chain] {B};\n\\node[below=of chain-1] (x) {X};\n\\node[below=of chain-end] (y) {Y};");
    const l = layout(text);
    expect(l.nodes.find((n) => n.id === "x")!.locked).toBeUndefined();
    expect(l.nodes.find((n) => n.id === "x")!.shape.center.x).toBeCloseTo(l.nodes.find((n) => n.id === "a")!.shape.center.x, 3);
    expect(l.nodes.find((n) => n.id === "y")!.shape.center.x).toBeCloseTo(l.nodes.find((n) => n.id === "chain-2")!.shape.center.x, 3);
  });
});

describe("planChainConversion", () => {
  it("writes each placed node's position after on chain, and keeps on chain and join", () => {
    const text = doc("start chain=going below, node distance=8mm", "\\node[draw, on chain] (a) {A};\n\\node[draw, on chain, join] (b) {B};\n\\node[draw, on chain, join] (c) {C};");
    const r = convert(text, "c");
    expect(r.text).toContain("\\node[draw, on chain, join, below=of a] (b) {B};");
    expect(r.text).toContain("\\node[draw, on chain, join, below=of b] (c) {C};");
    expect(r.text).toContain("\\node[draw, on chain] (a) {A};");
    expect(r.converted).toEqual(["b", "c"]);
    // The joins are still drawn.
    expect(layout(r.text).paths.filter((p) => p.id.startsWith("join@"))).toHaveLength(2);
  });

  it("names an unnamed node another one follows, from its label", () => {
    const text = doc("start chain=going right", "\\node[draw, on chain] (a) {A};\n\\node[draw, on chain] {Check input};\n\\node[draw, on chain] (c) {C};");
    const r = convert(text, "c");
    expect(r.named.map((n) => n.name)).toEqual(["checkInput"]);
    expect(r.text).toContain("\\node[draw, on chain, right=of a] (checkInput) {Check input};");
    expect(r.text).toContain("\\node[draw, on chain, right=of checkInput] (c) {C};");
    expect(r.ids.get("chain-2")).toBe("checkInput");
  });

  it("writes the chain's grid and distance when the node's own options change them after on chain", () => {
    const text = doc("start chain=going below, node distance=8mm", "\\node[draw, on chain] (a) {A};\n\\node[draw, on chain, on grid, node distance=15mm] (b) {B};");
    const r = convert(text, "b");
    expect(r.text).toMatch(/\\node\[draw, on chain, on grid, node distance=15mm, on grid=false, below=(8mm )?of a\] \(b\) \{B\};/);
  });

  it("a style that puts nodes on the chain (corpus: on chain, on grid in a style)", () => {
    const file = loadCorpusFile("se-382997-chains-indented.tex");
    const l = layout(file.text);
    const p1 = l.nodes.find((n) => n.id === "p1")!;
    expect(p1.lock?.kind).toBe("chain");
    const r = convert(file.text, "p1");
    // p4 and the others written with "right=of" were never placed by the chain.
    expect(r.converted).not.toContain("p4");
    expect(r.converted.length).toBe(chainPlaced(l, p1).length);
  });

  it("the chains corpus picture with \\chainin and named chains", () => {
    const file = loadCorpusFile("se-263754-chains.tex");
    const l = layout(file.text);
    for (const n of l.nodes.filter((x) => x.chain?.placed)) {
      const r = convert(file.text, n.id);
      expect(r.converted.length).toBeGreaterThan(0);
    }
  });

  it("dragging a chain node writes the chain out and moves the node, in one edit", () => {
    const text = doc("start chain=going below, node distance=8mm", "\\node[draw, on chain] (a) {A};\n\\node[draw, on chain, join] (b) {B};\n\\node[draw, on chain, join] (c) {C};");
    const l = layout(text);
    const b = l.nodes.find((n) => n.id === "b")!;
    const to = { x: b.shape.center.x + 2 * 28.4528, y: b.shape.center.y };
    const r = planChainMove(text, 0, "b", to);
    if (!r.ok) throw new Error(r.reason);
    expect(applyChanges(text, r.changes)).toBe(r.text);
    // b moved; c, placed below b, follows it.
    const after = layout(r.text);
    const node = (id: string) => after.nodes.find((n) => n.id === id)!;
    expect(node("b").shape.center.x).toBeCloseTo(to.x, 0);
    expect(node("c").shape.center.x).toBeCloseTo(to.x, 0);
    expect(r.text).toContain("\\node[draw, on chain, join, below=of b] (c) {C};");
    // 2 cm to the side of a small node is past the overlap: a diagonal (D24).
    expect(r.text).toContain("\\node[draw, on chain, join, below right=8mm and 1.5cm of a] (b) {B};");
  });

  it("a group drag with chain nodes in it writes their chain out first", () => {
    const text = doc("start chain=going below, node distance=8mm", "\\node[draw] (z) at (4,0) {Z};\n\\node[draw, on chain] (a) {A};\n\\node[draw, on chain] {B};\n\\node[draw, on chain] (c) {C};");
    const r = planGroupMove(text, 0, ["chain-2", "c"], { x: 28.4528, y: 0 });
    if (!r.ok) throw new Error(r.reason);
    expect(r.conversions).toHaveLength(1);
    expect(r.text).toContain("(b) {B};");
    expect(r.text).toContain("\\node[draw, on chain, below=of b] (c) {C};");
    const after = layout(r.text);
    const before = layout(text);
    const dx = (id: string, was: string) => after.nodes.find((n) => n.id === id)!.shape.center.x - before.nodes.find((n) => n.id === was)!.shape.center.x;
    expect(dx("b", "chain-2")).toBeCloseTo(28.4528, 0);
    expect(dx("c", "c")).toBeCloseTo(28.4528, 0);
    expect(dx("a", "a")).toBeCloseTo(0, 5);
  });

  it("a node the chain doesn't place needs nothing", () => {
    const text = doc("start chain=going below", "\\node[draw, on chain] (a) {A};\n\\node[draw, on chain] (b) {B};");
    const r = planChainConversion(text, 0, "a");
    expect(r.ok && r.changes).toEqual([]);
  });
});
