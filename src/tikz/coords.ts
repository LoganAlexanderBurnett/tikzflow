// Coordinate expressions: "(1,2)", "(30:1cm)", "(a)", "(a.north east)",
// "(a.30)", "(a |- b)", "($(a)!0.5!(b)$)", "($(a)+(1,0)$)", "([xshift=2mm]a)".
import { type KeyValue, parseOptionString } from "./options.ts";
import { anchorPoint, type NodeShape, type Point } from "./shapes.ts";
import { applyLinear, applyMatrix, type State } from "./state.ts";
import { CM, evalLength, evalNumber, evalQuantity, type FontUnits } from "./units.ts";

export interface NameEntry {
  shape: NodeShape;
  /** Id of the laid-out node this name belongs to, if any. */
  nodeId?: string;
}

export interface CoordEnv {
  names: ReadonlyMap<string, NameEntry>;
  state: State;
}

export type CoordResult =
  | {
      ok: true;
      point: Point;
      /** Set for a node name with an anchor ("a.north"): the node it belongs to. */
      anchored?: NameEntry;
      /** Set when the coordinate is a bare node name, so paths clip to its border. */
      node?: NameEntry;
      /** Names the coordinate refers to. */
      refs: string[];
    }
  | { ok: false; reason: string; refs: string[] };

const fail = (reason: string, refs: string[] = []): CoordResult => ({ ok: false, reason, refs });

function fontUnits(s: State): FontUnits {
  return { em: s.font.size, ex: s.font.size * 0.430554 };
}

/** Index of `needle` at nesting level zero (outside (), [], {} and $...$), or -1. */
function topLevelIndex(s: string, needle: string): number {
  let depth = 0;
  let math = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "$") math = !math;
    else if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (depth === 0 && !math && s.startsWith(needle, i)) return i;
  }
  return -1;
}

/** Splits "name.anchor", allowing dots in node names. */
export function splitNodeRef(ref: string, names: ReadonlyMap<string, NameEntry>): { name: string; anchor?: string } | null {
  const t = ref.trim();
  if (names.has(t)) return { name: t };
  const dot = t.lastIndexOf(".");
  if (dot > 0) {
    const name = t.slice(0, dot).trim();
    const anchor = t.slice(dot + 1).trim();
    if (names.has(name)) return { name, anchor };
  }
  return null;
}

/** Whether `ref` looks like a node name (with optional anchor) rather than numbers. */
export function looksLikeNodeRef(ref: string): boolean {
  return /^[^,:$\\{}()[\]]+$/.test(ref.trim()) && !/^[-+]?[\d.]+\s*(pt|cm|mm|in|bp|em|ex)?$/.test(ref.trim());
}

/** Evaluates the text inside a coordinate's parentheses. */
export function evalCoordText(text: string, env: CoordEnv): CoordResult {
  let t = text.trim();
  while (t.startsWith("{") && t.endsWith("}") && topLevelIndex(t.slice(1, -1), "}") < 0) t = t.slice(1, -1).trim();
  if (!t) return fail("empty coordinate");

  // Options in front: "[xshift=2mm] a.east".
  if (t.startsWith("[")) {
    let depth = 0;
    let end = -1;
    for (let i = 0; i < t.length; i++) {
      if (t[i] === "[" || t[i] === "{") depth++;
      else if (t[i] === "]" || t[i] === "}") depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
    if (end < 0) return fail("unclosed options in coordinate");
    const shift = coordShift(parseOptionString(t.slice(1, end)), env.state);
    if (!shift) return fail(`options in coordinate: ${t.slice(0, end + 1)}`);
    const inner = evalCoordText(t.slice(end + 1), env);
    if (!inner.ok) return inner;
    const [dx, dy] = applyLinear(env.state.matrix, shift[0], shift[1]);
    // "([yshift=3mm]a.east)" is still a point of a (it moves with it), but not its border.
    const of = inner.node ?? inner.anchored;
    return { ok: true, point: { x: inner.point.x + dx, y: inner.point.y + dy }, refs: inner.refs, ...(of ? { anchored: of } : {}) };
  }

  // Perpendicular coordinates.
  for (const op of ["|-", "-|"] as const) {
    const i = topLevelIndex(t, op);
    if (i > 0) {
      const a = evalCoordText(unparen(t.slice(0, i)), env);
      const b = evalCoordText(unparen(t.slice(i + 2)), env);
      const refs = [...a.refs, ...b.refs];
      if (!a.ok) return fail(a.reason, refs);
      if (!b.ok) return fail(b.reason, refs);
      const point = op === "|-" ? { x: a.point.x, y: b.point.y } : { x: b.point.x, y: a.point.y };
      return { ok: true, point, refs };
    }
  }

  if (t.startsWith("$") && t.endsWith("$") && t.length > 1) return evalCalc(t.slice(1, -1), env);

  if (topLevelIndex(t, ":") > 0) {
    const [angleText, radiusText] = splitOnce(t, ":");
    const angle = evalNumber(angleText);
    if (angle === null) return fail(`polar angle "${angleText}"`);
    const radii = radiusText.split(/\s+and\s+/);
    const rx = lengthOrUnit(radii[0]!, env.state, "x");
    const ry = radii[1] !== undefined ? lengthOrUnit(radii[1], env.state, "y") : rx;
    if (rx === null || ry === null) return fail(`polar radius "${radiusText}"`);
    const r = (angle * Math.PI) / 180;
    const [x, y] = applyMatrix(env.state.matrix, Math.cos(r) * rx, Math.sin(r) * ry);
    return { ok: true, point: { x, y }, refs: [] };
  }

  if (topLevelIndex(t, ",") > 0) {
    const parts = splitAll(t, ",");
    if (parts.length < 2 || parts.length > 3) return fail(`coordinate "${t}"`);
    const qs = parts.map((p) => evalQuantity(p, fontUnits(env.state)));
    if (qs.some((q) => !q)) return fail(`coordinate "${t}"`);
    const s = env.state;
    let lx = 0;
    let ly = 0;
    const [qx, qy, qz] = qs as [NonNullable<(typeof qs)[0]>, NonNullable<(typeof qs)[0]>, (typeof qs)[0]];
    if (qx.dimensioned) lx += qx.value;
    else {
      lx += qx.value * s.xUnit[0];
      ly += qx.value * s.xUnit[1];
    }
    if (qy.dimensioned) ly += qy.value;
    else {
      lx += qy.value * s.yUnit[0];
      ly += qy.value * s.yUnit[1];
    }
    if (qz) {
      // TikZ's default z vector.
      const z = qz.dimensioned ? qz.value / CM : qz.value;
      lx += z * -0.385 * CM;
      ly += z * -0.385 * CM;
    }
    const [x, y] = applyMatrix(s.matrix, lx, ly);
    return { ok: true, point: { x, y }, refs: [] };
  }

  // A node, with or without an anchor.
  const ref = splitNodeRef(t, env.names);
  if (!ref) {
    const name = t.includes(".") ? t.slice(0, t.lastIndexOf(".")).trim() : t;
    if (looksLikeNodeRef(t) && !/\\/.test(t)) return fail(`unknown node "${name}"`, [name]);
    return fail(`coordinate "${t}"`);
  }
  const entry = env.names.get(ref.name)!;
  if (ref.anchor === undefined) return { ok: true, point: { ...entry.shape.center }, node: entry, refs: [ref.name] };
  const p = anchorPoint(entry.shape, ref.anchor);
  if (!p) return fail(`anchor "${ref.anchor}" of ${ref.name}`, [ref.name]);
  return { ok: true, point: p, anchored: entry, refs: [ref.name] };
}

function unparen(s: string): string {
  const t = s.trim();
  if (t.startsWith("(") && t.endsWith(")")) return t.slice(1, -1);
  return t;
}

function splitOnce(s: string, sep: string): [string, string] {
  const i = topLevelIndex(s, sep);
  return [s.slice(0, i), s.slice(i + sep.length)];
}

function splitAll(s: string, sep: string): string[] {
  const out: string[] = [];
  let rest = s;
  for (let i = topLevelIndex(rest, sep); i >= 0; i = topLevelIndex(rest, sep)) {
    out.push(rest.slice(0, i));
    rest = rest.slice(i + sep.length);
  }
  out.push(rest);
  return out;
}

function lengthOrUnit(s: string, st: State, axis: "x" | "y"): number | null {
  const q = evalQuantity(s, fontUnits(st));
  if (!q) return null;
  if (q.dimensioned) return q.value;
  const u = axis === "x" ? st.xUnit : st.yUnit;
  return q.value * Math.hypot(u[0], u[1]);
}

/** xshift/yshift/shift in a coordinate's options, in local units. */
function coordShift(opts: KeyValue[], st: State): [number, number] | null {
  let dx = 0;
  let dy = 0;
  for (const o of opts) {
    if (o.key === "xshift" || o.key === "yshift") {
      const l = o.value === undefined ? null : evalLength(o.value, fontUnits(st));
      if (l === null) return null;
      if (o.key === "xshift") dx += l;
      else dy += l;
    } else if (o.key === "shift" && o.value) {
      const m = /^\{?\s*\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)\s*\}?$/.exec(o.value);
      const x = m ? lengthOrUnit(m[1]!, st, "x") : null;
      const y = m ? lengthOrUnit(m[2]!, st, "y") : null;
      if (x === null || y === null) return null;
      dx += x;
      dy += y;
    } else return null;
  }
  return [dx, dy];
}

// ---------------------------------------------------------------- calc

interface Scanner {
  s: string;
  i: number;
}

function ws(sc: Scanner) {
  while (sc.i < sc.s.length && /\s/.test(sc.s[sc.i]!)) sc.i++;
}

/** Reads "(...)" with nesting and returns the inner text. */
function readParens(sc: Scanner): string | null {
  ws(sc);
  if (sc.s[sc.i] !== "(") return null;
  let depth = 0;
  const start = sc.i;
  for (; sc.i < sc.s.length; sc.i++) {
    const ch = sc.s[sc.i];
    if (ch === "(" ) depth++;
    else if (ch === ")" && --depth === 0) {
      sc.i++;
      return sc.s.slice(start + 1, sc.i - 1);
    }
  }
  return null;
}

/** "$...$" from the calc library: sums of scaled coordinates with partway modifiers. */
function evalCalc(expr: string, env: CoordEnv): CoordResult {
  const sc: Scanner = { s: expr, i: 0 };
  const refs: string[] = [];
  let acc: Point = { x: 0, y: 0 };
  let sign = 1;
  let first = true;
  for (;;) {
    ws(sc);
    if (sc.i >= sc.s.length) break;
    const ch = sc.s[sc.i]!;
    if (!first) {
      if (ch === "+" || ch === "-") {
        sign = ch === "-" ? -1 : 1;
        sc.i++;
      } else return fail(`calc expression "${expr}"`, refs);
    } else if (ch === "-") {
      sign = -1;
      sc.i++;
    } else if (ch === "+") sc.i++;
    first = false;
    ws(sc);
    // Optional factor: "0.5*", "{2*3}*".
    let factor = 1;
    const fm = /^\s*(\{[^{}]*\}|[\d.]+)\s*\*/.exec(sc.s.slice(sc.i));
    if (fm) {
      const f = evalNumber(fm[1]!.replace(/^\{|\}$/g, ""));
      if (f === null) return fail(`calc factor "${fm[1]}"`, refs);
      factor = f;
      sc.i += fm[0].length;
    }
    const inner = readParens(sc);
    if (inner === null) return fail(`calc expression "${expr}"`, refs);
    const base = evalCoordText(inner, env);
    refs.push(...base.refs);
    if (!base.ok) return fail(base.reason, refs);
    let p = base.point;
    // Modifiers: !t!(b), !dim!(b), !t!angle:(b).
    for (;;) {
      ws(sc);
      if (sc.s[sc.i] !== "!") break;
      const close = sc.s.indexOf("!", sc.i + 1);
      if (close < 0) return fail(`calc modifier in "${expr}"`, refs);
      const spec = sc.s.slice(sc.i + 1, close).trim();
      sc.i = close + 1;
      const target = readParens(sc);
      if (target === null) return fail(`calc modifier in "${expr}"`, refs);
      const q = evalCoordText(target, env);
      refs.push(...q.refs);
      if (!q.ok) return fail(q.reason, refs);
      const [amount, angleText] = spec.includes(":") ? spec.split(":") : [spec, undefined];
      const qty = evalQuantity(amount!.trim(), fontUnits(env.state));
      if (!qty) return fail(`calc modifier "${spec}"`, refs);
      let dx = q.point.x - p.x;
      let dy = q.point.y - p.y;
      if (angleText !== undefined) {
        const a = evalNumber(angleText);
        if (a === null) return fail(`calc modifier "${spec}"`, refs);
        const r = (a * Math.PI) / 180;
        [dx, dy] = [dx * Math.cos(r) - dy * Math.sin(r), dx * Math.sin(r) + dy * Math.cos(r)];
      }
      if (qty.dimensioned) {
        const len = Math.hypot(dx, dy) || 1;
        p = { x: p.x + (dx / len) * qty.value, y: p.y + (dy / len) * qty.value };
      } else p = { x: p.x + dx * qty.value, y: p.y + dy * qty.value };
    }
    acc = { x: acc.x + sign * factor * p.x, y: acc.y + sign * factor * p.y };
  }
  return { ok: true, point: acc, refs };
}
