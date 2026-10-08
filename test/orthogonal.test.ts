// Milestone 2b step 5: orthogonal mode. "Make orthogonal" writes a single
// corner where it can (D45), and sliding a segment writes a |- / -| chain.
import { describe, expect, it } from "vitest";
import { applyChanges, diffRange } from "../src/edit/changes.ts";
import { findEdge } from "../src/edit/edges.ts";
import { orthoPolyline, planMakeOrthogonal, planSlide, snapSlide } from "../src/edit/orthogonal.ts";
import { isEdgeOperation } from "../src/edit/vertices.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import { type Edge, pictureEdges } from "../src/model/edges.ts";
import type { PictureLayout } from "../src/tikz/layout.ts";
import { PT_PER_UNIT } from "../src/tikz/units.ts";
import { SAMPLE } from "../src/ui/sample.ts";
import { corpusNames, loadCorpusFile } from "./corpus.ts";

const MM = PT_PER_UNIT.mm!;
const NODES = "\\node[draw] (a) at (0,0) {A};\n\\node[draw] (b) at (4,-2) {B};\n\\node[draw] (c) at (1,-4) {C};";
const pic = (body: string) => `\\begin{tikzpicture}\n${NODES}\n${body}\n\\end{tikzpicture}\n`;
const layoutOf = (text: string): PictureLayout => layoutDocumentPicture(analyzeDocument(text), 0)!;
const firstEdge = (text: string): Edge => pictureEdges(layoutOf(text))[0]!;
const drawLine = (text: string) => text.split("\n").find((l) => l.trimStart().startsWith("\\draw"))!.trim();
const node = (l: PictureLayout, name: string) => l.nodes.find((n) => n.name === name)!.shape;

function ok(r: ReturnType<typeof planSlide>, text: string) {
  if (!r.ok) throw new Error(r.reason);
  expect(applyChanges(text, r.changes)).toBe(r.text);
  return r;
}

describe("the pieces of an orthogonal edge", () => {
  it("includes the corners |- and -| leave unwritten, and merges pieces in line", () => {
    const e = firstEdge(pic("\\draw (a) -- ++(0,-1) |- (b);"));
    const poly = orthoPolyline(e)!;
    expect(poly.pieces.map((p) => p.axis)).toEqual(["v", "h"]);
    expect(poly.points).toHaveLength(3);
    expect(orthoPolyline(firstEdge(pic("\\draw (a) -- (b);")))).toBeNull();
  });
});

describe("make orthogonal", () => {
  it("uses one corner, horizontal first when the ends are further apart across", () => {
    const text = pic("\\draw[->] (a) -- node[above] {x} (b);");
    const r = ok(planMakeOrthogonal(text, 0, firstEdge(text).id), text);
    expect(drawLine(r.text)).toBe("\\draw[->] (a) -| node[above] {x} (b);");
  });

  it("goes the other way round when the first corner would cross a node", () => {
    const text = `\\begin{tikzpicture}\n${NODES}\n\\node[draw] (d) at (4,0) {D};\n\\draw (a) -- (b);\n\\end{tikzpicture}\n`;
    const r = ok(planMakeOrthogonal(text, 0, firstEdge(text).id), text);
    expect(drawLine(r.text)).toBe("\\draw (a) |- (b);");
  });

  it("follows the anchors: an end at a node's south leaves downwards", () => {
    const text = pic("\\draw (a.south) -- (b.west);");
    const r = ok(planMakeOrthogonal(text, 0, firstEdge(text).id), text);
    expect(drawLine(r.text)).toBe("\\draw (a.south) |- (b.west);");
  });

  it("uses two corners through the middle when both single corners cross nodes", () => {
    const text = `\\begin{tikzpicture}\n${NODES}\n\\node[draw] (d) at (4,0) {D};\n\\node[draw] (e) at (0,-2) {E};\n\\draw (a) -- (b);\n\\end{tikzpicture}\n`;
    const r = ok(planMakeOrthogonal(text, 0, firstEdge(text).id), text);
    expect(drawLine(r.text)).toBe("\\draw (a) -- ++(2cm,0) |- (b);");
  });

  it("straightens a polyline whose ends line up, and refuses a straight edge", () => {
    const text = pic("\\draw (a) -- (2,1) -- (4,0);");
    expect(drawLine(ok(planMakeOrthogonal(text, 0, firstEdge(text).id), text).text)).toBe("\\draw (a) -- (4,0);");
    const straight = pic("\\draw (a) -- (c |- a);");
    expect(planMakeOrthogonal(straight, 0, firstEdge(straight).id)).toMatchObject({ ok: false });
  });

  it("makes the corpus's straight and polyline edges orthogonal, touching only their path", () => {
    let done = 0;
    let tried = 0;
    for (const name of corpusNames()) {
      const text = loadCorpusFile(name).text;
      const doc = analyzeDocument(text);
      doc.syntax.pictures.forEach((_, i) => {
        const l = layoutDocumentPicture(doc, i)!;
        for (const e of pictureEdges(l)) {
          if (e.lock || e.mode === "orthogonal" || e.mode === "curved" || !e.source || !e.target || isEdgeOperation(e)) continue;
          const a = e.route.stops[e.from]!.point;
          const b = e.route.stops[e.to]!.point;
          // Most corpus edges already run straight down or across.
          if (Math.abs(a.x - b.x) < 0.5 || Math.abs(a.y - b.y) < 0.5) continue;
          tried++;
          const r = planMakeOrthogonal(text, i, e.id);
          if (!r.ok) continue;
          done++;
          const d = diffRange(text, r.text)!;
          expect(d.from, name).toBeGreaterThanOrEqual(e.path.syntax.from);
          expect(d.to, name).toBeLessThanOrEqual(e.path.syntax.to);
          expect(findEdge(r.layout, e.id)!.mode, name).toMatch(/orthogonal|straight/);
        }
      });
    }
    expect(tried).toBeGreaterThan(8);
    expect(done / tried).toBeGreaterThan(0.8);
  });
});

describe("sliding a segment", () => {
  it("slides a middle segment with both its corners", () => {
    const text = pic("\\draw[->] (a) -- ++(0,-1) -| (b);");
    const e = firstEdge(text);
    const a = node(layoutOf(text), "a").center;
    const r = ok(planSlide(text, 0, e.id, 1, a.y - 15 * MM), text);
    // The picture writes relative points as plain numbers, so the slide does too.
    expect(drawLine(r.text)).toBe("\\draw[->] (a) -- ++(0,-1.5) -| (b);");
  });

  it("drops corners that end up in line: sliding onto b's centre line leaves one corner", () => {
    const text = pic("\\draw (a) -- ++(0,-1) -| (b);");
    const e = firstEdge(text);
    const r = ok(planSlide(text, 0, e.id, 1, node(layoutOf(text), "b").center.y), text);
    expect(drawLine(r.text)).toBe("\\draw (a) |- (b);");
  });

  it("writes a perpendicular coordinate when a corner lines up with two nodes", () => {
    const text = pic("\\draw (a) -- ++(0,-1) -| (b);");
    const e = firstEdge(text);
    const r = ok(planSlide(text, 0, e.id, 1, node(layoutOf(text), "c").center.y), text);
    expect(drawLine(r.text)).toBe("\\draw (a) -- (a |- c) -| (b);");
  });

  it("moves where an end segment leaves a rectangle while it stays on the side", () => {
    const text = pic("\\draw (a) -| (b);");
    const e = firstEdge(text);
    const a = node(layoutOf(text), "a");
    const r = ok(planSlide(text, 0, e.id, 0, a.center.y + 2 * MM), text);
    expect(drawLine(r.text)).toBe("\\draw ([yshift=2mm]a.east) -| (b);");
    // Back on the centre line: the bare name again.
    const back = ok(planSlide(r.text, 0, e.id, 0, a.center.y), r.text);
    expect(drawLine(back.text)).toBe("\\draw (a) -| (b);");
  });

  it("meets a diamond or an ellipse at a border angle", () => {
    const text = `\\begin{tikzpicture}\n\\node[draw, diamond] (a) at (0,0) {A};\n\\node[draw] (b) at (4,-2) {B};\n\\draw (a) -| (b);\n\\end{tikzpicture}\n`;
    const e = firstEdge(text);
    const a = node(layoutOf(text), "a");
    const r = ok(planSlide(text, 0, e.id, 0, a.center.y + 2 * MM), text);
    expect(drawLine(r.text)).toMatch(/^\\draw \(a\.\d+\) -\| \(b\);$/);
    const start = findEdge(r.layout, e.id)!.route.stops[0]!.point;
    expect(Math.abs(start.y - (a.center.y + 2 * MM))).toBeLessThan(0.5);
  });

  it("adds a short piece out of the node when an end segment leaves its side", () => {
    const text = pic("\\draw (a) -| (b);");
    const e = firstEdge(text);
    const a = node(layoutOf(text), "a");
    const r = ok(planSlide(text, 0, e.id, 0, a.center.y + 10 * MM), text);
    expect(drawLine(r.text)).toBe("\\draw (a) -- ++(0,1cm) -| (b);");
    const after = findEdge(r.layout, e.id)!;
    expect(orthoPolyline(after)!.pieces.map((p) => p.axis)).toEqual(["v", "h", "v"]);
  });

  it("slides the sample's |- edge into stop's side, and keeps labels", () => {
    const l = layoutOf(SAMPLE);
    const e = pictureEdges(l).find((x) => x.mode === "orthogonal")!;
    const stop = node(l, "stop");
    // "rounded corners" doesn't change a rectangle's border, so this is a point on its east side.
    const r = ok(planSlide(SAMPLE, 0, e.id, 1, stop.center.y + 2 * MM), SAMPLE);
    expect(r.text).toBe(SAMPLE.replace("(base)  |- (stop);", "(base)  |- ([yshift=2mm]stop.east);"));
    const at = findEdge(r.layout, e.id)!.route.stops[e.to]!.point;
    expect(Math.abs(at.y - (stop.center.y + 2 * MM))).toBeLessThan(0.5);
    const text = pic("\\draw (a) -- ++(0,-1) -| node[near end, right] {no} (b);");
    const r2 = ok(planSlide(text, 0, firstEdge(text).id, 1, node(layoutOf(text), "a").center.y - 25 * MM), text);
    expect(drawLine(r2.text)).toBe("\\draw (a) -- ++(0,-2.5) -| node[near end, right] {no} (b);");
  });

  it("snaps to node lines", () => {
    const text = pic("\\draw (a) -- ++(0,-1) -| (b);");
    const l = layoutOf(text);
    const e = firstEdge(text);
    const piece = orthoPolyline(e)!.pieces[1]!;
    const b = node(l, "b").center.y;
    expect(snapSlide(l, e, piece, b + 2, 4).value).toBe(b);
    expect(snapSlide(l, e, piece, b + 20, 4).guides).toEqual([]);
  });
});
