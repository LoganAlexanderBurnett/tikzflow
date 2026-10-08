// Milestone 2b step 8 (D55): the edge properties panel's edits: arrow
// direction and tips, dashes, colour and line width, for one edge or its style.
import { describe, expect, it } from "vitest";
import { applyChanges } from "../src/edit/changes.ts";
import { arrowText, type EdgeEdit, type EdgeScope, planEdgeProperty, readEdgeProps } from "../src/edit/edgeprops.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import { type Edge, pictureEdges } from "../src/model/edges.ts";
import type { PictureLayout } from "../src/tikz/layout.ts";
import { corpusNames, loadCorpusFile } from "./corpus.ts";

const NODES = "\\node[draw] (a) at (0,0) {A};\n\\node[draw] (b) at (4,-2) {B};\n\\node[draw] (c) at (1,-4) {C};";
const pic = (body: string, opts = "") => `\\begin{tikzpicture}${opts}\n${NODES}\n${body}\n\\end{tikzpicture}\n`;
const layoutOf = (text: string): PictureLayout => layoutDocumentPicture(analyzeDocument(text), 0)!;
const edgesOf = (text: string): Edge[] => pictureEdges(layoutOf(text));
const lines = (text: string) => text.split("\n").slice(4, -2);
const EDGE: EdgeScope = { kind: "edge" };

function run(text: string, edit: EdgeEdit, scope: EdgeScope = EDGE, index = 0) {
  const r = planEdgeProperty(text, 0, edgesOf(text)[index]!.id, scope, edit);
  if (!r.ok) throw new Error(r.reason);
  expect(applyChanges(text, r.changes)).toBe(r.text);
  return r;
}
const props = (text: string, index = 0) => {
  const doc = analyzeDocument(text);
  return readEdgeProps(doc, doc.syntax.pictures[0]!, edgesOf(text)[index]!);
};

describe("arrow text", () => {
  it("writes the usual forms", () => {
    expect(arrowText("none", "default")).toBe("-");
    expect(arrowText("forward", "default")).toBe("->");
    expect(arrowText("backward", "default")).toBe("<-");
    expect(arrowText("both", "default")).toBe("<->");
    expect(arrowText("forward", "Stealth")).toBe("-Stealth");
    expect(arrowText("both", "Latex")).toBe("Latex-Latex");
  });
});

describe("reading", () => {
  it("reads arrow, dash, colour and width through styles", () => {
    const text = pic("\\draw[flow, red] (a) -- (b);", "").replace("\\node[draw] (a)", "\\tikzset{flow/.style={<->, dashed, thick}}\n\\node[draw] (a)");
    const p = props(text);
    expect(p).toMatchObject({ direction: "both", tip: "default", arrowVia: "flow", dash: "dashed", dashVia: "flow", color: "red", width: "thick", widthVia: "flow" });
    expect(p.colorVia).toBeUndefined();
    expect(props(pic("\\draw (a) -- (b);"))).toMatchObject({ direction: "none", dash: "solid", width: "thin" });
    expect(props(pic("\\draw[-Stealth, line width=2pt] (a) -- (b);"))).toMatchObject({ direction: "forward", tip: "Stealth", width: "custom", widthText: "2pt" });
  });
});

describe("arrows", () => {
  it("adds, changes and removes the arrow key", () => {
    const plain = pic("\\draw (a) -- (b);");
    expect(lines(run(plain, { kind: "arrow", direction: "forward" }).text)).toEqual(["\\draw[->] (a) -- (b);"]);
    const fwd = pic("\\draw[->] (a) -- (b);");
    expect(lines(run(fwd, { kind: "arrow", direction: "both" }).text)).toEqual(["\\draw[<->] (a) -- (b);"]);
    expect(lines(run(fwd, { kind: "arrow", direction: "backward" }).text)).toEqual(["\\draw[<-] (a) -- (b);"]);
    expect(lines(run(fwd, { kind: "arrow", direction: "none" }).text)).toEqual(["\\draw (a) -- (b);"]);
    const more = pic("\\draw[thick, ->, red] (a) -- (b);");
    expect(lines(run(more, { kind: "arrow", direction: "none" }).text)).toEqual(["\\draw[thick, red] (a) -- (b);"]);
  });

  it("changes the tip and loads arrows.meta where the document has a preamble", () => {
    const doc = "\\documentclass{article}\n\\usepackage{tikz}\n\\usetikzlibrary{positioning}\n\\begin{document}\n\\begin{tikzpicture}\n\\node (a) {A};\n\\node (b) at (2,0) {B};\n\\draw[->] (a) -- (b);\n\\end{tikzpicture}\n\\end{document}\n";
    const r = run(doc, { kind: "arrow", tip: "Stealth" });
    expect(r.text).toContain("\\draw[-Stealth] (a) -- (b);");
    expect(r.text).toContain("\\usetikzlibrary{positioning, arrows.meta}");
    expect(r.notes.join(" ")).toContain("arrows.meta");
    // Back to the default tip.
    const back = run(r.text, { kind: "arrow", tip: "default" });
    expect(back.text).toContain("\\draw[->] (a) -- (b);");
  });

  it("goes back to what a style gives instead of repeating it", () => {
    const text = pic("\\draw[arrow, <-] (a) -- (b);").replace("\\node[draw] (a)", "\\tikzset{arrow/.style={->}}\n\\node[draw] (a)");
    expect(lines(run(text, { kind: "arrow", direction: "forward" }).text).slice(1)).toEqual(["\\draw[arrow] (a) -- (b);"]);
  });

  it("works on edge operations, in their own options", () => {
    const text = pic("\\path (a) edge (b);\n\\path (b) edge[dashed] (c);");
    expect(lines(run(text, { kind: "arrow", direction: "forward" }, EDGE, 0).text)).toEqual(["\\path (a) edge[->] (b);", "\\path (b) edge[dashed] (c);"]);
    expect(lines(run(text, { kind: "arrow", direction: "forward" }, EDGE, 1).text)[1]).toBe("\\path (b) edge[dashed, ->] (c);");
  });

  it("refuses to change one edge's tip in a path with several edges", () => {
    const text = pic("\\draw[->] (a) -- (b) -- (c);");
    const r = planEdgeProperty(text, 0, edgesOf(text)[0]!.id, EDGE, { kind: "arrow", direction: "none" });
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/Split/) });
    // The other properties go on the whole path.
    expect(lines(run(text, { kind: "dash", value: "dashed" }).text)).toEqual(["\\draw[->, dashed] (a) -- (b) -- (c);"]);
  });
});

describe("dashes", () => {
  it("sets and clears them", () => {
    const text = pic("\\draw (a) -- (b);");
    const dashed = run(text, { kind: "dash", value: "dashed" });
    expect(lines(dashed.text)).toEqual(["\\draw[dashed] (a) -- (b);"]);
    expect(edgesOf(dashed.text)[0]!.path.dash).not.toBeNull();
    expect(lines(run(dashed.text, { kind: "dash", value: "dotted" }).text)).toEqual(["\\draw[dotted] (a) -- (b);"]);
    expect(lines(run(dashed.text, { kind: "dash", value: "solid" }).text)).toEqual(["\\draw (a) -- (b);"]);
    const several = pic("\\draw[->, densely dashed, red] (a) -- (b);");
    expect(lines(run(several, { kind: "dash", value: "dotted" }).text)).toEqual(["\\draw[->, dotted, red] (a) -- (b);"]);
  });

  it("writes solid only to override what a style gives", () => {
    const text = pic("\\draw[dash] (a) -- (b);").replace("\\node[draw] (a)", "\\tikzset{dash/.style={dashed}}\n\\node[draw] (a)");
    expect(lines(run(text, { kind: "dash", value: "solid" }).text)[1]).toBe("\\draw[dash, solid] (a) -- (b);");
    expect(lines(run(text, { kind: "dash", value: "dashed" }).text)[1]).toBe("\\draw[dash] (a) -- (b);");
  });
});

describe("colour", () => {
  it("keeps the form the edge uses", () => {
    expect(lines(run(pic("\\draw[red, ->] (a) -- (b);"), { kind: "color", value: "blue!60" }).text)).toEqual(["\\draw[blue!60, ->] (a) -- (b);"]);
    expect(lines(run(pic("\\draw[draw=red, ->] (a) -- (b);"), { kind: "color", value: "teal" }).text)).toEqual(["\\draw[draw=teal, ->] (a) -- (b);"]);
    expect(lines(run(pic("\\draw[color=red] (a) -- (b);"), { kind: "color", value: "teal" }).text)).toEqual(["\\draw[color=teal] (a) -- (b);"]);
    expect(lines(run(pic("\\draw[->] (a) -- (b);"), { kind: "color", value: "teal" }).text)).toEqual(["\\draw[->, draw=teal] (a) -- (b);"]);
    expect(lines(run(pic("\\draw (a) -- (b);"), { kind: "color", value: "{rgb,255:red,10;green,20;blue,30}" }).text)).toEqual(["\\draw[draw={rgb,255:red,10;green,20;blue,30}] (a) -- (b);"]);
  });

  it("drops the edge's own colour", () => {
    expect(lines(run(pic("\\draw[red, ->] (a) -- (b);"), { kind: "color", value: null }).text)).toEqual(["\\draw[->] (a) -- (b);"]);
    expect(lines(run(pic("\\draw[draw=red] (a) -- (b);"), { kind: "color", value: null }).text)).toEqual(["\\draw (a) -- (b);"]);
  });

  it("changes the stroke as drawn", () => {
    const r = run(pic("\\draw (a) -- (b);"), { kind: "color", value: "red" });
    expect(edgesOf(r.text)[0]!.path.stroke![0]).toBeGreaterThan(0.9);
  });
});

describe("line width", () => {
  it("sets named widths and goes back to the default", () => {
    const text = pic("\\draw[->] (a) -- (b);");
    const thick = run(text, { kind: "width", value: "thick" });
    expect(lines(thick.text)).toEqual(["\\draw[->, thick] (a) -- (b);"]);
    expect(edgesOf(thick.text)[0]!.path.lineWidth).toBeCloseTo(0.8, 2);
    expect(lines(run(thick.text, { kind: "width", value: "very thick" }).text)).toEqual(["\\draw[->, very thick] (a) -- (b);"]);
    expect(lines(run(thick.text, { kind: "width", value: null }).text)).toEqual(["\\draw[->] (a) -- (b);"]);
    expect(lines(run(pic("\\draw[line width=2pt] (a) -- (b);"), { kind: "width", value: "semithick" }).text)).toEqual(["\\draw[semithick] (a) -- (b);"]);
  });
});

describe("styles", () => {
  const withStyle = (body: string) => pic(body).replace("\\node[draw] (a)", "\\tikzset{flow/.style={->, thick}}\n\\node[draw] (a)");

  it("edits the style, so every edge using it changes, and says how many", () => {
    const text = withStyle("\\draw[flow] (a) -- (b);\n\\draw[flow] (b) -- (c);\n\\draw (a) -- (c);");
    const r = run(text, { kind: "dash", value: "dashed" }, { kind: "style", name: "flow" });
    expect(r.text).toContain("flow/.style={->, thick, dashed}");
    expect(r.notes.join(" ")).toMatch(/1 other edge uses the flow style/);
    expect(edgesOf(r.text).map((e) => e.path.dash !== null)).toEqual([true, true, false]);
    const arrow = run(text, { kind: "arrow", direction: "both" }, { kind: "style", name: "flow" });
    expect(arrow.text).toContain("flow/.style={<->, thick}");
    const width = run(text, { kind: "width", value: "very thick" }, { kind: "style", name: "flow" });
    expect(width.text).toContain("flow/.style={->, very thick}");
  });

  it("this edge on top of a style keeps the style alone", () => {
    const text = withStyle("\\draw[flow] (a) -- (b);\n\\draw[flow] (b) -- (c);");
    const r = run(text, { kind: "dash", value: "dotted" }, EDGE, 0);
    expect(lines(r.text).slice(1, 3)).toEqual(["\\draw[flow, dotted] (a) -- (b);", "\\draw[flow] (b) -- (c);"]);
  });

  it("refuses a style it can't edit", () => {
    const text = pic("\\draw[flow] (a) -- (b);");
    expect(planEdgeProperty(text, 0, edgesOf(text)[0]!.id, { kind: "style", name: "flow" }, { kind: "dash", value: "dashed" })).toMatchObject({ ok: false });
  });
});

describe("refusals", () => {
  it("refuses a missing edge, and a style it doesn't know", () => {
    const text = pic("\\draw (a) -- (b);");
    expect(planEdgeProperty(text, 0, "path@1:9", EDGE, { kind: "dash", value: "dashed" })).toMatchObject({ ok: false });
    expect(planEdgeProperty(text, 0, edgesOf(text)[0]!.id, { kind: "style", name: "nope" }, { kind: "dash", value: "dashed" })).toMatchObject({ ok: false });
  });

  it("leaves locked edges alone", () => {
    const text = pic("\\draw (a) -- (b) -- (2,-4) -- cycle;");
    const e = edgesOf(text)[0];
    if (e?.lock) expect(planEdgeProperty(text, 0, e.id, EDGE, { kind: "dash", value: "dashed" })).toMatchObject({ ok: false });
  });
});

describe("the corpus", () => {
  it("sets every editable edge dashed, thick, red and double-headed, changing only option text", () => {
    let tried = 0;
    let done = 0;
    for (const name of corpusNames()) {
      const text = loadCorpusFile(name).text;
      const doc = analyzeDocument(text);
      doc.syntax.pictures.forEach((_, i) => {
        const l = layoutDocumentPicture(doc, i)!;
        for (const e of pictureEdges(l)) {
          if (e.lock) continue;
          for (const edit of [{ kind: "dash", value: "dashed" }, { kind: "width", value: "thick" }, { kind: "color", value: "red" }, { kind: "arrow", direction: "both" }] as EdgeEdit[]) {
            tried++;
            const r = planEdgeProperty(text, i, e.id, EDGE, edit);
            if (!r.ok) {
              expect(r.reason, name).toBeTruthy();
              continue;
            }
            done++;
            expect(applyChanges(text, r.changes), name).toBe(r.text);
            // Only the edge's statement and the preamble's libraries change.
            for (const c of r.changes) {
              const inStatement = c.from >= e.path.syntax.from - 1 && c.to <= e.path.syntax.to + 1;
              const inLibraries = /usetikzlibrary/.test(text.slice(Math.max(0, c.from - 80), c.to + 40)) || /arrows\.meta/.test(c.insert);
              expect(inStatement || inLibraries, `${name}: ${JSON.stringify(c)}`).toBe(true);
            }
          }
        }
      });
    }
    expect(tried).toBeGreaterThan(400);
    expect(done / tried).toBeGreaterThan(0.8);
  }, 60000);
});
