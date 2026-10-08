// Milestone 2b step 3: anchors. Moving an end to another anchor or to the
// border, reconnecting it to another node, and drawing new edges.
import { describe, expect, it } from "vitest";
import { applyChanges, diffRange } from "../src/edit/changes.ts";
import { edgeHead } from "../src/edit/create.ts";
import { endBlocker, findEdge, planConnect, planEnd } from "../src/edit/edges.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import { type Edge, pictureEdges } from "../src/model/edges.ts";
import type { PictureLayout } from "../src/tikz/layout.ts";
import { SAMPLE } from "../src/ui/sample.ts";
import { corpusNames, loadCorpusFile } from "./corpus.ts";

const NODES = "\\node (a) at (0,0) {A};\n\\node (b) at (4,-2) {B};\n\\node (c) at (1,-4) {C};";
const pic = (body: string) => `\\begin{tikzpicture}\n${NODES}\n${body}\n\\end{tikzpicture}\n`;
const layoutOf = (text: string): PictureLayout => layoutDocumentPicture(analyzeDocument(text), 0)!;
const edges = (text: string): Edge[] => pictureEdges(layoutOf(text));
const id = (l: PictureLayout, name: string) => l.nodes.find((n) => n.name === name)!.id;
const drawLines = (text: string) => text.split("\n").filter((l) => l.trimStart().startsWith("\\draw"));

function end(text: string, edgeIndex: number, which: "from" | "to", node: string, anchor?: string) {
  const l = layoutOf(text);
  const e = pictureEdges(l)[edgeIndex]!;
  const r = planEnd(text, 0, e.id, which, anchor ? { node: id(l, node), anchor } : { node: id(l, node) });
  if (!r.ok) throw new Error(r.reason);
  expect(applyChanges(text, r.changes)).toBe(r.text);
  return r;
}

describe("moving an end", () => {
  it("attaches it to another anchor, changing only that end's text", () => {
    const text = pic("\\draw[->] (a) -- (b);");
    const r = end(text, 0, "to", "b", "west");
    expect(drawLines(r.text)).toEqual(["\\draw[->] (a) -- (b.west);"]);
    expect(diffRange(text, r.text)).toEqual({ from: text.indexOf("(b);") + 2, to: text.indexOf("(b);") + 2, insert: ".west" });
  });

  it("takes it back to the border", () => {
    const r = end(pic("\\draw[->] (a.east) -- (b.north west);"), 0, "from", "a");
    expect(drawLines(r.text)).toEqual(["\\draw[->] (a) -- (b.north west);"]);
  });

  it("reconnects it to another node", () => {
    const text = pic("\\draw[->] (a) -- node[above] {x} (b);");
    const r = end(text, 0, "to", "c", "north");
    expect(drawLines(r.text)).toEqual(["\\draw[->] (a) -- node[above] {x} (c.north);"]);
    const e = findEdge(r.layout, edges(text)[0]!.id)!;
    expect([e.source, e.target]).toEqual(["a", "c"]);
  });

  it("keeps the points after it where they were", () => {
    const text = pic("\\draw[->] (a.east) -- ++(5mm,0) |- (c);");
    const before = edges(text)[0]!.route.stops[1]!.point;
    const r = end(text, 0, "from", "a", "north east");
    const e = findEdge(r.layout, edges(text)[0]!.id)!;
    const after = e.route.stops[1]!.point;
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(0.2);
    expect(drawLines(r.text)[0]).toMatch(/^\\draw\[->\] \(a\.north east\) -- \+\+\([^)]*\) \|- \(c\);$/);
  });

  it("refuses a node defined after the edge, and says why", () => {
    const text = `\\begin{tikzpicture}\n${NODES}\n\\draw (a) -- (b);\n\\node (d) at (0,-6) {D};\n\\end{tikzpicture}\n`;
    const l = layoutOf(text);
    const r = planEnd(text, 0, pictureEdges(l)[0]!.id, "to", { node: id(l, "d") });
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/comes after this edge/) });
  });

  it("refuses an end shared with the next edge, the node a \\node ... edge starts from, and both ends on one node", () => {
    const shared = edges(pic("\\draw (a) -- (b) -- (c);"));
    expect(endBlocker(shared[0]!, "to")).toMatch(/shared with the edge after it/);
    expect(endBlocker(shared[1]!, "from")).toMatch(/shared with the edge before it/);
    expect(endBlocker(shared[0]!, "from")).toBeNull();
    const fromNode = edges(pic("\\node (d) at (0,-6) {D} edge (c);"))[0]!;
    expect(endBlocker(fromNode, "from")).toMatch(/\\node ... edge/);
    const text = pic("\\draw (a) -- (b);");
    const l = layoutOf(text);
    expect(planEnd(text, 0, pictureEdges(l)[0]!.id, "to", { node: id(l, "a") })).toMatchObject({ ok: false });
  });
});

describe("drawing a new edge", () => {
  it("writes it like the picture's other connections, after the last path", () => {
    const text = pic("\\draw[-latex] (a) -- (b);");
    const l = layoutOf(text);
    const doc = analyzeDocument(text);
    const r = planConnect(text, 0, { node: id(l, "b") }, { node: id(l, "c") }, edgeHead(doc, l));
    if (!r.ok) throw new Error(r.reason);
    expect(drawLines(r.text)).toEqual(["\\draw[-latex] (a) -- (b);", "\\draw[-latex] (b) -- (c);"]);
    expect(findEdge(r.layout, r.edgeId)).toMatchObject({ source: "b", target: "c" });
  });

  it("uses the anchors it was drawn between", () => {
    const text = pic("");
    const l = layoutOf(text);
    const r = planConnect(text, 0, { node: id(l, "a"), anchor: "east" }, { node: id(l, "b"), anchor: "north" }, "\\draw[->]");
    if (!r.ok) throw new Error(r.reason);
    expect(drawLines(r.text)).toEqual(["\\draw[->] (a.east) -- (b.north);"]);
  });

  it("names unnamed nodes in the same edit, and goes after nodes defined after the paths", () => {
    const text = "\\begin{tikzpicture}\n\\node (a) {A};\n\\draw (a) -- (1,1);\n\\node at (3,0) {Next step};\n\\end{tikzpicture}\n";
    const l = layoutOf(text);
    const r = planConnect(text, 0, { node: id(l, "a") }, { node: l.nodes[1]!.id }, "\\draw[->]");
    if (!r.ok) throw new Error(r.reason);
    expect(r.text).toBe("\\begin{tikzpicture}\n\\node (a) {A};\n\\draw (a) -- (1,1);\n\\node (nextStep) at (3,0) {Next step};\n\\draw[->] (a) -- (nextStep);\n\\end{tikzpicture}\n");
    expect(r.notes.join(" ")).toMatch(/named a node nextStep/);
  });

  it("refuses an edge from a node to itself", () => {
    const text = pic("");
    const l = layoutOf(text);
    expect(planConnect(text, 0, { node: id(l, "a") }, { node: id(l, "a") }, "\\draw[->]")).toMatchObject({ ok: false });
  });

  it("connects the sample's nodes without touching anything else", () => {
    const l = layoutOf(SAMPLE);
    const r = planConnect(SAMPLE, 0, { node: "base" }, { node: "rec", anchor: "east" }, edgeHead(analyzeDocument(SAMPLE), l));
    if (!r.ok) throw new Error(r.reason);
    expect(r.text).toBe(SAMPLE.replace("(base)  |- (stop);", "(base)  |- (stop);\n  \\draw[->] (base) -- (rec.east);"));
  });
});

describe("the corpus", () => {
  it("moves the end of every editable edge to another anchor of its node, or refuses with a reason", () => {
    let done = 0;
    let tried = 0;
    for (const name of corpusNames()) {
      const text = loadCorpusFile(name).text;
      const doc = analyzeDocument(text);
      doc.syntax.pictures.forEach((_, i) => {
        const l = layoutDocumentPicture(doc, i)!;
        for (const e of pictureEdges(l)) {
          if (!e.target || endBlocker(e, "to")) continue;
          const stop = e.route.stops[e.to]!;
          tried++;
          const r = planEnd(text, i, e.id, "to", { node: e.target, anchor: stop.anchor === "north" ? "south" : "north" });
          if (!r.ok) {
            expect(r.reason, name).toBeTruthy();
            continue;
          }
          done++;
          const d = diffRange(text, r.text)!;
          expect(d.from, name).toBeGreaterThanOrEqual(e.path.syntax.from);
          expect(d.to, name).toBeLessThanOrEqual(e.path.syntax.to);
        }
      });
    }
    expect(tried).toBeGreaterThan(100);
    expect(done / tried).toBeGreaterThan(0.9);
  });
});
