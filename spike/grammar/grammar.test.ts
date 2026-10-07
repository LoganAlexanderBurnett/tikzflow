import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TreeFragment } from "@lezer/common";
import { describe, expect, it } from "vitest";
import { breakdown, checkCoverage, countNodes, dump, parser } from "./analyze.ts";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");

const FIXTURES = ["document.tex", "bare-crlf.tex", "broken.tex"] as const;

const STRUCTURE = [
  "TikzPicture",
  "NodeStatement",
  "PathStatement",
  "CoordinateStatement",
  "Tikzset",
  "UseTikzLibrary",
  "Opaque",
] as const;

/** Small deterministic PRNG (mulberry32) so failures are reproducible. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Snippets that stress the grammar: delimiters, keywords, comments, CRLF,
// and non-ASCII text (positions are UTF-16 code units).
const SNIPPETS = [
  ";", "{", "}", "[", "]", "(", ")", "%", "\\", "\\node", "\\draw", " -- ", " -| ",
  "..", "node", " at ", "=", ",", "\r\n", "\n", "\t", "é", "→", "😀", "\\end{tikzpicture}",
  "\\begin{tikzpicture}", "\\tikzset{", "$x$", "++(1,0)", "% comment\n",
];

interface Edit {
  from: number;
  to: number;
  insert: string;
}

function randomEdit(text: string, next: () => number): Edit {
  const from = Math.floor(next() * (text.length + 1));
  const del = next() < 0.5 ? 0 : Math.floor(next() * 12);
  const to = Math.min(text.length, from + del);
  const insert = next() < 0.3 ? "" : SNIPPETS[Math.floor(next() * SNIPPETS.length)]!;
  return { from, to, insert };
}

const apply = (text: string, e: Edit) => text.slice(0, e.from) + e.insert + text.slice(e.to);

describe.each(FIXTURES)("%s", (name) => {
  const text = fixture(name);
  const tree = parser.parse(text);

  it("covers every byte exactly once", () => {
    const cov = checkCoverage(tree, text);
    expect(cov.gaps).toEqual([]);
    expect(cov.overlaps).toEqual([]);
    expect(cov.anonymousLeaves.map((l) => l.name)).toEqual([]);
    expect(cov.reconstructs).toBe(true);
  });

  it("incremental reparse matches a full parse after single edits", () => {
    const next = rng(name.length * 7919);
    const base = TreeFragment.addTree(tree);
    for (let i = 0; i < 300; i++) {
      const e = randomEdit(text, next);
      const changed = apply(text, e);
      const fragments = TreeFragment.applyChanges(base, [
        { fromA: e.from, toA: e.to, fromB: e.from, toB: e.from + e.insert.length },
      ]);
      const incremental = parser.parse(changed, fragments);
      expect(dump(incremental), `edit ${i}: ${JSON.stringify(e)}`).toBe(dump(parser.parse(changed)));
    }
  });

  it("incremental reparse matches a full parse over a chain of edits", () => {
    const next = rng(name.length * 104729);
    let current = text;
    let currentTree = tree;
    let fragments = TreeFragment.addTree(currentTree);
    for (let i = 0; i < 200; i++) {
      const e = randomEdit(current, next);
      current = apply(current, e);
      fragments = TreeFragment.applyChanges(fragments, [
        { fromA: e.from, toA: e.to, fromB: e.from, toB: e.from + e.insert.length },
      ]);
      currentTree = parser.parse(current, fragments);
      fragments = TreeFragment.addTree(currentTree, fragments);
      expect(dump(currentTree), `step ${i}`).toBe(dump(parser.parse(current)));
    }
  });

  it("keeps full byte coverage on randomly mutated input", () => {
    const next = rng(name.length * 31337);
    for (let i = 0; i < 500; i++) {
      let mutated = text;
      const edits = 1 + Math.floor(next() * 5);
      for (let j = 0; j < edits; j++) mutated = apply(mutated, randomEdit(mutated, next));
      const cov = checkCoverage(parser.parse(mutated), mutated);
      expect(cov.ok, `mutation ${i}: ${JSON.stringify({ gaps: cov.gaps, overlaps: cov.overlaps })}`).toBe(true);
    }
  });
});

describe("structure", () => {
  it("models the full document", () => {
    const tree = parser.parse(fixture("document.tex"));
    expect(countNodes(tree, STRUCTURE)).toMatchObject({
      TikzPicture: 1,
      NodeStatement: 7,
      PathStatement: 6,
      Tikzset: 1,
      UseTikzLibrary: 1,
    });
    expect(breakdown(tree).errorNodes).toBe(0);
  });

  it("models the bare CRLF picture and keeps \\foreach opaque", () => {
    const text = fixture("bare-crlf.tex");
    expect(text).toContain("\r\n");
    const tree = parser.parse(text);
    expect(countNodes(tree, STRUCTURE)).toMatchObject({
      TikzPicture: 1,
      NodeStatement: 3,
      PathStatement: 5,
      CoordinateStatement: 1,
    });
    expect(breakdown(tree).errorNodes).toBe(0);
    const foreach = tree.topNode.getChild("TikzPicture")!.getChildren("Opaque").map((n) => text.slice(n.from, n.to));
    expect(foreach).toContain("\\foreach");
    expect(foreach.some((s) => s.includes("\\node[draw=none] (n\\i)"))).toBe(true);
  });

  it("recovers from the broken input without losing structure around the errors", () => {
    const tree = parser.parse(fixture("broken.tex"));
    expect(countNodes(tree, STRUCTURE)).toMatchObject({
      TikzPicture: 1,
      NodeStatement: 2,
      PathStatement: 2,
    });
    expect(breakdown(tree).errorNodes).toBeGreaterThan(0);
  });

  it("parses the perpendicular coordinate operator inside coordinates", () => {
    const text = "\\begin{tikzpicture}\\draw (a.east |- b.north) -- (a -| b);\\end{tikzpicture}";
    const tree = parser.parse(text);
    const ops: string[] = [];
    tree.iterate({
      enter: (n) => {
        if (n.name === "|-" || n.name === "-|") ops.push(`${n.name}:${n.node.parent!.name}`);
      },
    });
    expect(ops).toEqual(["|-:Coordinate", "-|:Coordinate"]);
  });
});
