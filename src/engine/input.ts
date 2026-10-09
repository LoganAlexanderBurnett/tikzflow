// SPDX-License-Identifier: GPL-3.0-or-later
// The file the accurate preview compiles (D67): what follows the preamble
// saved in the engine's format (standalone, xcolor, tikz with our driver).
// It holds the user's preamble, the definitions before the picture and the
// picture itself, each copied verbatim so TeX's line numbers map back to the
// user's source. Packages the engine doesn't have, and font packages (the
// preview always uses Computer Modern, D16), are left out with a notice.

import type { DocumentModel } from "../model/document.ts";
import type { PictureSyntax } from "../model/syntax.ts";

/** A piece of input.tex copied from the source: input lines [inputLine, inputLine + lines) are source lines from sourceLine on. */
export interface LineSegment {
  inputLine: number;
  sourceLine: number;
  lines: number;
}

export interface CompileInput {
  /** input.tex. */
  tex: string;
  segments: LineSegment[];
  /** Packages left out because the engine doesn't have them. */
  unavailable: string[];
  /** Font packages left out: the preview typesets in Computer Modern. */
  fontPackages: string[];
  /** Locked blocks of the picture, marked in the output: marker id → source range. */
  blocks: Map<string, { from: number; to: number }>;
}

/**
 * Packages that change the document's fonts. The preview always uses Computer
 * Modern (D16), so they are left out and a notice says text widths may differ.
 */
const FONT_PACKAGES = new Set([
  "lmodern", "times", "mathptmx", "mathpazo", "palatino", "helvet", "courier", "avant", "bookman", "charter", "newcent",
  "utopia", "fourier", "kpfonts", "libertine", "libertinus", "libertinust1math", "newtxtext", "newtxmath", "newpxtext",
  "newpxmath", "txfonts", "pxfonts", "mathptmx", "tgtermes", "tgheros", "tgpagella", "tgbonum", "tgschola", "tgadventor",
  "tgcursor", "tgchorus", "sourcesanspro", "sourceserifpro", "sourcecodepro", "opensans", "roboto", "lato", "carlito",
  "cabin", "fira", "FiraSans", "FiraMono", "inconsolata", "beramono", "berasans", "beraserif", "dejavu", "noto", "XCharter",
  "stix", "stix2", "cochineal", "ebgaramond", "garamondx", "baskervillef", "plex-sans", "plex-serif", "plex-mono",
  "sansmath", "cmbright", "eulervm", "euler", "concmath", "ccfonts", "arev", "fontspec", "unicode-math", "mlmodern",
  "cfr-lm", "anyfontsize", "fontenc", "fix-cm",
]);

/** Packages already in the format, or that change nothing the preview needs; never reported missing. */
const BUILT_IN = new Set(["tikz", "pgf", "xcolor", "color", "graphics", "graphicx", "keyval", "standalone", "inputenc", "pgfcore"]);

/** Packages that would break the compile or the picture's placement, left out silently. */
const SKIPPED = new Set(["hyperref", "geometry", "fullpage", "showframe", "preview", "tikzexternal", "microtype", "babel", "polyglossia", "csquotes"]);

/** Font size commands for the class options 11pt and 12pt (size11.clo, size12.clo): the format is 10pt. */
const SIZES: Record<string, Array<[string, string, string]>> = {
  "11": [
    ["tiny", "6", "7"], ["scriptsize", "8", "9.5"], ["footnotesize", "9", "11"], ["small", "10", "12"],
    ["normalsize", "10.95", "13.6"], ["large", "12", "14"], ["Large", "14.4", "18"], ["LARGE", "17.28", "22"],
    ["huge", "20.74", "25"], ["Huge", "24.88", "30"],
  ],
  "12": [
    ["tiny", "6", "7"], ["scriptsize", "8", "9.5"], ["footnotesize", "10", "12"], ["small", "10.95", "13.6"],
    ["normalsize", "12", "14.5"], ["large", "14.4", "18"], ["Large", "17.28", "22"], ["LARGE", "20.74", "25"],
    ["huge", "24.88", "30"], ["Huge", "24.88", "30"],
  ],
};

const lineOf = (text: string, offset: number) => {
  let n = 1;
  for (let i = text.indexOf("\n"); i >= 0 && i < offset; i = text.indexOf("\n", i + 1)) n++;
  return n;
};
const countLines = (s: string) => s.split("\n").length;

/** The packages a \usepackage/\RequirePackage line loads, with the option list. */
const USEPACKAGE = /\\(?:usepackage|RequirePackage)\s*(\[[^\]]*\])?\s*\{([^}]*)\}/g;

/**
 * Builds input.tex for picture `index` of `doc`. `available(name)` says
 * whether the engine has a file (`foo.sty`).
 */
export function buildCompileInput(doc: DocumentModel, index: number, available: (file: string) => boolean): CompileInput | null {
  const pic = doc.syntax.pictures[index];
  if (!pic) return null;
  const text = doc.text;
  const parts: string[] = [];
  const segments: LineSegment[] = [];
  const unavailable: string[] = [];
  const fontPackages: string[] = [];
  let line = 1;
  const emit = (s: string) => {
    parts.push(s);
    line += countLines(s) - 1;
  };
  /** Copies source text [from, to) on fresh lines, recording where it came from. */
  const copy = (from: number, to: number, body = text.slice(from, to)) => {
    emit("\n");
    segments.push({ inputLine: line, sourceLine: lineOf(text, from), lines: countLines(body.replace(/\n$/, "")) });
    emit(body);
    emit("\n");
  };

  // Errors don't stop TeX: it carries on and the log says what went wrong (D15 item 5).
  emit("\\scrollmode\\errorcontextlines=5\\relax");

  const cls = /\\documentclass\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/.exec(text);
  const begin = cls ? text.indexOf("\\begin{document}", cls.index) : -1;
  if (cls && begin > cls.index && begin < pic.from) {
    const size = /\b(11|12)pt\b/.exec(cls[1] ?? "")?.[1];
    if (size) {
      emit("\n\\makeatletter");
      for (const [cmd, s, b] of SIZES[size]!) emit(`\\renewcommand\\${cmd}{\\@setfontsize\\${cmd}{${s}}{${b}}}`);
      emit("\\makeatother\\normalsize");
    }
    if (cls[2]!.trim() === "beamer") emit("\n\\renewcommand\\familydefault{\\sfdefault}\\normalfont");
    // The preamble, verbatim from the line after \documentclass, with unusable
    // packages taken out of their \usepackage lines.
    const eol = text.indexOf("\n", cls.index + cls[0].length);
    const from = eol < 0 || eol > begin ? begin : eol + 1;
    const preamble = text.slice(from, begin).replace(USEPACKAGE, (all, opts: string | undefined, list: string) => {
      const names = list.split(",").map((s) => s.trim()).filter(Boolean);
      const keep = names.filter((n) => {
        if (BUILT_IN.has(n)) return true;
        if (FONT_PACKAGES.has(n)) {
          // fontenc with OT1 only changes nothing.
          if (n === "fontenc" && !/T1|LY1|T2|TS1/.test(opts ?? "")) return true;
          fontPackages.push(n);
          return false;
        }
        if (SKIPPED.has(n)) return false;
        if (!available(`${n}.sty`)) {
          unavailable.push(n);
          return false;
        }
        return true;
      });
      if (keep.length === names.length) return all;
      // Keep the line count: the replacement stays on the same lines.
      const blank = all.replace(/[^\n]/g, "");
      return keep.length ? `\\usepackage${opts ?? ""}{${keep.join(",")}}${blank}` : `\\relax${blank}`;
    });
    copy(from, begin, preamble);
  }

  // Definitions outside the picture and outside the preamble (a bare picture's \tikzset, or a body's \definecolor).
  const preambleEnd = cls && begin > 0 ? begin : -1;
  for (const item of doc.syntax.preamble) {
    if (item.range.from >= pic.from) break;
    if (item.range.from < preambleEnd) continue;
    copy(item.range.from, item.range.to);
  }

  emit("\n\\begin{document}");
  const { body, blocks } = markBlocks(text, pic);
  copy(pic.from, pic.to, body);
  emit("\\end{document}\n");
  return { tex: parts.join(""), segments, unavailable, fontPackages, blocks };
}

/** The picture's text with each locked block between `tikzflow:begin`/`end` specials, on the same lines. */
function markBlocks(text: string, pic: PictureSyntax): { body: string; blocks: Map<string, { from: number; to: number }> } {
  const blocks = new Map<string, { from: number; to: number }>();
  const marks: Array<{ at: number; insert: string }> = [];
  for (const item of pic.items) {
    if (item.kind !== "opaque") continue;
    const id = `b${blocks.size}`;
    blocks.set(id, { from: item.range.from, to: item.range.to });
    marks.push({ at: item.range.from, insert: `\\special{tikzflow:begin ${id}}` });
    marks.push({ at: item.range.to, insert: `\\special{tikzflow:end ${id}}` });
  }
  let body = "";
  let at = pic.from;
  for (const m of marks.sort((a, b) => a.at - b.at)) {
    body += text.slice(at, m.at) + m.insert;
    at = m.at;
  }
  return { body: body + text.slice(at, pic.to), blocks };
}

/** The source line of input.tex's line `inputLine`, or null for a line the preview added. */
export function sourceLine(input: Pick<CompileInput, "segments">, inputLine: number): number | null {
  for (const s of input.segments) {
    if (inputLine >= s.inputLine && inputLine < s.inputLine + s.lines) return s.sourceLine + inputLine - s.inputLine;
  }
  return null;
}
