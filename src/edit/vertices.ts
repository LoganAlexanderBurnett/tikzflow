// Vertices (M2b step 4): adding, moving and removing the corners of an edge,
// and "Straighten". Also the helper the orthogonal and curved modes share:
// rewriting the code between an edge's two ends while keeping its labels,
// comments and ends as written.
import { analyzeDocument, layoutDocumentPicture } from "../model/document.ts";
import { type Edge, itemFrom, itemTo } from "../model/edges.ts";
import type { OptionList, PathItemSyntax, Range } from "../model/syntax.ts";
import type { LaidOutNode, PictureLayout, Route, RouteSeg } from "../tikz/layout.ts";
import type { Point } from "../tikz/shapes.ts";
import { type Change, composeChanges } from "./changes.ts";
import { planEdgeToLine } from "./edgeop.ts";
import { editPath, type EditOutcome, findEdge, isPlainStop, POINT_EPS, pointCandidates, type PointForm } from "./edges.ts";
import { fixLabelSides } from "./labels.ts";
import { removeItems } from "./optionEdits.ts";
import { eolNear, indentAt, indentUnit } from "./text.ts";

/** Whole-millimetre rounding, as for every written point (D44). */
const ROUND = Math.SQRT2 * 0.75 * (72.27 / 25.4);

/** Keys that only shape a curve. Straighten removes them; the curved mode writes them. */
export const CURVE_KEYS = new Set([
  "bend left",
  "bend right",
  "bend angle",
  "out",
  "in",
  "relative",
  "looseness",
  "in looseness",
  "out looseness",
  "distance",
  "in distance",
  "out distance",
  "min distance",
  "max distance",
  "in min distance",
  "in max distance",
  "out min distance",
  "out max distance",
  "in control",
  "out control",
  "controls",
]);

// ---------------------------------------------------------------- geometry

/** The point of a straight segment nearest `p`, how far along it is (0–1), and how far away. */
export function projectOnSegment(seg: Pick<RouteSeg, "from" | "to">, p: Point): { point: Point; t: number; dist: number } {
  const dx = seg.to.x - seg.from.x;
  const dy = seg.to.y - seg.from.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - seg.from.x) * dx + (p.y - seg.from.y) * dy) / len2)) : 0;
  const point = { x: seg.from.x + dx * t, y: seg.from.y + dy * t };
  return { point, t, dist: Math.hypot(p.x - point.x, p.y - point.y) };
}

/** The straight segment of `edge` nearest `p` (an index into the route's segments), and the point on it. */
export function nearestLineSegment(edge: Edge, p: Point): { seg: number; point: Point; dist: number } | null {
  let best: { seg: number; point: Point; dist: number } | null = null;
  for (const k of edge.segs) {
    const s = edge.route.segs[k]!;
    if (s.kind !== "line") continue;
    const q = projectOnSegment(s, p);
    if (!best || q.dist < best.dist) best = { seg: k, point: q.point, dist: q.dist };
  }
  return best;
}

/** The stops inside an edge: its corners, in order. */
export function edgeVertices(edge: Edge): number[] {
  return edge.segs.slice(1).map((k) => edge.route.segs[k]!.a);
}

/** Whether an edge is written as an `edge` operation, which joins two points directly. */
export function isEdgeOperation(edge: Edge): boolean {
  return edge.path.id.includes("/edge");
}

// ---------------------------------------------------------------- the code between the ends

export interface EdgeMiddle {
  /** Indices of the path's items between the edge's two ends. */
  items: number[];
  /** From the end of the start's code to the start of the end's code. */
  range: Range;
  /** The node items in the middle (labels, coordinates): every rewrite keeps them. */
  nodes: number[];
  /** Why the middle can't be rewritten, or null. */
  problem: string | null;
}

/** The code between an edge's two ends, sorted out for rewriting. */
export function edgeMiddle(edge: Edge): EdgeMiddle {
  const items = edge.path.syntax.items;
  const a = edge.route.stops[edge.from]!;
  const b = edge.route.stops[edge.to]!;
  const out: EdgeMiddle = { items: [], range: { from: a.range.to, to: b.range.from }, nodes: [], problem: null };
  if (isEdgeOperation(edge) || a.item < 0) {
    out.problem = 'This edge is written as an "edge" operation, which joins its two ends directly.';
    return out;
  }
  for (let k = a.item + 1; k < b.item; k++) {
    const it = items[k]!;
    out.items.push(k);
    const prev = items[k - 1];
    if (it.kind === "node") out.nodes.push(k);
    else if (it.kind === "unknown") out.problem ??= "Part of this edge's code isn't understood, so it can't be rewritten. Change it in the code.";
    else if (it.kind === "keyword" && it.word === "edge") out.problem ??= 'An "edge" operation starts here, and rewriting the code around it would lose it. Change it in the code.';
    else if (it.kind === "options" && !(prev?.kind === "keyword" && (prev.word === "to" || prev.word === "edge"))) {
      out.problem ??= "This edge's code has options in the middle, which apply to the whole path, so it can't be rewritten safely. Change it in the code.";
    }
  }
  return out;
}

/** One operation of a rewritten edge: "--", "-|", "to[bend left]", …, and the point it goes to (none for the last, which is the edge's end). */
export interface Step {
  op: string;
  target?: string;
}

/** "%" comments in `text` between `from` and `to`, outside `skip` ranges. */
function commentsIn(text: string, from: number, to: number, skip: readonly Range[]): string[] {
  const out: string[] = [];
  for (let i = from; i < to; i++) {
    const inside = skip.find((r) => i >= r.from && i < r.to);
    if (inside) {
      i = inside.to - 1;
      continue;
    }
    if (text[i] === "%" && text[i - 1] !== "\\") {
      let e = text.indexOf("\n", i);
      if (e < 0 || e > to) e = to;
      out.push(text.slice(i, e).replace(/\r$/, ""));
      i = e;
    }
  }
  return out;
}

/**
 * The new code between an edge's ends: its steps, with the middle's nodes
 * (labels) after the step `place` gives each, and its comments kept before
 * the end's code. Whitespace at either end is kept when it holds a line break.
 */
function middleText(text: string, edge: Edge, mid: EdgeMiddle, steps: readonly Step[], place: (item: number) => number): string {
  const items = edge.path.syntax.items;
  const byStep = steps.map(() => [] as string[]);
  for (const k of mid.nodes) {
    const it = items[k]!;
    byStep[Math.min(steps.length - 1, Math.max(0, place(k)))]!.push(text.slice(itemFrom(it), itemTo(it)));
  }
  const parts: string[] = [];
  steps.forEach((s, i) => {
    parts.push(s.op, ...byStep[i]!);
    if (i < steps.length - 1) parts.push(s.target!);
  });
  const raw = text.slice(mid.range.from, mid.range.to);
  const lead = /^\s*/.exec(raw)![0];
  const trail = /\s*$/.exec(raw)![0];
  const nodeRanges = mid.nodes.map((k) => ({ from: itemFrom(items[k]!), to: itemTo(items[k]!) }));
  const comments = commentsIn(text, mid.range.from, mid.range.to, nodeRanges);
  const body = parts.join(" ");
  // The spacing around the operations stays as written ("(base)  |- (stop)").
  if (comments.length) {
    const eol = eolNear(text, mid.range.from);
    const indent = indentAt(text, edge.path.syntax.from) + indentUnit(text);
    return `${lead}${body}${comments.map((c) => ` ${c}${eol}${indent}`).join("")}`;
  }
  return `${lead}${body}${trail}`;
}

/** A new text for one of an edge's ends, and where it must land. */
export interface EndWrite {
  text: string;
  want: Point;
  tolerance?: number;
}

/**
 * Replaces the code between `edge`'s ends with `steps`, keeping its labels
 * (each after the step `place` gives it), its comments, and both ends as
 * written unless `ends` rewrites them. `wants` are where the new points (by
 * step) must land. The points after the edge stay where they were.
 */
export function rewriteMiddle(
  text: string,
  picIndex: number,
  edge: Edge,
  steps: readonly Step[],
  place: (item: number) => number,
  wants: ReadonlyArray<{ step: number; want: Point; tolerance?: number }> = [],
  check?: (route: Route, layout: PictureLayout) => string | null,
  ends: { from?: EndWrite; to?: EndWrite } = {},
): EditOutcome {
  const mid = edgeMiddle(edge);
  if (mid.problem) return { ok: false, reason: mid.problem };
  const insert = middleText(text, edge, mid, steps, place);
  const route = edge.route;
  const changes: Change[] = [];
  if (insert !== text.slice(mid.range.from, mid.range.to)) changes.push({ from: mid.range.from, to: mid.range.to, insert });
  const a = route.stops[edge.from]!;
  const b = route.stops[edge.to]!;
  if (ends.from && ends.from.text !== text.slice(a.range.from, a.range.to)) changes.push({ from: a.range.from, to: a.range.to, insert: ends.from.text });
  if (ends.to && ends.to.text !== text.slice(b.range.from, b.range.to)) changes.push({ from: b.range.from, to: b.range.to, insert: ends.to.text });
  if (!changes.length) return { ok: false, reason: "Nothing to change: the edge is already written that way." };
  const delta = steps.length - (edge.to - edge.from);
  const endWants = [
    ...(ends.from ? [{ stop: edge.from, want: ends.from.want, tolerance: ends.from.tolerance ?? POINT_EPS }] : []),
    ...(ends.to ? [{ stop: edge.to + delta, want: ends.to.want, tolerance: ends.to.tolerance ?? POINT_EPS }] : []),
  ];
  return editPath(text, picIndex, edge, {
    changes,
    map: (k) => (k === edge.from && ends.from ? null : k === edge.to && ends.to ? null : k <= edge.from ? k : k >= edge.to ? k + delta : null),
    stops: route.stops.length + delta,
    segs: route.segs.length - edge.segs.length + steps.length,
    wants: [...wants.map((w) => ({ stop: edge.from + 1 + w.step, want: w.want, ...(w.tolerance !== undefined ? { tolerance: w.tolerance } : {}) })), ...endWants],
    ...(check ? { check } : {}),
  });
}

/** The laid-out label for a node item of a path, if it is one. */
export function labelOfItem(edge: Edge, item: number): LaidOutNode | undefined {
  const it = edge.path.syntax.items[item];
  return it?.kind === "node" ? edge.labels.find((n) => n.syntax.from === it.node.from) : undefined;
}

// ---------------------------------------------------------------- deleting code

const isHSpace = (ch: string | undefined) => ch === " " || ch === "\t";

/** Deletes `ranges`, each with the spaces after it; ranges with only spaces between merge. */
function deletions(text: string, ranges: readonly Range[]): Change[] {
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  const out: Change[] = [];
  for (const r of sorted) {
    let to = r.to;
    while (isHSpace(text[to])) to++;
    const prev = out[out.length - 1];
    if (prev && /^[ \t]*$/.test(text.slice(prev.to, r.from))) prev.to = Math.max(prev.to, to);
    else out.push({ from: r.from, to, insert: "" });
  }
  return out;
}

function itemRange(it: PathItemSyntax): Range {
  return { from: itemFrom(it), to: itemTo(it) };
}

/** Whether an item is a plain operation ("--", "|-", "-|") with nothing attached. */
function plainOp(it: PathItemSyntax | undefined): boolean {
  return it?.kind === "op" && it.op !== "..";
}

// ---------------------------------------------------------------- adding, removing, straightening

export type VertexOutcome = (EditOutcome & { ok: true; form: PointForm; stop: number }) | { ok: false; reason: string };

function edgeIn(text: string, picIndex: number, edgeId: string) {
  const doc = analyzeDocument(text);
  const layout = layoutDocumentPicture(doc, picIndex);
  const edge = layout && findEdge(layout, edgeId);
  return { doc, layout, edge };
}

/**
 * Adds a corner to segment `seg` (a route segment of the edge) at `p`. The
 * labels on that segment stay on the half they are nearer. The new point is
 * written in emitter order, like a moved waypoint (D47).
 */
export function planAddVertex(text: string, picIndex: number, edgeId: string, seg: number, p: Point): VertexOutcome {
  const { doc, layout, edge } = edgeIn(text, picIndex, edgeId);
  if (!layout || !edge) return { ok: false, reason: "There is no such edge." };
  if (edge.lock) return { ok: false, reason: `This edge can't be edited: ${edge.lock.message}.` };
  if (!edge.segs.includes(seg)) return { ok: false, reason: "That isn't part of this edge." };
  const s = edge.route.segs[seg]!;
  if (s.kind === "curve") return { ok: false, reason: "Corners go on straight edges: straighten this one first." };
  if (s.kind !== "line") return { ok: false, reason: "This part is orthogonal: drag the segment to slide it instead." };
  if (isEdgeOperation(edge)) {
    // An "edge" operation joins its ends directly: it becomes a "--" first, in the same edit (D53).
    const c = planEdgeToLine(text, picIndex, edgeId);
    if (!c.ok) return { ok: false, reason: c.reason };
    const ne = findEdge(c.layout, c.edgeId)!;
    const r = planAddVertex(c.text, picIndex, c.edgeId, ne.segs[0]!, p);
    if (!r.ok) return r;
    const note = `converted the "edge" operation to "--"${c.moved ? " in a \\draw of its own" : ""}`;
    return { ...r, changes: composeChanges(text, c.changes, r.changes), notes: [note, ...r.notes], edgeId: c.edgeId };
  }
  const route = edge.route;
  const items = edge.path.syntax.items;
  const a = route.stops[s.a]!;
  const b = route.stops[s.b]!;
  const opFrom = itemFrom(items[s.op]!);
  // Labels on this segment stay on the half they are nearer.
  const t = projectOnSegment(s, p).t;
  const onSeg = edge.labels.filter((n) => n.syntax.from > opFrom && n.syntax.to <= b.range.from);
  const early = onSeg.filter((n) => projectOnSegment(s, n.shape.center).t < t).length;
  const beforeEnd = !onSeg.length || early * 2 >= onSeg.length;
  const plain = isPlainStop(a) || isPlainStop(b);
  let last: string | null = null;
  for (const c of pointCandidates(doc, picIndex, layout, edge, s.a, p, undefined, plain)) {
    // "(a) -- node {x} P -- (b)" keeps the labels on a → P; "(a) -- P -- node {x} (b)" on P → b.
    const change: Change = beforeEnd ? { from: b.range.from, to: b.range.from, insert: `${c.text} -- ` } : { from: a.range.to, to: a.range.to, insert: ` -- ${c.text}` };
    const r = editPath(text, picIndex, edge, {
      changes: [change],
      map: (k) => (k <= s.a ? k : k + 1),
      stops: route.stops.length + 1,
      segs: route.segs.length + 1,
      wants: [{ stop: s.a + 1, want: p, tolerance: c.form === "perpendicular" ? POINT_EPS : ROUND }],
    });
    if (r.ok) return { ...r, form: c.form, stop: s.a + 1 };
    last = r.reason;
  }
  return { ok: false, reason: last ?? "The corner couldn't be written there." };
}

/**
 * Removes corner `stop` of the edge: the point and the operation after it go,
 * so "(a) -- (1,1) -- (b)" becomes "(a) -- (b)". Labels and other nodes stay.
 */
export function planRemoveVertex(text: string, picIndex: number, edgeId: string, stop: number): EditOutcome {
  const { layout, edge } = edgeIn(text, picIndex, edgeId);
  if (!layout || !edge) return { ok: false, reason: "There is no such edge." };
  if (edge.lock) return { ok: false, reason: `This edge can't be edited: ${edge.lock.message}.` };
  if (!edgeVertices(edge).includes(stop)) return { ok: false, reason: "That isn't a corner of this edge." };
  const route = edge.route;
  const items = edge.path.syntax.items;
  const inSeg = route.segs[edge.segs.find((k) => route.segs[k]!.b === stop)!]!;
  const outSeg = route.segs[edge.segs.find((k) => route.segs[k]!.a === stop)!]!;
  const p = route.stops[stop]!;
  const o1 = items[inSeg.op];
  const o2 = items[outSeg.op];
  let ranges: Range[];
  if (plainOp(o2)) ranges = [p.range, itemRange(o2!)];
  else if (plainOp(o1) && !items.slice(inSeg.op + 1, p.item).some((it) => it.kind === "node")) ranges = [itemRange(o1!), p.range];
  else return { ok: false, reason: "This corner joins a curve: straighten the edge first, or change it in the code." };
  return editPath(text, picIndex, edge, {
    changes: deletions(text, ranges),
    map: (k) => (k === stop ? null : k > stop ? k - 1 : k),
    stops: route.stops.length - 1,
    segs: route.segs.length - 1,
  });
}

/** The option list after an operation item ("to[...]", "edge[...]"), if any. */
export function opOptions(items: readonly PathItemSyntax[], op: number): OptionList | undefined {
  const next = items[op + 1];
  return next?.kind === "options" ? next.list : undefined;
}

/** "to[red]" from "to[bend left, red]": the operation without its curve keys, or "--" if nothing else is left. */
function straightOp(text: string, it: PathItemSyntax, list: OptionList | undefined): string {
  if (it.kind === "op" && it.op === "--") return "--";
  if (it.kind === "keyword" && it.word === "to" && list) {
    const keep = list.items.filter((i) => !CURVE_KEYS.has(i.key)).map((i) => text.slice(i.from, i.to));
    return keep.length ? `to[${keep.join(", ")}]` : "--";
  }
  return "--";
}

/**
 * Straighten: the edge goes straight from end to end, as a plain "--"
 * (D45). Its corners and curve go; its labels, comments and ends stay. An
 * `edge` operation loses its curve keys instead.
 */
export function planStraighten(text: string, picIndex: number, edgeId: string): EditOutcome {
  return fixLabelSides(text, picIndex, edgeId, straighten(text, picIndex, edgeId));
}

function straighten(text: string, picIndex: number, edgeId: string): EditOutcome {
  const { layout, edge } = edgeIn(text, picIndex, edgeId);
  if (!layout || !edge) return { ok: false, reason: "There is no such edge." };
  if (edge.lock) return { ok: false, reason: `This edge can't be edited: ${edge.lock.message}.` };
  const route = edge.route;
  const straight = edge.segs.length === 1 && route.segs[edge.segs[0]!]!.kind === "line";
  if (straight) return { ok: false, reason: "It is already straight." };
  const items = edge.path.syntax.items;
  if (isEdgeOperation(edge)) {
    // The path's range starts at its "edge" keyword.
    const op = items.findIndex((it) => it.kind === "keyword" && it.word === "edge" && itemFrom(it) === edge.path.range.from);
    const list = op >= 0 ? opOptions(items, op) : undefined;
    const curve = list?.items.filter((i) => CURVE_KEYS.has(i.key)) ?? [];
    if (!list || !curve.length) return { ok: false, reason: "This edge's curve comes from a style; change it in the code." };
    return editPath(text, picIndex, edge, { changes: removeItems(text, list, curve), check: (r) => (r.segs[0]?.kind === "line" ? null : "The edge would still be curved.") });
  }
  const first = route.segs[edge.segs[0]!]!;
  const op = straightOp(text, items[first.op]!, opOptions(items, first.op));
  return rewriteMiddle(text, picIndex, edge, [{ op }], () => 0, [], (r) => (r.segs[edge.segs[0]!]?.kind === "line" ? null : "The edge would still be curved: its curve comes from a style. Change it in the code."));
}
