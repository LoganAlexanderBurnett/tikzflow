// TeX dimensions and a small subset of pgfmath, enough for the lengths
// that appear in flowcharts ("1.5cm", "-0.5em", "2*3mm", "1cm+2pt").
// Every length is in TeX points (pt), 72.27 per inch.

export const PT_PER_UNIT: Record<string, number> = {
  pt: 1,
  bp: 72.27 / 72,
  in: 72.27,
  cm: 72.27 / 2.54,
  mm: 72.27 / 25.4,
  pc: 12,
  dd: 1238 / 1157,
  cc: (12 * 1238) / 1157,
  sp: 1 / 65536,
  nd: 685 / 642,
  nc: (12 * 685) / 642,
};

export const CM = PT_PER_UNIT.cm!;

/** Font-relative units for the current font. */
export interface FontUnits {
  em: number;
  ex: number;
}

export const DEFAULT_FONT_UNITS: FontUnits = { em: 10, ex: 4.30554 };

export interface Quantity {
  value: number;
  /** Whether a unit appeared. pgfmath treats a unitless result as a plain number. */
  dimensioned: boolean;
}

type Token = { kind: "num"; value: number; unit?: string } | { kind: "op"; op: string };

/** The page's lengths, pt (D73): what \textwidth, \columnwidth, \linewidth and \paperwidth are in the picture. */
export interface PageLengths {
  textWidth: number;
  columnWidth: number;
  paperWidth: number;
}

/** Article, 10pt, A4: what a picture with no preamble, or one that says nothing about its page, gets. */
export const DEFAULT_PAGE: PageLengths = { textWidth: 345, columnWidth: 345, paperWidth: 597.50787 };

/**
 * The page the lengths below refer to. The layout sets it from the document it draws (layoutPicture), so
 * the quick preview, the planners that check their edits by drawing, and the TeX preview all read
 * \textwidth the same way. Module state because evalLength is called from everywhere; one document is
 * drawn at a time and every drawing sets it first.
 */
let page: PageLengths = DEFAULT_PAGE;
export function setPageLengths(p: PageLengths | null): void {
  page = p ?? DEFAULT_PAGE;
}

/** Macros whose value is a known length. */
function knownLength(name: string): number | undefined {
  switch (name) {
    case "\\pgflinewidth":
      return 0.4;
    case "\\baselineskip":
      return 12;
    case "\\textwidth":
      return page.textWidth;
    case "\\linewidth":
    case "\\columnwidth":
      return page.columnWidth;
    case "\\paperwidth":
      return page.paperWidth;
    case "\\fill":
      return 0;
    default:
      return undefined;
  }
}

function tokenize(s: string, font: FontUnits): Token[] | null {
  const out: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if ("+-*/()".includes(ch)) {
      out.push({ kind: "op", op: ch });
      i++;
      continue;
    }
    const num = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
    if (num) {
      i += num[0].length;
      const rest = s.slice(i);
      const unit = /^\s*(pt|bp|in|cm|mm|pc|dd|cc|sp|nd|nc|em|ex)(?![a-zA-Z])/.exec(rest);
      const t: Token = { kind: "num", value: parseFloat(num[0]) };
      if (unit) {
        t.unit = unit[1]!;
        i += unit[0].length;
      } else {
        // A length macro right after a number multiplies it: "0.5\pgflinewidth".
        const cs = /^\s*(\\[a-zA-Z]+)/.exec(rest);
        const known = cs ? knownLength(cs[1]!) : undefined;
        if (cs && known !== undefined) {
          out.push(t, { kind: "op", op: "*" }, { kind: "num", value: known, unit: "pt" });
          i += cs[0].length;
          continue;
        }
      }
      out.push(t);
      continue;
    }
    const cs = /^\\[a-zA-Z]+/.exec(s.slice(i));
    if (cs && (cs[0] === "\\space" || cs[0] === "\\relax")) {
      i += cs[0].length;
      continue;
    }
    const known = cs ? knownLength(cs[0]) : undefined;
    if (cs && known !== undefined) {
      out.push({ kind: "num", value: known, unit: "pt" });
      i += cs[0].length;
      continue;
    }
    return null;
  }
  void font;
  return out;
}

/**
 * Evaluates a length expression. Returns null for anything it doesn't
 * understand (macros, functions), so callers can report it rather than guess.
 */
export function evalQuantity(input: string, font: FontUnits = DEFAULT_FONT_UNITS): Quantity | null {
  const s = input.trim();
  if (!s) return null;
  const tokens = tokenize(s, font);
  if (!tokens) return null;
  let pos = 0;
  const peek = () => tokens[pos];
  const toPt = (t: Token & { kind: "num" }): Quantity => {
    if (!t.unit) return { value: t.value, dimensioned: false };
    if (t.unit === "em") return { value: t.value * font.em, dimensioned: true };
    if (t.unit === "ex") return { value: t.value * font.ex, dimensioned: true };
    return { value: t.value * PT_PER_UNIT[t.unit]!, dimensioned: true };
  };
  function primary(): Quantity | null {
    const t = peek();
    if (!t) return null;
    if (t.kind === "op" && (t.op === "+" || t.op === "-")) {
      pos++;
      const q = primary();
      return q && { value: t.op === "-" ? -q.value : q.value, dimensioned: q.dimensioned };
    }
    if (t.kind === "op" && t.op === "(") {
      pos++;
      const q = sum();
      const close = peek();
      if (!close || close.kind !== "op" || close.op !== ")") return null;
      pos++;
      return q;
    }
    if (t.kind === "num") {
      pos++;
      return toPt(t);
    }
    return null;
  }
  function product(): Quantity | null {
    let q = primary();
    for (let t = peek(); q && t && t.kind === "op" && (t.op === "*" || t.op === "/"); t = peek()) {
      pos++;
      const r = primary();
      if (!r) return null;
      q =
        t.op === "*"
          ? { value: q.value * r.value, dimensioned: q.dimensioned || r.dimensioned }
          : { value: q.value / r.value, dimensioned: q.dimensioned && !r.dimensioned };
    }
    return q;
  }
  function sum(): Quantity | null {
    let q = product();
    for (let t = peek(); q && t && t.kind === "op" && (t.op === "+" || t.op === "-"); t = peek()) {
      pos++;
      const r = product();
      if (!r) return null;
      // pgfmath: mixing a dimension with a plain number treats the number as pt.
      q = { value: t.op === "+" ? q.value + r.value : q.value - r.value, dimensioned: q.dimensioned || r.dimensioned };
    }
    return q;
  }
  const q = sum();
  if (!q || pos !== tokens.length || !Number.isFinite(q.value)) return null;
  return q;
}

/** A length in pt. Plain numbers count as pt, as TeX dimension keys do. */
export function evalLength(input: string, font?: FontUnits): number | null {
  const q = evalQuantity(input, font);
  return q ? q.value : null;
}

/** A number without unit (angles, factors). Dimensions are rejected. */
export function evalNumber(input: string): number | null {
  const q = evalQuantity(input);
  return q && !q.dimensioned ? q.value : null;
}

/** Formats a length for emitted code: "1.5cm", "8mm", "12pt". */
export function formatLength(pt: number, unit: "cm" | "mm" | "pt" = "cm"): string {
  const v = pt / PT_PER_UNIT[unit]!;
  const rounded = Math.round(v * 100) / 100;
  return `${trimNumber(rounded)}${unit}`;
}

export function trimNumber(v: number): string {
  if (Object.is(v, -0) || Math.abs(v) < 1e-9) return "0";
  return String(Math.round(v * 1000) / 1000);
}
