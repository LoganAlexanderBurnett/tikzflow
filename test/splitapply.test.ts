// Milestone 3 step 3 (D58 item 5, D62): "Split and apply" sets an arrow tip on
// one edge of a \draw with several edges, by splitting the path first, as one
// set of changes.
import { describe, expect, it } from "vitest";
import { applyChanges } from "../src/edit/changes.ts";
import { type EdgeEdit, planSplitAndApply } from "../src/edit/edgeprops.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import { pictureEdges } from "../src/model/edges.ts";

const NODES = "\\node[draw] (a) at (0,0) {A};\n\\node[draw] (b) at (4,-2) {B};\n\\node[draw] (c) at (1,-4) {C};\n\\node[draw] (d) at (5,-5) {D};";
const pic = (body: string, pre = "") => `${pre}\\begin{tikzpicture}\n${NODES}\n${body}\n\\end{tikzpicture}\n`;
const edgesOf = (text: string) => pictureEdges(layoutDocumentPicture(analyzeDocument(text), 0)!);
/** The statements after the four nodes. */
const lines = (text: string) => text.split("\n").filter((l) => l.startsWith("\\draw") || l.startsWith("\\path"));
const tips = (text: string) => edgesOf(text).map((e) => e.path.tips.length);

function run(text: string, index: number, edit: EdgeEdit) {
  const r = planSplitAndApply(text, 0, edgesOf(text)[index]!.id, edit);
  if (!r.ok) throw new Error(r.reason);
  expect(applyChanges(text, r.changes)).toBe(r.text);
  return r;
}

describe("split and apply", () => {
  it("splits the path and sets the tip on the chosen edge only", () => {
    const text = pic("\\draw (a) -- (b) -- (c);");
    const r = run(text, 0, { kind: "arrow", direction: "forward" });
    expect(lines(r.text)).toEqual(["\\draw[->] (a) -- (b);", "\\draw (b) -- (c);"]);
    expect(tips(r.text)).toEqual([1, 0]);
    // The returned edge is the one that was asked about.
    const e = edgesOf(r.text).find((x) => x.id === r.edgeId)!;
    expect(e.path.tips).toHaveLength(1);
    expect(r.notes[0]).toMatch(/split the \\draw into 2 statements/);
  });

  it("keeps the tips the other edges had", () => {
    const text = pic("\\draw[->] (a) -- (b) -- (c) -- (d);");
    const r = run(text, 0, { kind: "arrow", direction: "forward" });
    expect(lines(r.text)).toEqual(["\\draw[->] (a) -- (b);", "\\draw (b) -- (c);", "\\draw[->] (c) -- (d);"]);
    const back = run(text, 2, { kind: "arrow", direction: "none" });
    expect(lines(back.text)).toEqual(["\\draw (a) -- (b);", "\\draw (b) -- (c);", "\\draw (c) -- (d);"]);
    expect(tips(back.text)).toEqual([0, 0, 0]);
  });

  it("can set both ends on a middle edge, keeping the path's other options", () => {
    const text = pic("\\draw[thick] (a) -- (b) -- (c) -- (d);");
    const r = run(text, 1, { kind: "arrow", direction: "both" });
    expect(tips(r.text)).toEqual([0, 2, 0]);
    expect(lines(r.text).every((l) => /^\\draw\[thick(, <->)?\]/.test(l))).toBe(true);
  });

  it("is one set of changes against the original text, touching only the statement", () => {
    const text = pic("\\draw[red] (a) -- (b) -- (c); % flow");
    const r = run(text, 1, { kind: "arrow", direction: "backward", tip: "default" });
    expect(tips(r.text)).toEqual([0, 1]);
    expect(r.text).toContain("% flow");
    const at = text.indexOf("\\draw");
    expect(r.text.slice(0, at)).toBe(text.slice(0, at));
    for (const c of r.changes) expect(c.from).toBeGreaterThanOrEqual(at);
  });

  it("changes nothing but the split when the edge already has that arrow", () => {
    const text = pic("\\draw[->] (a) -- (b) -- (c);");
    const r = run(text, 1, { kind: "arrow", direction: "forward" });
    expect(lines(r.text)).toEqual(["\\draw (a) -- (b);", "\\draw[->] (b) -- (c);"]);
    expect(r.notes.join(" ")).toMatch(/already had that arrow/);
  });

  it("refuses, writing nothing, when the path can't be split", () => {
    const edge = pic("\\draw (a) -- (b) edge (c);");
    expect(planSplitAndApply(edge, 0, edgesOf(edge)[0]!.id, { kind: "arrow", direction: "forward" }).ok).toBe(false);
    const single = pic("\\draw (a) -- (b);");
    expect(planSplitAndApply(single, 0, edgesOf(single)[0]!.id, { kind: "arrow", direction: "forward" })).toMatchObject({ ok: false, reason: expect.stringMatching(/only one edge/) });
  });

  it("only handles arrows", () => {
    const text = pic("\\draw (a) -- (b) -- (c);");
    expect(planSplitAndApply(text, 0, edgesOf(text)[0]!.id, { kind: "dash", value: "dashed" })).toMatchObject({ ok: false });
  });

  it("works with tips that come from a style, or refuses with a reason", () => {
    const text = pic("\\draw[flow] (a) -- (b) -- (c);", "\\tikzset{flow/.style={->}}\n");
    const r = planSplitAndApply(text, 0, edgesOf(text)[0]!.id, { kind: "arrow", direction: "forward" });
    if (r.ok) expect(tips(r.text)[0]).toBe(1);
    else expect(r.reason).toBeTruthy();
  });
});
