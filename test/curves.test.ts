// Milestone 2b step 6: curved mode. "Make curved" writes a plain bend left
// (D45); dragging a control point writes bend, out/in, or controls, the
// first that draws what was dragged.
import { describe, expect, it } from "vitest";
import { applyChanges, diffRange } from "../src/edit/changes.ts";
import { curveSegments, planControl, planMakeCurved } from "../src/edit/curves.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import { type Edge, pictureEdges } from "../src/model/edges.ts";
import type { PictureLayout } from "../src/tikz/layout.ts";
import type { Point } from "../src/tikz/shapes.ts";
import { PT_PER_UNIT } from "../src/tikz/units.ts";
import { corpusNames, loadCorpusFile } from "./corpus.ts";

const MM = PT_PER_UNIT.mm!;
const pic = (body: string) => `\\begin{tikzpicture}\n\\node[draw] (a) at (0,0) {A};\n\\node[draw] (b) at (4,-2) {B};\n${body}\n\\end{tikzpicture}\n`;
const layoutOf = (text: string): PictureLayout => layoutDocumentPicture(analyzeDocument(text), 0)!;
const firstEdge = (text: string): Edge => pictureEdges(layoutOf(text))[0]!;
const drawLine = (text: string) => text.split("\n").find((l) => l.trimStart().startsWith("\\draw"))!.trim();

function ok<T extends { ok: boolean }>(r: T, text: string) {
  if (!r.ok) throw new Error((r as unknown as { reason: string }).reason);
  const done = r as unknown as { changes: Parameters<typeof applyChanges>[1]; text: string; form?: string };
  expect(applyChanges(text, done.changes)).toBe(done.text);
  return done;
}

/** The control points the interpreter draws for `body`'s first curve. */
function controls(body: string): { c1: Point; c2: Point } {
  const e = firstEdge(pic(body));
  const s = e.route.segs[curveSegments(e)[0]!]!;
  return { c1: s.c1!, c2: s.c2! };
}

describe("make curved", () => {
  it("writes a plain bend left, keeping labels and other keys", () => {
    const cases: Array<[string, string]> = [
      ["\\draw[->] (a) -- node[above] {x} (b);", "\\draw[->] (a) to[bend left] node[above] {x} (b);"],
      ["\\draw (a) -- (2,1) -- (b);", "\\draw (a) to[bend left] (b);"],
      ["\\draw (a) to[red] (b);", "\\draw (a) to[red, bend left] (b);"],
      ["\\draw (a) -| (b);", "\\draw (a) to[bend left] (b);"],
      ["\\draw (a) edge (b);", "\\draw (a) edge[bend left] (b);"],
      ["\\draw (a) edge[red] (b);", "\\draw (a) edge[red, bend left] (b);"],
    ];
    for (const [before, after] of cases) {
      const text = pic(before);
      expect(drawLine(ok(planMakeCurved(text, 0, firstEdge(text).id), text).text)).toBe(after);
    }
  });

  it("refuses an edge that is already curved", () => {
    const text = pic("\\draw (a) to[bend right] (b);");
    expect(planMakeCurved(text, 0, firstEdge(text).id)).toMatchObject({ ok: false });
  });
});

describe("dragging a control point", () => {
  it("keeps a bend symmetric: a new angle", () => {
    const text = pic("\\draw (a) to[bend left] (b);");
    const e = firstEdge(text);
    const r = ok(planControl(text, 0, e.id, curveSegments(e)[0]!, 1, controls("\\draw (a) to[bend left=45] (b);").c1), text);
    expect(drawLine(r.text)).toBe("\\draw (a) to[bend left=45] (b);");
    expect(r.form).toBe("bend");
  });

  it("keeps a bend symmetric from the other end too, and writes looseness", () => {
    const text = pic("\\draw (a) to[bend left] (b);");
    const e = firstEdge(text);
    const r = ok(planControl(text, 0, e.id, curveSegments(e)[0]!, 2, controls("\\draw (a) to[bend right=20, looseness=1.5] (b);").c2), text);
    expect(drawLine(r.text)).toBe("\\draw (a) to[bend right=20, looseness=1.5] (b);");
  });

  it("writes out and in for a free curve", () => {
    const text = pic("\\draw (a) to[out=90, in=180] (b);");
    const e = firstEdge(text);
    const r = ok(planControl(text, 0, e.id, curveSegments(e)[0]!, 1, controls("\\draw (a) to[out=60, in=180] (b);").c1), text);
    expect(drawLine(r.text)).toBe("\\draw (a) to[out=60, in=180] (b);");
    expect(r.form).toBe("out-in");
  });

  it("writes a looseness for each end when they differ", () => {
    const text = pic("\\draw (a) to[out=90, in=180] (b);");
    const e = firstEdge(text);
    const r = ok(planControl(text, 0, e.id, curveSegments(e)[0]!, 1, controls("\\draw (a) to[out=90, in=180, out looseness=1.6] (b);").c1), text);
    expect(drawLine(r.text)).toBe("\\draw (a) to[out=90, in=180, out looseness=1.6] (b);");
  });

  it("turns a free curve back into a bend when it is symmetric", () => {
    const text = pic("\\draw (a) to[out=10, in=150] (b);");
    const e = firstEdge(text);
    const bent = controls("\\draw (a) to[bend left=40] (b);");
    const step = ok(planControl(text, 0, e.id, curveSegments(e)[0]!, 2, bent.c2), text);
    const e2 = firstEdge(step.text);
    const r = ok(planControl(step.text, 0, e2.id, curveSegments(e2)[0]!, 1, bent.c1), step.text);
    expect(drawLine(r.text)).toBe("\\draw (a) to[bend left=40] (b);");
  });

  it("frees a bend when asked (Alt), and keeps other keys", () => {
    const text = pic("\\draw (a) to[bend left, red] (b);");
    const e = firstEdge(text);
    const r = ok(planControl(text, 0, e.id, curveSegments(e)[0]!, 1, controls("\\draw (a) to[out=80, in=170] (b);").c1, true), text);
    expect(drawLine(r.text)).toMatch(/^\\draw \(a\) to\[red, out=80, in=\d+(, (out |in )?looseness=[\d.]+)*\] \(b\);$/);
  });

  it("moves a .. controls .. point relative to its end", () => {
    const text = pic("\\draw (a) .. controls +(1,1) and +(-1,1) .. (b);");
    const e = firstEdge(text);
    const { c1 } = controls("\\draw (a) .. controls +(1,1) and +(-1,1) .. (b);");
    const r = ok(planControl(text, 0, e.id, curveSegments(e)[0]!, 1, { x: c1.x + 5 * MM, y: c1.y }), text);
    expect(drawLine(r.text)).toBe("\\draw (a) .. controls +(1.5,1) and +(-1,1) .. (b);");
    expect(r.form).toBe("controls");
  });

  it("bends an edge operation in its own options", () => {
    const text = pic("\\draw (a) edge[bend left] (b);");
    const e = firstEdge(text);
    const r = ok(planControl(text, 0, e.id, curveSegments(e)[0]!, 1, controls("\\draw (a) edge[bend left=50] (b);").c1), text);
    expect(drawLine(r.text)).toBe("\\draw (a) edge[bend left=50] (b);");
  });

  it("reshapes the corpus's curves, touching only their path", () => {
    let done = 0;
    let tried = 0;
    for (const name of corpusNames()) {
      const text = loadCorpusFile(name).text;
      const doc = analyzeDocument(text);
      doc.syntax.pictures.forEach((_, i) => {
        const l = layoutDocumentPicture(doc, i)!;
        for (const e of pictureEdges(l)) {
          if (e.lock) continue;
          for (const k of curveSegments(e)) {
            const s = e.route.segs[k]!;
            tried++;
            const r = planControl(text, i, e.id, k, 1, { x: s.c1!.x + 3 * MM, y: s.c1!.y + 2 * MM });
            if (!r.ok) {
              expect(r.reason, name).toBeTruthy();
              continue;
            }
            done++;
            const d = diffRange(text, r.text)!;
            expect(d.from, name).toBeGreaterThanOrEqual(e.path.syntax.from);
            expect(d.to, name).toBeLessThanOrEqual(e.path.syntax.to);
          }
        }
      });
    }
    expect(tried).toBeGreaterThan(5);
    expect(done / tried).toBeGreaterThan(0.8);
  });
});
