// Making sure a TikZ library an edit relies on is loaded. Milestone 2 adds
// full library management; for now this covers "positioning", which every
// relational move needs.
import type { DocumentModel } from "../model/document.ts";
import type { PictureSyntax } from "../model/syntax.ts";
import type { Change } from "./changes.ts";
import { appendItem } from "./optionEdits.ts";

export type LibraryResult =
  /** Already loaded, or added by `change`. */
  | { ok: true; change?: Change }
  /** A bare picture: the libraries live in a preamble the editor can't see. */
  | { ok: false; reason: string };

/** Libraries that load others: chains and tikz-ext's positioning-plus load positioning. */
const IMPLIES: Record<string, string[]> = {
  chains: ["positioning"],
  "ext.positioning-plus": ["positioning"],
};

export function libraryLoaded(doc: DocumentModel, pic: PictureSyntax, library: string): boolean {
  for (const item of doc.syntax.preamble) {
    if (item.range.from >= pic.from) break;
    if (item.kind === "library" && item.names.some((n) => n === library || IMPLIES[n]?.includes(library))) return true;
  }
  return pic.items.some((i) => i.kind === "library" && i.names.includes(library));
}

/**
 * Returns the change that loads `library` for picture `pic`: added to the last
 * \usetikzlibrary before it, or as a new line after \usepackage{tikz} or the
 * \documentclass line.
 */
export function ensureLibrary(doc: DocumentModel, pic: PictureSyntax, library: string): LibraryResult {
  if (libraryLoaded(doc, pic, library)) return { ok: true };
  const text = doc.text;
  let last: (typeof doc.syntax.preamble)[number] | undefined;
  for (const item of doc.syntax.preamble) {
    if (item.range.from >= pic.from) break;
    if (item.kind === "library" && item.list) last = item;
  }
  if (last && last.kind === "library" && last.list) {
    if (!last.list.items.length) return { ok: true, change: { from: last.list.from + 1, to: last.list.to - 1, insert: library } };
    // "\usetikzlibrary{a, b,}": a trailing comma takes the name directly.
    const lastItem = last.list.items[last.list.items.length - 1]!;
    const trailingComma = last.list.commas.some((c) => c > lastItem.to);
    if (trailingComma) {
      const comma = Math.max(...last.list.commas);
      return { ok: true, change: { from: comma + 1, to: comma + 1, insert: ` ${library},` } };
    }
    return { ok: true, change: appendItem(text, last.list, library) };
  }
  const before = text.slice(0, pic.from);
  const pkg = /\\usepackage\s*(\[[^\]]*\])?\s*\{[^}]*\btikz\b[^}]*\}[^\n]*\n/g;
  let m: RegExpExecArray | null;
  let at = -1;
  while ((m = pkg.exec(before))) at = m.index + m[0].length;
  if (at < 0) {
    const cls = /\\documentclass\s*(\[[^\]]*\])?\s*\{[^}]*\}[^\n]*\n/.exec(before);
    if (cls) at = cls.index + cls[0].length;
  }
  if (at < 0) return { ok: false, reason: `this picture needs \\usetikzlibrary{${library}} in your document's preamble` };
  const eol = before.includes("\r\n") ? "\r\n" : "\n";
  return { ok: true, change: { from: at, to: at, insert: `\\usetikzlibrary{${library}}${eol}` } };
}
