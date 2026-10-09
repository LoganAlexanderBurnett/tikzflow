// SPDX-License-Identifier: GPL-3.0-or-later
// The two .tex exports (M3 step 11, D72): the picture as a standalone document
// that compiles by itself, and as a snippet to paste into a paper. Both are
// built from the source text's own pieces, verbatim, so the user's comments,
// spacing and macros come through unchanged.

import type { DocumentModel } from "../model/document.ts";

export interface TexExport {
  text: string;
  /** Things the user should know about what was written. */
  notes: string[];
}

const CLASS = /\\documentclass\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/;

const eolOf = (s: string) => (s.includes("\r\n") ? "\r\n" : "\n");

/** The text of a preamble: after the \documentclass line, up to \begin{document}, trimmed of blank lines at its ends. */
function preambleBody(src: string): { body: string; hadClass: boolean; classOptions: string } {
  const cls = CLASS.exec(src);
  const end = src.indexOf("\\begin{document}", cls?.index ?? 0);
  let from = 0;
  if (cls) {
    const eol = src.indexOf("\n", cls.index + cls[0].length);
    from = eol < 0 ? cls.index + cls[0].length : eol + 1;
    // Anything else on the \documentclass line (a comment) goes with it.
  }
  const to = end < 0 ? src.length : end;
  return { body: from < to ? src.slice(from, to).replace(/^\s*\n/, "").trimEnd() : "", hadClass: !!cls, classOptions: cls?.[1] ?? "" };
}

/** The definitions the picture depends on that sit outside it: the code's own `\tikzset`, libraries, colours and macros before it. */
function definitionsBefore(doc: DocumentModel, index: number, skipBefore: number): string[] {
  const pic = doc.syntax.pictures[index];
  if (!pic) return [];
  const out: string[] = [];
  for (const item of doc.syntax.preamble) {
    if (item.range.from >= pic.from) break;
    if (item.range.from < skipBefore) continue;
    out.push(doc.text.slice(item.range.from, item.range.to));
  }
  return out;
}

/** Where the document's own preamble ends, if the picture is inside a \begin{document}, else -1. */
function documentStart(doc: DocumentModel, index: number): number {
  const pic = doc.syntax.pictures[index];
  const cls = CLASS.exec(doc.text);
  const begin = cls ? doc.text.indexOf("\\begin{document}", cls.index) : -1;
  return pic && cls && begin > cls.index && begin < pic.from ? begin : -1;
}

/**
 * Picture `index` as a document of its own: `standalone` class, the preamble
 * it needs (the document's, the imported one, or the code's own definitions),
 * and the picture.
 */
export function standaloneTex(doc: DocumentModel, index: number, imported: string | null, border = "5pt"): TexExport | null {
  const pic = doc.syntax.pictures[index];
  if (!pic) return null;
  const eol = eolOf(doc.text);
  const notes: string[] = [];
  const start = documentStart(doc, index);
  const lines: string[] = [];
  if (start >= 0) {
    const own = preambleBody(doc.text.slice(0, start));
    if (own.body) lines.push(own.body);
    // Definitions made after \begin{document}, before the picture.
    lines.push(...definitionsBefore(doc, index, start));
    const cls = CLASS.exec(doc.text)![2]!.trim();
    if (cls !== "standalone" && cls !== "article" && cls !== "report" && cls !== "book") notes.push(`The ${cls} class is replaced by standalone; its page settings don't apply to the figure.`);
  } else {
    if (imported?.trim()) {
      const imp = preambleBody(imported);
      if (imp.body) lines.push(imp.body);
      notes.push("Your paper's preamble is included.");
    }
    lines.push(...definitionsBefore(doc, index, 0));
  }
  const text = [`\\documentclass[tikz,border=${border}]{standalone}`, ...lines, "", "\\begin{document}", doc.text.slice(pic.from, pic.to), "\\end{document}", ""].join(eol);
  return { text, notes };
}

/**
 * Picture `index` to paste into a paper: the lines it needs in the preamble,
 * as a comment says, then the picture.
 */
export function snippetTex(doc: DocumentModel, index: number): TexExport | null {
  const pic = doc.syntax.pictures[index];
  if (!pic) return null;
  const eol = eolOf(doc.text);
  const start = documentStart(doc, index);
  // Definitions from the document's preamble and from before the picture in the body.
  const defs = definitionsBefore(doc, index, 0).filter((d) => d.trim());
  const notes: string[] = [];
  const head: string[] = [];
  if (defs.length) {
    // Commented out, so that pasting the whole snippet into a document body is safe.
    const commented = ["\\usepackage{tikz}", ...defs].flatMap((d) => d.split(/\r?\n/)).map((l) => `% ${l}`);
    head.push('% Put these lines in your preamble (without the leading "% "):', ...commented, "");
    notes.push(`${defs.length} line${defs.length === 1 ? "" : "s"} for your preamble come first, in a comment.`);
  } else head.push("% Needs \\usepackage{tikz} in your preamble.", "");
  if (start >= 0) notes.push("Other packages of the document aren't listed.");
  head.push("% The figure:");
  return { text: [...head, doc.text.slice(pic.from, pic.to), ""].join(eol), notes };
}
