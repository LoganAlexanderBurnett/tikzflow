// Milestone 2b: the edge model. Routes tie each point and segment of a path
// to its code; paths split into node-to-node edges; labels belong to their
// edge; edges the editor can't rewrite are locked with a reason.
import { describe, expect, it } from "vitest";
import { planLabelEdit } from "../src/edit/label.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import { type Edge, edgeD, edgeTitle, pictureEdges } from "../src/model/edges.ts";
import { explainEdge } from "../src/model/explain.ts";
import type { PictureLayout } from "../src/tikz/layout.ts";
import { corpusNames, loadCorpusFile } from "./corpus.ts";

const pic = (body: string) => `\\begin{tikzpicture}\n${body}\n\\end{tikzpicture}\n`;
const NODES = "\\node (a) at (0,0) {A};\n\\node (b) at (3,0) {B};\n\\node (c) at (3,-2) {C};\n\\coordinate (k) at (1,-2);";

function edgesOf(text: string, index = 0): { layout: PictureLayout; edges: Edge[] } {
  const layout = layoutDocumentPicture(analyzeDocument(text), index)!;
  return { layout, edges: pictureEdges(layout) };
}

const titles = (text: string) => {
  const { layout, edges } = edgesOf(text);
  return edges.map((e) => edgeTitle(e, layout));
};

describe("routes", () => {
  it("tie each stop and segment to its code", () => {
    const text = pic(`${NODES}\n\\draw[->] (a.east) -- ++(5mm,0) |- (c);`);
    const p = edgesOf(text).layout.paths[0]!;
    const r = p.route!;
    expect(r.stops.map((s) => text.slice(s.range.from, s.range.to))).toEqual(["(a.east)", "++(5mm,0)", "(c)"]);
    expect(r.stops[0]).toMatchObject({ node: "a", anchor: "east" });
    expect(r.stops[1]).toMatchObject({ relative: "++" });
    expect(r.stops[2]).toMatchObject({ node: "c", bare: true });
    expect(r.segs.map((s) => [s.kind, s.a, s.b])).toEqual([
      ["line", 0, 1],
      ["vh", 1, 2],
    ]);
    // Each segment points at the operation that draws it.
    expect(r.segs.map((s) => p.syntax.items[s.op])).toMatchObject([
      { kind: "op", op: "--" },
      { kind: "op", op: "|-" },
    ]);
  });

  it("record control points, and the node a \\node ... edge path starts from", () => {
    const text = pic(`${NODES}\n\\draw (a) .. controls +(1,1) and +(-1,1) .. (b);\n\\node (d) at (0,-2) {D} edge[->] (c);`);
    const { layout } = edgesOf(text);
    const curve = layout.paths[0]!.route!;
    expect(curve.segs[0]!.kind).toBe("curve");
    expect(curve.segs[0]!.controls!.map((i) => layout.paths[0]!.syntax.items[i]!.kind)).toEqual(["coord", "coord"]);
    const fromNode = layout.paths.find((p) => p.id.includes("/edge"))!.route!;
    expect(fromNode.stops[0]).toMatchObject({ item: -1, node: "d", bare: true });
    expect(text.slice(fromNode.stops[0]!.range.from, fromNode.stops[0]!.range.to)).toBe("(d)");
  });

  it("mark shapes and paths the editor can't follow", () => {
    const { layout } = edgesOf(pic(`${NODES}\n\\draw (a) -- (b) -- (c) -- cycle;\n\\draw (a) rectangle (c);\n\\draw (a) -- (\\x,1);`));
    expect(layout.paths.map((p) => [p.route!.shapes, p.route!.broken])).toEqual([
      [true, false],
      [true, false],
      [false, true],
    ]);
  });
});

describe("edges", () => {
  it("split a path at every node it passes through", () => {
    expect(titles(pic(`${NODES}\n\\draw[->] (a) -- (b) -- (c);`))).toEqual(["a → b", "b → c"]);
    const { edges } = edgesOf(pic(`${NODES}\n\\draw[->] (a) -- (b) -- (c);`));
    expect(edges.map((e) => [e.sharedStart, e.sharedEnd])).toEqual([
      [false, true],
      [true, false],
    ]);
  });

  it("keep waypoints and coordinates inside one edge", () => {
    expect(titles(pic(`${NODES}\n\\draw (a) -- (1,1) -- (k) -- (c);`))).toEqual(["a → c"]);
    // An edge may end at a point rather than a node.
    expect(titles(pic(`${NODES}\n\\draw (a) -- ++(1,0);`))).toEqual(["a → (++1,0)"]);
  });

  it("make each edge operation its own edge", () => {
    expect(titles(pic(`${NODES}\n\\path (a) edge[->] (b) edge[->] (c);`))).toEqual(["a → b", "a → c"]);
  });

  it("start a new edge after a move", () => {
    expect(titles(pic(`${NODES}\n\\draw (a) -- (b) (c) -- (k);`))).toEqual(["a → b", "c → k"]);
  });

  it("know their mode from how they are written", () => {
    const { edges } = edgesOf(pic(`${NODES}\n\\draw (a) -- (b);\n\\draw (a) -- (1,1) -- (b);\n\\draw (a) |- (c);\n\\draw (a) to[bend left] (b);\n\\draw (a) to[out=0, in=90] (c);`));
    expect(edges.map((e) => e.mode)).toEqual(["straight", "polyline", "orthogonal", "curved", "curved"]);
  });

  it("highlight the whole statement when a path is one edge, and only their part otherwise", () => {
    const text = pic(`${NODES}\n\\draw[->] (a) -- (b);\n\\draw (a) -- (b) -- (c);`);
    const { edges } = edgesOf(text);
    expect(text.slice(edges[0]!.range.from, edges[0]!.range.to)).toBe("\\draw[->] (a) -- (b);");
    expect(edges.slice(1).map((e) => text.slice(e.range.from, e.range.to))).toEqual(["(a) -- (b)", "(b) -- (c)"]);
  });

  it("own the labels on their segments", () => {
    const text = pic(`${NODES}\n\\draw (a) -- node[above] {x} (b) -- node[right] {y} (c);\n\\draw (a) -- (c) node[pos=.5] {z};\n\\path (a) edge node {w} (c);`);
    const { edges } = edgesOf(text);
    const words = edges.map((e) => e.labels.map((n) => n.syntax.label!.text).join(","));
    expect(words).toEqual(["x", "y", "z", "w"]);
  });

  it("leave out paths that draw nothing", () => {
    expect(titles(pic(`${NODES}\n\\path (a) -- node {x} (b);`))).toEqual([]);
  });

  it("are locked, with a reason, when the path also draws shapes or can't be followed", () => {
    const { edges } = edgesOf(pic(`${NODES}\n\\draw (a) -- (b) -- (c) -- cycle;\n\\draw (a) -- (b) -- (\\x,1);`));
    expect(edges.map((e) => e.lock?.kind)).toEqual(["shapes", "shapes", "shapes", "broken"]);
    expect(explainEdge(edges[0]!)!.body).toMatch(/exactly as written/);
  });

  it("draw as SVG along their own segments", () => {
    const { edges } = edgesOf(pic(`${NODES}\n\\draw (a) |- (c);`));
    expect(edgeD(edges[0]!)).toMatch(/^M [-\d. ]+ L [-\d. ]+ L [-\d. ]+$/);
  });

  it("cover every drawn connection in the corpus, without errors", () => {
    let count = 0;
    for (const name of corpusNames()) {
      const doc = analyzeDocument(loadCorpusFile(name).text);
      doc.syntax.pictures.forEach((_, i) => {
        const l = layoutDocumentPicture(doc, i)!;
        const edges = pictureEdges(l);
        count += edges.length;
        // Every node-to-node connection a drawn path makes is some edge's two ends.
        for (const p of l.paths) {
          if (!p.route || !p.stroke) continue;
          for (const [from, to] of p.edges) expect(edges.some((e) => e.path === p && e.source === from && e.target === to), `${name}: ${from} → ${to}`).toBe(true);
        }
        for (const e of edges) {
          expect(e.range.from).toBeLessThanOrEqual(e.range.to);
          expect(edgeD(e)).not.toContain("NaN");
        }
      });
    }
    expect(count).toBeGreaterThan(250);
  });
});

describe("labels on edges", () => {
  it("can be edited in place, changing only the characters typed", () => {
    const text = pic(`${NODES}\n\\draw (a) -- node[above] {yes} (b);`);
    const { edges } = edgesOf(text);
    const label = edges[0]!.labels[0]!;
    const r = planLabelEdit(text, 0, label.id, "Yes");
    if (!r.ok) throw new Error(r.reason);
    expect(r.changes).toEqual([{ from: label.syntax.label!.inner.from, to: label.syntax.label!.inner.from + 1, insert: "Y" }]);
    expect(r.text).toContain("node[above] {Yes} (b);");
  });

  it("refuse text that would break the path", () => {
    const text = pic(`${NODES}\n\\draw (a) -- node {yes} (b);`);
    const label = edgesOf(text).edges[0]!.labels[0]!;
    expect(planLabelEdit(text, 0, label.id, "50% sure").ok).toBe(false);
    expect(planLabelEdit(text, 0, label.id, "a}").ok).toBe(false);
  });
});
