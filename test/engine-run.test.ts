// M3 steps 6–7 (D66, D67): the whole accurate-preview pipeline in Node, with
// the engine folder the app serves (vendor/engine/<tag>, from `npm run
// fetch-engines -- engine`, or TIKZFLOW_ENGINE=ci-<run> for a staged CI run).
// Skipped when the engine isn't there.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import { dviFonts, dviToSvg } from "../src/engine/dvisvg.ts";
import type { FontData } from "../src/engine/fontdata.ts";
import { buildCompileInput, locate, sourceLine } from "../src/engine/input.ts";
import { parseTexLog } from "../src/engine/log.ts";
import type { EngineIndex } from "../src/engine/protocol.ts";
import { PAGES, runTex } from "../src/engine/texlib.ts";
import { analyzeDocument } from "../src/model/document.ts";

const tag = process.env.TIKZFLOW_ENGINE ?? (JSON.parse(readFileSync(join(import.meta.dirname, "..", "engine", "release.json"), "utf8")) as { tag: string }).tag;
const dir = join(import.meta.dirname, "..", "vendor", "engine", tag);
const have = existsSync(join(dir, "index.json"));

describe.skipIf(!have)(`the engine (${tag})`, () => {
  let index: EngineIndex;
  let module: WebAssembly.Module;
  let dump: Uint8Array;
  let memory: WebAssembly.Memory;
  const files = new Set<string>();
  const read = (p: string) => gunzipSync(readFileSync(join(dir, p)));

  beforeAll(async () => {
    index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as EngineIndex;
    for (const f of index.texFiles) files.add(f);
    module = await WebAssembly.compile(read("tex.wasm.gz"));
    dump = read("core.dump.gz");
    memory = new WebAssembly.Memory({ initial: PAGES, maximum: PAGES });
  });

  async function compile(text: string, imported: string | null = null) {
    const input = buildCompileInput(analyzeDocument(text), 0, (f) => files.has(f), imported)!;
    new Uint8Array(memory.buffer).set(dump);
    const run = await runTex(module, memory, {
      terminal: "input.tex\n\\end\n",
      files: new Map([["input.tex", new TextEncoder().encode(input.tex)]]),
      // Answer later, as the browser does: TeX pauses and resumes.
      lookup: (name) => (files.has(name) ? Promise.resolve(read(`tex_files/${name}.gz`)) : null),
    });
    const log = new TextDecoder("latin1").decode(run.written.get("input.log"));
    const dvi = run.written.get("input.dvi");
    const fonts = new Map<string, FontData>();
    for (const f of dvi ? dviFonts(dvi) : []) fonts.set(f.name, JSON.parse(read(`fonts/${f.name}.json.gz`).toString()) as FontData);
    const svg = dvi ? dviToSvg(dvi, (n) => fonts.get(n)) : null;
    return { input, run, log, errors: parseTexLog(log), svg };
  }

  it("compiles a flowchart to SVG, text drawn as paths, placed by TikZ's origin", async () => {
    const r = await compile(
      "\\documentclass{article}\n\\usepackage{tikz}\n\\usetikzlibrary{positioning,shapes.geometric,arrows.meta}\n\\begin{document}\n" +
        "\\begin{tikzpicture}[>=Stealth]\n\\node[draw, rounded corners] (a) at (0,0) {Start};\n\\node[draw, diamond, below=of a] (b) {$x > 0$?};\n\\draw[->] (a) -- (b);\n\\end{tikzpicture}\n\\end{document}\n",
    );
    expect(r.errors).toEqual([]);
    expect(r.run.missing.filter((n) => n.endsWith(".sty"))).toEqual([]);
    expect(r.svg!.missingFonts).toEqual([]);
    expect(r.svg!.glyphs).toBe(9); // "Start", and x > 0 ? in math
    const p = r.svg!.picture!;
    // The node "Start" is centred on TikZ's origin: the box spans it.
    expect(p.tikz[0]).toBeLessThan(0);
    expect(p.tikz[2]).toBeGreaterThan(0);
    expect(p.tikz[3]).toBeGreaterThan(0);
    expect(p.tikz[1]).toBeLessThan(-30);
  });

  it("reports an error on the user's own line, and still draws the rest", async () => {
    const text = "\\begin{tikzpicture}\n\\node[draw] (a) {A};\n\\node[draw] at (2,0) {\\nosuchmacro B};\n\\end{tikzpicture}\n";
    const r = await compile(text);
    expect(r.errors.map((e) => e.message)).toEqual(["Undefined control sequence."]);
    const e = r.errors[0]!;
    expect(e.file).toBe("input.tex");
    expect(sourceLine(r.input, e.line!)).toBe(3);
    expect(r.svg!.glyphs).toBe(2);
  });

  it("loads packages and TikZ libraries on demand", async () => {
    const r = await compile(
      "\\documentclass{article}\n\\usepackage{amssymb,siunitx}\n\\usepackage{tikz}\n\\usetikzlibrary{calc,matrix,decorations.pathmorphing}\n\\begin{document}\n" +
        "\\begin{tikzpicture}\n\\matrix[matrix of nodes, nodes={draw}] (m) {$\\mathbb{R}$ & \\SI{3}{\\metre} \\\\};\n\\draw[decorate, decoration=zigzag] (m.south west) -- ($(m.south east)+(1,0)$);\n\\end{tikzpicture}\n\\end{document}\n",
    );
    expect(r.errors).toEqual([]);
    expect(r.run.read).toContain("siunitx.sty");
    expect(r.run.read).toContain("tikzlibrarydecorations.pathmorphing.code.tex");
    expect(r.svg!.missingFonts).toEqual([]);
  });

  it("leaves out a package the engine doesn't have, and says so", async () => {
    const r = await compile("\\documentclass{article}\n\\usepackage{nosuchpackage}\n\\usepackage{tikz}\n\\begin{document}\n\\begin{tikzpicture}\\node {A};\\end{tikzpicture}\n\\end{document}\n");
    expect(r.input.unavailable).toEqual(["nosuchpackage"]);
    expect(r.errors).toEqual([]);
    expect(r.svg!.glyphs).toBe(1);
  });

  it("uses an imported preamble for a bare picture, and puts its errors on its own lines (D71)", async () => {
    const bare = "\\begin{tikzpicture}\n\\node[draw] (a) {\\state{A}\\ B};\n\\end{tikzpicture}\n";
    const imported = "\\documentclass[11pt]{article}\n\\usepackage{amsmath}\n\\newcommand{\\state}[1]{\\textbf{#1}}\n\\begin{document}\n\\end{document}\n";
    const r = await compile(bare, imported);
    expect(r.errors).toEqual([]);
    expect(r.run.read).toContain("amsmath.sty");
    expect(r.svg!.glyphs).toBe(2);
    // Without it the macro is undefined, in the code's own line.
    const without = await compile(bare);
    expect(without.errors.map((e) => e.message)).toEqual(["Undefined control sequence."]);
    // A fault in the imported text is placed there.
    const broken = await compile(bare, "\\newcommand{\\state}[1]{\\textbf{#1}}\n\\nosuchcommand\n");
    const e = broken.errors.find((x) => x.message === "Undefined control sequence.")!;
    expect(locate(broken.input, e.line!)).toEqual({ in: "preamble", line: 2 });
  });

  it("gives figures the paper's column width (D71)", async () => {
    const bare = "\\begin{tikzpicture}\n\\node[draw, text width=\\columnwidth] (a) {A};\n\\end{tikzpicture}\n";
    const r = await compile(bare, "\\documentclass[twocolumn,a4paper]{article}\n");
    expect(r.errors).toEqual([]);
    // The node is a column (221 pt) of text plus its inner separation on each side.
    const [x0, , x1] = r.svg!.picture!.tikz;
    expect(x1 - x0).toBeCloseTo(221 + 2 * 3.3333 + 0.4, 0);
  });

  it("marks a locked block's output", async () => {
    const r = await compile("\\begin{tikzpicture}\n\\foreach \\i in {1,2,3} \\draw (\\i,0) circle (2pt);\n\\node at (0,0) {A};\n\\end{tikzpicture}\n");
    expect(r.errors).toEqual([]);
    expect(r.svg!.svg).toMatch(/<g data-tf-begin="b0"\/>[\s\S]*<path[\s\S]*<g data-tf-end="b0"\/>/);
  });
});
