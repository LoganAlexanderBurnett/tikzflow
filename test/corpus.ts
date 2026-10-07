// Loads the round-trip corpus (corpus/*.tex) for tests and scripts.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { decode, type Encoding } from "../src/source/encoding.ts";

export const corpusDir = join(import.meta.dirname, "..", "corpus");

export interface CorpusFile {
  name: string;
  bytes: Uint8Array;
  text: string;
  encoding: Encoding;
}

export function corpusNames(): string[] {
  return readdirSync(corpusDir)
    .filter((f) => f.endsWith(".tex"))
    .sort();
}

export function loadCorpusFile(name: string): CorpusFile {
  const bytes = new Uint8Array(readFileSync(join(corpusDir, name)));
  const { text, encoding } = decode(bytes);
  return { name, bytes, text, encoding };
}

export function loadCorpus(): CorpusFile[] {
  return corpusNames().map(loadCorpusFile);
}

// Snippets that stress the grammar: delimiters, keywords, comments, CRLF,
// and non-ASCII text (positions are UTF-16 code units).
const SNIPPETS = [
  ";", "{", "}", "[", "]", "(", ")", "%", "\\", "\\node", "\\draw", " -- ", " -| ", "-|", "|-",
  "..", "node", " at ", "=", "+=", ",", "\r\n", "\n", "\t", "é", "→", "😀", "\\end{tikzpicture}",
  "\\begin{tikzpicture}", "\\tikzset{", "\\tikzstyle{x}=[", "\\foreach \\x in {1,2}", " in ",
  "\\matrix", "$x$", "++(1,0)", "% comment\n", "\\begin{scope}[red]", "\\end{scope}",
];

export interface Edit {
  from: number;
  to: number;
  insert: string;
}

export function randomEdit(text: string, next: () => number): Edit {
  const from = Math.floor(next() * (text.length + 1));
  const del = next() < 0.5 ? 0 : Math.floor(next() * 12);
  const to = Math.min(text.length, from + del);
  const insert = next() < 0.3 ? "" : SNIPPETS[Math.floor(next() * SNIPPETS.length)]!;
  return { from, to, insert };
}

/**
 * An edit that keeps an error-free document error-free: more whitespace, a
 * comment, a new statement after a ";", or a different digit.
 */
export function benignEdit(text: string, next: () => number): Edit {
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]!;
  const positions = (re: RegExp) => [...text.matchAll(re)].map((m) => m.index);
  for (;;) {
    const kind = Math.floor(next() * 3);
    if (kind === 0) {
      // Whitespace outside comments: a line break inside a comment would
      // turn the rest of it into code.
      const ws = positions(/[ \t\n]/g).filter((i) => !text.slice(text.lastIndexOf("\n", i - 1) + 1, i).includes("%"));
      if (!ws.length) continue;
      const at = pick(ws);
      return { from: at, to: at, insert: pick([" ", "\n  ", "  % note\n", "\t"]) };
    }
    if (kind === 1) {
      const ends = positions(/;\n/g);
      if (!ends.length) continue;
      const at = pick(ends) + 1;
      return { from: at, to: at, insert: pick(["\n  \\node (q) {Q};", "\n  \\draw (q) -- (r);", "\n  \\coordinate (c) at (1,2);"]) };
    }
    const digits = positions(/[0-9]/g);
    if (!digits.length) continue;
    const at = pick(digits);
    return { from: at, to: at + 1, insert: String(Math.floor(next() * 10)) };
  }
}

export const applyEdit =(text: string, e: Edit) => text.slice(0, e.from) + e.insert + text.slice(e.to);

/** A seed derived from a file name, so each corpus file gets its own edits. */
export const seedFor = (name: string) => [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);

/** Small deterministic PRNG (mulberry32) so failures are reproducible. */
export function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
