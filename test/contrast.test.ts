// M4 step 6 (D85): contrast warnings for text on fills, WCAG AA.
import { describe, expect, it } from "vitest";
import { betterText, blend, contrastIssues, contrastRatio, formatRatio, isLargeText, luminance } from "../src/edit/contrast.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";

const issuesOf = (body: string, preamble = "") => {
  const text = `\\documentclass{article}\n\\usepackage{tikz}\n\\usetikzlibrary{positioning,fit,backgrounds}\n${preamble}\\begin{document}\n\\begin{tikzpicture}\n${body}\n\\end{tikzpicture}\n\\end{document}\n`;
  return contrastIssues(layoutDocumentPicture(analyzeDocument(text), 0)!);
};

describe("the ratio", () => {
  it("matches WCAG's definition", () => {
    expect(contrastRatio([0, 0, 0], [1, 1, 1])).toBeCloseTo(21, 5);
    expect(contrastRatio([1, 1, 1], [1, 1, 1])).toBeCloseTo(1, 5);
    // #767676 is the lightest gray that passes AA on white; #777777 doesn't.
    expect(contrastRatio([0x76 / 255, 0x76 / 255, 0x76 / 255], [1, 1, 1])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio([0x77 / 255, 0x77 / 255, 0x77 / 255], [1, 1, 1])).toBeLessThan(4.5);
    expect(luminance([1, 1, 1])).toBeCloseTo(1, 6);
    expect(luminance([0, 0, 0])).toBe(0);
  });

  it("is the same whichever color is on top", () => {
    expect(contrastRatio([1, 0, 0], [0, 0, 1])).toBeCloseTo(contrastRatio([0, 0, 1], [1, 0, 0]), 10);
  });

  it("knows what large text is: 18pt, or 14pt bold", () => {
    expect(isLargeText(17.9, false)).toBe(false);
    expect(isLargeText(18, false)).toBe(true);
    expect(isLargeText(14, false)).toBe(false);
    expect(isLargeText(14, true)).toBe(true);
    expect(isLargeText(13.9, true)).toBe(false);
  });

  it("blends colors, and rounds the ratio down for display", () => {
    expect(blend([0, 0, 0], [1, 1, 1], 0.25)).toEqual([0.75, 0.75, 0.75]);
    expect(formatRatio(4.49)).toBe("4.4:1");
    expect(formatRatio(21)).toBe("21.0:1");
  });

  it("suggests black or white, whichever reads better", () => {
    expect(betterText([1, 1, 0]).name).toBe("black");
    expect(betterText([0, 0, 0.4]).name).toBe("white");
    expect(betterText([1, 1, 0]).ratio).toBeGreaterThan(15);
  });
});

describe("the warnings", () => {
  it("finds light text on a light fill and passes good pairs", () => {
    const issues = issuesOf(["\\node[draw, fill=yellow, text=white] (bad) {Bad};", "\\node[draw, fill=blue!80!black, text=white, right=of bad] (good) {Good};", "\\node[draw, fill=yellow!30, right=of good] (plain) {Plain};"].join("\n"), "\\usetikzlibrary{positioning}\n");
    expect(issues.map((i) => i.name)).toEqual(["bad"]);
    const i = issues[0]!;
    expect(i.ratio).toBeCloseTo(contrastRatio([1, 1, 1], [1, 1, 0]), 6);
    expect(i.required).toBe(4.5);
    expect(i.on).toBe("fill");
    expect(i.label).toBe("Bad");
  });

  it("checks text with no fill against the white page", () => {
    const issues = issuesOf("\\node[text=yellow] (faint) {Faint};\n\\node[text=black] at (3,0) (ok) {Fine};\n\\node at (6,0) (default) {Default};");
    expect(issues.map((i) => [i.name, i.on])).toEqual([["faint", "page"]]);
  });

  it("checks text with no fill against the fill behind it, such as a lane", () => {
    const issues = issuesOf(
      [
        "\\node[draw] (a) at (0,0) {Dark on dark};",
        "\\node[draw, text=white] (b) at (3,0) {Light on dark};",
        "\\begin{scope}[on background layer]",
        "\\node[fill=black!70, fit=(a) (b), inner sep=3mm] (lane) {};",
        "\\end{scope}",
      ].join("\n"),
    );
    // Black text on the dark lane fails; white text on it passes.
    expect(issues.map((i) => [i.name, i.on])).toEqual([["a", "behind"]]);
  });

  it("uses large text's lower limit", () => {
    // Mid gray on white: between 3:1 and 4.5:1.
    const gray = "text={rgb,255:red,140;green,140;blue,140}";
    const r = contrastRatio([140 / 255, 140 / 255, 140 / 255], [1, 1, 1]);
    expect(r).toBeGreaterThan(3);
    expect(r).toBeLessThan(4.5);
    const issues = issuesOf([`\\node[${gray}] (small) {Small};`, `\\node[${gray}, font=\\huge, right=of small] (big) {Big};`, `\\node[${gray}, font=\\Large\\bfseries, right=of big] (bold) {Bold};`, `\\node[${gray}, font=\\Large, right=of bold] (medium) {Medium};`].join("\n"), "\\usetikzlibrary{positioning}\n");
    expect(issues.map((i) => i.name)).toEqual(["small", "medium"]);
    expect(issues.every((i) => i.required === 4.5)).toBe(true);
  });

  it("blends a translucent fill with what is behind it", () => {
    const issues = issuesOf("\\node[fill=black, fill opacity=0.1, text=white] (ghost) {Ghost};\n\\node[fill=black, text=white] at (3,0) (solid) {Solid};");
    expect(issues.map((i) => i.name)).toEqual(["ghost"]);
    expect(issues[0]!.background[0]).toBeCloseTo(0.9, 5);
  });

  it("checks text colored inside the label, and edge labels", () => {
    const issues = issuesOf(
      [
        "\\node[draw] (a) at (0,0) {Plain \\textcolor{yellow}{pale}};",
        "\\node[draw] (b) at (4,0) {B};",
        "\\draw[->] (a) -- node[fill=yellow, text=white, auto] {via} (b);",
      ].join("\n"),
    );
    expect(issues.map((i) => [i.name ?? i.label, i.edgeLabel])).toEqual([
      ["a", false],
      ["via", true],
    ]);
  });

  it("leaves out empty nodes, coordinates and shaded nodes", () => {
    const issues = issuesOf(["\\node[fill=yellow, text=white] (empty) {};", "\\coordinate (c) at (2,2);", "\\node[shade, left color=yellow, right color=white, text=white] at (4,0) (shaded) {Shaded};"].join("\n"));
    expect(issues).toEqual([]);
  });

  it("does not warn about the sample's own colors", () => {
    const text = `\\documentclass{article}\n\\usepackage{tikz}\n\\begin{document}\n\\begin{tikzpicture}\n\\node[draw, fill=blue!8] {Normal};\n\\node[draw, fill=teal!15] at (3,0) {Teal};\n\\node[draw, fill=orange!15] at (6,0) {Orange};\n\\end{tikzpicture}\n\\end{document}\n`;
    expect(contrastIssues(layoutDocumentPicture(analyzeDocument(text), 0)!)).toEqual([]);
  });
});
