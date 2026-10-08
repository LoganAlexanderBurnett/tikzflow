// Milestone 2b step 6: curved mode. "Make curved" writes a plain bend left
// (D45); dragging a curve's handles writes bend, out/in, or controls (D53):
// the middle handle keeps a bend symmetric, a handle near an end changes only
// that end's angle.
import { describe, expect, it } from "vitest";
import { applyChanges, diffRange } from "../src/edit/changes.ts";
import { curveForm, curveMiddle, curveSegments, planCurve, planMakeCurved } from "../src/edit/curves.ts";
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

/** The middle of `body`'s first curve. */
function middle(body: string): Point {
  const e = firstEdge(pic(body));
  return curveMiddle(e.route.segs[curveSegments(e)[0]!]!);
}

/** A point `d` pt from `from`, at `deg` degrees. */
const ray = (from: Point, deg: number, d: number): Point => ({ x: from.x + Math.cos((deg * Math.PI) / 180) * d, y: from.y + Math.sin((deg * Math.PI) / 180) * d });
const A: Point = { x: 0, y: 0 };
const B: Point = { x: 4 * PT_PER_UNIT.cm!, y: -2 * PT_PER_UNIT.cm! };

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

describe("the middle handle", () => {
  it("keeps a bend symmetric: a new angle", () => {
    const text = pic("\\draw (a) to[bend left] (b);");
    const e = firstEdge(text);
    const r = ok(planCurve(text, 0, e.id, curveSegments(e)[0]!, "mid", middle("\\draw (a) to[bend left=45] (b);")), text);
    expect(drawLine(r.text)).toBe("\\draw (a) to[bend left=45] (b);");
    expect(r.form).toBe("bend");
  });

  it("goes to the other side, and lands where it was dragged", () => {
    const text = pic("\\draw (a) to[bend left] (b);");
    const e = firstEdge(text);
    const target = middle("\\draw (a) to[bend right=20, looseness=1.5] (b);");
    const r = ok(planCurve(text, 0, e.id, curveSegments(e)[0]!, "mid", target), text);
    expect(drawLine(r.text)).toMatch(/to\[bend right(=\d+)?\]/);
    const e2 = firstEdge(r.text);
    const mid = curveMiddle(e2.route.segs[curveSegments(e2)[0]!]!);
    expect(Math.hypot(mid.x - target.x, mid.y - target.y)).toBeLessThan(4 * MM);
  });

  it("bends in whole degrees when snapping is off (Alt)", () => {
    const text = pic("\\draw (a) to[bend left] (b);");
    const e = firstEdge(text);
    const target = middle("\\draw (a) to[bend left=43] (b);");
    const snapped = ok(planCurve(text, 0, e.id, curveSegments(e)[0]!, "mid", target), text);
    expect(drawLine(snapped.text)).toBe("\\draw (a) to[bend left=45] (b);");
    const free = ok(planCurve(text, 0, e.id, curveSegments(e)[0]!, "mid", target, false), text);
    expect(drawLine(free.text)).toMatch(/bend left=4[2-4]\]/);
  });

  it("raises the looseness only when the angle runs out", () => {
    const text = pic("\\draw (a) to[bend left] (b);");
    const e = firstEdge(text);
    const r = ok(planCurve(text, 0, e.id, curveSegments(e)[0]!, "mid", middle("\\draw (a) to[bend left=80, looseness=2] (b);")), text);
    expect(drawLine(r.text)).toMatch(/to\[bend left=(8\d|90), looseness=[\d.]+\]/);
  });

  it("keeps the angles of an out/in curve and scales its looseness", () => {
    const text = pic("\\draw (a) to[out=90, in=180] (b);");
    const e = firstEdge(text);
    const r = ok(planCurve(text, 0, e.id, curveSegments(e)[0]!, "mid", middle("\\draw (a) to[out=90, in=180, looseness=1.5] (b);")), text);
    expect(drawLine(r.text)).toBe("\\draw (a) to[out=90, in=180, looseness=1.5] (b);");
  });

  it("keeps other keys and bends an edge operation in its own options", () => {
    const text = pic("\\draw (a) edge[red, bend left] (b);");
    const e = firstEdge(text);
    const r = ok(planCurve(text, 0, e.id, curveSegments(e)[0]!, "mid", middle("\\draw (a) edge[bend left=50] (b);")), text);
    expect(drawLine(r.text)).toMatch(/^\\draw \(a\) edge\[red, bend left=(45|50)\] \(b\);$/);
  });
});

describe("the end handles", () => {
  it("change only that end's angle, in place", () => {
    const text = pic("\\draw (a) to[out=90, in=180] (b);");
    const e = firstEdge(text);
    const k = curveSegments(e)[0]!;
    const out = ok(planCurve(text, 0, e.id, k, "end1", ray(A, 60, 40)), text);
    expect(drawLine(out.text)).toBe("\\draw (a) to[out=60, in=180] (b);");
    expect(out.form).toBe("out-in");
    const into = ok(planCurve(text, 0, e.id, k, "end2", ray(B, 150, 40)), text);
    expect(drawLine(into.text)).toBe("\\draw (a) to[out=90, in=150] (b);");
  });

  it("keep the looseness and the other keys", () => {
    const text = pic("\\draw (a) to[out=90, in=180, looseness=1.5, red] (b);");
    const e = firstEdge(text);
    const r = ok(planCurve(text, 0, e.id, curveSegments(e)[0]!, "end1", ray(A, 45, 40)), text);
    expect(drawLine(r.text)).toBe("\\draw (a) to[out=45, in=180, looseness=1.5, red] (b);");
  });

  it("turn a bend into out and in, keeping its other keys", () => {
    const text = pic("\\draw (a) to[bend left, red] (b);");
    const e = firstEdge(text);
    const r = ok(planCurve(text, 0, e.id, curveSegments(e)[0]!, "end1", ray(A, 80, 40)), text);
    expect(drawLine(r.text)).toMatch(/^\\draw \(a\) to\[red, out=80, in=-?\d+(, (out |in )?looseness=[\d.]+)*\] \(b\);$/);
  });

  it("snap to multiples of 15 degrees unless snapping is off (Alt)", () => {
    const text = pic("\\draw (a) to[out=90, in=180] (b);");
    const e = firstEdge(text);
    const k = curveSegments(e)[0]!;
    expect(drawLine(ok(planCurve(text, 0, e.id, k, "end1", ray(A, 62, 40)), text).text)).toContain("out=60");
    expect(drawLine(ok(planCurve(text, 0, e.id, k, "end1", ray(A, 62, 40), false), text).text)).toContain("out=62");
  });

  it("work on an edge operation", () => {
    const text = pic("\\draw (a) edge[out=90, in=180] (b);");
    const e = firstEdge(text);
    const r = ok(planCurve(text, 0, e.id, curveSegments(e)[0]!, "end1", ray(A, 30, 40)), text);
    expect(drawLine(r.text)).toBe("\\draw (a) edge[out=30, in=180] (b);");
  });
});

describe("a .. controls .. curve", () => {
  it("moves a control point relative to its end", () => {
    const text = pic("\\draw (a) .. controls +(1,1) and +(-1,1) .. (b);");
    const e = firstEdge(text);
    const { c1 } = controls("\\draw (a) .. controls +(1,1) and +(-1,1) .. (b);");
    const r = ok(planCurve(text, 0, e.id, curveSegments(e)[0]!, "c1", { x: c1.x + 5 * MM, y: c1.y }), text);
    expect(drawLine(r.text)).toBe("\\draw (a) .. controls +(1.5,1) and +(-1,1) .. (b);");
    expect(r.form).toBe("controls");
  });

  it("has no end or middle handles, and the other forms have no control points", () => {
    const text = pic("\\draw (a) .. controls +(1,1) and +(-1,1) .. (b);");
    const e = firstEdge(text);
    expect(curveForm(e, curveSegments(e)[0]!)).toBe("controls");
    expect(planCurve(text, 0, e.id, curveSegments(e)[0]!, "mid", A)).toMatchObject({ ok: false });
    const t2 = pic("\\draw (a) to[bend left] (b);");
    const e2 = firstEdge(t2);
    expect(curveForm(e2, curveSegments(e2)[0]!)).toBe("keys");
    expect(planCurve(t2, 0, e2.id, curveSegments(e2)[0]!, "c1", A)).toMatchObject({ ok: false });
  });
});

describe("reshaping the corpus's curves", () => {
  it("touches only the path, and mostly succeeds", () => {
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
            const mid = curveMiddle(s);
            const moves: Array<[Parameters<typeof planCurve>[4], Point]> =
              curveForm(e, k) === "controls"
                ? [["c1", { x: s.c1!.x + 3 * MM, y: s.c1!.y + 2 * MM }]]
                : [
                    ["mid", { x: mid.x + 3 * MM, y: mid.y + 2 * MM }],
                    ["end1", { x: s.c1!.x + 3 * MM, y: s.c1!.y + 2 * MM }],
                  ];
            for (const [handle, to] of moves) {
              tried++;
              const r = planCurve(text, i, e.id, k, handle, to);
              if (!r.ok) {
                expect(r.reason, name).toBeTruthy();
                continue;
              }
              done++;
              const d = diffRange(text, r.text);
              if (!d) continue; // the drag landed on what was written already
              expect(d.from, name).toBeGreaterThanOrEqual(e.path.syntax.from);
              expect(d.to, name).toBeLessThanOrEqual(e.path.syntax.to);
            }
          }
        }
      });
    }
    expect(tried).toBeGreaterThan(5);
    expect(done / tried).toBeGreaterThan(0.8);
  });
});
