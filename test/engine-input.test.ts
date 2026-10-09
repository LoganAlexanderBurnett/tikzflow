// M3 step 7 (D67): what the accurate preview compiles, and reading TeX's log.
import { describe, expect, it } from "vitest";
import { buildCompileInput, locate, sourceLine } from "../src/engine/input.ts";
import { parseTexLog, texAborted } from "../src/engine/log.ts";
import { cleanName } from "../src/engine/texlib.ts";
import { analyzeDocument } from "../src/model/document.ts";

const HAVE = new Set(["amsmath.sty", "booktabs.sty", "siunitx.sty"]);
const available = (f: string) => HAVE.has(f);
const build = (text: string) => buildCompileInput(analyzeDocument(text), 0, available)!;

const DOC = [
  "\\documentclass[12pt]{article}",
  "\\usepackage{amsmath,nosuchpkg}",
  "\\usepackage[T1]{fontenc}",
  "\\usepackage{lmodern}",
  "\\usepackage{tikz}",
  "\\usetikzlibrary{positioning}",
  "\\tikzset{box/.style={draw}}",
  "\\begin{document}",
  "Some text.",
  "\\begin{tikzpicture}",
  "  \\node[box] (a) {A};",
  "  \\foreach \\i in {1,2} \\node at (\\i,0) {\\i};",
  "  \\node[box, right=of a] (b) {B};",
  "\\end{tikzpicture}",
  "\\end{document}",
  "",
].join("\n");

describe("the compile input", () => {
  it("copies the preamble and the picture, leaving out what the engine can't use", () => {
    const input = build(DOC);
    expect(input.tex).toContain("\\scrollmode");
    expect(input.tex).toContain("\\usepackage{amsmath}");
    expect(input.tex).not.toContain("nosuchpkg");
    expect(input.tex).not.toContain("lmodern");
    expect(input.tex).not.toContain("fontenc");
    expect(input.unavailable).toEqual(["nosuchpkg"]);
    expect(input.fontPackages).toEqual(["fontenc", "lmodern"]);
    // The document's text isn't compiled, only the picture.
    expect(input.tex).not.toContain("Some text.");
    expect(input.tex).toMatch(/\\begin\{document\}\n\\begin\{tikzpicture\}[\s\S]*\\end\{tikzpicture\}\n\\end\{document\}\n$/);
    // 12pt: the font sizes of size12.clo.
    expect(input.tex).toContain("\\renewcommand\\normalsize{\\@setfontsize\\normalsize{12}{14.5}}");
  });

  it("maps every copied line back to the source", () => {
    const input = build(DOC);
    const lines = input.tex.split("\n");
    const source = DOC.split("\n");
    for (const [i, l] of lines.entries()) {
      const s = sourceLine(input, i + 1);
      if (s === null) continue;
      // Marker specials are added on the same line; package lines may be shortened.
      const want = source[s - 1]!;
      if (/usepackage/.test(want)) continue;
      expect(l.replace(/\\special\{tikzflow:[^}]*\}/g, ""), `input line ${i + 1}`).toBe(want);
    }
    const nodeLine = lines.findIndex((l) => l.includes("right=of a")) + 1;
    expect(sourceLine(input, nodeLine)).toBe(13);
    expect(sourceLine(input, 1)).toBeNull();
  });

  it("marks locked blocks so the compiled output can be traced to them", () => {
    const input = build(DOC);
    expect([...input.blocks.keys()]).toEqual(["b0"]);
    const b = input.blocks.get("b0")!;
    expect(DOC.slice(b.from, b.to)).toMatch(/^\\foreach/);
    expect(input.tex).toContain("\\special{tikzflow:begin b0}\\foreach");
    expect(input.tex).toMatch(/\{\\i\};\\special\{tikzflow:end b0\}/);
  });

  it("takes a bare picture with the definitions before it", () => {
    const text = "\\usetikzlibrary{positioning}\n\\tikzset{x/.style={draw}}\n\\begin{tikzpicture}\n\\node[x] {A};\n\\end{tikzpicture}\n";
    const input = build(text);
    expect(input.tex).toContain("\\usetikzlibrary{positioning}");
    expect(input.tex).toContain("\\tikzset{x/.style={draw}}");
    expect(input.unavailable).toEqual([]);
  });
});

describe("reading the log", () => {
  const LOG = [
    "This is e-TeX, Version 3.141592653-2.6 (preloaded format=latex 2026.10.9)",
    "**input.tex",
    "(input.tex",
    'LaTeX2e <2026-06-01>',
    '("tikzlibrarypositioning.code.tex"',
    "File: tikzlibrarypositioning.code.tex 2026-08-01 v3.1.12 (3.1.12)",
    ') ("l3backend-dvisvgm.def"',
    ")",
    "Overfull \\hbox (12.0pt too wide) in paragraph at lines 3--4",
    "! Undefined control sequence.",
    "l.12   \\foo",
    "           {x}",
    "! Package pgfkeys Error: I do not know the key '/tikz/bogus' and I am going to ignore it. Perhaps you misspelled it.",
    "",
    "See the pgfkeys package documentation for explanation.",
    "Type  H <return>  for immediate help.",
    " ...                                              ",
    "                                                  ",
    "l.14 \\end{tikzpicture}",
    "",
    ")",
  ].join("\n");

  it("finds each error, its line and the file it was in", () => {
    const errors = parseTexLog(LOG);
    expect(errors.map((e) => [e.message.slice(0, 30), e.line, e.file])).toEqual([
      ["Undefined control sequence.", 12, "input.tex"],
      ["Package pgfkeys Error: I do no", 14, "input.tex"],
    ]);
    expect(errors[0]!.context).toBe("  \\foo");
  });

  it("knows when TeX gave up", () => {
    expect(texAborted("! Emergency stop.\n*** (job aborted, no legal \\end found)")).toBe(true);
    expect(texAborted(LOG)).toBe(false);
  });
});

describe("file names TeX asks for", () => {
  it("are cleaned as web2js does, with the quoted names of the 2026 kernel", () => {
    expect(cleanName('"tikzlibrarycalc.code.tex"')).toBe("tikzlibrarycalc.code.tex");
    expect(cleanName('TeXinputs:"x.sty"   ')).toBe("x.sty");
    expect(cleanName("TeXfonts:cmr10.tfm")).toBe("cmr10.tfm");
    expect(cleanName("./input.tex\0\0")).toBe("input.tex");
    expect(cleanName("{foo.tex}junk")).toBe("foo.tex");
  });
});

describe("an imported preamble (D71)", () => {
  const BARE = ["\\begin{tikzpicture}", "\\node[draw] (a) {\\state{A}};", "\\end{tikzpicture}", ""].join("\n");
  const IMPORTED = [
    "\\documentclass[11pt,twocolumn]{article}",
    "\\usepackage{amsmath}",
    "\\usepackage{lmodern,nosuchpkg}",
    "\\newcommand{\\state}[1]{\\mathbf{#1}}",
    "\\begin{document}",
    "Ignored text.",
    "\\end{document}",
  ].join("\n");
  const withImported = (text: string, imported: string | null) => buildCompileInput(analyzeDocument(text), 0, available, imported)!;

  it("goes in front of a bare picture, treated like a preamble in the code", () => {
    const input = withImported(BARE, IMPORTED);
    expect(input.tex).toContain("\\newcommand{\\state}[1]{\\mathbf{#1}}");
    expect(input.tex).toContain("\\usepackage{amsmath}");
    expect(input.tex).not.toContain("\\documentclass");
    expect(input.tex).not.toContain("Ignored text");
    expect(input.tex).not.toContain("lmodern");
    expect(input.tex).not.toContain("nosuchpkg");
    expect(input.fontPackages).toEqual(["lmodern"]);
    expect(input.unavailable).toEqual(["nosuchpkg"]);
    // 11pt: the font sizes of size11.clo.
    expect(input.tex).toContain("\\renewcommand\\normalsize{\\@setfontsize\\normalsize{10.95}{13.6}}");
  });

  it("maps its lines to the imported text, not to the code", () => {
    const input = withImported(BARE, IMPORTED);
    const line = input.tex.split("\n").findIndex((l) => l.includes("\\newcommand{\\state}")) + 1;
    expect(sourceLine(input, line)).toBeNull();
    expect(locate(input, line)).toEqual({ in: "preamble", line: 4 });
    const node = input.tex.split("\n").findIndex((l) => l.includes("\\node[draw]")) + 1;
    expect(locate(input, node)).toEqual({ in: "code", line: 2 });
  });

  it("is ignored when the code has a preamble of its own", () => {
    const input = withImported(DOC, IMPORTED);
    expect(input.tex).not.toContain("\\state");
    expect(input.tex).toContain("\\tikzset{box/.style={draw}}");
  });

  it("is taken whole when it has no \\documentclass or \\begin{document}", () => {
    const input = withImported(BARE, "\\usepackage{booktabs}\n\\newcommand{\\state}[1]{#1}");
    expect(input.tex).toContain("\\usepackage{booktabs}");
    expect(input.tex).toContain("\\newcommand{\\state}[1]{#1}");
  });

  it("changes nothing when there is none", () => {
    expect(withImported(BARE, "  \n").tex).toBe(withImported(BARE, null).tex);
  });
});
