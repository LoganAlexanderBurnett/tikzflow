// Curved mode (M2b step 6): "Make curved" and dragging an edge's control
// points. A curve is written in this order, the first that draws what was
// dragged (SPEC.md): `bend left=40` when it is symmetric, `out=…, in=…` (with
// `looseness`, or `out looseness` and `in looseness` when the two differ),
// and `.. controls +(…) and +(…) ..`, which is kept for curves already
// written that way. "Make curved" writes a plain `bend left` (D45).
import { analyzeDocument, layoutDocumentPicture } from "../model/document.ts";
import { type Edge, itemFrom } from "../model/edges.ts";
import type { OptionList, PathItemSyntax } from "../model/syntax.ts";
import type { LaidOutNode, PictureLayout, RouteSeg, RouteStop } from "../tikz/layout.ts";
import { anchorPoint, type Point } from "../tikz/shapes.ts";
import { trimNumber } from "../tikz/units.ts";
import type { Change } from "./changes.ts";
import { absoluteText, editPath, type EditOutcome, findEdge, relativeStyle, relativeText } from "./edges.ts";
import { CURVE_KEYS, edgeMiddle, isEdgeOperation, opOptions, rewriteMiddle } from "./vertices.ts";

const DEG = 180 / Math.PI;
/** TikZ's control distance for looseness 1, as a share of the distance between the ends (tikzlibrarytopaths). */
const SPAN = 0.3915;

const norm = (deg: number) => {
  const d = ((deg % 360) + 360) % 360;
  return d > 180 ? d - 360 : d;
};
const angleOf = (from: Point, to: Point) => Math.atan2(to.y - from.y, to.x - from.x) * DEG;
const dist = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);
const polar = (p: Point, deg: number, d: number): Point => ({ x: p.x + Math.cos(deg / DEG) * d, y: p.y + Math.sin(deg / DEG) * d });

function edgeIn(text: string, picIndex: number, edgeId: string) {
  const doc = analyzeDocument(text);
  const layout = layoutDocumentPicture(doc, picIndex);
  const edge = layout && findEdge(layout, edgeId);
  return { doc, layout, edge };
}

/** The "to" or "edge" keyword item that starts a segment, and its option list. */
function curveOp(edge: Edge, seg: RouteSeg): { kind: "to" | "edge" | "controls"; item: PathItemSyntax; list?: OptionList } | null {
  const items = edge.path.syntax.items;
  const it = items[seg.op];
  if (!it) return null;
  if (it.kind === "op" && it.op === "..") return { kind: "controls", item: it };
  if (it.kind === "keyword" && (it.word === "to" || it.word === "edge")) {
    const list = opOptions(items, seg.op);
    return list ? { kind: it.word, item: it, list } : { kind: it.word, item: it };
  }
  return null;
}

/** Where a curve starts or ends on stop `s` leaving at `deg`: on the border for a bare node, else the point itself. */
function endAt(layout: PictureLayout, s: RouteStop, deg: number): Point {
  if (!s.bare || !s.node) return s.point;
  const n = layout.nodes.find((x) => x.id === s.node);
  return n ? (anchorPoint(n.shape, String(((Math.round(deg * 1000) / 1000) % 360 + 360) % 360)) ?? s.point) : s.point;
}

// ---------------------------------------------------------------- make curved

/**
 * "Make curved": a plain `bend left` (D45), TikZ's 30°. The edge's corners
 * go; its labels, comments and ends stay. An `edge` operation gets the key
 * in its own options.
 */
export function planMakeCurved(text: string, picIndex: number, edgeId: string): EditOutcome {
  const { layout, edge } = edgeIn(text, picIndex, edgeId);
  if (!layout || !edge) return { ok: false, reason: "There is no such edge." };
  if (edge.lock) return { ok: false, reason: `This edge can't be edited: ${edge.lock.message}.` };
  if (edge.mode === "curved") return { ok: false, reason: "It is already curved: drag its control points to shape it." };
  const isCurve = (r: { segs: RouteSeg[] }) => (r.segs.some((s) => s.kind === "curve") ? null : "The edge would still be straight.");
  if (isEdgeOperation(edge)) {
    const items = edge.path.syntax.items;
    const op = items.findIndex((it) => it.kind === "keyword" && it.word === "edge" && itemFrom(it) === edge.path.range.from);
    const kw = items[op];
    if (!kw || kw.kind !== "keyword") return { ok: false, reason: "The edge's code couldn't be found." };
    const list = opOptions(items, op);
    const change: Change = list
      ? list.items.length
        ? { from: list.items[list.items.length - 1]!.to, to: list.items[list.items.length - 1]!.to, insert: ", bend left" }
        : { from: list.from + 1, to: list.to - 1, insert: "bend left" }
      : { from: kw.range.to, to: kw.range.to, insert: "[bend left]" };
    return editPath(text, picIndex, edge, { changes: [change], check: isCurve });
  }
  const route = edge.route;
  const first = route.segs[edge.segs[0]!]!;
  const items = edge.path.syntax.items;
  const it = items[first.op];
  const list = it?.kind === "keyword" && it.word === "to" ? opOptions(items, first.op) : undefined;
  const keep = list ? list.items.filter((i) => !CURVE_KEYS.has(i.key)).map((i) => text.slice(i.from, i.to)) : [];
  const op = `to[${[...keep, "bend left"].join(", ")}]`;
  return rewriteMiddle(text, picIndex, edge, [{ op }], () => 0, [], (r) => isCurve({ segs: [r.segs[edge.segs[0]!]!] }));
}

// ---------------------------------------------------------------- dragging control points

/** The curved segments of an edge (route segment indices), for their control handles. */
export function curveSegments(edge: Edge): number[] {
  return edge.segs.filter((k) => edge.route.segs[k]!.kind === "curve");
}

/** Whether a curve is written with "bend left" or "bend right", so dragging it keeps it symmetric. */
export function isBend(edge: Edge, seg: number): boolean {
  const op = curveOp(edge, edge.route.segs[seg]!);
  const keys = [...(op?.list?.items ?? []), ...edge.path.syntax.items.flatMap((it) => (it.kind === "options" ? it.list.items : []))];
  return keys.some((i) => i.key === "bend left" || i.key === "bend right");
}

/** The curve keys that draw a symmetric bend: "bend left", "bend right=45", with "looseness" if it isn't 1. */
function bendKeys(theta: number, looseness: number): string[] {
  const a = Math.round(Math.abs(theta));
  const side = theta >= 0 ? "bend left" : "bend right";
  const keys = [a === 30 ? side : `${side}=${a}`];
  if (Math.abs(looseness - 1) >= 0.05) keys.push(`looseness=${trimNumber(Math.round(looseness * 10) / 10)}`);
  return keys;
}

/** "out=90, in=180", with one "looseness" or one for each end. */
function outInKeys(out: number, inA: number, l1: number, l2: number): string[] {
  const keys = [`out=${Math.round(norm(out))}`, `in=${Math.round(norm(inA))}`];
  const r1 = Math.round(l1 * 10) / 10;
  const r2 = Math.round(l2 * 10) / 10;
  if (r1 === r2) {
    if (r1 !== 1) keys.push(`looseness=${trimNumber(r1)}`);
  } else {
    if (r1 !== 1) keys.push(`out looseness=${trimNumber(r1)}`);
    if (r2 !== 1) keys.push(`in looseness=${trimNumber(r2)}`);
  }
  return keys;
}

/**
 * The bend that puts the middle of a symmetric curve at `p`: the angle that
 * reaches it at looseness `l0`, and a larger looseness only when even 85°
 * falls short. The angle moves where the curve meets the borders (TikZ's
 * relative mode), which moves the chord, so a few rounds settle it.
 */
function bendForMiddle(layout: PictureLayout, a: RouteStop, b: RouteStop, p: Point, l0: number): { theta: number; looseness: number } {
  const base = angleOf(a.point, b.point);
  const limit = Math.sin(85 / DEG);
  let theta = 0;
  let looseness = l0;
  for (let round = 0; round < 4; round++) {
    const from = endAt(layout, a, base + theta);
    const to = endAt(layout, b, base + 180 - theta);
    const span = SPAN * dist(from, to);
    if (span <= 0) break;
    const chord = angleOf(from, to) / DEG;
    // How far p is from the chord, to its left; the middle of a symmetric curve is 3/4 as far as its control points.
    const need = (-(p.x - from.x) * Math.sin(chord) + (p.y - from.y) * Math.cos(chord)) / 0.75 / span;
    const ratio = need / l0;
    if (Math.abs(ratio) <= limit) {
      theta = Math.asin(ratio) * DEG;
      looseness = l0;
    } else {
      theta = Math.sign(need) * 85;
      looseness = Math.abs(need) / limit;
    }
  }
  return { theta, looseness };
}

/** The out and in angles and loosenesses that put the control points at `c1` and `c2`. */
function outInFor(layout: PictureLayout, a: RouteStop, b: RouteStop, c1: Point, c2: Point): { out: number; in: number; l1: number; l2: number } {
  // A bare node's control point lies on the ray from its centre at the out angle.
  const out = Math.round(angleOf(a.point, c1));
  const inA = Math.round(angleOf(b.point, c2));
  const from = endAt(layout, a, out);
  const to = endAt(layout, b, inA);
  const span = SPAN * dist(from, to) || 1;
  return { out, in: inA, l1: dist(from, c1) / span, l2: dist(to, c2) / span };
}

/** How far a written control point may land from where it was dragged: angles and loosenesses are rounded. */
function tolerance(seg: RouteSeg): number {
  return Math.max(1.5, 0.06 * dist(seg.from, seg.to));
}

export type ControlOutcome = (EditOutcome & { ok: true; form: "bend" | "out-in" | "controls" }) | { ok: false; reason: string };

/**
 * The handles of a curve (D53). A curve written with `to` or `edge` keys has a
 * handle near each end (`end1`, `end2`: only that end's angle changes) and one
 * in the middle (`mid`: the curve stays symmetric). A `.. controls ..` curve
 * has its two control points (`c1`, `c2`).
 */
export type CurveHandle = "c1" | "c2" | "end1" | "end2" | "mid";

/** How a curved segment is written: with keys on `to`/`edge`, or `.. controls ..`. Null if its code isn't understood. */
export function curveForm(edge: Edge, seg: number): "keys" | "controls" | null {
  const s = edge.route.segs[seg];
  const op = s && curveOp(edge, s);
  return op ? (op.kind === "controls" ? "controls" : "keys") : null;
}

/** The point halfway along a curve. */
export function curveMiddle(s: RouteSeg): Point {
  return { x: (s.from.x + 3 * s.c1!.x + 3 * s.c2!.x + s.to.x) / 8, y: (s.from.y + 3 * s.c1!.y + 3 * s.c2!.y + s.to.y) / 8 };
}

/** Whole degrees, snapped to the nearest multiple of 15° when within 3° of it (unless `snap` is off). */
function snapAngle(deg: number, snap: boolean): number {
  const r = Math.round(deg);
  if (!snap) return r;
  const m = Math.round(deg / 15) * 15;
  return Math.abs(deg - m) <= 3 ? m : r;
}

/**
 * Drags one handle of curved segment `seg` to `p` (for `mid`, to where the
 * curve's middle should be). `snap` is off with Alt: bends then go in whole
 * degrees and `out`/`in` don't snap to multiples of 15°.
 * - **`end1`, `end2`:** only that end's angle changes: `out=60` or `in=180`,
 *   edited in place when the curve is written that way, else the curve is
 *   written as `out`/`in` with the loosenesses it had.
 * - **`mid`:** a bend stays a bend, with `looseness` where needed. A curve
 *   written with `out`/`in` keeps its angles and both loosenesses are scaled.
 * - **`c1`, `c2`:** a `.. controls ..` point, rewritten relative to its end.
 */
export function planCurve(text: string, picIndex: number, edgeId: string, seg: number, handle: CurveHandle, p: Point, snap = true): ControlOutcome {
  const { doc, layout, edge } = edgeIn(text, picIndex, edgeId);
  const pic = doc.syntax.pictures[picIndex];
  if (!layout || !edge || !pic) return { ok: false, reason: "There is no such edge." };
  if (edge.lock) return { ok: false, reason: `This edge can't be edited: ${edge.lock.message}.` };
  const s = edge.route.segs[seg];
  if (!s || s.kind !== "curve" || !edge.segs.includes(seg)) return { ok: false, reason: "That isn't a curve of this edge." };
  const op = curveOp(edge, s);
  if (!op) return { ok: false, reason: "This curve's code isn't understood, so it can't be reshaped. Change it in the code." };
  const a = edge.route.stops[s.a]!;
  const b = edge.route.stops[s.b]!;
  const tol = tolerance(s);
  const lands = (want1: Point | null, want2: Point | null) => (r: { segs: RouteSeg[] }) => {
    const n = r.segs[seg];
    if (!n || n.kind !== "curve") return "The curve couldn't be written that way.";
    if ((want1 && dist(n.c1!, want1) > tol) || (want2 && dist(n.c2!, want2) > tol)) return "The curve couldn't be written that way.";
    return null;
  };

  if (op.kind === "controls") {
    if (handle !== "c1" && handle !== "c2") return { ok: false, reason: "Drag this curve's control points to reshape it." };
    const which = handle === "c1" ? 1 : 2;
    // Rewrite that control point, relative to the end it belongs to.
    const items = s.controls ?? [];
    const k = items[which === 1 ? 0 : items.length - 1];
    const it = k !== undefined ? edge.path.syntax.items[k] : undefined;
    if (!it || it.kind !== "coord") return { ok: false, reason: "This curve's control point couldn't be found." };
    const base = which === 1 ? a.point : b.point;
    // A control point written as plain numbers stays that way; anything else becomes relative to its end.
    const plain = !it.coord.relative && /^[\s\d.,+-]+$/.test(it.coord.text);
    const style = relativeStyle(text, pic);
    const t = plain ? absoluteText(edge.route, p, ",") : relativeText(edge.route, { x: p.x - base.x, y: p.y - base.y }, "+", style);
    if (!t) return { ok: false, reason: "The control point couldn't be written." };
    const one = items.length === 1;
    const r = editPath(text, picIndex, edge, { changes: [{ from: it.coord.from, to: it.coord.to, insert: t }], check: lands(which === 1 || one ? p : null, which === 2 || one ? p : null) });
    return r.ok ? { ...r, form: "controls" } : r;
  }
  if (handle === "c1" || handle === "c2") return { ok: false, reason: "Drag this curve's end handles or its middle handle to reshape it." };

  // A "to" or "edge" curve: work out the keys that draw what was dragged.
  const list = op.list;
  if (list && text.slice(list.from, list.to).includes("%")) return { ok: false, reason: "This curve's options have a comment in them; reshape it in the code." };
  const keep = list ? list.items.filter((i) => !CURVE_KEYS.has(i.key)).map((i) => text.slice(i.from, i.to)) : [];
  const write = (keys: string[]): Change => {
    const inner = [...keep, ...keys].join(", ");
    return list ? { from: list.from + 1, to: list.to - 1, insert: inner } : { from: op.item.kind === "keyword" ? op.item.range.to : 0, to: op.item.kind === "keyword" ? op.item.range.to : 0, insert: `[${inner}]` };
  };
  const candidates: Array<{ changes: Change[]; form: "bend" | "out-in"; check: ReturnType<typeof lands> | (() => null) }> = [];
  const c1 = s.c1!;
  const c2 = s.c2!;

  if (handle === "mid") {
    const m0 = curveMiddle(s);
    const dx = p.x - m0.x;
    const dy = p.y - m0.y;
    if (isBend(edge, seg)) {
      const span = SPAN * dist(s.from, s.to);
      const l0 = Math.max(0.1, Math.round((dist(s.from, c1) / (span || 1)) * 10) / 10);
      const bend = bendForMiddle(layout, a, b, p, l0);
      let theta = snap ? Math.round(bend.theta / 5) * 5 : Math.round(bend.theta);
      if (theta === 0) theta = bend.theta >= 0 ? (snap ? 5 : 1) : snap ? -5 : -1;
      candidates.push({ changes: [write(bendKeys(theta, bend.looseness))], form: "bend", check: () => null });
    } else {
      // Scaling both arms by k moves the middle by (k - 1) · 3/8 · (arm 1 + arm 2).
      const o = outInFor(layout, a, b, c1, c2);
      const w = { x: (3 / 8) * (c1.x - s.from.x + c2.x - s.to.x), y: (3 / 8) * (c1.y - s.from.y + c2.y - s.to.y) };
      const ww = w.x * w.x + w.y * w.y;
      const k = Math.max(0.1, ww > 0 ? 1 + (dx * w.x + dy * w.y) / ww : 1);
      candidates.push({ changes: [write(outInKeys(o.out, o.in, o.l1 * k, o.l2 * k))], form: "out-in", check: () => null });
    }
  } else {
    const first = handle === "end1";
    const o = outInFor(layout, a, b, c1, c2);
    const angle = snapAngle(angleOf(first ? a.point : b.point, p), snap);
    const out = first ? angle : o.out;
    const inA = first ? o.in : angle;
    // The curve afterwards: the angle changes, the loosenesses stay.
    const from = endAt(layout, a, out);
    const to = endAt(layout, b, inA);
    const span = SPAN * dist(from, to);
    const want1 = polar(from, out, o.l1 * span);
    const want2 = polar(to, inA, o.l2 * span);
    const keyItem = list && !isBend(edge, seg) && list.items.some((i) => i.key === "out") && list.items.some((i) => i.key === "in") ? list.items.filter((i) => i.key === (first ? "out" : "in")).at(-1) : undefined;
    // Written that way already: change just that value.
    if (keyItem?.valueRange) candidates.push({ changes: [{ from: keyItem.valueRange.from, to: keyItem.valueRange.to, insert: String(Math.round(norm(angle))) }], form: "out-in", check: lands(want1, want2) });
    candidates.push({ changes: [write(outInKeys(out, inA, o.l1, o.l2))], form: "out-in", check: lands(want1, want2) });
  }

  let last: string | null = null;
  for (const c of candidates) {
    const r = editPath(text, picIndex, edge, { changes: c.changes, check: c.check });
    if (r.ok) return { ...r, form: c.form };
    last = r.reason;
  }
  return { ok: false, reason: last ?? "The curve couldn't be written that way." };
}

/** The node at a stop, if it is one. */
export function stopNode(layout: PictureLayout, s: RouteStop): LaidOutNode | undefined {
  return s.node ? layout.nodes.find((n) => n.id === s.node) : undefined;
}

/** Why an edge can't be made curved, or null. */
export function curveBlocker(edge: Edge): string | null {
  if (edge.lock) return "This edge is kept as written.";
  if (edge.mode === "curved") return "It is already curved: drag its control points to shape it.";
  if (!isEdgeOperation(edge)) return edgeMiddle(edge).problem;
  return null;
}
