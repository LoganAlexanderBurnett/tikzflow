// Milestone 2b, owner's decision on steps 4–6 (D53): Make orthogonal and a new
// corner turn an `edge` operation into `--`, in place or in a \draw of its own,
// as one edit that draws the same picture apart from the route.
import { describe, expect, it } from "vitest";
import { applyChanges } from "../src/edit/changes.ts";
import { planEdgeToLine } from "../src/edit/edgeop.ts";
import { planMakeOrthogonal } from "../src/edit/orthogonal.ts";
import { planAddVertex } from "../src/edit/vertices.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import { type Edge, pictureEdges } from "../src/model/edges.ts";
import type { PictureLayout } from "../src/tikz/layout.ts";
import { corpusNames, loadCorpusFile } from "./corpus.ts";

const NODES = "\\node[draw] (a) at (0,0) {A};\n\\node[draw] (b) at (4,-2) {B};\n\\node[draw] (c) at (1,-4) {C};";
const pic = (body: string, opts = "") => `\\begin{tikzpicture}${opts}\n${NODES}\n${body}\n\\end{tikzpicture}\n`;
const layoutOf = (text: string): PictureLayout => layoutDocumentPicture(analyzeDocument(text), 0)!;
const edgesOf = (text: string): Edge[] => pictureEdges(layoutOf(text));
const lines = (text: string) => text.split("\n").slice(4, -2);

function ok<T extends { ok: boolean }>(r: T, text: string) {
  if (!r.ok) throw new Error((r as unknown as { reason: string }).reason);
  const done = r as unknown as { changes: Parameters<typeof applyChanges>[1]; text: string; notes?: string[] };
  expect(applyChanges(text, done.changes)).toBe(done.text);
  return done;
}

describe("converting an edge operation to --", () => {
  it("rewrites a statement that holds only that edge in place, keeping its options and labels", () => {
    const text = pic("\\draw[->] (a) edge[dashed] node {x} (b);");
    const r = ok(planEdgeToLine(text, 0, edgesOf(text)[0]!.id), text);
    expect(lines(r.text)).toEqual(["\\draw[->, dashed] (a) -- node {x} (b);"]);
    expect(r.moved).toBe(false);
  });

  it("turns \\path into \\draw, and adds options where there were none", () => {
    const text = pic("\\path (a) edge[red, bend left] (b);\n\\path[->] (b) edge (c);");
    expect(lines(ok(planEdgeToLine(text, 0, edgesOf(text)[0]!.id), text).text)).toEqual(["\\draw[red] (a) -- (b);", "\\path[->] (b) edge (c);"]);
    expect(lines(ok(planEdgeToLine(text, 0, edgesOf(text)[1]!.id), text).text)).toEqual(["\\path (a) edge[red, bend left] (b);", "\\draw[->] (b) -- (c);"]);
  });

  it("moves one edge of several into a \\draw of its own, after the statement", () => {
    const text = pic("\\path[->] (a) edge (b) (b) edge node[above] {yes} (c); % both");
    const e = edgesOf(text);
    expect(e).toHaveLength(2);
    const r = ok(planEdgeToLine(text, 0, e[1]!.id), text);
    expect(lines(r.text)).toEqual(["\\path[->] (a) edge (b); % both", "\\draw[->] (b) -- node[above] {yes} (c);"]);
    expect(r.moved).toBe(true);
    const first = ok(planEdgeToLine(text, 0, e[0]!.id), text);
    expect(lines(first.text)).toEqual(["\\path[->] (b) edge node[above] {yes} (c); % both", "\\draw[->] (a) -- (b);"]);
  });

  it("keeps the start when another edge uses it", () => {
    const text = pic("\\path (a) edge (b) edge (c);");
    const e = edgesOf(text);
    const r = ok(planEdgeToLine(text, 0, e[1]!.id), text);
    expect(lines(r.text)).toEqual(["\\path (a) edge (b);", "\\draw (a) -- (c);"]);
  });

  it("splits a chain of edges one per line", () => {
    const text = pic("\\draw (a) edge (b)\n      (b) edge (c);");
    const r = ok(planEdgeToLine(text, 0, edgesOf(text)[0]!.id), text);
    expect(lines(r.text)).toEqual(["\\draw", "      (b) edge (c);", "\\draw (a) -- (b);"]);
  });

  it("writes out what the edge got from every edge", () => {
    const text = pic("\\path (a) edge (b);", "[every edge/.style={draw, ->, thick}]");
    const r = ok(planEdgeToLine(text, 0, edgesOf(text)[0]!.id), text);
    expect(lines(r.text)).toEqual(["\\draw[->, thick] (a) -- (b);"]);
  });

  it("refuses what it can't keep the same", () => {
    const rel = pic("\\draw (a) edge ++(1,0);");
    expect(planEdgeToLine(rel, 0, edgesOf(rel)[0]!.id)).toMatchObject({ ok: false, reason: expect.stringMatching(/relative/) });
    const fill = pic("\\fill[red] (a) edge (b);");
    const e = edgesOf(fill)[0];
    if (e) expect(planEdgeToLine(fill, 0, e.id)).toMatchObject({ ok: false });
    const node = pic("\\node (d) at (3,1) {D} edge (a);");
    expect(planEdgeToLine(node, 0, edgesOf(node)[0]!.id)).toMatchObject({ ok: false, reason: expect.stringMatching(/node/) });
    const straight = pic("\\draw (a) -- (b);");
    expect(planEdgeToLine(straight, 0, edgesOf(straight)[0]!.id)).toMatchObject({ ok: false });
  });
});

describe("Make orthogonal and corners on an edge operation", () => {
  it("make it orthogonal in one edit", () => {
    const text = pic("\\draw[->] (a) edge (b);");
    const r = ok(planMakeOrthogonal(text, 0, edgesOf(text)[0]!.id), text);
    expect(lines(r.text)).toEqual(["\\draw[->] (a) -| (b);"]);
    expect(r.notes?.[0]).toMatch(/converted the "edge" operation/);
  });

  it("make a curved one orthogonal, dropping the curve", () => {
    const text = pic("\\draw (a) edge[bend left, red] (b);");
    const r = ok(planMakeOrthogonal(text, 0, edgesOf(text)[0]!.id), text);
    expect(lines(r.text)).toEqual(["\\draw[red] (a) -| (b);"]);
  });

  it("move one of several edges into its own \\draw and make it orthogonal", () => {
    const text = pic("\\path[->] (a) edge (b) (b) edge (c);");
    const r = ok(planMakeOrthogonal(text, 0, edgesOf(text)[1]!.id), text);
    expect(lines(r.text)).toEqual(["\\path[->] (a) edge (b);", expect.stringMatching(/^\\draw\[->\] \(b\) (-\||\|-) \(c\);$/)]);
    expect((r as unknown as { edgeId: string }).edgeId).toBeTruthy();
    const after = edgesOf(r.text);
    expect(after.some((e) => e.mode === "orthogonal")).toBe(true);
  });

  it("add a corner in one edit", () => {
    const text = pic("\\draw[->] (a) edge node {x} (b);");
    const e = edgesOf(text)[0]!;
    const s = e.route.segs[e.segs[0]!]!;
    const mid = { x: s.to.x * 0.5 + s.from.x * 0.5 + 20, y: s.to.y * 0.5 + s.from.y * 0.5 };
    const r = ok(planAddVertex(text, 0, e.id, e.segs[0]!, mid), text);
    expect(lines(r.text)[0]).toMatch(/^\\draw\[->\] \(a\) -- .* -- node \{x\} \(b\);$|^\\draw\[->\] \(a\) -- node \{x\} .* -- \(b\);$/);
    expect(edgesOf(r.text)[0]!.mode).toBe("polyline");
  });

  it("refuse with the reason when the conversion can't be done", () => {
    const text = pic("\\fill (a) edge (b);");
    const e = edgesOf(text)[0];
    if (e) expect(planMakeOrthogonal(text, 0, e.id)).toMatchObject({ ok: false });
  });
});

describe("the corpus's edge operations", () => {
  it("make orthogonal where they can, touching nothing outside their statement and the new line after it", () => {
    let tried = 0;
    let done = 0;
    for (const name of corpusNames()) {
      const text = loadCorpusFile(name).text;
      const doc = analyzeDocument(text);
      doc.syntax.pictures.forEach((_, i) => {
        const l = layoutDocumentPicture(doc, i)!;
        for (const e of pictureEdges(l)) {
          if (e.lock || !e.path.id.includes("/edge")) continue;
          tried++;
          const r = planMakeOrthogonal(text, i, e.id);
          if (!r.ok) {
            expect(r.reason, name).toBeTruthy();
            continue;
          }
          done++;
          expect(applyChanges(text, r.changes), name).toBe(r.text);
          // Every change lies in the statement or in the line after it.
          const lineAfter = text.indexOf("\n", e.path.syntax.to);
          for (const c of r.changes) {
            expect(c.from, name).toBeGreaterThanOrEqual(e.path.syntax.from - 1);
            expect(c.to, name).toBeLessThanOrEqual(Math.max(e.path.syntax.to, lineAfter) + 1);
          }
        }
      });
    }
    expect(tried).toBeGreaterThan(5);
    expect(done / tried).toBeGreaterThan(0.5);
  });
});
