// Node labels: a small TeX text-mode reader plus line layout. It produces
// runs measured with Computer Modern metrics, so node sizes are the same in
// tests and in the browser and don't depend on font loading.
import katex from "katex";
import type { RGB } from "../tikz/colors.ts";
import type { FontSpec } from "../tikz/state.ts";
import { FONT_METRICS } from "./fontMetrics.ts";

export interface Macro {
  params: number;
  defaultArg?: string;
  body: string;
}

export interface LabelEnv {
  macros: ReadonlyMap<string, Macro>;
  /** Resolves a colour name for \color and \textcolor. */
  color: (expr: string) => RGB | null;
}

export interface TextStyle {
  size: number;
  family: "rm" | "sf" | "tt";
  bold: boolean;
  italic: boolean;
  smallcaps: boolean;
  underline: boolean;
  color?: RGB;
  /** Raised (+1) or lowered (-1) script text from \textsuperscript / \textsubscript. */
  script?: 1 | -1;
}

export type Run =
  | { kind: "text"; text: string; style: TextStyle; x: number; width: number }
  | { kind: "math"; tex: string; display: boolean; style: TextStyle; x: number; width: number; height: number; depth: number }
  | { kind: "unknown"; text: string; style: TextStyle; x: number; width: number };

export interface Line {
  runs: Run[];
  width: number;
  height: number;
  depth: number;
  /** Offset of the line from the left edge of the text box. */
  x: number;
  /** Baseline position measured down from the top of the text box. */
  baseline: number;
}

export interface TextLayout {
  lines: Line[];
  width: number;
  height: number;
  depth: number;
  /** Constructs that were shown approximately or not at all. */
  issues: string[];
}

// ---------------------------------------------------------------- metrics

function fontName(st: TextStyle): string {
  if (st.family === "tt") return "Typewriter-Regular";
  if (st.family === "sf") return st.bold ? "SansSerif-Bold" : st.italic ? "SansSerif-Italic" : "SansSerif-Regular";
  if (st.bold && st.italic) return "Main-BoldItalic";
  if (st.bold) return "Main-Bold";
  if (st.italic) return "Main-Italic";
  return "Main-Regular";
}

/** Interword space in em, from the TeX fonts' fontdimen 2. */
function spaceWidth(st: TextStyle): number {
  if (st.family === "tt") return 0.525;
  if (st.bold) return 0.38333;
  return 0.33333;
}

function scriptScale(st: TextStyle): number {
  return st.script ? 0.7 : 1;
}

interface Measure {
  width: number;
  height: number;
  depth: number;
}

export function measureText(text: string, st: TextStyle): Measure {
  const table = FONT_METRICS[fontName(st)]!;
  const fallback = FONT_METRICS["Main-Regular"]!;
  const em = st.size * scriptScale(st);
  let width = 0;
  let height = 0;
  let depth = 0;
  for (const ch of text) {
    let code = ch.codePointAt(0)!;
    if (st.smallcaps && ch >= "a" && ch <= "z") code = ch.toUpperCase().codePointAt(0)!;
    const scale = st.smallcaps && ch >= "a" && ch <= "z" ? 0.8 : 1;
    if (ch === " ") {
      width += spaceWidth(st) * em;
      continue;
    }
    if (ch === " ") {
      width += spaceWidth(st) * em;
      continue;
    }
    const m = table[code] ?? fallback[code] ?? fallback[baseLetter(ch)];
    if (m) {
      width += m[2] * em * scale;
      height = Math.max(height, m[0] * em * scale);
      depth = Math.max(depth, m[1] * em * scale);
    } else {
      // Unknown glyphs: wide for CJK and emoji, half an em otherwise.
      const wide = code >= 0x2e80;
      width += (wide ? 1 : 0.5) * em;
      height = Math.max(height, (wide ? 0.8 : 0.683) * em);
      depth = Math.max(depth, (wide ? 0.12 : 0) * em);
    }
  }
  if (st.script) {
    const shift = st.script === 1 ? 0.363 * st.size : -0.15 * st.size;
    height = Math.max(0, height + shift);
    depth = Math.max(0, depth - shift);
  }
  return { width, height, depth };
}

/** For accented letters without metrics, the unaccented letter. */
function baseLetter(ch: string): number {
  const base = ch.normalize("NFD")[0] ?? ch;
  return base.codePointAt(0)!;
}

// KaTeX's sizes relative to normalsize, indexed by its "sizeN" classes.
const KATEX_SIZES = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.2, 1.44, 1.728, 2.074, 2.488];

interface KatexNode {
  classes?: string[];
  children?: KatexNode[];
  text?: string;
  width?: number;
  italic?: number;
  height?: number;
  depth?: number;
  style?: Record<string, string>;
}

function emValue(v: string | undefined): number {
  if (!v) return 0;
  const m = /^(-?[\d.]+)em$/.exec(v);
  return m ? parseFloat(m[1]!) : 0;
}

function katexWidth(node: KatexNode, scale: number): number {
  const cls = node.classes ?? [];
  let s = scale;
  if (cls.includes("sizing") || cls.includes("fontsize-ensurer")) {
    const reset = cls.find((c) => c.startsWith("reset-size"));
    const size = cls.find((c) => /^size\d+$/.test(c));
    if (reset && size) s = (scale * KATEX_SIZES[+size.slice(4) - 1]!) / KATEX_SIZES[+reset.slice(10) - 1]!;
  }
  const margins = (emValue(node.style?.marginLeft) + emValue(node.style?.marginRight)) * s;
  if (node.text !== undefined) return ((node.width ?? 0) + (node.italic ?? 0)) * s + margins;
  if (cls.includes("vlist-s") || cls.includes("pstrut") || cls.includes("katex-strut") || cls.includes("strut")) return 0;
  if (cls.includes("nulldelimiter")) return 0.12 * s;
  if (node.style?.width && !node.children?.length) return emValue(node.style.width) * s + margins;
  const kids = node.children ?? [];
  if (cls.includes("vlist")) return Math.max(0, ...kids.map((k) => katexWidth(k, s))) + margins;
  let w = 0;
  for (const k of kids) w += katexWidth(k, s);
  return w + margins + (node.style?.minWidth ? 0 : 0);
}

const mathCache = new Map<string, Measure | null>();

export function measureMath(tex: string, display: boolean, macros: Record<string, string>): Measure | null {
  const key = `${display ? "D" : "i"}${JSON.stringify(macros)}${tex}`;
  if (mathCache.has(key)) return mathCache.get(key)!;
  let result: Measure | null;
  try {
    const tree = (katex as unknown as { __renderToHTMLTree: (t: string, o: object) => KatexNode }).__renderToHTMLTree(tex, {
      displayMode: display,
      macros: { ...macros },
      throwOnError: true,
      strict: "ignore",
    });
    result = { width: katexWidth(tree, 1), height: tree.height ?? 0.7, depth: tree.depth ?? 0 };
  } catch {
    result = null;
  }
  if (mathCache.size > 2000) mathCache.clear();
  mathCache.set(key, result);
  return result;
}

// ---------------------------------------------------------------- reader

type Item =
  | { kind: "text"; text: string; style: TextStyle }
  | { kind: "space"; style: TextStyle; width?: number; breakable: boolean }
  | { kind: "math"; tex: string; display: boolean; style: TextStyle }
  | { kind: "unknown"; text: string; style: TextStyle }
  | { kind: "break" };

const SPACES: Record<string, number> = {
  "\\,": 0.16667,
  "\\thinspace": 0.16667,
  "\\:": 0.22222,
  "\\>": 0.22222,
  "\\;": 0.27778,
  "\\enspace": 0.5,
  "\\quad": 1,
  "\\qquad": 2,
  "\\enskip": 0.5,
  "\\hfill": 0.33333,
  "\\hfil": 0.33333,
  "\\!": -0.16667,
  "\\negthinspace": -0.16667,
};

const SYMBOLS: Record<string, string> = {
  "\\%": "%",
  "\\&": "&",
  "\\#": "#",
  "\\_": "_",
  "\\$": "$",
  "\\{": "{",
  "\\}": "}",
  "\\ldots": "…",
  "\\dots": "…",
  "\\textellipsis": "…",
  "\\textbullet": "•",
  "\\textendash": "–",
  "\\textemdash": "—",
  "\\textdegree": "°",
  "\\copyright": "©",
  "\\textregistered": "®",
  "\\texttrademark": "™",
  "\\S": "§",
  "\\P": "¶",
  "\\ss": "ß",
  "\\o": "ø",
  "\\O": "Ø",
  "\\ae": "æ",
  "\\AE": "Æ",
  "\\oe": "œ",
  "\\OE": "Œ",
  "\\aa": "å",
  "\\AA": "Å",
  "\\l": "ł",
  "\\L": "Ł",
  "\\i": "ı",
  "\\textless": "<",
  "\\textgreater": ">",
  "\\textbar": "|",
  "\\textbackslash": "\\",
  "\\textasciitilde": "~",
  "\\textasciicircum": "^",
  "\\textquoteleft": "‘",
  "\\textquoteright": "’",
  "\\textquotedblleft": "“",
  "\\textquotedblright": "”",
  "\\textperthousand": "‰",
  "\\texteuro": "€",
  "\\euro": "€",
  "\\pounds": "£",
  "\\textsterling": "£",
  "\\checkmark": "✓",
  "\\LaTeX": "LaTeX",
  "\\TeX": "TeX",
  "\\LaTeXe": "LaTeX2ε",
  "\\slash": "/",
  "\\textunderscore": "_",
};

const ACCENTS: Record<string, string> = {
  "'": "́",
  "`": "̀",
  "^": "̂",
  '"': "̈",
  "~": "̃",
  "=": "̄",
  ".": "̇",
  u: "̆",
  v: "̌",
  H: "̋",
  c: "̧",
  k: "̨",
  r: "̊",
};

const STYLE_COMMANDS: Record<string, Partial<TextStyle>> = {
  "\\textbf": { bold: true },
  "\\textit": { italic: true },
  "\\textsl": { italic: true },
  "\\emph": { italic: true },
  "\\textsf": { family: "sf" },
  "\\texttt": { family: "tt" },
  "\\textrm": { family: "rm" },
  "\\textsc": { smallcaps: true },
  "\\textup": { italic: false },
  "\\textmd": { bold: false },
  "\\textnormal": { family: "rm", bold: false, italic: false, smallcaps: false },
  "\\underline": { underline: true },
  "\\textsuperscript": { script: 1 },
  "\\textsubscript": { script: -1 },
};

const DECLARATIONS: Record<string, Partial<TextStyle>> = {
  "\\bfseries": { bold: true },
  "\\bf": { bold: true },
  "\\mdseries": { bold: false },
  "\\itshape": { italic: true },
  "\\it": { italic: true },
  "\\slshape": { italic: true },
  "\\sl": { italic: true },
  "\\em": { italic: true },
  "\\upshape": { italic: false },
  "\\scshape": { smallcaps: true },
  "\\sffamily": { family: "sf" },
  "\\sf": { family: "sf" },
  "\\ttfamily": { family: "tt" },
  "\\tt": { family: "tt" },
  "\\rmfamily": { family: "rm" },
  "\\rm": { family: "rm" },
  "\\normalfont": { family: "rm", bold: false, italic: false, smallcaps: false },
};

const SIZE_DECLARATIONS: Record<string, number> = {
  "\\tiny": 5,
  "\\scriptsize": 7,
  "\\footnotesize": 8,
  "\\small": 9,
  "\\normalsize": 10,
  "\\large": 12,
  "\\Large": 14.4,
  "\\LARGE": 17.28,
  "\\huge": 20.74,
  "\\Huge": 24.88,
};

/** Commands that are dropped along with their arguments: [number of brace arguments, optional argument?]. */
const DROPPED: Record<string, [number, boolean]> = {
  "\\strut": [0, false],
  "\\centering": [0, false],
  "\\raggedright": [0, false],
  "\\raggedleft": [0, false],
  "\\noindent": [0, false],
  "\\selectfont": [0, false],
  "\\vspace": [1, false],
  "\\vfill": [0, false],
  "\\vphantom": [1, false],
  "\\label": [1, false],
  "\\index": [1, false],
  "\\hline": [0, false],
  "\\smallskip": [0, false],
  "\\medskip": [0, false],
  "\\bigskip": [0, false],
  "\\nobreak": [0, false],
  "\\allowbreak": [0, false],
  "\\protect": [0, false],
  "\\relax": [0, false],
  "\\leavevmode": [0, false],
  "\\par": [0, false],
  "\\boldmath": [0, false],
  "\\unboldmath": [0, false],
  "\\fontsize": [2, false],
};

/** Commands whose last argument is shown as plain content. */
const TRANSPARENT: Record<string, [number, boolean]> = {
  "\\mbox": [1, false],
  "\\hbox": [1, false],
  "\\text": [1, false],
  "\\makebox": [1, true],
  "\\fbox": [1, false],
  "\\parbox": [2, true],
  "\\raisebox": [2, true],
  "\\scalebox": [2, false],
  "\\resizebox": [3, false],
  "\\rotatebox": [2, true],
  "\\shortstack": [1, true],
};

interface Reader {
  src: string;
  pos: number;
}

function readGroup(r: Reader): string | null {
  skipSpace(r);
  if (r.src[r.pos] === "{") {
    let depth = 0;
    const start = r.pos;
    for (; r.pos < r.src.length; r.pos++) {
      const ch = r.src[r.pos];
      if (ch === "\\") {
        r.pos++;
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        r.pos++;
        return r.src.slice(start + 1, r.pos - 1);
      }
    }
    r.pos = r.src.length;
    return r.src.slice(start + 1);
  }
  // A single token as argument.
  if (r.pos >= r.src.length) return null;
  const cs = /^\\([a-zA-Z@]+|.)/.exec(r.src.slice(r.pos));
  if (cs) {
    r.pos += cs[0].length;
    return cs[0];
  }
  return r.src[r.pos++]!;
}

function readOptional(r: Reader): string | null {
  const save = r.pos;
  skipSpace(r);
  if (r.src[r.pos] !== "[") {
    r.pos = save;
    return null;
  }
  const end = r.src.indexOf("]", r.pos);
  if (end < 0) {
    r.pos = save;
    return null;
  }
  const v = r.src.slice(r.pos + 1, end);
  r.pos = end + 1;
  return v;
}

function skipSpace(r: Reader) {
  while (r.pos < r.src.length && /\s/.test(r.src[r.pos]!)) r.pos++;
}

/** Finds the end of inline math starting after `open`. */
function readMath(r: Reader, close: string): string {
  let depth = 0;
  const start = r.pos;
  for (; r.pos < r.src.length; r.pos++) {
    const ch = r.src[r.pos];
    if (ch === "\\" && !r.src.startsWith(close, r.pos)) {
      r.pos++;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (depth <= 0 && r.src.startsWith(close, r.pos)) {
      const tex = r.src.slice(start, r.pos);
      r.pos += close.length;
      return tex;
    }
  }
  return r.src.slice(start);
}

function expandMacro(m: Macro, r: Reader): string {
  const args: string[] = [];
  let first = 0;
  if (m.defaultArg !== undefined) {
    args.push(readOptional(r) ?? m.defaultArg);
    first = 1;
  }
  for (let i = first; i < m.params; i++) args.push(readGroup(r) ?? "");
  return m.body.replace(/#(\d)/g, (_, d: string) => args[+d - 1] ?? "");
}

function read(src: string, style: TextStyle, env: LabelEnv, out: Item[], issues: string[], depth: number): void {
  if (depth > 20) return;
  const r: Reader = { src, pos: 0 };
  let st = { ...style };
  const pushText = (text: string) => {
    const prev = out[out.length - 1];
    if (prev && prev.kind === "text" && sameStyle(prev.style, st)) prev.text += text;
    else out.push({ kind: "text", text, style: { ...st } });
  };
  const pushSpace = (width?: number, breakable = true) => {
    const prev = out[out.length - 1];
    if (width === undefined && (!prev || prev.kind === "space" || prev.kind === "break")) return;
    const item: Item = { kind: "space", style: { ...st }, breakable };
    if (width !== undefined) item.width = width;
    out.push(item);
  };
  while (r.pos < src.length) {
    const ch = src[r.pos]!;
    if (ch === "%") {
      const nl = src.indexOf("\n", r.pos);
      r.pos = nl < 0 ? src.length : nl + 1;
      continue;
    }
    if (/\s/.test(ch)) {
      skipSpace(r);
      pushSpace();
      continue;
    }
    if (ch === "{") {
      const inner = readGroup(r) ?? "";
      read(inner, st, env, out, issues, depth + 1);
      continue;
    }
    if (ch === "}") {
      r.pos++;
      continue;
    }
    if (ch === "~") {
      r.pos++;
      pushSpace(undefined, false);
      continue;
    }
    if (ch === "$") {
      const display = src[r.pos + 1] === "$";
      r.pos += display ? 2 : 1;
      const tex = readMath(r, display ? "$$" : "$");
      if (display) out.push({ kind: "break" });
      out.push({ kind: "math", tex, display, style: { ...st } });
      if (display) out.push({ kind: "break" });
      continue;
    }
    if (ch === "-" && src.startsWith("---", r.pos)) {
      r.pos += 3;
      pushText("—");
      continue;
    }
    if (ch === "-" && src.startsWith("--", r.pos)) {
      r.pos += 2;
      pushText("–");
      continue;
    }
    if (ch === "`" && src[r.pos + 1] === "`") {
      r.pos += 2;
      pushText("“");
      continue;
    }
    if (ch === "'" && src[r.pos + 1] === "'") {
      r.pos += 2;
      pushText("”");
      continue;
    }
    if (ch === "`") {
      r.pos++;
      pushText("‘");
      continue;
    }
    if (ch === "'") {
      r.pos++;
      pushText("’");
      continue;
    }
    if (ch === "&") {
      // Table cell separator inside tabular: show as a gap.
      r.pos++;
      pushSpace(1);
      continue;
    }
    if (ch !== "\\") {
      const m = /^[^\\{}$%~\s\-`'&]+|^./u.exec(src.slice(r.pos))!;
      r.pos += m[0].length;
      pushText(m[0]);
      continue;
    }
    // Control sequences.
    const m = /^\\([a-zA-Z@]+\*?|.)/.exec(src.slice(r.pos));
    if (!m) {
      r.pos++;
      continue;
    }
    const cs = `\\${m[1]}`;
    r.pos += m[0].length;
    const letters = /^[a-zA-Z@]/.test(m[1]!);
    const csName = cs.replace(/\*$/, "");
    if (cs === "\\\\" || cs === "\\newline" || cs === "\\linebreak" || cs === "\\cr" || cs === "\\tabularnewline") {
      readOptional(r);
      out.push({ kind: "break" });
      continue;
    }
    if (cs === "\\(" || cs === "\\[") {
      const display = cs === "\\[";
      const tex = readMath(r, display ? "\\]" : "\\)");
      if (display) out.push({ kind: "break" });
      out.push({ kind: "math", tex, display, style: { ...st } });
      if (display) out.push({ kind: "break" });
      continue;
    }
    if (letters) skipSpaceAfterWord(r);
    if (cs === "\\ " || cs === "\\@") {
      pushSpace(cs === "\\ " ? undefined : 0);
      continue;
    }
    if (cs in SPACES) {
      pushSpace(SPACES[cs]! * st.size, cs === "\\quad" || cs === "\\qquad" || cs === "\\hfill");
      continue;
    }
    if (cs === "\\hspace" || cs === "\\hspace*") {
      const arg = readGroup(r) ?? "";
      const l = /^\s*(-?[\d.]+)\s*(pt|em|ex|cm|mm)/.exec(arg);
      const w = l ? parseFloat(l[1]!) * ({ pt: 1, em: st.size, ex: st.size * 0.43, cm: 28.45, mm: 2.845 } as Record<string, number>)[l[2]!]! : st.size;
      pushSpace(w, false);
      continue;
    }
    if (cs in SYMBOLS) {
      pushText(SYMBOLS[cs]!);
      continue;
    }
    if (m[1]!.length === 1 && m[1]! in ACCENTS) {
      const arg = readGroup(r) ?? "";
      const base = arg.startsWith("\\") ? (SYMBOLS[arg] ?? arg.slice(1)) : arg;
      pushText((base + ACCENTS[m[1]!]!).normalize("NFC"));
      continue;
    }
    if (csName in STYLE_COMMANDS) {
      const inner = readGroup(r) ?? "";
      read(inner, { ...st, ...STYLE_COMMANDS[csName]! }, env, out, issues, depth + 1);
      continue;
    }
    if (cs in DECLARATIONS) {
      st = { ...st, ...DECLARATIONS[cs]! };
      continue;
    }
    if (cs in SIZE_DECLARATIONS) {
      st = { ...st, size: SIZE_DECLARATIONS[cs]! };
      continue;
    }
    if (cs === "\\color") {
      const c = env.color(readGroup(r) ?? "");
      if (c) st = { ...st, color: c };
      continue;
    }
    if (cs === "\\textcolor") {
      const c = env.color(readGroup(r) ?? "");
      const inner = readGroup(r) ?? "";
      read(inner, c ? { ...st, color: c } : st, env, out, issues, depth + 1);
      continue;
    }
    if (csName in DROPPED) {
      const [n, opt] = DROPPED[csName]!;
      if (opt) readOptional(r);
      for (let i = 0; i < n; i++) readGroup(r);
      continue;
    }
    if (csName in TRANSPARENT) {
      const [n, opt] = TRANSPARENT[csName]!;
      if (opt) readOptional(r);
      if (cs === "\\makebox") readOptional(r);
      for (let i = 0; i < n - 1; i++) readGroup(r);
      if (cs === "\\rotatebox" || cs === "\\scalebox" || cs === "\\resizebox") issues.push(cs);
      const inner = readGroup(r) ?? "";
      if (cs === "\\shortstack" || cs === "\\parbox") read(inner, st, env, out, issues, depth + 1);
      else read(inner.replace(/\\\\/g, " "), st, env, out, issues, depth + 1);
      continue;
    }
    if (cs === "\\phantom" || cs === "\\hphantom") {
      const inner = readGroup(r) ?? "";
      const sub: Item[] = [];
      read(inner, st, env, sub, issues, depth + 1);
      let w = 0;
      for (const it of sub) if (it.kind === "text") w += measureText(it.text, it.style).width;
      pushSpace(w, false);
      continue;
    }
    if (cs === "\\begin" || cs === "\\end") {
      const envName = readGroup(r) ?? "";
      if (cs === "\\begin" && (envName === "tabular" || envName === "tabular*" || envName === "array")) readGroup(r);
      if (cs === "\\begin" && envName === "minipage") {
        readOptional(r);
        readGroup(r);
      }
      if (envName === "itemize" || envName === "enumerate" || envName === "description") out.push({ kind: "break" });
      continue;
    }
    if (cs === "\\item") {
      readOptional(r);
      out.push({ kind: "break" });
      pushText("• ");
      continue;
    }
    if (cs === "\\nodepart") {
      readGroup(r);
      out.push({ kind: "break" });
      issues.push("\\nodepart");
      continue;
    }
    if (cs === "\\includegraphics") {
      readOptional(r);
      readGroup(r);
      out.push({ kind: "unknown", text: "[image]", style: { ...st } });
      issues.push("\\includegraphics");
      continue;
    }
    const macro = env.macros.get(cs);
    if (macro) {
      const expansion = expandMacro(macro, r);
      read(expansion, st, env, out, issues, depth + 1);
      continue;
    }
    // Anything else: show the command itself, marked as unknown.
    out.push({ kind: "unknown", text: cs, style: { ...st } });
    issues.push(cs);
  }
}

function skipSpaceAfterWord(r: Reader) {
  while (r.pos < r.src.length && (r.src[r.pos] === " " || r.src[r.pos] === "\t")) r.pos++;
}

function sameStyle(a: TextStyle, b: TextStyle): boolean {
  return (
    a.size === b.size &&
    a.family === b.family &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.smallcaps === b.smallcaps &&
    a.underline === b.underline &&
    a.script === b.script &&
    a.color?.join() === b.color?.join()
  );
}

// ---------------------------------------------------------------- layout

export interface LayoutOptions {
  font: FontSpec;
  color?: RGB;
  /** Width to wrap at, in pt. */
  textWidth?: number;
  align?: "left" | "center" | "right" | "justify";
}

/** Macros for KaTeX: user \newcommand definitions without optional arguments. */
function katexMacros(env: LabelEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, m] of env.macros) if (m.defaultArg === undefined) out[name] = m.body;
  return out;
}

interface Box {
  item: Item;
  width: number;
  height: number;
  depth: number;
}

function measureItem(it: Item, macros: Record<string, string>, issues: string[]): Box {
  switch (it.kind) {
    case "text":
    case "unknown": {
      const m = measureText(it.text, it.style);
      return { item: it, ...m };
    }
    case "space": {
      const w = it.width ?? spaceWidth(it.style) * it.style.size;
      return { item: it, width: w, height: 0, depth: 0 };
    }
    case "math": {
      const m = measureMath(it.tex, it.display, macros);
      if (!m) {
        issues.push(`$${it.tex}$`);
        const fb = measureText(it.tex, { ...it.style, italic: true });
        return { item: it, ...fb };
      }
      const k = it.style.size;
      return { item: it, width: m.width * k, height: m.height * k, depth: m.depth * k };
    }
    case "break":
      return { item: it, width: 0, height: 0, depth: 0 };
  }
}

export function layoutLabel(src: string, opts: LayoutOptions, env: LabelEnv): TextLayout {
  const issues: string[] = [];
  const base: TextStyle = {
    size: opts.font.size,
    family: opts.font.family,
    bold: opts.font.bold,
    italic: opts.font.italic,
    smallcaps: opts.font.smallcaps,
    underline: false,
  };
  if (opts.color) base.color = opts.color;
  const items: Item[] = [];
  read(src, base, env, items, issues, 0);
  const macros = katexMacros(env);
  const boxes = items.map((it) => measureItem(it, macros, issues));

  // Break into lines: at explicit breaks, and greedily at spaces when a width is set.
  const rawLines: Box[][] = [[]];
  const maxW = opts.textWidth;
  let lineW = 0;
  for (const b of boxes) {
    const line = rawLines[rawLines.length - 1]!;
    if (b.item.kind === "break") {
      rawLines.push([]);
      lineW = 0;
      continue;
    }
    if (maxW !== undefined && b.item.kind !== "space" && lineW + b.width > maxW + 0.01 && line.length) {
      // Move the trailing word (everything after the last breakable space) to a new line.
      let cut = line.length;
      while (cut > 0 && !(line[cut - 1]!.item.kind === "space" && (line[cut - 1]!.item as { breakable: boolean }).breakable)) cut--;
      if (cut > 0) {
        const moved = line.splice(cut);
        line.pop(); // the space itself
        rawLines.push(moved);
        lineW = moved.reduce((w, x) => w + x.width, 0);
      }
    }
    rawLines[rawLines.length - 1]!.push(b);
    lineW += b.width;
  }

  const strutH = 0.7 * opts.font.size;
  const strutD = 0.3 * opts.font.size;
  const lines: Line[] = [];
  for (const raw of rawLines) {
    while (raw.length && raw[raw.length - 1]!.item.kind === "space") raw.pop();
    while (raw.length && raw[0]!.item.kind === "space") raw.shift();
    let x = 0;
    let height = 0;
    let depth = 0;
    const runs: Run[] = [];
    for (const b of raw) {
      const it = b.item;
      if (it.kind === "text") runs.push({ kind: "text", text: it.text, style: it.style, x, width: b.width });
      else if (it.kind === "unknown") runs.push({ kind: "unknown", text: it.text, style: it.style, x, width: b.width });
      else if (it.kind === "math") runs.push({ kind: "math", tex: it.tex, display: it.display, style: it.style, x, width: b.width, height: b.height, depth: b.depth });
      else if (it.kind === "space" && runs.length) {
        const last = runs[runs.length - 1]!;
        // Fold spaces into the preceding text run so the browser lays them out too.
        if (last.kind === "text" && it.width === undefined && sameStyle(last.style, it.style)) {
          last.text += " ";
          last.width += b.width;
        }
      }
      x += b.width;
      height = Math.max(height, b.height);
      depth = Math.max(depth, b.depth);
    }
    lines.push({ runs, width: x, height, depth, x: 0, baseline: 0 });
  }
  // Drop empty lines at the end ("text\\" adds none in TeX).
  while (lines.length > 1 && lines[lines.length - 1]!.runs.length === 0) lines.pop();

  const width = maxW ?? Math.max(0, ...lines.map((l) => l.width));
  const align = opts.align ?? (lines.length > 1 && maxW === undefined ? "center" : "left");
  const skip = opts.font.baselineskip;
  let y = 0;
  lines.forEach((l, i) => {
    if (i === 0) y = l.height;
    else {
      const prev = lines[i - 1]!;
      // TeX: baselines are \baselineskip apart unless the lines would touch.
      y += Math.max(skip, prev.depth + l.height + 1);
    }
    l.baseline = y;
    if (align === "center") l.x = (width - l.width) / 2;
    else if (align === "right") l.x = width - l.width;
  });
  const last = lines[lines.length - 1]!;
  const multi = lines.length > 1 || maxW !== undefined;
  // A one-line node uses its glyphs' height and depth. Multi-line and
  // fixed-width text sits in a box with struts on its first and last line.
  const height = multi ? Math.max(lines[0]!.height, strutH) : lines[0]!.height;
  if (multi) {
    const shift = height - lines[0]!.height;
    for (const l of lines) l.baseline += shift;
  }
  const bottom = last.baseline + (multi ? Math.max(last.depth, strutD) : last.depth);
  return { lines, width, height, depth: bottom - height, issues: [...new Set(issues)] };
}
