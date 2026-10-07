// A small interpreter for TikZ keys: applies "key=value" lists to a State,
// expanding styles the way pgfkeys does. Keys it doesn't know are recorded in
// state.unknown, never guessed at.
import type { ColorTable } from "./colors.ts";
import { indexTopLevel, type KeyValue, parseOptionString, stripBraces } from "./options.ts";
import { type ArrowTip, FONT_SIZES, multiply, type State } from "./state.ts";
import { CM, evalLength, evalNumber, evalQuantity, type FontUnits } from "./units.ts";

export interface StyleEntry {
  body: string;
  defaultArg?: string;
}

/** Style definitions, with scoping: a child sees its parent's styles. */
export class StyleTable {
  private own = new Map<string, StyleEntry>();
  private parent: StyleTable | null;

  constructor(parent: StyleTable | null = null) {
    this.parent = parent;
  }

  get(name: string): StyleEntry | undefined {
    return this.own.get(name) ?? this.parent?.get(name);
  }

  set(name: string, body: string): void {
    const prev = this.get(name);
    const entry: StyleEntry = { body };
    if (prev?.defaultArg !== undefined) entry.defaultArg = prev.defaultArg;
    this.own.set(name, entry);
  }

  append(name: string, body: string): void {
    const prev = this.get(name);
    const entry: StyleEntry = { body: prev?.body ? `${prev.body},${body}` : body };
    if (prev?.defaultArg !== undefined) entry.defaultArg = prev.defaultArg;
    this.own.set(name, entry);
  }

  setDefault(name: string, arg: string): void {
    const prev = this.get(name);
    this.own.set(name, { body: prev?.body ?? "", defaultArg: arg });
  }

  child(): StyleTable {
    return new StyleTable(this);
  }
}

export interface KeyContext {
  styles: StyleTable;
  colors: ColorTable;
  /** Shapes the editor can draw. Other shape names are unknown keys. */
  shapes: ReadonlySet<string>;
}

/** Built-in TikZ styles. */
export function builtinStyles(): StyleTable {
  const t = new StyleTable();
  t.set("help lines", "color=gray, line width=0.2pt");
  t.set("every node", "");
  t.set("every path", "");
  t.set("every edge", "draw");
  t.set("every label", "");
  t.set("every pin", "");
  return t;
}

export const KNOWN_SHAPES = new Set([
  "rectangle",
  "circle",
  "ellipse",
  "diamond",
  "trapezium",
  "rounded rectangle",
  "cylinder",
  "tape",
  "coordinate",
  "circle split",
  "rectangle split",
  "regular polygon",
  "star",
  "signal",
  "single arrow",
  "double arrow",
  "isosceles triangle",
  "kite",
  "dart",
  "cloud",
  "chamfered rectangle",
  "document",
]);

/** Shapes that need a library and what it's called. */
export const SHAPE_LIBRARY: Record<string, string> = {
  ellipse: "shapes.geometric",
  diamond: "shapes.geometric",
  trapezium: "shapes.geometric",
  cylinder: "shapes.geometric",
  "regular polygon": "shapes.geometric",
  star: "shapes.geometric",
  "isosceles triangle": "shapes.geometric",
  kite: "shapes.geometric",
  dart: "shapes.geometric",
  "rounded rectangle": "shapes.misc",
  "chamfered rectangle": "shapes.misc",
  tape: "shapes.symbols",
  signal: "shapes.symbols",
  cloud: "shapes.symbols",
  "single arrow": "shapes.arrows",
  "double arrow": "shapes.arrows",
  "circle split": "shapes.multipart",
  "rectangle split": "shapes.multipart",
};

const POSITIONING_DIRS = new Set([
  "above",
  "below",
  "left",
  "right",
  "above left",
  "above right",
  "below left",
  "below right",
  "base left",
  "base right",
  "mid left",
  "mid right",
]);

const LINE_WIDTHS: Record<string, number> = {
  "ultra thin": 0.1,
  "very thin": 0.2,
  thin: 0.4,
  semithick: 0.6,
  thick: 0.8,
  "very thick": 1.2,
  "ultra thick": 1.6,
};

const DASHES: Record<string, number[] | null> = {
  solid: null,
  dotted: [0.4, 2],
  "densely dotted": [0.4, 1],
  "loosely dotted": [0.4, 4],
  dashed: [3, 3],
  "densely dashed": [3, 2],
  "loosely dashed": [3, 6],
  "dash dot": [3, 2, 0.4, 2],
  "densely dash dot": [3, 1, 0.4, 1],
  "loosely dash dot": [3, 4, 0.4, 4],
  "dash dot dot": [3, 2, 0.4, 2, 0.4, 2],
};

/** Keys that are known but have no effect on the native preview. */
const IGNORED = new Set([
  "remember picture",
  "overlay",
  "baseline",
  "transform shape",
  "line cap",
  "line join",
  "miter limit",
  "even odd rule",
  "nonzero rule",
  "use as bounding box",
  "trim left",
  "trim right",
  "every picture",
  "text badly ragged",
  "allow upside down",
  "execute at begin node",
  "execute at end node",
  "execute at begin picture",
  "inner frame sep",
  "framed",
  "show background rectangle",
  "on background layer",
  "behind path",
  "in front of path",
  "font size",
  "smooth",
  "tension",
  "prefix",
  "id",
  "shadow xshift",
  "shadow yshift",
  "shadow scale",
  "draw opacity",
  "cylinder uses custom fill",
  "cylinder body fill",
  "cylinder end fill",
  "shape border uses incircle",
  "rounded rectangle arc length",
  "rounded rectangle west arc",
  "rounded rectangle east arc",
  "tape bend top",
  "tape bend bottom",
  "tape bend height",
  "rectangle split parts",
  "rectangle split horizontal",
  "rectangle split part fill",
  "rectangle split part align",
  "rectangle split draw splits",
  "rectangle split ignore empty parts",
  "regular polygon sides",
  "star points",
  "star point ratio",
  "signal pointer angle",
  "signal to",
  "signal from",
  "single arrow head extend",
  "chamfered rectangle corners",
  "label distance",
  "pin distance",
  "pin edge",
  "every label",
  "text opacity",
  "anchor at",
]);

/** Keys that change how something looks in a way the native preview can't show. */
const UNRENDERED = new Set([
  "decorate",
  "decoration",
  "postaction",
  "preaction",
  "double",
  "double distance",

  "xslant",
  "yslant",
  "path picture",
  "pattern",
  "pattern color",
  "start chain",
  "chain default direction",
  "every join",
]);

/** Keys that mean the node's position depends on something the editor doesn't model. */
export const UNMODELLED_PLACEMENT = new Set(["on chain", "join", "continue chain", "start branch", "below delimiter", "matrix anchor"]);

function fontUnits(s: State): FontUnits {
  return { em: s.font.size, ex: s.font.size * 0.430554 };
}

/** A coordinate-like length: unitless numbers are multiples of the x unit (1cm by default). */
function lengthOrUnits(v: string, s: State): number | null {
  const q = evalQuantity(v, fontUnits(s));
  if (!q) return null;
  return q.dimensioned ? q.value : q.value * CM;
}

export function parseNodeDistance(v: string, s: State): { v: number; h: number } | null {
  const parts = v.split(/\s+and\s+/);
  const a = lengthOrUnits(parts[0]!, s);
  if (a === null) return null;
  const b = parts[1] !== undefined ? lengthOrUnits(parts[1], s) : a;
  if (b === null) return null;
  return { v: a, h: b };
}

/** Reads "\small\bfseries" and friends into the state's font. */
export function applyFont(s: State, value: string, ctx: KeyContext): boolean {
  let ok = true;
  const re = /\\([a-zA-Z]+)|\{([^{}]*)\}|(\S)/g;
  const tokens = [...value.matchAll(re)];
  for (let i = 0; i < tokens.length; i++) {
    const m = tokens[i]!;
    const cs = m[1] ? `\\${m[1]}` : null;
    if (!cs) continue; // braces and stray characters (e.g. arguments handled below)
    if (cs in FONT_SIZES) {
      const [size, skip] = FONT_SIZES[cs]!;
      s.font = { ...s.font, size, baselineskip: skip };
    } else if (cs === "\\bfseries" || cs === "\\bf") s.font = { ...s.font, bold: true };
    else if (cs === "\\mdseries") s.font = { ...s.font, bold: false };
    else if (cs === "\\itshape" || cs === "\\it" || cs === "\\slshape" || cs === "\\sl" || cs === "\\em") s.font = { ...s.font, italic: true };
    else if (cs === "\\upshape") s.font = { ...s.font, italic: false };
    else if (cs === "\\scshape" || cs === "\\sc") s.font = { ...s.font, smallcaps: true };
    else if (cs === "\\sffamily" || cs === "\\sf") s.font = { ...s.font, family: "sf" };
    else if (cs === "\\ttfamily" || cs === "\\tt") s.font = { ...s.font, family: "tt" };
    else if (cs === "\\rmfamily" || cs === "\\rm") s.font = { ...s.font, family: "rm" };
    else if (cs === "\\normalfont") s.font = { ...s.font, family: "rm", bold: false, italic: false, smallcaps: false };
    else if (cs === "\\color") {
      const arg = tokens[i + 1]?.[2];
      const rgb = arg !== undefined ? ctx.colors.parse(arg) : null;
      if (rgb) s.textColor = rgb;
      else ok = false;
      i++;
    } else if (cs === "\\fontsize") {
      const a = tokens[i + 1]?.[2];
      const b = tokens[i + 2]?.[2];
      const size = a !== undefined ? evalLength(a) : null;
      const skip = b !== undefined ? evalLength(b) : null;
      if (size) s.font = { ...s.font, size, baselineskip: skip ?? size * 1.2 };
      i += 2;
    } else if (cs === "\\selectfont" || cs === "\\strut" || cs === "\\boldmath" || cs === "\\unboldmath") {
      // no effect on metrics we model
    } else ok = false;
  }
  return ok;
}

/** Parses one side of an arrow specification, or returns null if it isn't one. */
export function parseTip(spec: string, s: State): ArrowTip | null | undefined {
  let t = spec.trim();
  if (t === "") return undefined; // no tip on this side
  if (t.startsWith("{") && t.endsWith("}")) t = t.slice(1, -1).trim();
  if (t === "") return undefined;
  // Count repeats like ">>" or "Stealth[]Stealth[]".
  const simple: Record<string, Partial<ArrowTip> & { kind: string }> = {
    ">": { ...s.defaultEndTip },
    "<": { ...s.defaultStartTip },
    "|": { kind: "bar" },
    o: { kind: "circle", open: true },
    "*": { kind: "circle" },
    to: { kind: "to" },
    "to reversed": { kind: "to", reversed: true },
    latex: { kind: "latex" },
    "latex'": { kind: "latex" },
    "latex reversed": { kind: "latex", reversed: true },
    stealth: { kind: "stealth" },
    "stealth'": { kind: "stealth" },
    "stealth reversed": { kind: "stealth", reversed: true },
    "triangle 45": { kind: "triangle" },
    "triangle 60": { kind: "triangle" },
    "triangle 90": { kind: "triangle" },
    "open triangle 45": { kind: "triangle", open: true },
    "open triangle 60": { kind: "triangle", open: true },
    "open triangle 90": { kind: "triangle", open: true },
    "angle 45": { kind: "to" },
    "angle 60": { kind: "to" },
    "angle 90": { kind: "to" },
    diamond: { kind: "diamond" },
    "open diamond": { kind: "diamond", open: true },
    square: { kind: "square" },
    "open square": { kind: "square", open: true },
    "round cap": { kind: "round" },
    "butt cap": { kind: "butt" },
    "[": { kind: "bar" },
    "]": { kind: "bar" },
    ")": { kind: "bar" },
    "(": { kind: "bar" },
  };
  const repeat = /^(>+|<+)$/.exec(t);
  if (repeat) {
    const base = t[0] === ">" ? s.defaultEndTip : s.defaultStartTip;
    return { ...base, count: t.length };
  }
  if (t in simple) return { open: false, count: 1, reversed: false, ...simple[t] } as ArrowTip;
  // arrows.meta: Name[options], possibly repeated.
  const meta = [...t.matchAll(/([A-Z][A-Za-z ]*?)\s*(?:\[([^\]]*)\])?(?=\s*(?:[A-Z]|$))/g)];
  if (meta.length && meta.map((m) => m[0]).join("").replace(/\s/g, "") === t.replace(/\s/g, "")) {
    const first = meta[0]!;
    const names: Record<string, string> = {
      Stealth: "stealth",
      Latex: "latex",
      Triangle: "triangle",
      To: "to",
      Bar: "bar",
      Circle: "circle",
      Square: "square",
      Kite: "kite",
      Diamond: "diamond",
      Ellipse: "circle",
      Rectangle: "square",
      Implies: "to",
      "Classical TikZ Rightarrow": "to",
      "Computer Modern Rightarrow": "to",
      "Straight Barb": "to",
      "Arc Barb": "to",
      "Tee Barb": "bar",
      "Round Cap": "round",
      "Butt Cap": "butt",
      "Triangle Cap": "butt",
      "Fast Triangle": "triangle",
      "Fast Round": "round",
      Rays: "to",
      Hooks: "to",
    };
    const kind = names[first[1]!.trim()];
    if (!kind) return null;
    const tip: ArrowTip = { kind, open: false, count: meta.length, reversed: false };
    for (const opt of parseOptionString(first[2] ?? "")) {
      const v = opt.value;
      if (opt.key === "open") tip.open = true;
      else if (opt.key === "reversed") tip.reversed = true;
      else if (opt.key === "length" && v) {
        const l = evalLength(v.split(/\s+/)[0]!);
        if (l !== null) tip.length = l;
      } else if (opt.key === "width" && v) {
        const w = evalLength(v.split(/\s+/)[0]!);
        if (w !== null) tip.width = w;
      } else if (opt.key === "scale" && v) {
        const k = evalNumber(v);
        if (k !== null) {
          tip.length = (tip.length ?? defaultTipLength(kind, s.lineWidth)) * k;
          tip.width = (tip.width ?? defaultTipWidth(kind, s.lineWidth)) * k;
        }
      }
    }
    return tip;
  }
  return null;
}

export function defaultTipLength(kind: string, lw: number): number {
  switch (kind) {
    case "stealth":
      return 3 + 4.5 * lw;
    case "latex":
      return 3 + 4.5 * lw;
    case "triangle":
      return 3 + 3 * lw;
    case "bar":
      return lw;
    case "circle":
    case "square":
    case "diamond":
      return 2.4 + 3 * lw;
    case "kite":
      return 3.6 + 4.5 * lw;
    case "round":
    case "butt":
      return 0;
    default:
      return 1.6 + 2.2 * lw; // "to"
  }
}

export function defaultTipWidth(kind: string, lw: number): number {
  switch (kind) {
    case "stealth":
    case "latex":
      return (3 + 4.5 * lw) * 0.75;
    case "triangle":
      return 3 + 3 * lw;
    case "bar":
      return 2 + 3 * lw;
    case "kite":
      return 2 + 3 * lw;
    default:
      return 2.4 + 3 * lw;
  }
}

/** Splits an arrow key like "<->", "-{Stealth[]}", "latex-latex" into its two sides. */
function arrowSides(key: string): [string, string] | null {
  let depth = 0;
  for (let i = 0; i < key.length; i++) {
    const ch = key[i]!;
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
    else if (ch === "-" && depth === 0) return [key.slice(0, i), key.slice(i + 1)];
  }
  return null;
}

function setArrows(s: State, key: string): boolean {
  const sides = arrowSides(key);
  if (!sides) return false;
  const start = parseTip(sides[0], s);
  const end = parseTip(sides[1], s);
  if (start === null || end === null) return false;
  s.startTip = start ?? null;
  s.endTip = end ?? null;
  return true;
}

function setDefaultTip(s: State, value: string): boolean {
  const tip = parseTip(value, s);
  if (!tip) return false;
  s.defaultEndTip = tip;
  s.defaultStartTip = tip;
  return true;
}

function readDash(v: string): number[] | null {
  const out: number[] = [];
  for (const m of v.matchAll(/(on|off)\s*([^\s]+(?:\s*(?:pt|cm|mm|bp|em|ex))?)/g)) {
    const l = evalLength(m[2]!);
    if (l === null) return null;
    out.push(l);
  }
  return out.length ? out : null;
}

/** Applies a list of keys in order. `depth` guards against recursive styles. */
export function applyKeys(s: State, keys: KeyValue[], ctx: KeyContext, depth = 0): void {
  for (const kv of keys) applyKey(s, kv, ctx, depth);
}

export function applyStyle(s: State, name: string, ctx: KeyContext, arg?: string, depth = 0): boolean {
  const entry = ctx.styles.get(name);
  if (!entry) return false;
  if (depth > 40) return true;
  const value = arg ?? entry.defaultArg ?? "";
  const body = entry.body.replace(/#1/g, value);
  applyKeys(s, parseOptionString(body), ctx, depth + 1);
  return true;
}

export function applyKey(s: State, kv: KeyValue, ctx: KeyContext, depth = 0): void {
  const key = kv.key.trim();
  const raw = kv.value;
  const value = raw === undefined ? undefined : stripBraces(raw);
  const unknown = (): void => {
    s.unknown.push(raw === undefined ? key : `${key}=${raw}`);
  };
  if (!key) return;

  // Style definitions inside an option list: "every node/.style={...}".
  const handler = /^(.*?)\s*\/\.(style|append style|prefix style|default|code|estyle|style 2 args)$/.exec(key);
  if (handler) {
    const name = handler[1]!.trim();
    const body = value ?? "";
    if (handler[2] === "default") ctx.styles.setDefault(name, body);
    else if (handler[2] === "append style" || handler[2] === "prefix style") ctx.styles.append(name, body);
    else if (handler[2] === "style" || handler[2] === "estyle") ctx.styles.set(name, body);
    return;
  }
  // Full key paths ("/tikz/draw") work like the short form.
  if (key.startsWith("/tikz/")) return applyKey(s, { ...kv, key: key.slice(6) }, ctx, depth);

  if (key in LINE_WIDTHS && value === undefined) {
    s.lineWidth = LINE_WIDTHS[key]!;
    return;
  }
  if (key in DASHES && value === undefined) {
    s.dash = DASHES[key]!;
    return;
  }
  if (IGNORED.has(key)) return;
  if (UNRENDERED.has(key)) {
    s.unrendered.push(key);
    return;
  }
  if (UNMODELLED_PLACEMENT.has(key) || key.startsWith("on chain") || key.startsWith("start chain")) {
    s.unrendered.push(key);
    if (key.startsWith("on chain") || key === "matrix anchor") s.placement = { kind: "relative", dir: "unmodelled", of: key };
    return;
  }

  const len = (v: string | undefined) => (v === undefined ? null : evalLength(v, fontUnits(s)));
  const num = (v: string | undefined) => (v === undefined ? null : evalNumber(v));
  const color = (v: string | undefined) => (v === undefined ? null : ctx.colors.parse(v));

  switch (key) {
    case "draw":
      if (value === "none") {
        s.draw = false;
        s.drawColor = "none";
      } else {
        s.draw = true;
        if (value !== undefined) {
          const c = color(value);
          if (c) s.drawColor = c;
          else unknown();
        }
      }
      return;
    case "fill":
      if (value === "none") {
        s.fill = false;
        s.fillColor = "none";
      } else {
        s.fill = true;
        if (value !== undefined) {
          const c = color(value);
          if (c) s.fillColor = c;
          else unknown();
        }
      }
      return;
    case "color": {
      const c = color(value);
      if (c) {
        s.color = c;
        delete s.drawColor;
        delete s.fillColor;
        delete s.textColor;
      } else unknown();
      return;
    }
    case "text": {
      const c = color(value);
      if (c) s.textColor = c;
      else unknown();
      return;
    }
    case "line width": {
      const l = len(value);
      if (l !== null) s.lineWidth = l;
      else unknown();
      return;
    }
    case "dash pattern": {
      const d = value ? readDash(value) : null;
      if (d) s.dash = d;
      else unknown();
      return;
    }
    case "dash phase":
      return;
    case "rounded corners": {
      const l = value === undefined ? 4 : len(value);
      if (l !== null) s.roundedCorners = l;
      else unknown();
      return;
    }
    case "sharp corners":
      s.roundedCorners = 0;
      return;
    case "opacity":
    case "fill opacity": {
      const n = num(value);
      if (n === null) return unknown();
      if (key === "opacity") s.opacity = n;
      else s.fillOpacity = n;
      return;
    }
    case "font":
    case "node font":
      if (value === undefined || !applyFont(s, value, ctx)) unknown();
      return;
    case ">":
    case "arrows":
    case "arrows.meta":
      if (key === ">") {
        if (value === undefined || !setDefaultTip(s, value)) unknown();
      } else if (value === undefined || !setArrows(s, value)) unknown();
      return;
    case "<":
      if (value !== undefined) {
        const tip = parseTip(value, s);
        if (tip) s.defaultStartTip = tip;
        else unknown();
      }
      return;
    case "shorten >":
    case "shorten <": {
      const l = len(value);
      if (l === null) return unknown();
      if (key === "shorten >") s.shortenEnd = l;
      else s.shortenStart = l;
      return;
    }
    case "node distance": {
      const d = value ? parseNodeDistance(value, s) : null;
      if (d) s.nodeDistance = d;
      else unknown();
      return;
    }
    case "on grid":
      s.onGrid = value !== "false";
      return;
    case "auto":
      s.autoLabels = value === "right" ? "right" : value === "false" ? null : "left";
      return;
    case "swap":
    case "'":
      s.swap = true;
      return;
    case "sloped":
      s.sloped = true;
      return;
    case "inner sep":
    case "inner xsep":
    case "inner ysep":
    case "outer sep":
    case "outer xsep":
    case "outer ysep": {
      const l = len(value);
      if (l === null) return unknown();
      if (key !== "inner ysep" && key.startsWith("inner")) s.innerXSep = l;
      if (key !== "inner xsep" && key.startsWith("inner")) s.innerYSep = l;
      if (key !== "outer ysep" && key.startsWith("outer")) s.outerXSep = l;
      if (key !== "outer xsep" && key.startsWith("outer")) s.outerYSep = l;
      return;
    }
    case "minimum width":
    case "minimum height":
    case "minimum size": {
      const l = len(value);
      if (l === null) return unknown();
      if (key !== "minimum height") s.minWidth = l;
      if (key !== "minimum width") s.minHeight = l;
      return;
    }
    case "text width":
    case "text height":
    case "text depth": {
      const l = len(value);
      if (l === null) return unknown();
      if (key === "text width") s.textWidth = l;
      else if (key === "text height") s.textHeight = l;
      else s.textDepth = l;
      return;
    }
    case "align": {
      const map: Record<string, State["align"]> = {
        left: "left",
        "flush left": "left",
        right: "right",
        "flush right": "right",
        center: "center",
        "flush center": "center",
        justify: "justify",
        none: "left",
      };
      const a = value ? map[value] : undefined;
      if (a) s.align = a;
      else unknown();
      return;
    }
    case "text centered":
    case "text badly centered":
      s.align = "center";
      return;
    case "text ragged":
      s.align = "left";
      return;
    case "text justified":
      s.align = "justify";
      return;
    case "anchor":
      if (value) s.anchor = value;
      else unknown();
      return;
    case "shape":
      if (value && ctx.shapes.has(value)) s.shape = value;
      else unknown();
      return;
    case "aspect":
    case "shape aspect": {
      const n = num(value);
      if (n !== null && n > 0) s.aspect = n;
      else unknown();
      return;
    }
    case "trapezium left angle":
    case "trapezium right angle":
    case "trapezium angle": {
      const n = num(value);
      if (n === null) return unknown();
      if (key !== "trapezium right angle") s.trapeziumLeftAngle = n;
      if (key !== "trapezium left angle") s.trapeziumRightAngle = n;
      return;
    }
    case "trapezium stretches":
    case "trapezium stretches body":
      s.trapeziumStretches = value !== "false";
      return;
    case "shape border rotate": {
      const n = num(value);
      if (n !== null) s.shapeBorderRotate = n;
      else unknown();
      return;
    }
    case "xshift":
    case "yshift": {
      // A plain number is in pt here, as for any TeX dimension.
      const l = len(value);
      if (l === null) return unknown();
      if (key === "xshift") s.xshift += l;
      else s.yshift += l;
      return;
    }
    case "shift": {
      // A coordinate: plain numbers use the x and y units.
      const m = value ? /^\(?\s*([^,]+?)\s*,\s*([^)]+?)\s*\)?$/.exec(stripBraces(value)) : null;
      const x = m ? evalQuantity(m[1]!, fontUnits(s)) : null;
      const y = m ? evalQuantity(m[2]!, fontUnits(s)) : null;
      if (!x || !y) return unknown();
      const dx = (x.dimensioned ? x.value : x.value * s.xUnit[0]) + (y.dimensioned ? 0 : y.value * s.yUnit[0]);
      const dy = (x.dimensioned ? 0 : x.value * s.xUnit[1]) + (y.dimensioned ? y.value : y.value * s.yUnit[1]);
      s.xshift += dx;
      s.yshift += dy;
      return;
    }
    case "scale":
    case "xscale":
    case "yscale": {
      const n = num(value);
      if (n === null) return unknown();
      s.matrix = multiply(s.matrix, [key === "yscale" ? 1 : n, 0, 0, key === "xscale" ? 1 : n, 0, 0]);
      return;
    }
    case "rotate": {
      const n = num(value);
      if (n === null) return unknown();
      const r = (n * Math.PI) / 180;
      s.matrix = multiply(s.matrix, [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]);
      s.unrendered.push("rotate");
      return;
    }
    case "x":
    case "y": {
      const l = value === undefined ? null : lengthOrUnits(value, s);
      if (l === null) return unknown();
      if (key === "x") s.xUnit = [l, 0];
      else s.yUnit = [0, l];
      return;
    }
    case "name":
    case "alias":
      if (value) s.name = value;
      return;
    case "at":
      if (value) s.at = value;
      else unknown();
      return;
    case "local bounding box":
      if (value) s.localBoundingBox = value;
      return;
    case "fit":
      if (value) s.fit = value;
      return;
    case "label":
    case "pin":
      if (value) s.labels.push(value);
      return;
    case "pos": {
      const n = num(value);
      if (n !== null) s.pos = n;
      else unknown();
      return;
    }
    case "midway":
      s.pos = 0.5;
      return;
    case "near start":
      s.pos = 0.25;
      return;
    case "near end":
      s.pos = 0.75;
      return;
    case "very near start":
      s.pos = 0.125;
      return;
    case "very near end":
      s.pos = 0.875;
      return;
    case "at start":
      s.pos = 0;
      return;
    case "at end":
      s.pos = 1;
      return;
    case "bend left":
    case "bend right": {
      const a = value === undefined ? 30 : num(value);
      if (a === null) return unknown();
      s.bend = { side: key === "bend left" ? "left" : "right", angle: a };
      return;
    }
    case "bend angle":
      return;
    case "out":
    case "in": {
      const a = num(value);
      if (a === null) return unknown();
      if (key === "out") s.out = a;
      else s.in = a;
      return;
    }
    case "looseness":
    case "out looseness":
    case "in looseness": {
      const n = num(value);
      if (n !== null) s.looseness = n;
      return;
    }
    case "relative":
    case "distance":
    case "out distance":
    case "in distance":
    case "min distance":
      return;
    case "style":
      if (value === undefined || !applyStyle(s, value, ctx, undefined, depth)) unknown();
      return;
    case "top color":
    case "bottom color":
    case "left color":
    case "right color":
    case "middle color":
    case "inner color":
    case "outer color":
    case "ball color": {
      const c = color(value);
      if (!c) return unknown();
      const prev = s.shading;
      if (key === "top color") s.shading = { kind: "vertical", from: c, to: prev?.kind === "vertical" ? prev.to : [1, 1, 1] };
      else if (key === "bottom color") s.shading = { kind: "vertical", from: prev?.kind === "vertical" ? prev.from : [1, 1, 1], to: c };
      else if (key === "left color") s.shading = { kind: "horizontal", from: c, to: prev?.kind === "horizontal" ? prev.to : [1, 1, 1] };
      else if (key === "right color") s.shading = { kind: "horizontal", from: prev?.kind === "horizontal" ? prev.from : [1, 1, 1], to: c };
      else if (key === "middle color" && prev) s.shading = { ...prev, middle: c };
      else if (key === "inner color") s.shading = { kind: "radial", from: c, to: prev?.kind === "radial" ? prev.to : [1, 1, 1] };
      else if (key === "outer color") s.shading = { kind: "radial", from: prev?.kind === "radial" ? prev.from : [1, 1, 1], to: c };
      else if (key === "ball color") s.shading = { kind: "radial", from: [1, 1, 1], to: c };
      s.fill = true;
      return;
    }
    case "shading":
    case "shading angle":
      return;
    case "drop shadow":
    case "general shadow":
    case "circular drop shadow":
    case "copy shadow":
      s.shadow = true;
      return;
  }

  if (value === undefined && POSITIONING_DIRS.has(key)) {
    s.placement = { kind: "relative", dir: key };
    return;
  }
  if (value !== undefined && POSITIONING_DIRS.has(key)) {
    const of = indexTopLevel(` ${value} `, " of ");
    if (of >= 0) {
      const shift = value.slice(0, of).trim();
      const target = value.slice(of + 3).trim();
      s.placement = shift ? { kind: "relative", dir: key, shift, of: target } : { kind: "relative", dir: key, of: target };
    } else s.placement = { kind: "relative", dir: key, shift: value };
    return;
  }
  const old = /^(above|below|left|right|above left|above right|below left|below right) of$/.exec(key);
  if (old && value) {
    s.placement = { kind: "old", dir: old[1]!, of: value };
    return;
  }

  // Unknown key handler, in pgfkeys' order: style, colour, shape, arrows.
  if (applyStyle(s, key, ctx, value, depth)) return;
  if (value === undefined) {
    if (ctx.shapes.has(key)) {
      s.shape = key;
      return;
    }
    const c = ctx.colors.parse(key);
    if (c) {
      s.color = c;
      delete s.drawColor;
      delete s.fillColor;
      delete s.textColor;
      return;
    }
    if (key.includes("-") && setArrows(s, key)) return;
  }
  unknown();
}

