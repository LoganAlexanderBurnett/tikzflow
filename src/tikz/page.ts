// SPDX-License-Identifier: GPL-3.0-or-later
// The width of the page a figure goes on (M3 step 10, D71): what a preamble
// says about \textwidth and \columnwidth, worked out without compiling it.
// The engine's format is `standalone`, which has no page, so this reads the
// document class's options, the geometry package and \setlength the way TeX
// would, for the classes whose defaults are known (article, report, book,
// beamer). For any other class the widths are unknown until the file sets them
// or the user types one. Every width says where it came from.

import { DEFAULT_PAGE, evalLength, type PageLengths, PT_PER_UNIT } from "./units.ts";

export interface PageGeometry {
  /** The document class, if the preamble has a \documentclass line. */
  documentClass: string | null;
  /** Width of the paper, pt. */
  paperWidth: number | null;
  /** \textwidth, pt. */
  textWidth: number | null;
  /** \columnwidth (and \linewidth in a figure), pt. */
  columnWidth: number | null;
  columns: 1 | 2;
  /** Where the numbers came from, one line each. */
  notes: string[];
  /** The widths follow from a class's defaults rather than from lengths the file sets. */
  estimated: boolean;
}

const mm = (v: number) => (v * PT_PER_UNIT.mm!);
const inch = (v: number) => v * PT_PER_UNIT.in!;

/** Paper widths, pt: width then height. */
const PAPERS: Record<string, [number, number]> = {
  a4paper: [mm(210), mm(297)],
  a5paper: [mm(148), mm(210)],
  b5paper: [mm(176), mm(250)],
  letterpaper: [inch(8.5), inch(11)],
  legalpaper: [inch(8.5), inch(14)],
  executivepaper: [inch(7.25), inch(10.5)],
};

/** Text width of the standard classes' 10, 11 and 12pt files (size10.clo and the others), pt. */
const BASE_TEXT_WIDTH: Record<string, number> = { "10": 345, "11": 360, "12": 390 };
const STANDARD_CLASSES = new Set(["article", "report", "book"]);

/** Beamer's paper widths by aspect ratio, pt; its text is the paper less 1 cm each side. */
const BEAMER_PAPER: Record<string, number> = { "43": mm(128), "169": mm(160), "1610": mm(160) };

/** The text without comments (a % not escaped to the end of its line). */
function stripComments(s: string): string {
  return s.replace(/(^|[^\\])%.*$/gm, "$1");
}

/** The text of the braces that open at `s[open]` (a "{"), and where they close, or null. */
function braced(s: string, open: number): { body: string; end: number } | null {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") i++;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return { body: s.slice(open + 1, i), end: i + 1 };
  }
  return null;
}

/** Splits at commas outside braces. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === "," && depth === 0) {
      out.push(s.slice(from, i));
      from = i + 1;
    }
  }
  out.push(s.slice(from));
  return out.map((x) => x.trim()).filter(Boolean);
}

/** A key list's values: `margin=2cm, a4paper, hmargin={1in,1in}`. */
function keyList(s: string): Map<string, string | true> {
  const out = new Map<string, string | true>();
  for (const item of splitTop(s)) {
    const eq = item.indexOf("=");
    if (eq < 0) out.set(item, true);
    else out.set(item.slice(0, eq).trim(), item.slice(eq + 1).trim().replace(/^\{(.*)\}$/s, "$1"));
  }
  return out;
}

/** geometry's options: from `\usepackage[...]{geometry}` and every `\geometry{...}`. */
function geometryOptions(s: string): Array<Map<string, string | true>> {
  const out: Array<Map<string, string | true>> = [];
  for (const m of s.matchAll(/\\usepackage\s*\[/g)) {
    const open = m.index! + m[0].length - 1;
    const close = matching(s, open, "[", "]");
    if (close < 0) continue;
    const rest = /^\s*\{([^}]*)\}/.exec(s.slice(close + 1));
    if (rest && rest[1]!.split(",").some((p) => p.trim() === "geometry")) out.push(keyList(s.slice(open + 1, close)));
  }
  for (const m of s.matchAll(/\\geometry\s*\{/g)) {
    const b = braced(s, m.index! + m[0].length - 1);
    if (b) out.push(keyList(b.body));
  }
  return out;
}

function matching(s: string, open: number, o: string, c: string): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "\\") i++;
    else if (s[i] === o) depth++;
    else if (s[i] === c && --depth === 0) return i;
  }
  return -1;
}

const trim1 = (v: number) => String(Math.round(v * 10) / 10);

/** "252 pt (88.9 mm, 3.49 in)": a width in the units people think in. */
export function describeWidth(pt: number): string {
  return `${trim1(pt)} pt (${trim1(pt / PT_PER_UNIT.mm!)} mm, ${Math.round((pt / PT_PER_UNIT.in!) * 100) / 100} in)`;
}

/** Widths the user typed (D73); they win over whatever the preamble says. */
export interface WidthOverride {
  textWidth?: number | null;
  columnWidth?: number | null;
}

/** What the Page panel holds: the imported preamble and the typed widths. */
export interface PageSettings extends WidthOverride {
  imported: string;
}

export const NO_PAGE_SETTINGS: PageSettings = { imported: "", textWidth: null, columnWidth: null };

/** The preamble of a document that has one before the picture at `picFrom` (a \documentclass … \begin{document}), or null. */
export function ownPreamble(text: string, picFrom: number): string | null {
  const cls = /\\documentclass/.exec(text);
  const begin = cls ? text.indexOf("\\begin{document}", cls.index) : -1;
  return cls && begin > cls.index && begin < picFrom ? text.slice(0, begin) : null;
}

/**
 * What the page is for a picture: the preamble in use (the code's own, else the imported one) with the
 * typed widths over it. Null when there is no preamble and no typed width. The one place the quick
 * preview, the width guide and the TeX preview all take their widths from (D73).
 */
export function effectivePage(own: string | null, settings: PageSettings): PageGeometry | null {
  const source = own ?? (settings.imported.trim() ? settings.imported : null);
  const typed = settings.textWidth != null || settings.columnWidth != null;
  if (source === null && !typed) return null;
  // Every planner builds an environment, so the last answer is kept.
  if (last && last.source === source && last.text === settings.textWidth && last.column === settings.columnWidth) return last.page;
  const page = pageGeometry(source ?? "", settings);
  last = { source, text: settings.textWidth, column: settings.columnWidth, page };
  return page;
}
let last: { source: string | null; text: number | null | undefined; column: number | null | undefined; page: PageGeometry } | null = null;

/** The lengths a picture sees on this page: what is known, else article's (the class the preview substitutes). */
export function pageLengths(g: PageGeometry | null): PageLengths {
  if (!g) return DEFAULT_PAGE;
  const textWidth = g.textWidth ?? g.columnWidth ?? DEFAULT_PAGE.textWidth;
  return { textWidth, columnWidth: g.columnWidth ?? textWidth, paperWidth: g.paperWidth ?? DEFAULT_PAGE.paperWidth };
}

/**
 * Reads the page widths a preamble implies. `preamble` may be a whole document: only what comes before
 * \begin{document} counts. `typed` widths come last and win.
 */
export function pageGeometry(source: string, typed: WidthOverride = {}): PageGeometry {
  const end = source.indexOf("\\begin{document}");
  const s = stripComments(end < 0 ? source : source.slice(0, end));
  const g: PageGeometry = { documentClass: null, paperWidth: null, textWidth: null, columnWidth: null, columns: 1, notes: [], estimated: true };

  const cls = /\\documentclass\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/.exec(s);
  const options = (cls?.[1] ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  g.documentClass = cls ? cls[2]!.trim() : null;
  const size = /^(10|11|12)pt$/.exec(options.find((o) => /^(10|11|12)pt$/.test(o)) ?? "")?.[1] ?? "10";
  g.columns = options.includes("twocolumn") ? 2 : 1;
  const paperName = options.find((o) => o in PAPERS) ?? "letterpaper";
  let columnSep = 10;

  // The class's own defaults.
  if (g.documentClass && STANDARD_CLASSES.has(g.documentClass)) {
    const [pw, ph] = PAPERS[paperName]!;
    g.paperWidth = options.includes("landscape") ? ph : pw;
    const available = g.paperWidth - inch(2);
    const base = BASE_TEXT_WIDTH[size]!;
    const full = g.columns === 2 ? 2 * base : base;
    // size10.clo and the others: the base width if the paper is wider than it needs, else what the paper leaves, to whole points.
    g.textWidth = available > full ? full : Math.floor(available);
    g.notes.push(`${g.documentClass}, ${size}pt, ${paperName.replace("paper", "")}${g.columns === 2 ? ", two columns" : ""}: the class gives a text width of ${describeWidth(g.textWidth)}`);
  } else if (g.documentClass === "beamer") {
    const ratio = options.map((o) => /^aspectratio=(\d+)$/.exec(o)?.[1]).find(Boolean) ?? "43";
    const paper = BEAMER_PAPER[ratio];
    if (paper) {
      g.paperWidth = paper;
      g.textWidth = paper - 2 * mm(10);
      g.notes.push(`beamer, aspect ratio ${ratio === "43" ? "4:3" : ratio === "169" ? "16:9" : "16:10"}: slides ${trim1(paper / PT_PER_UNIT.mm!)} mm wide with 1 cm margins give a text width of ${describeWidth(g.textWidth)}`);
    } else g.notes.push(`beamer with aspect ratio ${ratio}: its slide width isn't known here`);
  } else if (g.documentClass) {
    g.notes.push(`The ${g.documentClass} class's page isn't known here: set a width below, or say it in the preamble (\\setlength{\\textwidth}{…}, geometry)`);
  }
  if (g.paperWidth === null && paperName in PAPERS && options.some((o) => o in PAPERS)) g.paperWidth = PAPERS[paperName]![0];

  // geometry, in the order it is loaded or called.
  for (const opts of geometryOptions(s)) {
    const paper = [...opts.keys()].find((k) => k in PAPERS);
    if (paper) {
      const [pw, ph] = PAPERS[paper]!;
      g.paperWidth = opts.has("landscape") ? ph : pw;
    }
    const pwKey = opts.get("paperwidth");
    if (typeof pwKey === "string" && evalLength(pwKey) !== null) g.paperWidth = evalLength(pwKey);
    const len = (k: string) => {
      const v = opts.get(k);
      return typeof v === "string" ? evalLength(v) : null;
    };
    const pair = (k: string): [number | null, number | null] => {
      const v = opts.get(k);
      if (typeof v !== "string") return [null, null];
      const parts = v.split(",").map((x) => x.trim());
      return [evalLength(parts[0] ?? ""), parts[1] !== undefined ? evalLength(parts[1]) : evalLength(parts[0] ?? "")];
    };
    let width: number | null = len("textwidth") ?? len("width") ?? pair("text")[0] ?? pair("total")[0];
    let how = "";
    if (width !== null) how = "its width";
    if (width === null) {
      const margin = len("margin");
      const hm = pair("hmargin");
      const left = len("left") ?? len("inner") ?? hm[0] ?? margin;
      const right = len("right") ?? len("outer") ?? hm[1] ?? margin;
      if (g.paperWidth !== null && left !== null && right !== null) {
        width = g.paperWidth - left - right;
        how = "its margins";
      } else if (g.paperWidth !== null && typeof opts.get("hscale") === "string") {
        width = g.paperWidth * (parseFloat(opts.get("hscale") as string) || 0);
        how = "hscale";
      } else if (g.paperWidth !== null && typeof opts.get("scale") === "string") {
        width = g.paperWidth * (parseFloat(opts.get("scale") as string) || 0);
        how = "scale";
      }
    }
    if (width !== null && width > 0) {
      g.textWidth = width;
      g.estimated = false;
      g.notes.push(`geometry gives a text width of ${describeWidth(width)} from ${how}`);
    }
  }

  // \setlength, \addtolength and `\textwidth=…`, in order.
  const names = ["textwidth", "columnwidth", "columnsep", "paperwidth", "linewidth"] as const;
  type Name = (typeof names)[number];
  let explicitColumn: number | null = null;
  const current = (n: Name): number | null => (n === "textwidth" ? g.textWidth : n === "columnwidth" || n === "linewidth" ? explicitColumn ?? g.columnWidth : n === "paperwidth" ? g.paperWidth : columnSep);
  const evalValue = (raw: string): number | null => {
    let v = raw.trim();
    v = v.replace(/(\d*\.?\d+)\s*\\(textwidth|paperwidth|columnwidth|linewidth)(?![a-zA-Z])/g, (_m, k: string, n: string) => {
      const c = current(n as Name);
      return c === null ? "?" : `${k}*(${c}pt)`;
    });
    v = v.replace(/\\(textwidth|paperwidth|columnwidth|linewidth)(?![a-zA-Z])/g, (_m, n: string) => {
      const c = current(n as Name);
      return c === null ? "?" : `(${c}pt)`;
    });
    return v.includes("?") ? null : evalLength(v);
  };
  const set = (n: Name, v: number, add: boolean, text: string) => {
    const base = current(n);
    const value = add ? (base === null ? null : base + v) : v;
    if (value === null) return;
    if (n === "textwidth") g.textWidth = value;
    else if (n === "columnwidth" || n === "linewidth") explicitColumn = value;
    else if (n === "paperwidth") g.paperWidth = value;
    else columnSep = value;
    if (n !== "paperwidth" && n !== "columnsep") g.estimated = false;
    g.notes.push(`${text} gives ${describeWidth(value)}`);
  };
  const found: Array<{ at: number; name: Name; add: boolean; value: string; text: string }> = [];
  for (const m of s.matchAll(/\\(setlength|addtolength)\s*(?:\{\s*\\(\w+)\s*\}|\\(\w+))\s*\{/g)) {
    const name = (m[2] ?? m[3]) as Name;
    if (!(names as readonly string[]).includes(name)) continue;
    const b = braced(s, m.index! + m[0].length - 1);
    if (b) found.push({ at: m.index!, name, add: m[1] === "addtolength", value: b.body, text: `\\${m[1]}{\\${name}}{${b.body.trim()}}` });
  }
  for (const m of s.matchAll(/\\(textwidth|columnwidth|columnsep|paperwidth|linewidth)\s*=\s*([^\\\n;]+?)\s*(?=\n|$|\\|;)/g)) {
    found.push({ at: m.index!, name: m[1] as Name, add: false, value: m[2]!, text: `\\${m[1]}=${m[2]!.trim()}` });
  }
  found.sort((a, b) => a.at - b.at);
  for (const f of found) {
    const v = evalValue(f.value);
    if (v !== null) set(f.name, v, f.add, f.text);
    else g.notes.push(`${f.text} couldn't be read, so it is ignored`);
  }

  // Widths the user typed: they win (D73).
  if (typed.textWidth != null) {
    g.textWidth = typed.textWidth;
    g.estimated = false;
    g.notes.push(`You typed a text width of ${describeWidth(typed.textWidth)}`);
  }
  if (typed.columnWidth != null) {
    explicitColumn = typed.columnWidth;
    g.estimated = false;
    g.notes.push(`You typed a column width of ${describeWidth(typed.columnWidth)}`);
  }

  // The column: the whole text on one column, what two columns leave on two.
  if (explicitColumn !== null) g.columnWidth = explicitColumn;
  else if (g.textWidth !== null) g.columnWidth = g.columns === 2 ? (g.textWidth - columnSep) / 2 : g.textWidth;
  if (g.columns === 2 && g.columnWidth !== null && explicitColumn === null) g.notes.push(`two columns ${trim1(columnSep)} pt apart leave a column of ${describeWidth(g.columnWidth)}`);
  return g;
}
