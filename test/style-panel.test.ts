// Milestone 2a step 7: the style panel (editing a style's definition),
// factoring repeated options into a named style, and matching sizes.
import { describe, expect, it } from "vitest";
import { applyChanges, diffRange } from "../src/edit/changes.ts";
import { planMatch } from "../src/edit/resize.ts";
import type { Scope } from "../src/edit/properties.ts";
import { findRepeats, planFactor, planStyleEdit, styleInfos, styleNameProblem } from "../src/edit/styleedit.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import type { LaidOutNode, PictureLayout } from "../src/tikz/layout.ts";
import { PT_PER_UNIT } from "../src/tikz/units.ts";
import { SAMPLE } from "../src/ui/sample.ts";
import { corpusNames, loadCorpusFile } from "./corpus.ts";

const MM = PT_PER_UNIT.mm!;
const layoutOf = (text: string, pic = 0): PictureLayout => layoutDocumentPicture(analyzeDocument(text), pic)!;
const node = (text: string, id: string): LaidOutNode => layoutOf(text).nodes.find((n) => n.id === id)!;
const infos = (text: string) => {
  const doc = analyzeDocument(text);
  return styleInfos(doc, doc.syntax.pictures[0]!, layoutDocumentPicture(doc, 0)!);
};
const pic = (body: string, pre = "") => `${pre}\\begin{tikzpicture}\n${body}\n\\end{tikzpicture}\n`;

describe("the style list", () => {
  it("lists the figure's styles with the nodes that use them", () => {
    const list = infos(SAMPLE);
    expect(list.map((s) => s.name)).toEqual(expect.arrayContaining(["base", "terminal", "process", "decision", "io"]));
    const process = list.find((s) => s.name === "process")!;
    expect(process.users.map((n) => n.name).sort()).toEqual(["base", "rec"]);
    expect(process.body).toBe("base, fill=blue!8");
    // A style other styles build on counts their nodes too.
    expect(list.find((s) => s.name === "base")!.users.length).toBe(6);
  });

  it("explains a style it can't edit", () => {
    const text = pic("\\node[arg=red] {A};", "\\tikzset{arg/.style={fill=#1}}\n");
    expect(infos(text).find((s) => s.name === "arg")!.reason).toMatch(/argument/);
  });
});

describe("editing a style", () => {
  it("changes only the characters that differ, and every node using it follows", () => {
    const r = planStyleEdit(SAMPLE, 0, "process", "base, fill=red!10");
    if (!r.ok) throw new Error(r.reason);
    expect(r.users).toBe(2);
    const d = diffRange(SAMPLE, r.text)!;
    expect(SAMPLE.slice(d.from, d.to)).toBe("blue!8");
    expect(r.text).toContain("process/.style  = {base, fill=red!10},");
    const before = node(SAMPLE, "rec").fill;
    expect(node(r.text, "rec").fill).not.toEqual(before);
    expect(node(r.text, "base").fill).toEqual(node(r.text, "rec").fill);
    // Other styles are untouched.
    expect(node(r.text, "start").fill).toEqual(node(SAMPLE, "start").fill);
  });

  it("keeps multi-line bodies and CRLF line endings", () => {
    const crlf = SAMPLE.replace(/\n/g, "\r\n");
    const r = planStyleEdit(crlf, 0, "io", "base, trapezium, trapezium left angle=60,\r\n trapezium right angle=120, fill=gray!12");
    if (!r.ok) throw new Error(r.reason);
    expect(r.text).toContain("left angle=60,\r\n trapezium right");
    expect(r.text.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("edits a \\tikzstyle in brackets", () => {
    const text = pic("\\node[box] {A};", "\\tikzstyle{box}=[draw, fill=blue!10]\n");
    const r = planStyleEdit(text, 0, "box", "draw, fill=green!10");
    if (!r.ok) throw new Error(r.reason);
    expect(r.text).toContain("\\tikzstyle{box}=[draw, fill=green!10]");
  });

  it("refuses text that would break the code", () => {
    for (const bad of ["draw, fill={red", "draw}, fill=red", "draw % comment", "draw\\"]) {
      const r = planStyleEdit(SAMPLE, 0, "process", bad);
      expect(r.ok, bad).toBe(false);
    }
    const bracket = planStyleEdit(pic("\\node[box] {A};", "\\tikzstyle{box}=[draw]\n"), 0, "box", "draw] x");
    expect(bracket.ok).toBe(false);
  });

  it("changes nothing when the body is the same", () => {
    const r = planStyleEdit(SAMPLE, 0, "process", "base, fill=blue!8");
    expect(r.ok && r.changes.length === 0).toBe(true);
  });
});

describe("repeated options", () => {
  const body = [
    "\\node[draw, fill=blue!10, rounded corners] (a) at (0,0) {A};",
    "\\node[draw, fill=blue!10, rounded corners, below=of a] (b) {B};",
    "\\node[draw, fill=blue!10, rounded corners, below=of b] (c) {C};",
    "\\node[draw, fill=green!10, below=of c] (d) {D};",
  ].join("\n");
  const text = pic(body, "\\usetikzlibrary{positioning}\n");

  it("finds options three nodes write out, and suggests a name", () => {
    const doc = analyzeDocument(text);
    const reps = findRepeats(doc, doc.syntax.pictures[0]!, layoutDocumentPicture(doc, 0)!);
    expect(reps).toHaveLength(1);
    expect(reps[0]!.items).toEqual(["draw", "fill=blue!10", "rounded corners"]);
    expect(reps[0]!.nodes).toEqual(["a", "b", "c"]);
    expect(reps[0]!.suggestion).toBe("blueBox");
  });

  it("ignores placement, and sets that are too small to matter", () => {
    const small = pic("\\node[draw, right=of x] (a) {A};\n\\node[draw, right=of a] (b) {B};\n\\node[draw, right=of b] (c) {C};");
    const doc = analyzeDocument(small);
    expect(findRepeats(doc, doc.syntax.pictures[0]!, layoutDocumentPicture(doc, 0)!)).toEqual([]);
  });

  it("factors them into a style: the nodes look the same and the style lands in the preamble", () => {
    const doc = analyzeDocument(text);
    const rep = findRepeats(doc, doc.syntax.pictures[0]!, layoutDocumentPicture(doc, 0)!)[0]!;
    const r = planFactor(text, 0, rep, "blueBox");
    if (!r.ok) throw new Error(r.reason);
    expect(r.nodes).toBe(3);
    // The first repeated option gives its place to the style; the others go.
    expect(r.text).toContain("\\node[blueBox] (a) at (0,0) {A};");
    expect(r.text).toContain("\\node[blueBox, below=of a] (b) {B};");
    expect(r.text).toContain("\\node[draw, fill=green!10, below=of c] (d) {D};");
    // A bare picture's style goes in its options; this one has a preamble line, so a \tikzset.
    expect(r.text).toMatch(/blueBox\/\.style=\{draw, fill=blue!10, rounded corners\}/);
    const before = layoutOf(text);
    const after = layoutOf(r.text);
    for (const n of before.nodes) {
      const m = after.nodes.find((x) => x.id === n.id)!;
      expect(m.shape.center).toEqual(n.shape.center);
      expect(m.fill).toEqual(n.fill);
    }
    // The panel finds nothing left to factor.
    const doc2 = analyzeDocument(r.text);
    expect(findRepeats(doc2, doc2.syntax.pictures[0]!, layoutDocumentPicture(doc2, 0)!)).toEqual([]);
  });

  it("refuses when an option between them would override one", () => {
    const tricky = pic(
      [
        "\\node[draw, fill=blue!10, rounded corners] (a) at (0,0) {A};",
        "\\node[rounded corners, fill=red, fill=blue!10, draw] (b) at (3,0) {B};",
        "\\node[draw, fill=blue!10, rounded corners] (c) at (6,0) {C};",
      ].join("\n"),
    );
    const doc = analyzeDocument(tricky);
    const rep = findRepeats(doc, doc.syntax.pictures[0]!, layoutDocumentPicture(doc, 0)!)[0]!;
    const r = planFactor(tricky, 0, rep, "blueBox");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/would change how b looks/);
  });

  it("refuses a name that is taken or would shadow a TikZ key", () => {
    const doc = analyzeDocument(SAMPLE);
    const p = doc.syntax.pictures[0]!;
    expect(styleNameProblem(doc, p, "process")).toMatch(/already/);
    expect(styleNameProblem(doc, p, "diamond")).toMatch(/shadow/);
    expect(styleNameProblem(doc, p, "2fast")).toMatch(/letters/);
    expect(styleNameProblem(doc, p, "myBox")).toBeNull();
  });

  it("works on every picture of the corpus, never changing how anything looks", () => {
    let factored = 0;
    for (const name of corpusNames()) {
      const t = loadCorpusFile(name).text;
      const doc = analyzeDocument(t);
      doc.syntax.pictures.forEach((p, i) => {
        const l = layoutDocumentPicture(doc, i)!;
        for (const rep of findRepeats(doc, p, l)) {
          const r = planFactor(t, i, rep, rep.suggestion);
          if (!r.ok) continue;
          factored++;
          expect(applyChanges(t, r.changes), name).toBe(r.text);
          expect(analyzeDocument(r.text).errors.length, name).toBeLessThanOrEqual(doc.errors.length);
        }
      });
    }
    expect(factored).toBeGreaterThan(0);
  });
});

describe("matching sizes", () => {
  const text = pic(
    [
      "\\node[draw, minimum width=3cm] (a) at (0,0) {A};",
      "\\node[draw] (b) at (0,-2) {Much longer label};",
      "\\node[draw, minimum width=5cm] (c) at (0,-4) {C};",
    ].join("\n"),
  );
  const nodes: Scope = { kind: "nodes", ids: ["a", "b", "c"] };
  const run = (axis: "w" | "h", ids: string[], scope: Scope = nodes, t = text) => {
    const doc = analyzeDocument(t);
    return planMatch(doc, 0, layoutDocumentPicture(doc, 0)!, ids, axis, scope);
  };

  it("gives the other nodes the first one's width, in round millimetres", () => {
    const r = run("w", ["a", "b", "c"]);
    if (!r.ok) throw new Error(r.reason);
    expect(r.changed).toEqual(["b", "c"]);
    for (const id of ["b", "c"]) expect(Math.abs(2 * node(r.text, id).shape.hw - 2 * node(text, "a").shape.hw)).toBeLessThan(0.6 * MM);
    expect(r.text).toContain("\\node[draw, minimum width=5cm] (c)".replace("5cm", "3cm"));
    expect(r.text).toMatch(/\(b\) at \(0,-2\) \{Much longer label\}/);
    // Only the nodes' own statements change.
    expect(applyChanges(text, r.changes)).toBe(r.text);
  });

  it("uses the first selected node, not the biggest", () => {
    const r = run("w", ["c", "a", "b"]);
    if (!r.ok) throw new Error(r.reason);
    expect(Math.abs(2 * node(r.text, "a").shape.hw - 2 * node(text, "c").shape.hw)).toBeLessThan(0.6 * MM);
  });

  it("matches heights too", () => {
    const tall = pic("\\node[draw, minimum height=2cm] (a) at (0,0) {A};\n\\node[draw] (b) at (3,0) {B};");
    const r = run("h", ["a", "b"], { kind: "nodes", ids: ["a", "b"] }, tall);
    if (!r.ok) throw new Error(r.reason);
    expect(Math.abs(2 * node(r.text, "b").shape.hh - 2 * node(tall, "a").shape.hh)).toBeLessThan(0.6 * MM);
  });

  it("with a style chosen, the style takes the size and every node using it changes", () => {
    const styled = pic(
      "\\tikzset{box/.style={draw}}\n\\node[box, minimum width=3cm] (a) at (0,0) {A};\n\\node[box] (b) at (0,-2) {B};\n\\node[box] (c) at (0,-4) {C};",
    );
    const r = run("w", ["a", "b"], { kind: "style", name: "box" }, styled);
    if (!r.ok) throw new Error(r.reason);
    expect(r.text).toMatch(/box\/\.style=\{draw, minimum width=3cm\}/);
    expect(Math.abs(2 * node(r.text, "c").shape.hw - 2 * node(styled, "a").shape.hw)).toBeLessThan(0.6 * MM);
  });

  it("says when there is nothing to do or nothing selected to match", () => {
    expect(run("w", ["a"]).ok).toBe(false);
    const same = pic("\\node[draw, minimum width=3cm] (a) at (0,0) {A};\n\\node[draw, minimum width=3cm] (b) at (0,-2) {B};");
    const r = run("w", ["a", "b"], { kind: "nodes", ids: ["a", "b"] }, same);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/already/);
  });

  it("leaves nodes it can't resize alone and says why", () => {
    const withFit = pic("\\node[draw, minimum width=3cm] (a) at (0,0) {A};\n\\node[draw, fit=(a)] (f) {};\n\\node[draw] (b) at (0,-2) {BBBBBBBB};");
    const r = run("w", ["a", "f", "b"], { kind: "nodes", ids: ["a", "f", "b"] }, withFit);
    if (!r.ok) throw new Error(r.reason);
    expect(r.changed).toEqual(["b"]);
    expect(r.notes.join(" ")).toMatch(/fit|follows/);
  });
});
