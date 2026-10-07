import { type Tree, TreeFragment } from "@lezer/common";
import { describe, expect, it } from "vitest";
import { breakdown, checkCoverage, countNodes, dump, parser } from "../src/parser/analyze.ts";
import { decode, encode } from "../src/source/encoding.ts";
import { applyEdit, benignEdit, corpusNames, loadCorpusFile, randomEdit, rng, seedFor } from "./corpus.ts";

const STRUCTURE = [
  "TikzPicture",
  "NodeStatement",
  "PathStatement",
  "CoordinateStatement",
  "Tikzset",
  "TikzStyle",
  "UseTikzLibrary",
  "Foreach",
  "MatrixStatement",
  "Opaque",
] as const;

const apply = applyEdit;

describe.each(corpusNames())("%s", (name) => {
  const file = loadCorpusFile(name);
  const { text } = file;
  const tree = parser.parse(text);
  const seed = seedFor(name);

  it("loads and saves byte-identically", () => {
    expect(Buffer.from(encode(text, file.encoding)).equals(Buffer.from(file.bytes))).toBe(true);
  });

  it("covers every byte exactly once", () => {
    const cov = checkCoverage(tree, text);
    expect(cov.gaps).toEqual([]);
    expect(cov.overlaps).toEqual([]);
    expect(cov.anonymousLeaves.map((l) => l.name)).toEqual([]);
    expect(cov.reconstructs).toBe(true);
  });

  // Incremental reparses must always cover every byte. They must match a full
  // parse exactly whenever the result has no parse errors. Inside error
  // recovery Lezer may legitimately settle differently when it reuses old
  // nodes, so the semantic layer always works from a full parse (D17).
  const checkIncremental = (incremental: Tree, changed: string, label: string) => {
    expect(checkCoverage(incremental, changed).ok, label).toBe(true);
    const full = parser.parse(changed);
    if (breakdown(full, changed).errorNodes === 0) expect(dump(incremental), label).toBe(dump(full));
  };

  it("incremental reparse matches a full parse after single edits", () => {
    const next = rng(seed);
    const base = TreeFragment.addTree(tree);
    for (let i = 0; i < 100; i++) {
      const e = i % 2 ? randomEdit(text, next) : benignEdit(text, next);
      const changed = apply(text, e);
      const fragments = TreeFragment.applyChanges(base, [
        { fromA: e.from, toA: e.to, fromB: e.from, toB: e.from + e.insert.length },
      ]);
      checkIncremental(parser.parse(changed, fragments), changed, `edit ${i}: ${JSON.stringify(e)}`);
    }
  });

  it.each([
    ["random", randomEdit],
    ["benign", benignEdit],
  ] as const)("incremental reparse matches a full parse over a chain of %s edits", (_, makeEdit) => {
    const next = rng(seed ^ 0x5bd1e995);
    let current = text;
    let fragments = TreeFragment.addTree(tree);
    for (let i = 0; i < 60; i++) {
      const e = makeEdit(current, next);
      current = apply(current, e);
      fragments = TreeFragment.applyChanges(fragments, [
        { fromA: e.from, toA: e.to, fromB: e.from, toB: e.from + e.insert.length },
      ]);
      const currentTree = parser.parse(current, fragments);
      fragments = TreeFragment.addTree(currentTree, fragments);
      checkIncremental(currentTree, current, `step ${i}: ${JSON.stringify(e)}`);
    }
  });

  it("stays error-free under benign edits", () => {
    if (breakdown(tree, text).errorNodes > 0) return;
    const next = rng(seed ^ 0x1234567);
    let current = text;
    for (let i = 0; i < 40; i++) current = apply(current, benignEdit(current, next));
    expect(breakdown(parser.parse(current), current).errorNodes).toBe(0);
  });

  it("keeps full byte coverage on randomly mutated input", () => {
    const next = rng(seed ^ 0x27d4eb2f);
    for (let i = 0; i < 150; i++) {
      let mutated = text;
      const edits = 1 + Math.floor(next() * 5);
      for (let j = 0; j < edits; j++) mutated = apply(mutated, randomEdit(mutated, next));
      const cov = checkCoverage(parser.parse(mutated), mutated);
      expect(cov.ok, `mutation ${i}: ${JSON.stringify({ gaps: cov.gaps, overlaps: cov.overlaps })}`).toBe(true);
    }
  });
});

describe("encoding", () => {
  it("keeps a UTF-8 byte-order mark in the text", () => {
    const f = loadCorpusFile("self-bom-crlf-unicode.tex");
    expect(f.encoding).toBe("utf-8");
    expect(f.text.charCodeAt(0)).toBe(0xfeff);
  });

  it("reads invalid UTF-8 as ISO-8859-1", () => {
    const f = loadCorpusFile("self-latin1.tex");
    expect(f.encoding).toBe("latin1");
    expect(f.text).toContain("Größe messen");
  });

  it("round-trips UTF-16 with a byte-order mark", () => {
    const text = "\ufeff\\node {Größe 😀};";
    for (const enc of ["utf-16le", "utf-16be"] as const) {
      const bytes = encode(text, enc);
      expect(decode(bytes)).toEqual({ text, encoding: enc });
    }
  });

  it("refuses to write characters ISO-8859-1 can't hold", () => {
    expect(() => encode("€", "latin1")).toThrow(/latin1/);
  });
});

describe("structure", () => {
  const parse = (name: string) => {
    const { text } = loadCorpusFile(name);
    const tree = parser.parse(text);
    return { text, tree, counts: countNodes(tree, STRUCTURE), stats: breakdown(tree, text) };
  };

  it("models the full document", () => {
    const { counts, stats } = parse("self-document.tex");
    expect(counts).toMatchObject({ TikzPicture: 1, NodeStatement: 7, PathStatement: 6, Tikzset: 1, UseTikzLibrary: 1 });
    expect(stats.errorNodes).toBe(0);
  });

  it("models the bare CRLF picture and keeps \\foreach opaque", () => {
    const { text, tree, counts, stats } = parse("self-bare-crlf.tex");
    expect(text).toContain("\r\n");
    expect(counts).toMatchObject({ TikzPicture: 1, NodeStatement: 4, PathStatement: 5, CoordinateStatement: 1, Foreach: 1 });
    expect(stats.errorNodes).toBe(0);
    const foreach = tree.topNode.getChild("TikzPicture")!.getChild("Foreach")!;
    expect(text.slice(foreach.from, foreach.to)).toContain("\\node[draw=none] (n\\i)");
  });

  it("recovers from the broken input without losing structure around the errors", () => {
    const { counts, stats } = parse("self-broken.tex");
    expect(counts).toMatchObject({ TikzPicture: 1, NodeStatement: 2, PathStatement: 2, TikzStyle: 1, MatrixStatement: 1 });
    expect(stats.errorNodes).toBeGreaterThan(0);
  });

  it("finds pictures inside \\resizebox and \\tikzstyle definitions", () => {
    const { counts, stats } = parse("se-62804-tikzstyle-resizebox.tex");
    expect(counts).toMatchObject({ TikzPicture: 1, TikzStyle: 3 });
    expect(stats.errorNodes).toBe(0);
  });

  it("separates picture options from the body", () => {
    const text = "\\begin{tikzpicture}[node distance=1cm] [x] \\node {A};\\end{tikzpicture}";
    const pic = parser.parse(text).topNode.getChild("TikzPicture")!;
    expect(pic.getChildren("PictureOptions")).toHaveLength(1);
    expect(pic.getChildren("Opaque")).toHaveLength(1);
  });

  it("parses the perpendicular coordinate operator inside coordinates, with or without spaces", () => {
    const text = "\\begin{tikzpicture}\\draw (a.east |- b.north) -- (a-|b) -- (r5.north-|r4) -- (1,-2);\\end{tikzpicture}";
    const tree = parser.parse(text);
    const ops: string[] = [];
    tree.iterate({
      enter: (n) => {
        if (n.name === "|-" || n.name === "-|") ops.push(`${n.name}:${n.node.parent!.name}`);
      },
    });
    expect(ops).toEqual(["|-:Coordinate", "-|:Coordinate", "-|:Coordinate"]);
    expect(breakdown(tree, text).errorNodes).toBe(0);
  });

  it("accepts semicolons inside braced option values", () => {
    const text = "\\begin{tikzpicture}[a/.style={decoration={markings, mark=at position 1 with {\\arrow{>};}}}]\\end{tikzpicture}";
    expect(breakdown(parser.parse(text), text).errorNodes).toBe(0);
  });

  it("has no parse errors on the corpus except the files with deliberate errors", () => {
    const withErrors = corpusNames().filter((n) => parse(n).stats.errorNodes > 0);
    // self-hybrid-surrogate.tex is a real figure whose own code errors are kept on purpose.
    expect(withErrors).toEqual(["self-broken.tex", "self-hybrid-surrogate.tex"]);
  });
});
