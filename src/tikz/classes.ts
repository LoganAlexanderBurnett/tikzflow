// SPDX-License-Identifier: GPL-3.0-or-later
// The page a document class gives (D71, D73): text width, columns and the gap
// between them, from the class's options. The numbers are what LaTeX itself
// printed for each class and option list in the pinned TeX Live 2026 image
// (engine/page-widths/measured.jsonl, made by .github/workflows/page-widths.yml);
// test/page.test.ts runs every measured case through this file.
//
// Classes: article, report and book (size10.clo and the others), and the
// presets elsarticle, IEEEtran, revtex4-2, acmart and llncs. Any other class is
// unknown: the caller says so and takes typed widths.

import { PT_PER_UNIT } from "./units.ts";

const mm = (v: number) => v * PT_PER_UNIT.mm!;
const inch = (v: number) => v * PT_PER_UNIT.in!;

/** Paper widths, pt: width then height. */
export const PAPERS: Record<string, [number, number]> = {
  a4paper: [mm(210), mm(297)],
  a5paper: [mm(148), mm(210)],
  b5paper: [mm(176), mm(250)],
  letterpaper: [inch(8.5), inch(11)],
  legalpaper: [inch(8.5), inch(14)],
  executivepaper: [inch(7.25), inch(10.5)],
};

/** What a class's options give for the page. */
export interface ClassPage {
  /** Width of the paper, pt, when the class's text width follows from it. */
  paperWidth: number | null;
  textWidth: number;
  columns: 1 | 2;
  /** The gap between two columns, pt. */
  columnSep: number;
  /** One line on where the numbers come from. */
  note: string;
}

/** A class option list, read the way `\documentclass[...]` is. */
export interface ClassOptions {
  /** Every option, trimmed. */
  all: string[];
  /** 10, 11 or 12 when a size is given. */
  size: "10" | "11" | "12" | null;
  paper: string | null;
  landscape: boolean;
  has(option: string): boolean;
  /** `key=value` options. */
  value(key: string): string | null;
}

export function readClassOptions(list: string[]): ClassOptions {
  const size = [...list].reverse().find((o) => /^(10|11|12)pt$/.test(o));
  const paper = [...list].reverse().find((o) => o in PAPERS);
  return {
    all: list,
    size: size ? (size.slice(0, 2) as "10" | "11" | "12") : null,
    paper: paper ?? null,
    landscape: list.includes("landscape"),
    has: (o) => list.includes(o),
    value: (key) => {
      for (const o of [...list].reverse()) if (o.startsWith(`${key}=`)) return o.slice(key.length + 1).trim();
      return null;
    },
  };
}

const BASE_TEXT_WIDTH: Record<string, number> = { "10": 345, "11": 360, "12": 390 };

/** article, report and book: size10.clo, size11.clo and size12.clo, or what the paper leaves. */
function standard(cls: string, o: ClassOptions, forceColumns?: 1 | 2): ClassPage {
  const size = o.size ?? "10";
  const [pw, ph] = PAPERS[o.paper ?? "letterpaper"]!;
  const paperWidth = o.landscape ? ph : pw;
  const columns = forceColumns ?? (o.has("twocolumn") ? 2 : 1);
  const available = paperWidth - inch(2);
  const base = BASE_TEXT_WIDTH[size]!;
  const full = columns === 2 ? 2 * base : base;
  // The base width if the paper is wider than it needs, else what the paper leaves, to whole points.
  const textWidth = available > full ? full : Math.floor(available);
  return {
    paperWidth,
    textWidth,
    columns,
    columnSep: 10,
    note: `${cls}, ${size}pt, ${(o.paper ?? "letterpaper").replace("paper", "")}${columns === 2 ? ", two columns" : ""}`,
  };
}

/** The class's page for these options, or null for a class this file doesn't know. */
export function classPage(cls: string, o: ClassOptions): ClassPage | null {
  switch (cls) {
    case "article":
    case "report":
    case "book":
      return standard(cls, o);

    case "elsarticle": {
      // 1p, 3p and 5p set the text width; 1p is one column, 5p two, and 3p follows twocolumn. Otherwise article's.
      const layout = [...o.all].reverse().find((x) => x === "1p" || x === "3p" || x === "5p");
      if (layout === "1p") return { paperWidth: null, textWidth: 384, columns: 1, columnSep: 24, note: "elsarticle 1p" };
      if (layout === "3p") return { paperWidth: null, textWidth: 468, columns: o.has("twocolumn") ? 2 : 1, columnSep: 24, note: `elsarticle 3p${o.has("twocolumn") ? ", two columns" : ""}` };
      if (layout === "5p") return { paperWidth: null, textWidth: 522, columns: 2, columnSep: 18, note: "elsarticle 5p, two columns" };
      return { ...standard("elsarticle", o), note: `elsarticle (article's page${o.size ? `, ${o.size}pt` : ""}${o.has("twocolumn") ? ", two columns" : ""})` };
    }

    case "IEEEtran":
      return ieee(o);
    case "revtex4-2":
      return revtex(o);
    case "acmart":
      return acm(o);

    case "llncs": {
      // A fixed 12.2 cm text block; twocolumn only splits it.
      const columns = o.has("twocolumn") ? 2 : 1;
      return { paperWidth: null, textWidth: 347.12354, columns, columnSep: 10, note: `llncs: a 12.2 cm text block${columns === 2 ? ", two columns" : ""}` };
    }
    default:
      return null;
  }
}

/**
 * IEEEtran: a fixed text block, two columns unless `onecolumn` or a peer-review option; the
 * `compsoc` option widens it a little and `conference,compsoc` narrows it to 7 in. With `draftcls`
 * and one column the text is what the paper leaves after 1 in margins.
 */
function ieee(o: ClassOptions): ClassPage {
  const one = o.has("onecolumn") || o.has("peerreview") || o.has("peerreviewca");
  const columns: 1 | 2 = one ? 1 : 2;
  if (o.has("draftcls") && o.has("onecolumn")) {
    const [pw, ph] = PAPERS[o.paper ?? "letterpaper"]!;
    const paperWidth = o.landscape ? ph : pw;
    return { paperWidth, textWidth: paperWidth - inch(2), columns: 1, columnSep: 12, note: "IEEEtran, draftcls, one column: the paper less 1 in margins" };
  }
  let textWidth = 516;
  let columnSep = 12;
  if (o.has("compsoc")) {
    textWidth = o.has("conference") ? 505.89 : 517.935;
    columnSep = o.has("conference") ? 18.0675 : 12.045;
  }
  return { paperWidth: null, textWidth, columns, columnSep, note: `IEEEtran${o.has("compsoc") ? " compsoc" : ""}${columns === 2 ? ", two columns" : ", one column"}` };
}

/**
 * revtex4-2: the text width follows the type size (10pt 510 pt, 11 and 12pt 468 pt), which is the
 * 10pt of `reprint`, the 12pt of `preprint` and the AIP style, and 10pt otherwise. `reprint` and
 * `twocolumn` give two columns (18 pt apart at 10pt, else 10 pt) unless `onecolumn` is also given.
 */
function revtex(o: ClassOptions): ClassPage {
  const size = o.size ?? (o.has("reprint") ? "10" : o.has("preprint") || o.has("aip") ? "12" : "10");
  const columns: 1 | 2 = !o.has("onecolumn") && (o.has("reprint") || o.has("twocolumn")) ? 2 : 1;
  return {
    paperWidth: null,
    textWidth: size === "10" ? 510 : 468,
    columns,
    columnSep: size === "10" ? 18 : 10,
    note: `revtex4-2, ${size}pt${columns === 2 ? ", two columns" : ", one column"}`,
  };
}

/** acmart's formats that set the page in one column, from `format=` or the format name as an option. */
const ACM_ONE_COLUMN: Record<string, number> = { manuscript: 430.00462, acmsmall: 395.8225, acmlarge: 452.295, acmcp: 395.8225 };

/**
 * acmart: the text width of the single-column formats. The two-column formats (sigconf, sigplan,
 * sigchi, acmtog, acmengage) switch to two columns after the title, so their column width isn't
 * the one LaTeX has at egin{document}; it is only known once measured after a title
 * (engine/page-widths), and a format not listed is not guessed.
 */
function acm(o: ClassOptions): ClassPage | null {
  const format = o.value("format") ?? ["manuscript", "acmsmall", "acmlarge", "acmcp", "sigconf", "sigplan", "sigchi", "sigchi-a", "acmtog", "acmengage"].find((f) => o.has(f)) ?? "manuscript";
  const width = ACM_ONE_COLUMN[format];
  if (width === undefined || o.has("twocolumn")) return null;
  return { paperWidth: null, textWidth: width, columns: 1, columnSep: 18, note: `acmart ${format}` };
}
