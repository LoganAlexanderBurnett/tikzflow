// SPDX-License-Identifier: GPL-3.0-or-later
// SVG to PDF, in the browser (M3 step 11, D72): the PDF export converts the
// accurate preview's SVG instead of shipping a second TeX engine (the owner's
// note under Milestone 3, item 8). The SVG is our own converter's output
// (src/engine/dvisvg.ts) holding pgf's drawing, so this reads the subset that
// can contain: groups with transforms and inherited paint, paths, `use` of
// glyph outlines, rect, circle, clip paths and gradients (as PDF shadings).
// Text is already paths, so the PDF has no fonts. The page is the SVG's
// viewBox, in bp (PDF's own unit).
//
// What it doesn't do, and says in `warnings`: `<image>`, patterns, filters,
// masks, markers, `opacity` on groups (treated as fill and stroke opacity),
// and rounded `rect` corners.

// ---------------------------------------------------------------- XML

export interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) => s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e: string) => (e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTITIES[e] ?? m)));

/**
 * A small XML reader: elements and attributes (text is ignored: the SVG has none that is drawn).
 * Tags that don't nest are repaired as an HTML parser would (an end tag closes what it can, a stray one is
 * ignored, open elements close at the end), and `onRepair` says so: TeX's picture can be cut short by an error.
 */
export function parseXml(source: string, onRepair: (message: string) => void = () => {}): XmlNode {
  const root: XmlNode = { tag: "#root", attrs: {}, children: [] };
  const stack: XmlNode[] = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  for (const m of source.matchAll(re)) {
    if (m[2] === undefined) continue;
    if (m[1]) {
      let at = stack.length - 1;
      while (at > 0 && stack[at]!.tag !== m[2]) at--;
      if (at === 0) onRepair(`a stray </${m[2]}> was ignored`);
      else {
        if (at < stack.length - 1) onRepair(`</${m[2]}> closed ${stack.length - 1 - at} element(s) left open`);
        stack.length = at;
      }
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of m[3]!.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]!] = decode(a[2] ?? a[3] ?? "");
    const node: XmlNode = { tag: m[2], attrs, children: [] };
    stack[stack.length - 1]!.children.push(node);
    if (!m[4]) stack.push(node);
  }
  if (stack.length !== 1) onRepair(`<${stack[stack.length - 1]!.tag}> was never closed`);
  const svg = root.children.find((c) => c.tag === "svg");
  if (!svg) throw new Error("SVG: no <svg> element");
  return svg;
}

// ---------------------------------------------------------------- geometry

/** [a b c d e f]: x' = a x + c y + e, y' = b x + d y + f. */
export type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `m1` then `m2` applied to a point is `mul(m2, m1)`; a child's matrix goes on the right of its parent's. */
export function mul(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

const nums = (s: string): number[] => (s.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);

/** An SVG transform list: `translate(1,2)scale(3)` and so on, left to right. */
export function parseTransform(s: string | undefined): Matrix {
  let m = IDENTITY;
  for (const t of (s ?? "").matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = nums(t[2]!);
    let n: Matrix | null = null;
    switch (t[1]) {
      case "matrix":
        if (a.length === 6) n = a as Matrix;
        break;
      case "translate":
        n = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
        break;
      case "scale":
        n = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
        break;
      case "rotate": {
        const r = ((a[0] ?? 0) * Math.PI) / 180;
        const [c, s2] = [Math.cos(r), Math.sin(r)];
        n = [c, s2, -s2, c, 0, 0];
        if (a.length >= 3) n = mul(mul([1, 0, 0, 1, a[1]!, a[2]!], n), [1, 0, 0, 1, -a[1]!, -a[2]!]);
        break;
      }
      case "skewX":
        n = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case "skewY":
        n = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    if (n) m = mul(m, n);
  }
  return m;
}

/** A path as PDF would draw it: moveto, lineto, curveto (cubic) and close. */
export type Seg = ["M", number, number] | ["L", number, number] | ["C", number, number, number, number, number, number] | ["Z"];

/** Converts one SVG elliptical arc to cubic curves (the SVG implementation notes, F.6). */
function arcToCubics(x0: number, y0: number, rx: number, ry: number, phiDeg: number, large: boolean, sweep: boolean, x: number, y: number): Seg[] {
  if (x0 === x && y0 === y) return [];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (!rx || !ry) return [["L", x, y]];
  const phi = (phiDeg * Math.PI) / 180;
  const [c, s] = [Math.cos(phi), Math.sin(phi)];
  const dx = (x0 - x) / 2;
  const dy = (y0 - y) / 2;
  const x1 = c * dx + s * dy;
  const y1 = -s * dx + c * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (k * rx * y1) / ry;
  const cyp = (-k * ry * x1) / rx;
  const cx = c * cxp - s * cyp + (x0 + x) / 2;
  const cy = s * cxp + c * cyp + (y0 + y) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const theta1 = angle(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
  let dTheta = angle((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  else if (sweep && dTheta < 0) dTheta += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2) - 1e-9));
  const step = dTheta / n;
  const t = (4 / 3) * Math.tan(step / 4);
  const out: Seg[] = [];
  const point = (th: number): [number, number, number, number] => {
    const [ct, st] = [Math.cos(th), Math.sin(th)];
    // Point and derivative of the ellipse at th, rotated and moved into place.
    return [cx + rx * ct * c - ry * st * s, cy + rx * ct * s + ry * st * c, -rx * st * c - ry * ct * s, -rx * st * s + ry * ct * c];
  };
  for (let i = 0; i < n; i++) {
    const a = point(theta1 + i * step);
    const b = point(theta1 + (i + 1) * step);
    out.push(["C", a[0] + t * a[2], a[1] + t * a[3], b[0] - t * b[2], b[1] - t * b[3], b[0], b[1]]);
  }
  return out;
}

/** The path data `d` as absolute move/line/cubic/close segments. Quadratics are raised to cubics, arcs converted. */
export function parsePath(d: string): Seg[] {
  const out: Seg[] = [];
  const tokens = d.match(/[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  let i = 0;
  let cmd = "";
  let [x, y, sx, sy] = [0, 0, 0, 0];
  let [lcx, lcy, lqx, lqy] = [0, 0, 0, 0];
  let prev = "";
  const num = () => {
    const t = tokens[i++];
    if (t === undefined || /[A-Za-z]/.test(t)) throw new Error(`SVG path: a number is missing in "${d.slice(0, 60)}"`);
    return Number(t);
  };
  const flag = () => {
    // Arc flags may be written without a separator ("a1 1 0 011 1").
    const t = tokens[i]!;
    if (t.length > 1 && /^[01]/.test(t)) {
      tokens[i] = t.slice(1);
      return t[0] === "1";
    }
    return num() === 1;
  };
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i]!)) cmd = tokens[i++]!;
    else if (cmd === "M") cmd = "L";
    else if (cmd === "m") cmd = "l";
    else if (!cmd) throw new Error("SVG path: no command");
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    switch (C) {
      case "M":
        x = num() + ox;
        y = num() + oy;
        [sx, sy] = [x, y];
        out.push(["M", x, y]);
        break;
      case "L":
        x = num() + ox;
        y = num() + oy;
        out.push(["L", x, y]);
        break;
      case "H":
        x = num() + ox;
        out.push(["L", x, y]);
        break;
      case "V":
        y = num() + oy;
        out.push(["L", x, y]);
        break;
      case "C": {
        const [a, b, c, e, f, g] = [num() + ox, num() + oy, num() + ox, num() + oy, num() + ox, num() + oy];
        out.push(["C", a, b, c, e, f, g]);
        [lcx, lcy, x, y] = [c, e, f, g];
        break;
      }
      case "S": {
        const refl = prev === "C" || prev === "S";
        const [a, b] = refl ? [2 * x - lcx, 2 * y - lcy] : [x, y];
        const [c, e, f, g] = [num() + ox, num() + oy, num() + ox, num() + oy];
        out.push(["C", a, b, c, e, f, g]);
        [lcx, lcy, x, y] = [c, e, f, g];
        break;
      }
      case "Q":
      case "T": {
        let qx: number;
        let qy: number;
        if (C === "Q") {
          qx = num() + ox;
          qy = num() + oy;
        } else {
          const refl = prev === "Q" || prev === "T";
          [qx, qy] = refl ? [2 * x - lqx, 2 * y - lqy] : [x, y];
        }
        const [ex, ey] = [num() + ox, num() + oy];
        out.push(["C", x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey), ex, ey]);
        [lqx, lqy, x, y] = [qx, qy, ex, ey];
        break;
      }
      case "A": {
        const [rx, ry, rot] = [num(), num(), num()];
        const large = flag();
        const sweep = flag();
        const [ex, ey] = [num() + ox, num() + oy];
        out.push(...arcToCubics(x, y, rx, ry, rot, large, sweep, ex, ey));
        [x, y] = [ex, ey];
        break;
      }
      case "Z":
        out.push(["Z"]);
        [x, y] = [sx, sy];
        break;
      default:
        throw new Error(`SVG path: unknown command ${cmd}`);
    }
    prev = C;
  }
  return out;
}

/** The box of a path's points and control points (the hull's box: exact enough for gradients). */
function bounds(segs: readonly Seg[]): [number, number, number, number] | null {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const s of segs) {
    for (let i = 1; i < s.length; i += 2) {
      x0 = Math.min(x0, s[i] as number);
      x1 = Math.max(x1, s[i] as number);
      y0 = Math.min(y0, s[i + 1] as number);
      y1 = Math.max(y1, s[i + 1] as number);
    }
  }
  return Number.isFinite(x0) ? [x0, y0, x1, y1] : null;
}

const KAPPA = 0.5522847498;
function ellipse(cx: number, cy: number, rx: number, ry: number): Seg[] {
  const [kx, ky] = [rx * KAPPA, ry * KAPPA];
  return [
    ["M", cx + rx, cy],
    ["C", cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry],
    ["C", cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy],
    ["C", cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry],
    ["C", cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy],
    ["Z"],
  ];
}

// ---------------------------------------------------------------- paint

type Rgb = [number, number, number];
type Paint = { kind: "none" } | { kind: "color"; rgb: Rgb } | { kind: "gradient"; id: string };

const NAMED: Record<string, Rgb> = {
  black: [0, 0, 0], white: [1, 1, 1], red: [1, 0, 0], green: [0, 0.5019608, 0], blue: [0, 0, 1], yellow: [1, 1, 0], cyan: [0, 1, 1], aqua: [0, 1, 1],
  magenta: [1, 0, 1], fuchsia: [1, 0, 1], gray: [0.5019608, 0.5019608, 0.5019608], grey: [0.5019608, 0.5019608, 0.5019608], silver: [0.7529412, 0.7529412, 0.7529412],
  orange: [1, 0.6470588, 0], purple: [0.5019608, 0, 0.5019608], brown: [0.6470588, 0.1647059, 0.1647059], pink: [1, 0.7529412, 0.7960784], lime: [0, 1, 0],
  navy: [0, 0, 0.5019608], teal: [0, 0.5019608, 0.5019608], olive: [0.5019608, 0.5019608, 0], maroon: [0.5019608, 0, 0],
};

function parsePaint(value: string, current: Rgb): Paint | null {
  const v = value.trim();
  if (!v || v === "inherit") return null;
  if (v === "none" || v === "transparent") return { kind: "none" };
  if (v === "currentColor") return { kind: "color", rgb: current };
  const url = /^url\(\s*#([^)\s]+)\s*\)/.exec(v);
  if (url) return { kind: "gradient", id: url[1]! };
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(v);
  if (hex) {
    const h = hex[1]!.length === 3 ? [...hex[1]!].map((c) => c + c).join("") : hex[1]!;
    return { kind: "color", rgb: [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255] };
  }
  const rgb = /^rgba?\(([^)]*)\)/i.exec(v);
  if (rgb) {
    const p = rgb[1]!.split(/[\s,/]+/).filter(Boolean);
    const c = (s: string) => (s.endsWith("%") ? parseFloat(s) / 100 : parseFloat(s) / 255);
    if (p.length >= 3) return { kind: "color", rgb: [c(p[0]!), c(p[1]!), c(p[2]!)] };
  }
  const named = NAMED[v.toLowerCase()];
  return named ? { kind: "color", rgb: named } : null;
}

/** An element's presentation: its attributes, then its `style` attribute over them. */
function presentation(attrs: Record<string, string>): Record<string, string> {
  const p: Record<string, string> = { ...attrs };
  for (const decl of (attrs.style ?? "").split(";")) {
    const i = decl.indexOf(":");
    if (i > 0) p[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
  }
  return p;
}

interface State {
  ctm: Matrix;
  color: Rgb;
  fill: Paint;
  stroke: Paint;
  strokeWidth: number;
  cap: number;
  join: number;
  miter: number;
  dash: number[];
  dashOffset: number;
  fillOpacity: number;
  strokeOpacity: number;
  fillRule: "nonzero" | "evenodd";
  clipRule: "nonzero" | "evenodd";
}

const INITIAL: State = {
  ctm: IDENTITY,
  color: [0, 0, 0],
  fill: { kind: "color", rgb: [0, 0, 0] },
  stroke: { kind: "none" },
  strokeWidth: 1,
  cap: 0,
  join: 0,
  miter: 4,
  dash: [],
  dashOffset: 0,
  fillOpacity: 1,
  strokeOpacity: 1,
  fillRule: "nonzero",
  clipRule: "nonzero",
};

/** `s` with the element's own presentation attributes applied (not its transform). */
function withStyle(s: State, p: Record<string, string>, warn: (w: string) => void): State {
  const n: State = { ...s };
  const num = (v: string | undefined) => (v === undefined ? null : (nums(v)[0] ?? null));
  if (p.color) n.color = (parsePaint(p.color, s.color) as { rgb: Rgb } | null)?.rgb ?? s.color;
  const fill = p.fill !== undefined ? parsePaint(p.fill, n.color) : null;
  if (fill) n.fill = fill;
  const stroke = p.stroke !== undefined ? parsePaint(p.stroke, n.color) : null;
  if (stroke) n.stroke = stroke;
  const sw = num(p["stroke-width"]);
  if (sw !== null) n.strokeWidth = sw;
  if (p["stroke-linecap"]) n.cap = { butt: 0, round: 1, square: 2 }[p["stroke-linecap"]] ?? s.cap;
  if (p["stroke-linejoin"]) n.join = { miter: 0, round: 1, bevel: 2 }[p["stroke-linejoin"]] ?? s.join;
  const ml = num(p["stroke-miterlimit"]);
  if (ml !== null) n.miter = ml;
  if (p["stroke-dasharray"] !== undefined) {
    const d = p["stroke-dasharray"] === "none" ? [] : nums(p["stroke-dasharray"]);
    n.dash = d.length && d.some((v) => v > 0) ? (d.length % 2 ? [...d, ...d] : d) : [];
  }
  const doff = num(p["stroke-dashoffset"]);
  if (doff !== null) n.dashOffset = doff;
  const fo = num(p["fill-opacity"]);
  if (fo !== null) n.fillOpacity = Math.min(1, Math.max(0, fo));
  const so = num(p["stroke-opacity"]);
  if (so !== null) n.strokeOpacity = Math.min(1, Math.max(0, so));
  const op = num(p.opacity);
  if (op !== null && op < 1) {
    // Group opacity needs a transparency group; this applies it to each shape instead.
    n.fillOpacity *= op;
    n.strokeOpacity *= op;
    warn("opacity on a group is applied to each shape");
  }
  if (p["fill-rule"] === "evenodd" || p["fill-rule"] === "nonzero") n.fillRule = p["fill-rule"];
  if (p["clip-rule"] === "evenodd" || p["clip-rule"] === "nonzero") n.clipRule = p["clip-rule"];
  return n;
}

// ---------------------------------------------------------------- PDF output

/** Matrices need more digits than coordinates: a glyph is drawn through a scale of about 0.007. */
const fmtHi = (v: number): string => {
  if (!Number.isFinite(v)) return "0";
  const t = v.toFixed(8).replace(/\.?0+$/, "");
  return t === "-0" || t === "" ? "0" : t;
};

const fmt = (v: number): string => {
  if (!Number.isFinite(v)) return "0";
  const r = Math.round(v * 10000) / 10000;
  return Object.is(r, -0) ? "0" : String(r);
};

interface Shading {
  /** The shading dictionary's text, with its function inline. */
  dict: string;
  /** Pattern space to page space. */
  matrix: Matrix;
}

class Writer {
  readonly warnings = new Set<string>();
  #content: string[] = [];
  #gstates = new Map<string, number>();
  #patterns: Shading[] = [];

  emit(s: string): void {
    this.#content.push(s);
  }
  gstate(fill: number, stroke: number): string {
    const key = `${fmt(fill)} ${fmt(stroke)}`;
    if (!this.#gstates.has(key)) this.#gstates.set(key, this.#gstates.size);
    return `/G${this.#gstates.get(key)}`;
  }
  pattern(s: Shading): string {
    this.#patterns.push(s);
    return `/P${this.#patterns.length - 1}`;
  }
  get stream(): string {
    return this.#content.join("\n");
  }
  get gstates(): string[] {
    return [...this.#gstates.keys()];
  }
  get patterns(): Shading[] {
    return this.#patterns;
  }
}

const rgbOps = (c: Rgb, op: "rg" | "RG") => `${fmt(c[0])} ${fmt(c[1])} ${fmt(c[2])} ${op}`;

interface Doc {
  ids: Map<string, XmlNode>;
  out: Writer;
}

function indexIds(n: XmlNode, ids: Map<string, XmlNode>): void {
  if (n.attrs.id) ids.set(n.attrs.id, n);
  for (const c of n.children) indexIds(c, ids);
}

/** The shapes of an element, as segments in its own coordinates (paths, rect, circle, …), or null for other elements. */
function shapeOf(n: XmlNode): Seg[] | null {
  const a = n.attrs;
  const f = (k: string, d = 0) => (a[k] !== undefined ? (nums(a[k]!)[0] ?? d) : d);
  switch (n.tag) {
    case "path":
      return a.d ? parsePath(a.d) : [];
    case "rect": {
      const [x, y, w, h] = [f("x"), f("y"), f("width"), f("height")];
      return w > 0 && h > 0 ? [["M", x, y], ["L", x + w, y], ["L", x + w, y + h], ["L", x, y + h], ["Z"]] : [];
    }
    case "circle":
      return f("r") > 0 ? ellipse(f("cx"), f("cy"), f("r"), f("r")) : [];
    case "ellipse":
      return f("rx") > 0 && f("ry") > 0 ? ellipse(f("cx"), f("cy"), f("rx"), f("ry")) : [];
    case "line":
      return [["M", f("x1"), f("y1")], ["L", f("x2"), f("y2")]];
    case "polyline":
    case "polygon": {
      const p = nums(a.points ?? "");
      const segs: Seg[] = [];
      for (let i = 0; i + 1 < p.length; i += 2) segs.push([i ? "L" : "M", p[i]!, p[i + 1]!]);
      if (n.tag === "polygon" && segs.length) segs.push(["Z"]);
      return segs;
    }
  }
  return null;
}

function pathOps(segs: readonly Seg[]): string {
  const out: string[] = [];
  for (const s of segs) {
    if (s[0] === "M") out.push(`${fmt(s[1])} ${fmt(s[2])} m`);
    else if (s[0] === "L") out.push(`${fmt(s[1])} ${fmt(s[2])} l`);
    else if (s[0] === "C") out.push(`${fmt(s[1])} ${fmt(s[2])} ${fmt(s[3])} ${fmt(s[4])} ${fmt(s[5])} ${fmt(s[6])} c`);
    else out.push("h");
  }
  return out.join(" ");
}

const ref = (n: XmlNode) => n.attrs["xlink:href"] ?? n.attrs.href ?? "";

/** A gradient as a PDF shading in its own space (the unit box for objectBoundingBox), or null if it can't be read. */
function gradientShading(doc: Doc, id: string, box: [number, number, number, number] | null, ctm: Matrix, pageFromSvg: Matrix): Shading | null {
  const g = doc.ids.get(id);
  if (!g || (g.tag !== "linearGradient" && g.tag !== "radialGradient")) return null;
  // Stops come from the gradient itself or the one it points to.
  let stopsFrom: XmlNode | undefined = g;
  for (let guard = 0; stopsFrom && !stopsFrom.children.some((c) => c.tag === "stop") && guard < 8; guard++) stopsFrom = doc.ids.get(ref(stopsFrom).replace(/^#/, ""));
  const stops = (stopsFrom?.children ?? [])
    .filter((c) => c.tag === "stop")
    .map((c) => {
      const p = presentation(c.attrs);
      const off = (p.offset ?? "0").trim();
      const color = parsePaint(p["stop-color"] ?? "#000", [0, 0, 0]);
      const o = off.endsWith("%") ? parseFloat(off) / 100 : parseFloat(off);
      return { offset: Math.min(1, Math.max(0, Number.isFinite(o) ? o : 0)), rgb: color?.kind === "color" ? color.rgb : ([0, 0, 0] as Rgb) };
    });
  if (!stops.length) return null;
  for (let i = 1; i < stops.length; i++) stops[i]!.offset = Math.max(stops[i]!.offset, stops[i - 1]!.offset);
  const units = g.attrs.gradientUnits ?? "objectBoundingBox";
  const dimension = (v: string | undefined, fallback: number): number => {
    if (v === undefined) return fallback;
    const x = nums(v)[0] ?? fallback;
    return v.trim().endsWith("%") ? x / 100 : x;
  };
  let space: Matrix;
  if (units === "userSpaceOnUse") space = ctm;
  else {
    if (!box) return null;
    const w = box[2] - box[0] || 1e-9;
    const h = box[3] - box[1] || 1e-9;
    space = mul(ctm, [w, 0, 0, h, box[0], box[1]]);
  }
  space = mul(space, parseTransform(g.attrs.gradientTransform));
  const matrix = mul(pageFromSvg, space);

  // PDF function: stitched exponential interpolations between the stops.
  const bounds: number[] = [];
  const fns: string[] = [];
  const pad: Array<{ offset: number; rgb: Rgb }> = [...stops];
  if (pad[0]!.offset > 0) pad.unshift({ offset: 0, rgb: pad[0]!.rgb });
  if (pad[pad.length - 1]!.offset < 1) pad.push({ offset: 1, rgb: pad[pad.length - 1]!.rgb });
  for (let i = 0; i + 1 < pad.length; i++) {
    const [a, b] = [pad[i]!, pad[i + 1]!];
    if (i > 0) bounds.push(a.offset);
    fns.push(`<< /FunctionType 2 /Domain [0 1] /C0 [${a.rgb.map(fmt).join(" ")}] /C1 [${b.rgb.map(fmt).join(" ")}] /N 1 >>`);
  }
  const fn =
    fns.length === 1
      ? fns[0]!
      : `<< /FunctionType 3 /Domain [0 1] /Functions [${fns.join(" ")}] /Bounds [${bounds.map(fmt).join(" ")}] /Encode [${fns.map(() => "0 1").join(" ")}] >>`;
  if (g.tag === "linearGradient") {
    const [x1, y1, x2, y2] = [dimension(g.attrs.x1, 0), dimension(g.attrs.y1, 0), dimension(g.attrs.x2, 1), dimension(g.attrs.y2, 0)];
    return { dict: `<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [${[x1, y1, x2, y2].map(fmt).join(" ")}] /Function ${fn} /Extend [true true] >>`, matrix };
  }
  const [cx, cy, r] = [dimension(g.attrs.cx, 0.5), dimension(g.attrs.cy, 0.5), dimension(g.attrs.r, 0.5)];
  const [fx, fy] = [dimension(g.attrs.fx, cx), dimension(g.attrs.fy, cy)];
  return { dict: `<< /ShadingType 3 /ColorSpace /DeviceRGB /Coords [${[fx, fy, 0, cx, cy, r].map(fmt).join(" ")}] /Function ${fn} /Extend [true true] >>`, matrix };
}

function draw(doc: Doc, n: XmlNode, st: State, pageFromSvg: Matrix, depth: number): void {
  if (depth > 64) throw new Error("SVG: elements nest too deeply (a <use> of itself?)");
  const { out } = doc;
  const warn = (w: string) => out.warnings.add(w);
  switch (n.tag) {
    case "defs":
    case "clipPath":
    case "linearGradient":
    case "radialGradient":
    case "title":
    case "desc":
    case "style":
    case "metadata":
      return;
    case "image":
    case "pattern":
    case "filter":
    case "mask":
    case "foreignObject":
    case "text":
      warn(`<${n.tag}> isn't converted`);
      return;
  }
  const p = presentation(n.attrs);
  let s = withStyle(st, p, warn);
  const own = parseTransform(n.attrs.transform);
  const hasTransform = n.attrs.transform !== undefined && own.some((v, i) => v !== IDENTITY[i]);
  const clip = /^url\(\s*#([^)\s]+)\s*\)/.exec(p["clip-path"] ?? "")?.[1];
  const needsSave = hasTransform || !!clip || n.tag === "g" || n.tag === "svg" || n.tag === "use";
  if (needsSave) out.emit("q");
  if (hasTransform) {
    out.emit(`${own.map(fmtHi).join(" ")} cm`);
    s = { ...s, ctm: mul(s.ctm, own) };
  }
  if (clip) {
    const cp = doc.ids.get(clip);
    if (cp?.tag === "clipPath") {
      // The clip is in the user space of the element that refers to it; its children's own transforms are applied to their points.
      const flat: string[] = [];
      for (const c of cp.children) {
        const segs = shapeOf(c);
        if (segs?.length) flat.push(pathOps(transformSegs(segs, parseTransform(c.attrs.transform))));
      }
      const clipRule = presentation(cp.children[0]?.attrs ?? {})["clip-rule"] ?? cp.attrs["clip-rule"];
      if (flat.length) out.emit(`${flat.join(" ")} ${clipRule === "evenodd" ? "W*" : "W"} n`);
    } else warn(`clip path ${clip} not found`);
  }

  if (n.tag === "use") {
    const target = doc.ids.get(ref(n).replace(/^#/, ""));
    const x = n.attrs.x ? (nums(n.attrs.x)[0] ?? 0) : 0;
    const y = n.attrs.y ? (nums(n.attrs.y)[0] ?? 0) : 0;
    if (!target) warn(`<use> of ${ref(n)} not found`);
    else {
      let u = s;
      if (x || y) {
        out.emit(`1 0 0 1 ${fmtHi(x)} ${fmtHi(y)} cm`);
        u = { ...s, ctm: mul(s.ctm, [1, 0, 0, 1, x, y]) };
      }
      draw(doc, target, u, pageFromSvg, depth + 1);
    }
  } else if (n.tag === "g" || n.tag === "svg") {
    for (const c of n.children) draw(doc, c, s, pageFromSvg, depth + 1);
  } else {
    const segs = shapeOf(n);
    if (segs?.length) paintShape(doc, segs, s, pageFromSvg);
    else if (segs === null) warn(`<${n.tag}> isn't converted`);
  }
  if (needsSave) out.emit("Q");
}

function transformSegs(segs: readonly Seg[], m: Matrix): Seg[] {
  const [a, b, c, d, e, f] = m;
  const tx = (x: number, y: number): [number, number] => [a * x + c * y + e, b * x + d * y + f];
  return segs.map((s): Seg => {
    if (s[0] === "Z") return s;
    if (s[0] === "C") {
      const [p, q, r] = [tx(s[1], s[2]), tx(s[3], s[4]), tx(s[5], s[6])];
      return ["C", p[0], p[1], q[0], q[1], r[0], r[1]];
    }
    const p = tx(s[1], s[2]);
    return [s[0], p[0], p[1]];
  });
}

function paintShape(doc: Doc, segs: readonly Seg[], s: State, pageFromSvg: Matrix): void {
  const { out } = doc;
  const filled = s.fill.kind !== "none";
  const stroked = s.stroke.kind === "color" && s.strokeWidth > 0;
  if (!filled && !stroked) return;
  out.emit("q");
  if (s.fillOpacity < 1 || s.strokeOpacity < 1) out.emit(`${out.gstate(s.fillOpacity, s.strokeOpacity)} gs`);
  let fillOk = filled;
  if (s.fill.kind === "color") out.emit(rgbOps(s.fill.rgb, "rg"));
  else if (s.fill.kind === "gradient") {
    const shading = gradientShading(doc, s.fill.id, bounds(segs), s.ctm, pageFromSvg);
    if (shading) out.emit(`/Pattern cs ${out.pattern(shading)} scn`);
    else {
      out.warnings.add(`gradient ${s.fill.id} couldn't be read; filled with its first colour`);
      fillOk = false;
    }
  }
  if (stroked && s.stroke.kind === "color") {
    out.emit(rgbOps(s.stroke.rgb, "RG"));
    out.emit(`${fmt(s.strokeWidth)} w ${s.cap} J ${s.join} j ${fmt(s.miter)} M ${s.dash.length ? `[${s.dash.map(fmt).join(" ")}] ${fmt(s.dashOffset)} d` : "[] 0 d"}`);
  }
  const rule = s.fillRule === "evenodd" ? "*" : "";
  const op = fillOk && stroked ? `B${rule}` : fillOk ? `f${rule}` : stroked ? "S" : "n";
  out.emit(`${pathOps(segs)} ${op}`);
  out.emit("Q");
}

// ---------------------------------------------------------------- the file

const latin1 = (s: string): Uint8Array => {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
};

async function deflate(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") return null;
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export interface PdfResult {
  pdf: Uint8Array;
  /** The page, bp. */
  width: number;
  height: number;
  /** Things in the SVG that weren't converted. */
  warnings: string[];
}

/** Converts a self-contained SVG (viewBox in bp) to a one-page PDF. */
export async function svgToPdf(svg: string): Promise<PdfResult> {
  const repairs = new Set<string>();
  const root = parseXml(svg, (m) => repairs.add(m));
  const vb = nums(root.attrs.viewBox ?? "");
  if (vb.length !== 4 || !(vb[2]! > 0) || !(vb[3]! > 0)) throw new Error("SVG: the viewBox is missing or empty");
  const [minX, minY, width, height] = vb as [number, number, number, number];
  // SVG user space (y down, origin at the viewBox corner) to PDF page space (y up, origin at the lower left).
  const pageFromSvg: Matrix = [1, 0, 0, -1, -minX, height + minY];
  const ids = new Map<string, XmlNode>();
  indexIds(root, ids);
  const out = new Writer();
  const doc: Doc = { ids, out };
  out.emit(`${pageFromSvg.map(fmtHi).join(" ")} cm`);
  draw(doc, root, INITIAL, pageFromSvg, 0);

  const content = latin1(out.stream);
  const packed = await deflate(content);
  const objects: Array<Uint8Array | string> = [];
  const add = (body: Uint8Array | string): number => objects.push(body);
  // 1 catalog, 2 pages, 3 page, 4 contents, then resources.
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  const resourceStart = 5;
  const gs = out.gstates.map((k, i) => ({ k, id: resourceStart + i }));
  const patterns = out.patterns.map((p, i) => ({ p, id: resourceStart + gs.length + i }));
  const resources = [
    gs.length ? `/ExtGState << ${gs.map((g, i) => `/G${i} ${g.id} 0 R`).join(" ")} >>` : "",
    patterns.length ? `/Pattern << ${patterns.map((p, i) => `/P${i} ${p.id} 0 R`).join(" ")} >>` : "",
  ].join(" ");
  add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(width)} ${fmt(height)}] /Contents 4 0 R /Resources << ${resources} >> >>`);
  const body = packed ?? content;
  const head = `<< /Length ${body.length}${packed ? " /Filter /FlateDecode" : ""} >>\nstream\n`;
  add(concat([latin1(head), body, latin1("\nendstream")]));
  for (const g of gs) {
    const [ca, CA] = g.k.split(" ");
    add(`<< /Type /ExtGState /ca ${ca} /CA ${CA} >>`);
  }
  for (const { p } of patterns) {
    const [a, b, c, d, e, f] = p.matrix;
    add(`<< /Type /Pattern /PatternType 2 /Shading ${p.dict} /Matrix [${[a, b, c, d, e, f].map(fmtHi).join(" ")}] >>`);
  }
  const info = add("<< /Producer (TikZFlow) /Creator (TikZFlow) >>");

  const chunks: Uint8Array[] = [latin1("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")];
  const offsets: number[] = [];
  let at = chunks[0]!.length;
  objects.forEach((o, i) => {
    offsets.push(at);
    const b = concat([latin1(`${i + 1} 0 obj\n`), typeof o === "string" ? latin1(o) : o, latin1("\nendobj\n")]);
    chunks.push(b);
    at += b.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)].join("");
  chunks.push(latin1(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${at}\n%%EOF\n`));
  return { pdf: concat(chunks), width, height, warnings: [...[...repairs].map((r) => `The SVG's tags didn't nest (TeX stopped early?): ${r}`), ...out.warnings] };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
