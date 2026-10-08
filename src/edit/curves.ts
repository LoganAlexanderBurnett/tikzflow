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
 * The bend that puts control point `which` at `p` (the other mirrors it):
 * its angle, from the line between where the curve meets its ends (TikZ's
 * relative mode), and its looseness.
 */
function bendFor(layout: PictureLayout, a: RouteStop, b: RouteStop, which: 1 | 2, p: Point): { theta: number; looseness: number } {
  const base = angleOf(a.point, b.point);
  // The angle decides where the curve meets the borders, which decides the angle: two rounds settle it.
  let theta = which === 1 ? norm(angleOf(a.point, p) - base) : norm(base + 180 - angleOf(b.point, p));
  let looseness = 1;
  for (let round = 0; round < 3; round++) {
    const from = endAt(layout, a, base + theta);
    const to = endAt(layout, b, base + 180 - theta);
    const chord = angleOf(from, to);
    const span = SPAN * dist(from, to);
    theta = which === 1 ? norm(angleOf(from, p) - chord) : norm(chord + 180 - angleOf(to, p));
    looseness = span > 0 ? dist(which === 1 ? from : to, p) / span : 1;
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
 * Moves control point `which` (1 at the start, 2 at the end) of curved
 * segment `seg` to `p`. A curve written with `bend` stays symmetric (the other
 * control point mirrors this one) unless `free`. A `to` or `edge` curve is
 * written as a bend when that draws it, else with `out`/`in`; a
 * `.. controls ..` curve keeps its form, with the control point relative to
 * its end.
 */
export function planControl(text: string, picIndex: number, edgeId: string, seg: number, which: 1 | 2, p: Point, free = false): ControlOutcome {
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

  // A "to" or "edge" curve: work out the control points wanted, then the keys that draw them.
  const symmetric = !free && isBend(edge, seg);
  const list = op.list;
  if (list && text.slice(list.from, list.to).includes("%")) return { ok: false, reason: "This curve's options have a comment in them; reshape it in the code." };
  const keep = list ? list.items.filter((i) => !CURVE_KEYS.has(i.key)).map((i) => text.slice(i.from, i.to)) : [];
  const write = (keys: string[]): Change => {
    const inner = [...keep, ...keys].join(", ");
    return list ? { from: list.from + 1, to: list.to - 1, insert: inner } : { from: op.item.kind === "keyword" ? op.item.range.to : 0, to: op.item.kind === "keyword" ? op.item.range.to : 0, insert: `[${inner}]` };
  };
  const candidates: Array<{ keys: string[]; form: "bend" | "out-in"; check: ReturnType<typeof lands> }> = [];
  if (symmetric) {
    const bend = bendFor(layout, a, b, which, p);
    const theta = Math.round(bend.theta / 5) * 5 || (bend.theta >= 0 ? 5 : -5);
    candidates.push({ keys: bendKeys(theta, bend.looseness), form: "bend", check: () => null });
  } else {
    const c1 = which === 1 ? p : s.c1!;
    const c2 = which === 2 ? p : s.c2!;
    const bend = bendFor(layout, a, b, which, p);
    candidates.push({ keys: bendKeys(Math.round(bend.theta), bend.looseness), form: "bend", check: lands(c1, c2) });
    const o = outInFor(layout, a, b, c1, c2);
    candidates.push({ keys: outInKeys(o.out, o.in, o.l1, o.l2), form: "out-in", check: lands(which === 1 ? c1 : null, which === 2 ? c2 : null) });
  }
  let last: string | null = null;
  for (const c of candidates) {
    const r = editPath(text, picIndex, edge, { changes: [write(c.keys)], check: c.check });
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
