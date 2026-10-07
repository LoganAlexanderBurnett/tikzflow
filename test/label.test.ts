// Milestone 2a step 5: editing a node's label in place. Only the label's own
// characters change, and text that would break the statement is refused.
import { describe, expect, it } from "vitest";
import { diffRange } from "../src/edit/changes.ts";
import { draftOf, labelBlocker, labelProblem, planLabelEdit } from "../src/edit/label.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import { SAMPLE } from "../src/ui/sample.ts";
import { loadCorpus } from "./corpus.ts";

const pic = (body: string) => `\\begin{tikzpicture}\n${body}\n\\end{tikzpicture}\n`;

function edit(text: string, id: string, draft: string) {
  return planLabelEdit(text, 0, id, draft);
}

function ok(text: string, id: string, draft: string) {
  const r = edit(text, id, draft);
  if (!r.ok) throw new Error(r.reason);
  return r;
}

describe("what a label may contain", () => {
  it("accepts ordinary TeX", () => {
    for (const s of ["", "Start", "Return\\\\ $n \\cdot f(n-1)$", "\\textbf{Bold} and {grouped}", "50\\% done", "a\\{b", "line one\nline two", "note % comment\nnext"]) {
      expect(labelProblem(s), s).toBeNull();
    }
  });

  it("refuses text that would break the statement", () => {
    expect(labelProblem("a } b")).toMatch(/no matching "\{"/);
    expect(labelProblem("a { b")).toMatch(/no matching "\}"/);
    expect(labelProblem("50% done")).toMatch(/comment/);
    expect(labelProblem("ends with \\")).toMatch(/backslash/);
    expect(labelProblem("{ok} but }")).not.toBeNull();
  });
});

describe("planLabelEdit", () => {
  it("changes only the characters that differ", () => {
    const text = pic("\\node[draw] (a) at (0,0) {Hello world};\n\\node (b) at (3,0) {B};");
    const r = ok(text, "a", "Hello there");
    expect(r.text).toContain("\\node[draw] (a) at (0,0) {Hello there};");
    const d = diffRange(text, r.text)!;
    expect(text.slice(d.from, d.to)).toBe("world");
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0]!.to - r.changes[0]!.from).toBe(5);
  });

  it("does nothing when the label is unchanged", () => {
    const text = pic("\\node (a) at (0,0) {Same};");
    const r = ok(text, "a", "Same");
    expect(r.changes).toEqual([]);
    expect(r.text).toBe(text);
  });

  it("edits math, line breaks and nested braces as written", () => {
    const text = pic("\\node[align=center] (a) at (0,0) {Return\\\\ $n \\cdot f(n-1)$};");
    const r = ok(text, "a", "Return\\\\ $n! \\cdot \\textbf{f}(n-1)$");
    expect(r.text).toContain("{Return\\\\ $n! \\cdot \\textbf{f}(n-1)$};");
    expect(layoutDocumentPicture(analyzeDocument(r.text), 0)!.nodes[0]!.text!.lines.length).toBe(2);
  });

  it("fills an empty label", () => {
    const text = pic("\\node[draw] (a) at (0,0) {};");
    expect(ok(text, "a", "Now text").text).toContain("{Now text};");
  });

  it("keeps a label's own comments and line breaks", () => {
    const text = pic("\\node[draw] (a) at (0,0) {First % why\n    second};\n\\node (b) at (2,0) {B};");
    const r = ok(text, "a", "First % why\n    second line");
    expect(r.text).toContain("{First % why\n    second line};");
  });

  it("writes line breaks in the file's own style", () => {
    const text = "\\begin{tikzpicture}\r\n\\node[draw] (a) at (0,0) {One\r\nTwo};\r\n\\end{tikzpicture}\r\n";
    const r = ok(text, "a", `${draftOf("One\r\nTwo")}\nThree`);
    expect(r.text).toContain("{One\r\nTwo\r\nThree};");
    expect(r.text.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("works on nodes the editor can't move", () => {
    const text = pic("\\node[draw, right=of ghost] (c) {C};");
    expect(layoutDocumentPicture(analyzeDocument(text), 0)!.nodes[0]!.locked).toBeTruthy();
    expect(ok(text, "c", "Changed").text).toContain("{Changed};");
  });

  it("refuses text that would break the code, and says why", () => {
    const text = pic("\\node (a) at (0,0) {A};");
    const r = edit(text, "a", "oops } \\draw (0,0) -- (1,1); {");
    expect(r.ok).toBe(false);
    const r2 = edit(text, "a", "100% sure");
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toMatch(/comment/);
  });

  it("refuses coordinates and unknown nodes", () => {
    const text = pic("\\coordinate (o) at (0,0);\n\\node (a) at (1,0) {A};");
    expect(labelBlocker(text, 0, "o")).toMatch(/Only a node/);
    expect(edit(text, "nope", "x").ok).toBe(false);
  });

  it("an unclosed label is left alone", () => {
    const text = "\\begin{tikzpicture}\n\\node (a) at (0,0) {A\n\\end{tikzpicture}\n";
    const l = layoutDocumentPicture(analyzeDocument(text), 0);
    const n = l?.nodes.find((x) => x.kind === "statement");
    if (n) expect(labelBlocker(text, 0, n.id)).toMatch(/isn't closed/);
  });

  it("the sample's labels edit cleanly", () => {
    const r = ok(SAMPLE, "start", "Begin");
    expect(r.text).toContain("(start) {Begin};");
    const r2 = ok(SAMPLE, "rec", "Return\\\\ $n \\cdot (n-1)!$");
    expect(r2.text).toContain("(rec)   {Return\\\\ $n \\cdot (n-1)!$};");
  });
});

describe("every corpus picture", () => {
  // Adding a letter to every closed label changes exactly that letter, and
  // nothing else about the picture.
  for (const file of loadCorpus()) {
    it(`${file.name}: appending a character to each label changes one character`, () => {
      const doc = analyzeDocument(file.text);
      for (let p = 0; p < doc.syntax.pictures.length; p++) {
        const layout = layoutDocumentPicture(doc, p);
        if (!layout) continue;
        for (const n of layout.nodes) {
          if (n.kind !== "statement" || labelBlocker(file.text, p, n.id)) continue;
          const source = draftOf(n.syntax.label!.text);
          if (labelProblem(`${source}x`)) continue;
          const r = planLabelEdit(file.text, p, n.id, `${source}x`);
          if (!r.ok) continue;
          expect(r.text.length, `${file.name} ${n.id}`).toBe(file.text.length + 1);
          const d = diffRange(file.text, r.text)!;
          expect(d.to - d.from, `${file.name} ${n.id}`).toBe(0);
          expect(d.insert, `${file.name} ${n.id}`).toBe("x");
          expect(d.from).toBeGreaterThanOrEqual(n.syntax.label!.inner.from);
          expect(d.from).toBeLessThanOrEqual(n.syntax.label!.inner.to);
        }
      }
    });
  }
});
