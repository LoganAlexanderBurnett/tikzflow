// Milestone 3 step 11 (D72): the .tex exports and the SVG made ready to save.
import { describe, expect, it } from "vitest";
import { tidySvg } from "../src/export/svg.ts";
import { snippetTex, standaloneTex } from "../src/export/tex.ts";
import { analyzeDocument } from "../src/model/document.ts";
import { loadCorpusFile } from "./corpus.ts";

const BARE = [
  "\\usetikzlibrary{positioning}",
  "\\tikzset{box/.style={draw, rounded corners}}",
  "\\begin{tikzpicture}",
  "  \\node[box] (a) {A}; % the first",
  "  \\node[box, right=of a] (b) {B};",
  "\\end{tikzpicture}",
  "",
].join("\n");

const FULL = [
  "\\documentclass[11pt]{article}",
  "\\usepackage{amsmath}",
  "\\usepackage{tikz}",
  "\\usetikzlibrary{arrows.meta}",
  "\\newcommand{\\state}[1]{\\mathbf{#1}}",
  "\\begin{document}",
  "Text.",
  "\\begin{figure}",
  "\\begin{tikzpicture}",
  "  \\node (a) {$\\state{A}$};",
  "\\end{tikzpicture}",
  "\\end{figure}",
  "\\end{document}",
  "",
].join("\n");

const doc = (t: string) => analyzeDocument(t);

describe("the standalone document", () => {
  it("wraps a bare picture, with the code's definitions in the preamble and the picture untouched", () => {
    const x = standaloneTex(doc(BARE), 0, null)!;
    expect(x.text).toBe(
      [
        "\\documentclass[tikz,border=5pt]{standalone}",
        "\\usetikzlibrary{positioning}",
        "\\tikzset{box/.style={draw, rounded corners}}",
        "",
        "\\begin{document}",
        "\\begin{tikzpicture}",
        "  \\node[box] (a) {A}; % the first",
        "  \\node[box, right=of a] (b) {B};",
        "\\end{tikzpicture}",
        "\\end{document}",
        "",
      ].join("\n"),
    );
    expect(x.notes).toEqual([]);
  });

  it("puts the imported preamble first, without its documentclass and its text", () => {
    const x = standaloneTex(doc(BARE), 0, "\\documentclass[twocolumn]{article}\n\\usepackage{amsmath}\n\\newcommand{\\x}{y}\n\\begin{document}\nIgnored\n\\end{document}")!;
    const lines = x.text.split("\n");
    expect(lines.slice(0, 4)).toEqual(["\\documentclass[tikz,border=5pt]{standalone}", "\\usepackage{amsmath}", "\\newcommand{\\x}{y}", "\\usetikzlibrary{positioning}"]);
    expect(x.text).not.toContain("Ignored");
    expect(x.text).not.toContain("article");
    expect(x.notes).toEqual(["Your paper's preamble is included."]);
  });

  it("takes a full document's preamble and only the picture's own text", () => {
    const x = standaloneTex(doc(FULL), 0, "\\usepackage{ignored}")!;
    expect(x.text).toBe(
      [
        "\\documentclass[tikz,border=5pt]{standalone}",
        "\\usepackage{amsmath}",
        "\\usepackage{tikz}",
        "\\usetikzlibrary{arrows.meta}",
        "\\newcommand{\\state}[1]{\\mathbf{#1}}",
        "",
        "\\begin{document}",
        "\\begin{tikzpicture}",
        "  \\node (a) {$\\state{A}$};",
        "\\end{tikzpicture}",
        "\\end{document}",
        "",
      ].join("\n"),
    );
    expect(x.notes).toEqual([]);
  });

  it("keeps the source's line endings", () => {
    const x = standaloneTex(doc(BARE.replace(/\n/g, "\r\n")), 0, null)!;
    expect(x.text.replace(/\r\n/g, "")).not.toContain("\n");
    expect(x.text).toContain("\\end{tikzpicture}\r\n\\end{document}\r\n");
  });

  it("says when a class other than the standard ones is replaced", () => {
    const x = standaloneTex(doc(FULL.replace("{article}", "{IEEEtran}")), 0, null)!;
    expect(x.notes[0]).toContain("IEEEtran class is replaced by standalone");
  });

  it("has nothing to export without a picture", () => {
    expect(standaloneTex(doc("\\documentclass{article}"), 0, null)).toBeNull();
    expect(snippetTex(doc("hello"), 0)).toBeNull();
  });

  it("exports every corpus picture with the picture's text unchanged", () => {
    for (const name of ["self-document.tex", "self-figure-multi.tex", "self-latin1.tex", "self-bom-crlf-unicode.tex"]) {
      const d = doc(loadCorpusFile(name).text);
      d.syntax.pictures.forEach((pic, i) => {
        const x = standaloneTex(d, i, null)!;
        expect(x.text, name).toContain(d.text.slice(pic.from, pic.to));
        expect(x.text.startsWith("\\documentclass[tikz,border=5pt]{standalone}")).toBe(true);
        // It re-parses to one picture, the same one.
        const back = analyzeDocument(x.text);
        expect(back.syntax.pictures, name).toHaveLength(1);
        expect(back.text.slice(back.syntax.pictures[0]!.from, back.syntax.pictures[0]!.to)).toBe(d.text.slice(pic.from, pic.to));
      });
    }
  });
});

describe("the snippet", () => {
  it("is the picture, with the preamble lines it needs as a comment above it", () => {
    const x = snippetTex(doc(BARE), 0)!;
    expect(x.text).toBe(
      [
        '% Put these lines in your preamble (without the leading "% "):',
        "% \\usepackage{tikz}",
        "% \\usetikzlibrary{positioning}",
        "% \\tikzset{box/.style={draw, rounded corners}}",
        "",
        "% The figure:",
        "\\begin{tikzpicture}",
        "  \\node[box] (a) {A}; % the first",
        "  \\node[box, right=of a] (b) {B};",
        "\\end{tikzpicture}",
        "",
      ].join("\n"),
    );
  });

  it("is safe to paste whole: nothing but comments comes before \\begin{tikzpicture}", () => {
    for (const t of [BARE, FULL]) {
      const x = snippetTex(doc(t), 0)!;
      const before = x.text.slice(0, x.text.indexOf("\\begin{tikzpicture}")).split("\n").filter((l) => l.trim());
      expect(before.every((l) => l.startsWith("%"))).toBe(true);
    }
  });

  it("with no definitions says only that tikz is needed", () => {
    const x = snippetTex(doc("\\begin{tikzpicture}\\node{A};\\end{tikzpicture}"), 0)!;
    expect(x.text).toBe("% Needs \\usepackage{tikz} in your preamble.\n\n% The figure:\n\\begin{tikzpicture}\\node{A};\\end{tikzpicture}\n");
  });
});

describe("the SVG made ready to save", () => {
  const raw =
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="40pt" height="20pt" viewBox="-10 -5 40 20" overflow="visible"><defs><path id="g" d="M0 0L1 1" stroke="none"/></defs><g data-tf-begin="b0"/><g stroke="#000"><use xlink:href="#g" transform="scale(2)"/></g><g data-tf-end="b0"/></svg>';

  it("drops the app's markers and adds the margin to the page", () => {
    const t = tidySvg(raw, 3);
    expect(t.svg).not.toContain("data-tf");
    expect(t.svg).toContain('viewBox="-13 -8 46 26"');
    expect(t.svg).toContain('width="46pt" height="26pt"');
    expect([t.width, t.height]).toEqual([46, 26]);
    expect(t.svg).toContain('<use xlink:href="#g" transform="scale(2)"/>');
    expect(t.svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns=')).toBe(true);
    expect(t.repairs).toEqual([]);
  });

  it("repairs a picture TeX cut short, and says so", () => {
    const t = tidySvg(raw.replace("</svg>", "</g></svg>"), 0);
    expect(t.repairs).toEqual(["a stray </g> was ignored"]);
    expect(t.svg.match(/<svg/g)).toHaveLength(1);
  });

  it("has no margin by default and refuses an SVG without a viewBox", () => {
    expect(tidySvg(raw).svg).toContain('viewBox="-10 -5 40 20"');
    expect(() => tidySvg('<svg xmlns="http://www.w3.org/2000/svg"/>')).toThrow(/viewBox/);
  });
});
