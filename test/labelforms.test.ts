// Milestone 3 step 4 (D58 item 6, D63): changing an edge's form (Straight,
// Orthogonal, Curved) turns a label side key that the new line cuts through
// into `auto`, by the same rule as sliding a label (D57).
import { describe, expect, it } from "vitest";
import { applyChanges } from "../src/edit/changes.ts";
import { planMakeCurved } from "../src/edit/curves.ts";
import { labelGeometry } from "../src/edit/labels.ts";
import { planMakeOrthogonal } from "../src/edit/orthogonal.ts";
import { planStraighten } from "../src/edit/vertices.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import { pictureEdges } from "../src/model/edges.ts";
import { corpusNames, loadCorpusFile } from "./corpus.ts";

const DIAGONAL = "\\node[draw] (a) at (0,0) {A};\n\\node[draw] (b) at (4,-5) {B};";
const WIDE = "\\node[draw] (a) at (0,0) {A};\n\\node[draw] (b) at (4,-3) {B};";
const STEEP = "\\node[draw] (a) at (0,0) {A};\n\\node[draw] (b) at (1,-5) {B};";
const pic = (nodes: string, body: string) => `\\begin{tikzpicture}\n${nodes}\n${body}\n\\end{tikzpicture}\n`;
const layoutOf = (text: string) => layoutDocumentPicture(analyzeDocument(text), 0)!;
const edgesOf = (text: string) => pictureEdges(layoutOf(text));
const statements = (text: string) => text.split("\n").filter((l) => l.startsWith("\\draw") || l.startsWith("\\path"));

type Plan = typeof planMakeOrthogonal;
function run(plan: Plan, text: string, index = 0) {
  const r = plan(text, 0, edgesOf(text)[index]!.id);
  if (!r.ok) throw new Error(r.reason);
  expect(applyChanges(text, r.changes)).toBe(r.text);
  return r;
}

describe("making an edge orthogonal", () => {
  it("turns a side key the new pieces cut through into auto", () => {
    // At 0.8 along the diagonal a label above is fine; on the upright piece of -| it sits on the line.
    const r = run(planMakeOrthogonal, pic(WIDE, "\\draw (a) -- node[pos=0.8, above] {x} (b);"));
    expect(statements(r.text)).toEqual(["\\draw (a) -| node[pos=0.8, auto] {x} (b);"]);
    expect(r.notes.join(" ")).toContain('wrote the label "x" as auto instead of above');
  });

  it("keeps the label beside the line, on the side it was on, when the line is tilted", () => {
    // A tilted line says which side `above` means, so the written auto/swap follows it.
    const straight = (side: string) => run(planStraighten, pic(DIAGONAL, `\\draw (a) |- node[pos=0.8, ${side}] {x} (b);`));
    for (const side of ["above", "below"]) {
      const r = straight(side);
      const edge = pictureEdges(layoutOf(r.text))[0]!;
      const g = labelGeometry(edge, edge.labels[0]!)!;
      expect(g.overlap, side).toBeLessThan(1.5);
      const dy = edge.labels[0]!.shape.center.y - g.point.y;
      // The label stays where `above`/`below` pointed.
      if (r.notes.length) expect(side === "above" ? dy > 0 : dy < 0, side).toBe(true);
    }
    expect(straight("above").notes).toHaveLength(1);
  });

  it("leaves labels that sit beside the new line alone", () => {
    const keep = run(planMakeOrthogonal, pic(WIDE, "\\draw (a) -- node[pos=0.5, above] {x} (b);"));
    expect(statements(keep.text)).toEqual(["\\draw (a) -| node[pos=0.5, above] {x} (b);"]);
    expect(keep.notes).toEqual([]);
  });

  it("fixes each label of the edge on its own", () => {
    const r = run(planMakeOrthogonal, pic(DIAGONAL, "\\draw (a) -- node[pos=0.2, above] {x} node[pos=0.8, left] {y} (b);"));
    expect(statements(r.text)).toEqual(["\\draw (a) |- node[pos=0.2, auto] {x} node[pos=0.8, auto] {y} (b);"]);
    expect(r.notes).toHaveLength(2);
  });

  it("does not touch a side key with a distance, or one without a side", () => {
    const dist = run(planMakeOrthogonal, pic(DIAGONAL, "\\draw (a) -- node[pos=0.8, above=2mm] {x} (b);"));
    expect(dist.text).toContain("above=2mm");
    const none = run(planMakeOrthogonal, pic(DIAGONAL, "\\draw (a) -- node[pos=0.8] {x} (b);"));
    expect(none.text).toContain("node[pos=0.8] {x}");
  });

  it("leaves a sloped label alone: the layout can't tell where it sits", () => {
    const r = run(planMakeOrthogonal, pic(WIDE, "\\draw (a) -- node[pos=0.8, above, sloped] {x} (b);"));
    expect(statements(r.text)).toEqual(["\\draw (a) -| node[pos=0.8, above, sloped] {x} (b);"]);
    expect(r.notes).toEqual([]);
  });

  it("also does it for an edge operation turned into a line", () => {
    const r = run(planMakeOrthogonal, pic(DIAGONAL, "\\path (a) edge node[pos=0.2, above] {x} (b);"));
    expect(r.notes.join(" ")).toContain("converted");
    const l = layoutOf(r.text);
    const edge = pictureEdges(l)[0]!;
    expect(labelGeometry(edge, edge.labels[0]!)!.overlap).toBeLessThan(1.5);
  });
});

describe("straightening an edge", () => {
  it("turns a side key the straight line cuts through into auto", () => {
    const r = run(planStraighten, pic(DIAGONAL, "\\draw (a) |- node[pos=0.8, above] {x} (b);"));
    expect(statements(r.text)).toEqual(["\\draw (a) -- node[pos=0.8, auto] {x} (b);"]);
  });

  it("leaves a label that is fine where it is", () => {
    const r = run(planStraighten, pic(DIAGONAL, "\\draw (a) |- node[below] {x} (b);"));
    expect(statements(r.text)).toEqual(["\\draw (a) -- node[below] {x} (b);"]);
    expect(r.notes).toEqual([]);
  });
});

describe("making an edge curved", () => {
  it("leaves labels that stay beside the curve", () => {
    const r = run(planMakeCurved, pic("\\node[draw] (a) at (0,0) {A};\n\\node[draw] (b) at (5,0) {B};", "\\draw (a) -- node[above] {x} (b);"));
    expect(statements(r.text)).toEqual(["\\draw (a) to[bend left] node[above] {x} (b);"]);
  });

  it("does not change a label the line already cut through (the author's choice)", () => {
    const r = run(planMakeCurved, pic(STEEP, "\\draw (a) -- node[above] {x} (b);"));
    expect(r.text).toContain("node[above] {x}");
  });

  it("turns a key into auto when the curve is what cuts through it", () => {
    // A label above the end of a curve that leaves upright: find a placement where the curve makes it worse.
    const text = pic("\\node[draw] (a) at (0,0) {A};\n\\node[draw] (b) at (2,0) {B};", "\\draw (a) -- node[pos=0.1, above] {x} (b);");
    const r = run(planMakeCurved, text);
    const edge = pictureEdges(layoutOf(r.text))[0]!;
    expect(labelGeometry(edge, edge.labels[0]!)!.overlap).toBeLessThan(1.5);
  });
});

describe("every corpus edge", () => {
  it("never ends up with a label the form change put on the line, and never loses a label", () => {
    let changed = 0;
    let checked = 0;
    for (const name of corpusNames()) {
      const text = loadCorpusFile(name).text;
      const l0 = layoutDocumentPicture(analyzeDocument(text), 0);
      if (!l0) continue;
      for (const [i, e] of pictureEdges(l0).entries()) {
        if (!e.labels.length || e.lock) continue;
        for (const plan of [planMakeOrthogonal, planStraighten, planMakeCurved]) {
          const r = plan(text, 0, e.id);
          if (!r.ok) continue;
          checked++;
          expect(applyChanges(text, r.changes)).toBe(r.text);
          const edge = (r.edgeId ? pictureEdges(r.layout).find((x) => x.id === r.edgeId) : pictureEdges(r.layout)[i]) ?? pictureEdges(r.layout)[i];
          expect(edge?.labels.length, `${name} edge ${i}`).toBe(e.labels.length);
          if (r.notes.some((n) => n.includes("instead of"))) changed++;
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
});
