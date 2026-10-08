// Milestone 2b step 4: vertices. Adding a corner to a straight segment,
// removing one, and Straighten. Each keeps the edge's labels and ends, and
// leaves the rest of the path where it was.
import { describe, expect, it } from "vitest";
import { applyChanges, diffRange } from "../src/edit/changes.ts";
import { findEdge } from "../src/edit/edges.ts";
import { edgeVertices, nearestLineSegment, planAddVertex, planRemoveVertex, planStraighten } from "../src/edit/vertices.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import { type Edge, pictureEdges } from "../src/model/edges.ts";
import type { PictureLayout } from "../src/tikz/layout.ts";
import { PT_PER_UNIT } from "../src/tikz/units.ts";
import { corpusNames, loadCorpusFile } from "./corpus.ts";

const MM = PT_PER_UNIT.mm!;
const pic = (body: string) => `\\begin{tikzpicture}\n\\node (a) at (0,0) {A};\n\\node (b) at (4,-2) {B};\n\\node (c) at (1,-4) {C};\n${body}\n\\end{tikzpicture}\n`;
const layoutOf = (text: string): PictureLayout => layoutDocumentPicture(analyzeDocument(text), 0)!;
const firstEdge = (text: string): Edge => pictureEdges(layoutOf(text))[0]!;
const drawLine = (text: string) => text.split("\n").find((l) => l.startsWith("\\draw"))!;
const node = (l: PictureLayout, name: string) => l.nodes.find((n) => n.name === name)!.shape.center;

function ok<T extends { ok: boolean }>(r: T, text: string): Extract<T, { ok: true }> & { text: string } {
  if (!r.ok) throw new Error((r as unknown as { reason: string }).reason);
  const done = r as Extract<T, { ok: true }> & { changes: never; text: string };
  expect(applyChanges(text, (r as unknown as { changes: Parameters<typeof applyChanges>[1] }).changes)).toBe(done.text);
  return done;
}

describe("adding a corner", () => {
  it("writes it relative to the point before it, and only inserts", () => {
    const text = pic("\\draw[->] (a) -- (b);");
    const e = firstEdge(text);
    const a = node(layoutOf(text), "a");
    const r = ok(planAddVertex(text, 0, e.id, e.segs[0]!, { x: a.x + 20 * MM, y: a.y + 5 * MM }), text);
    expect(drawLine(r.text)).toBe("\\draw[->] (a) -- ++(2cm,5mm) -- (b);");
    expect(r.form).toBe("relative");
    expect(diffRange(text, r.text)!.to - diffRange(text, r.text)!.from).toBe(0);
  });

  it("writes a perpendicular coordinate when it lines up with two nodes", () => {
    const text = pic("\\draw[->] (a) -- (b);");
    const l = layoutOf(text);
    const e = firstEdge(text);
    const r = ok(planAddVertex(text, 0, e.id, e.segs[0]!, { x: node(l, "b").x, y: node(l, "a").y }), text);
    expect(drawLine(r.text)).toBe("\\draw[->] (a) -- (b |- a) -- (b);");
  });

  it("keeps a label on the half it is nearer", () => {
    const text = pic("\\draw (a) -- node[near start] {x} (b);");
    const l = layoutOf(text);
    const e = firstEdge(text);
    const b = node(l, "b");
    // Near the end: the label (near the start) stays on a → corner.
    const r = ok(planAddVertex(text, 0, e.id, e.segs[0]!, { x: b.x - 10 * MM, y: b.y + 10 * MM }), text);
    expect(drawLine(r.text)).toBe("\\draw (a) -- node[near start] {x} ++(3cm,-1cm) -- (b);");
    // Near the start: it goes on corner → b.
    const a = node(l, "a");
    const r2 = ok(planAddVertex(text, 0, e.id, e.segs[0]!, { x: a.x + 3 * MM, y: a.y - 8 * MM }), text);
    expect(drawLine(r2.text)).toBe("\\draw (a) -- ++(3mm,-8mm) -- node[near start] {x} (b);");
  });

  it("keeps plain coordinates plain, and holds a relative point after it", () => {
    const text = pic("\\draw (1,1) -- (3,1);");
    const e = firstEdge(text);
    const r = ok(planAddVertex(text, 0, e.id, e.segs[0]!, { x: 2 * 28.4528, y: 2 * 28.4528 }), text);
    expect(drawLine(r.text)).toBe("\\draw (1,1) -- (2,2) -- (3,1);");
    const rel = pic("\\draw (a) -- ++(2cm,0);");
    const e2 = firstEdge(rel);
    const a = node(layoutOf(rel), "a");
    const r2 = ok(planAddVertex(rel, 0, e2.id, e2.segs[0]!, { x: a.x + 10 * MM, y: a.y + 10 * MM }), rel);
    expect(drawLine(r2.text)).toBe("\\draw (a) -- ++(1cm,1cm) -- ++(1cm,-1cm);");
  });

  it("refuses curves, orthogonal pieces and edge operations", () => {
    for (const body of ["\\draw (a) to[bend left] (b);", "\\draw (a) |- (b);", "\\draw (a) edge (b);"]) {
      const text = pic(body);
      const e = firstEdge(text);
      expect(planAddVertex(text, 0, e.id, e.segs[0]!, { x: 10, y: 10 })).toMatchObject({ ok: false });
    }
  });

  it("finds the segment nearest a point", () => {
    const text = pic("\\draw (a) -- ++(2,0) -- (b);");
    const e = firstEdge(text);
    const hit = nearestLineSegment(e, { x: 30, y: 3 })!;
    expect(hit.seg).toBe(e.segs[0]);
    expect(hit.point.y).toBeCloseTo(0, 6);
  });
});

describe("removing a corner", () => {
  it("removes the point and the operation after it", () => {
    const text = pic("\\draw[->] (a) -- node {x} (2,1) -- node {y} (b);");
    const e = firstEdge(text);
    const r = ok(planRemoveVertex(text, 0, e.id, edgeVertices(e)[0]!), text);
    expect(drawLine(r.text)).toBe("\\draw[->] (a) -- node {x} node {y} (b);");
  });

  it("keeps the rest of the path in place", () => {
    const text = pic("\\draw (a) -- ++(1,0) -- ++(0,-1) -- ++(1,0);");
    const e = firstEdge(text);
    const last = e.route.stops[3]!.point;
    const r = ok(planRemoveVertex(text, 0, e.id, 1), text);
    expect(drawLine(r.text)).toBe("\\draw (a) -- ++(1,-1) -- ++(1,0);");
    const after = findEdge(r.layout, e.id)!.route.stops[2]!.point;
    expect(Math.hypot(after.x - last.x, after.y - last.y)).toBeLessThan(0.1);
  });

  it("keeps the operation before a curve", () => {
    const text = pic("\\draw (a) |- (2,1) to[bend left] (b);");
    const e = firstEdge(text);
    const r = ok(planRemoveVertex(text, 0, e.id, 1), text);
    expect(drawLine(r.text)).toBe("\\draw (a) to[bend left] (b);");
  });
});

describe("straighten", () => {
  it("removes corners and curves and keeps labels", () => {
    const cases: Array<[string, string]> = [
      ["\\draw[->] (a) -- ++(1,0) |- node[right] {no} (b);", "\\draw[->] (a) -- node[right] {no} (b);"],
      ["\\draw (a) to[bend left=40] node {x} (b);", "\\draw (a) -- node {x} (b);"],
      ["\\draw (a) to[out=90, in=180, red] (b);", "\\draw (a) to[red] (b);"],
      ["\\draw (a) .. controls +(1,1) and +(-1,1) .. (b);", "\\draw (a) -- (b);"],
      ["\\draw (a) -| (b);", "\\draw (a) -- (b);"],
      ["\\draw (a) edge[bend left, red] (b);", "\\draw (a) edge[red] (b);"],
    ];
    for (const [before, after] of cases) {
      const text = pic(before);
      const r = ok(planStraighten(text, 0, firstEdge(text).id), text);
      expect(drawLine(r.text)).toBe(after);
    }
  });

  it("keeps comments in the middle", () => {
    const text = pic("\\draw (a) -- (1,1) % around\n  -- (b);");
    const r = ok(planStraighten(text, 0, firstEdge(text).id), text);
    expect(r.text).toContain("\\draw (a) -- % around\n  (b);");
  });

  it("only touches its own edge in a longer path", () => {
    const text = pic("\\draw (a) -- (2,1) -- (b) -- (c);");
    const r = ok(planStraighten(text, 0, firstEdge(text).id), text);
    expect(drawLine(r.text)).toBe("\\draw (a) -- (b) -- (c);");
  });

  it("refuses an edge that is already straight, and options in the middle", () => {
    const text = pic("\\draw (a) -- (b);");
    expect(planStraighten(text, 0, firstEdge(text).id)).toMatchObject({ ok: false, reason: "It is already straight." });
    const mid = pic("\\draw (a) -- (1,1) [red] -- (b);");
    expect(planStraighten(mid, 0, firstEdge(mid).id)).toMatchObject({ ok: false, reason: expect.stringMatching(/options in the middle/) });
  });
});

describe("the corpus", () => {
  it("straightens every edge with corners or curves, or refuses with a reason, touching only its path", () => {
    let done = 0;
    let tried = 0;
    for (const name of corpusNames()) {
      const text = loadCorpusFile(name).text;
      const doc = analyzeDocument(text);
      doc.syntax.pictures.forEach((_, i) => {
        const l = layoutDocumentPicture(doc, i)!;
        for (const e of pictureEdges(l)) {
          if (e.lock || e.mode === "straight") continue;
          tried++;
          const r = planStraighten(text, i, e.id);
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
    expect(tried).toBeGreaterThan(30);
    expect(done / tried).toBeGreaterThan(0.8);
  });
});
