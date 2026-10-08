// Editing edges (M2b): the shared core every edge edit is built from.
//
// An edge edit replaces the text of some of its path's stops (and, in later
// steps, operations) and nothing else. Points are written in the emitter
// order of SPEC.md, as far as it applies to a point on a path:
//   1. a node's anchor, for an end ("(b.west)"), or the bare name for its border;
//   2. a perpendicular coordinate when the point lines up with two nodes ("(a |- b)");
//   3. relative to the point before it ("++(8mm,0)"), so it follows its nodes;
//   4. plain coordinates, as a last resort or in pictures written that way.
// Every edit is checked by laying the patched text out again: the points it
// writes land where they should (to the millimetre), every other point of
// the path stays exactly where it was, and nothing else in the picture moves.
import { analyzeDocument, type DocumentModel, layoutDocumentPicture } from "../model/document.ts";
import { type Edge, pictureEdges } from "../model/edges.ts";
import type { PictureSyntax, Range } from "../model/syntax.ts";
import type { LaidOutNode, LaidOutPath, PictureLayout, Route, RouteStop } from "../tikz/layout.ts";
import { anchorPoint, type Point } from "../tikz/shapes.ts";
import { applyLinear, applyMatrix, invert } from "../tikz/state.ts";
import { CM, PT_PER_UNIT, trimNumber } from "../tikz/units.ts";
import { applyChanges, type Change, composeChanges } from "./changes.ts";
import { afterTopItem, insertStatements, isTopLevelItem, nodeAnchor, pathAnchor } from "./insert.ts";
import { lineEnd, lineStart, restOfLineBlank } from "./text.ts";
import { nameForUnnamed, nameNodeChange, nameStyle, takenNames } from "./names.ts";
import type { Guide } from "./snap.ts";
import { definedStyleNames, nodeStyles, styleSites } from "./styles.ts";

const MM = PT_PER_UNIT.mm!;
/** How far an alignment may be off and still count, in pt. */
export const POINT_EPS = 0.5;
/** Written points are rounded to whole millimetres (D44), so they may land this far off. */
const ROUND_TOLERANCE = Math.SQRT2 * 0.75 * MM;
/** Points the edit doesn't write must stay exactly where they were. */
const KEEP_TOLERANCE = 0.05;
/** Relative points rewritten to stay in place are written to 0.1 mm, so they land within this. */
const HOLD_TOLERANCE = 0.06 * MM;
const SIMPLE_NAME = /^[A-Za-z0-9_\-:]+$/;

/** `edgeId` is the edge's id afterwards when the edit moved it (an "edge" operation turned into a line of its own). */
export type EditOutcome = { ok: true; changes: Change[]; text: string; layout: PictureLayout; notes: string[]; edgeId?: string } | { ok: false; reason: string };

/** The edge with id `id`, or undefined. */
export function findEdge(layout: PictureLayout, id: string): Edge | undefined {
  return pictureEdges(layout).find((e) => e.id === id);
}

/** The path with id `id` after an edit inside it: its position in the text doesn't change. */
function pathAfter(layout: PictureLayout, id: string): LaidOutPath | undefined {
  return layout.paths.find((p) => p.id === id);
}

// ---------------------------------------------------------------- writing points

/** "8mm", "1.5cm", "0": a length in whole millimetres, as a person would write it. */
export function formatLength(pt: number): string {
  const mm = Math.round(pt / MM);
  if (mm === 0) return "0";
  if (Math.abs(mm) < 10) return `${mm}mm`;
  return `${trimNumber(mm / 10)}cm`;
}

/** How a picture writes relative points: with units ("++(5mm,0)") or plain numbers ("++(0.5,0)"). */
export function relativeStyle(text: string, pic: PictureSyntax): "dims" | "plain" {
  let dims = 0;
  let plain = 0;
  for (const m of text.slice(pic.from, pic.to).matchAll(/\+\+?\s*\(([^()]*)\)/g)) {
    if (!/,/.test(m[1]!)) continue;
    if (/\d\s*(pt|cm|mm|in|bp|em|ex)\b/.test(m[1]!)) dims++;
    else if (/^[\s\d.,+-]+$/.test(m[1]!)) plain++;
  }
  return plain > dims ? "plain" : "dims";
}

/** Whether the frame's x and y units are the plain 1 cm axes, so plain numbers mean centimetres. */
function unitAxes(route: Route): { x: number; y: number } | null {
  const { xUnit, yUnit } = route.frame;
  if (Math.abs(xUnit[1]) > 1e-9 || Math.abs(yUnit[0]) > 1e-9 || xUnit[0] <= 0 || yUnit[1] <= 0) return null;
  return { x: xUnit[0], y: yUnit[1] };
}

/**
 * "++(8mm,-3mm)" or "++(0.8,-0.3)": a relative point for an offset in canvas
 * pt, rounded to `step` millimetres (whole millimetres unless a point is being
 * held where it was).
 */
export function relativeText(route: Route, offset: Point, prefix: "+" | "++", style: "dims" | "plain", step = 1): string | null {
  const inv = invert(route.frame.matrix);
  if (!inv) return null;
  const [lx, ly] = applyLinear(inv, offset.x, offset.y);
  const mm = (v: number) => Math.round(v / MM / step) * step;
  const axes = unitAxes(route);
  if (style === "plain" && axes && Math.abs(axes.x - CM) < 1e-6 && Math.abs(axes.y - CM) < 1e-6) {
    const cm = (v: number) => trimNumber(mm(v) / 10);
    return `${prefix}(${cm(lx)},${cm(ly)})`;
  }
  const len = (v: number) => {
    const m = mm(v);
    if (Math.abs(m) < 1e-9) return "0";
    return Math.abs(m) < 10 ? `${trimNumber(m)}mm` : `${trimNumber(m / 10)}cm`;
  };
  return `${prefix}(${len(lx)},${len(ly)})`;
}

/** "(2.5,-1)": plain coordinates in the path's own units, to 0.01 of a unit. */
export function absoluteText(route: Route, p: Point, sep: string): string | null {
  const inv = invert(route.frame.matrix);
  const axes = unitAxes(route);
  if (!inv) return null;
  const [lx, ly] = applyMatrix(inv, p.x, p.y);
  if (!axes) return `(${formatLength(lx)}${sep}${formatLength(ly)})`;
  const fmt = (v: number, unit: number) => trimNumber(Math.round((v / unit) * 100) / 100);
  return `(${fmt(lx, axes.x)}${sep}${fmt(ly, axes.y)})`;
}

/** Nodes a point on `path` may refer to by name: named, with a shape, and defined before the path. */
export function pathReferences(layout: PictureLayout, path: LaidOutPath): LaidOutNode[] {
  const latest = new Map<string, LaidOutNode>();
  for (const n of layout.nodes) {
    if (n.statement.from >= path.syntax.from) break;
    if (n.name && !n.implicitName && SIMPLE_NAME.test(n.name) && n.kind === "statement") latest.set(n.name, n);
  }
  return [...latest.values()];
}

/** The x (centre, east, west) and y (centre, north, south) lines of a node a point can line up with. */
export function nodeLines(n: LaidOutNode): { xs: Array<{ at: number; ref: string }>; ys: Array<{ at: number; ref: string }> } {
  const c = n.shape.center;
  const at = (a: string) => anchorPoint(n.shape, a);
  const name = n.name!;
  const xs = [{ at: c.x, ref: name }];
  const ys = [{ at: c.y, ref: name }];
  for (const a of ["east", "west"]) {
    const p = at(a);
    if (p && Math.abs(p.x - c.x) > POINT_EPS) xs.push({ at: p.x, ref: `${name}.${a}` });
  }
  for (const a of ["north", "south"]) {
    const p = at(a);
    if (p && Math.abs(p.y - c.y) > POINT_EPS) ys.push({ at: p.y, ref: `${name}.${a}` });
  }
  return { xs, ys };
}

/** "(a |- b)" when `p` has the x of a node line and the y of another node's, or null. */
export function perpendicularText(layout: PictureLayout, path: LaidOutPath, p: Point, prefer: readonly string[] = []): string | null {
  const refs = pathReferences(layout, path);
  // Ends of the edge first, then nearer nodes; centres before sides.
  const rank = (n: LaidOutNode) => (prefer.includes(n.id) ? 0 : 1) * 1e6 + Math.hypot(n.shape.center.x - p.x, n.shape.center.y - p.y);
  const sorted = [...refs].sort((a, b) => rank(a) - rank(b));
  let x: { ref: string; node: string } | null = null;
  let y: { ref: string; node: string } | null = null;
  for (const n of sorted) {
    const lines = nodeLines(n);
    if (!x) {
      const hit = lines.xs.find((l) => Math.abs(l.at - p.x) <= POINT_EPS);
      if (hit) x = { ref: hit.ref, node: n.id };
    }
    if (!y) {
      const hit = lines.ys.find((l) => Math.abs(l.at - p.y) <= POINT_EPS);
      if (hit) y = { ref: hit.ref, node: n.id };
    }
  }
  if (!x || !y || x.node === y.node) return null;
  return `(${x.ref} |- ${y.ref})`;
}

/** Where a relative point at stop `index` of `route` is measured from: the last point not written with "+". */
export function relativeBase(route: Route, index: number): Point | null {
  for (let k = index - 1; k >= 0; k--) {
    const s = route.stops[k]!;
    if (s.relative !== "+") return s.point;
  }
  return null;
}

export type PointForm = "perpendicular" | "relative" | "absolute";

export interface PointCandidate {
  /** The text for the stop's whole range, e.g. "++(8mm,0)" or "(a |- b)". */
  text: string;
  form: PointForm;
}

/**
 * Ways to write a waypoint of `edge` (stop `index` of its route) at `p`, best
 * first. A waypoint is never written as a node's anchor: the path would then
 * pass through that node, which reads as two edges. A point written with
 * plain numbers keeps them unless it lines up with nodes, so plain-coordinate
 * pictures stay that way (as for nodes, D24).
 */
export function waypointCandidates(doc: DocumentModel, picIndex: number, layout: PictureLayout, edge: Edge, index: number, p: Point): PointCandidate[] {
  return pointCandidates(doc, picIndex, layout, edge, index - 1, p, edge.route.stops[index]);
}

/** Whether a stop is written as plain numbers, "(2,1)". */
export function isPlainStop(s: RouteStop | undefined): boolean {
  return !!s && !s.relative && !s.node && /^[\s\d.,+-]+$/.test(s.text);
}

/**
 * Ways to write a point at `p` that comes right after stop `after` of the
 * edge's route, best first. `replacing` is the stop it rewrites, if any: a
 * "+" stays "+", and plain numbers stay plain. A new point is written with
 * plain numbers when the points around it are (`plain`).
 */
export function pointCandidates(
  doc: DocumentModel,
  picIndex: number,
  layout: PictureLayout,
  edge: Edge,
  after: number,
  p: Point,
  replacing?: RouteStop,
  plain = false,
): PointCandidate[] {
  const route = edge.route;
  const pic = doc.syntax.pictures[picIndex]!;
  const out: PointCandidate[] = [];
  const ends = [edge.source, edge.target].filter((x): x is string => !!x);
  const perp = perpendicularText(layout, edge.path, p, ends);
  if (perp) out.push({ text: perp, form: "perpendicular" });
  const base = relativeBase(route, after + 1);
  const relative = base && relativeText(route, { x: p.x - base.x, y: p.y - base.y }, replacing?.relative ?? "++", relativeStyle(doc.text, pic));
  const sep = replacing && /,\s/.test(replacing.text) ? ", " : ",";
  const absolute = absoluteText(route, p, sep);
  if (replacing ? isPlainStop(replacing) : plain) {
    if (absolute) out.push({ text: absolute, form: "absolute" });
    return out;
  }
  if (relative) out.push({ text: relative, form: "relative" });
  if (absolute && !replacing?.relative) out.push({ text: absolute, form: "absolute" });
  return out;
}

// ---------------------------------------------------------------- checking

/**
 * Lays out `changes` applied to `text` and checks the edit stayed inside path
 * `pathId`: no new syntax errors, every node where it was, every other path
 * drawn as before. Returns the new layout and path, or why not.
 */
function layoutAfter(
  text: string,
  picIndex: number,
  before: { doc: DocumentModel; layout: PictureLayout },
  pathId: string,
  changes: readonly Change[],
): { text: string; layout: PictureLayout; path: LaidOutPath } | { reason: string } {
  const next = applyChanges(text, changes);
  const doc = analyzeDocument(next);
  if (doc.errors.length > before.doc.errors.length) return { reason: "That would break the code around the edge, so it wasn't written." };
  const layout = layoutDocumentPicture(doc, picIndex);
  const path = layout && pathAfter(layout, pathId);
  if (!layout || !path?.route) return { reason: "The edge couldn't be found after the edit, so it wasn't written." };
  if (layout.nodes.length !== before.layout.nodes.length) return { reason: "That would change the picture's nodes, so it wasn't written." };
  for (let i = 0; i < layout.nodes.length; i++) {
    // Coordinates placed on the path itself move with it.
    if (layout.nodes[i]!.statement.from === path.syntax.from) continue;
    const a = before.layout.nodes[i]!.shape.center;
    const b = layout.nodes[i]!.shape.center;
    if (Math.hypot(a.x - b.x, a.y - b.y) > KEEP_TOLERANCE) return { reason: `That would move ${layout.nodes[i]!.name ?? "a node"}, so it wasn't written.` };
  }
  const others = (l: PictureLayout, id: string) => l.paths.filter((p) => p.id !== id && !p.id.startsWith(`${id}/`)).map((p) => p.d);
  const was = others(before.layout, pathId);
  const now = others(layout, pathId);
  if (was.length !== now.length || was.some((d, i) => d !== now[i])) return { reason: "That would change another path, so it wasn't written." };
  return { text: next, layout, path };
}

/** A point an edit leaves alone: where it must stay, and its code's range in the text before the edit. */
interface Kept {
  point: Point;
  range: Range;
}

/**
 * Rewrites relative points after the edited ones that moved because the point
 * they are measured from moved, so they stay where they were (D45: editing
 * one point leaves the rest of the path alone). `keep` maps stop indices
 * after the edit to the points that must stay; `stops` is how many stops the
 * path has after the edit.
 */
function holdRelatives(
  text: string,
  picIndex: number,
  before: { doc: DocumentModel; layout: PictureLayout },
  pathId: string,
  changes: Change[],
  keep: ReadonlyMap<number, Kept>,
  style: "dims" | "plain",
  stops: number,
): { changes: Change[]; text: string; layout: PictureLayout; path: LaidOutPath; held: Set<number> } | { reason: string } {
  let current = changes;
  const held = new Set<number>();
  for (let round = 0; round < 16; round++) {
    const after = layoutAfter(text, picIndex, before, pathId, current);
    if ("reason" in after) return after;
    const route = after.path.route!;
    const done = { ...after, changes: current, held };
    if (route.stops.length !== stops) return done;
    let fixed = false;
    for (const [k, want] of keep) {
      const s = route.stops[k]!;
      const off = Math.hypot(s.point.x - want.point.x, s.point.y - want.point.y);
      if (off <= (held.has(k) ? HOLD_TOLERANCE : KEEP_TOLERANCE)) continue;
      // Only a relative point can be held by rewriting it, once; anything else moved for another reason.
      const base = relativeBase(route, k);
      if (!s.relative || !base || held.has(k)) return done;
      const t = relativeText(route, { x: want.point.x - base.x, y: want.point.y - base.y }, s.relative, style, 0.1);
      if (!t) return done;
      current = [...current, { from: want.range.from, to: want.range.to, insert: t }];
      held.add(k);
      fixed = true;
      break;
    }
    if (!fixed) return done;
  }
  return { reason: "The points after this one couldn't be kept in place." };
}

/** An edit inside one path, for `editPath`. */
export interface PathEdit {
  changes: Change[];
  /** Where each stop of the route goes: its index after the edit, or null if the edit removes or rewrites it. Default: unchanged. */
  map?: (old: number) => number | null;
  /** How many stops and segments the path has after the edit (default: as many as before). */
  stops?: number;
  segs?: number;
  /** Stops (indices after the edit) that must land at a point, within `tolerance` (default: whole-millimetre rounding). */
  wants?: ReadonlyArray<{ stop: number; want: Point; tolerance?: number }>;
  /** A last check on the result: why it is wrong, or null. */
  check?: (route: Route, layout: PictureLayout) => string | null;
}

/**
 * Applies an edit inside `edge`'s path, holds the path's other points in
 * place, and checks the result: no new syntax errors, nothing else in the
 * picture moved, the path has the stops and segments it should, every point
 * the edit leaves alone is where it was, and every point it writes lands
 * where it should.
 */
export function editPath(text: string, picIndex: number, edge: Edge, edit: PathEdit): EditOutcome {
  const doc = analyzeDocument(text);
  const layout = layoutDocumentPicture(doc, picIndex);
  const pic = doc.syntax.pictures[picIndex];
  if (!layout || !pic) return { ok: false, reason: "There is no picture." };
  if (edge.lock) return { ok: false, reason: `This edge can't be edited: ${edge.lock.message}.` };
  const route = edge.route;
  const map = edit.map ?? ((k: number) => k);
  const keep = new Map<number, Kept>();
  route.stops.forEach((s, k) => {
    const n = map(k);
    if (n !== null) keep.set(n, { point: s.point, range: s.range });
  });
  const stops = edit.stops ?? route.stops.length;
  const before = { doc, layout };
  const held = holdRelatives(text, picIndex, before, edge.path.id, edit.changes, keep, relativeStyle(text, pic), stops);
  if ("reason" in held) return { ok: false, reason: held.reason };
  const newRoute = held.path.route!;
  if (newRoute.stops.length !== stops || newRoute.segs.length !== (edit.segs ?? route.segs.length)) return { ok: false, reason: "That would change how the path is put together, so it wasn't written." };
  for (const [k, want] of keep) {
    const s = newRoute.stops[k]!;
    if (Math.hypot(s.point.x - want.point.x, s.point.y - want.point.y) > (held.held.has(k) ? HOLD_TOLERANCE : KEEP_TOLERANCE)) return { ok: false, reason: "That would move other points of the path, so it wasn't written." };
  }
  for (const w of edit.wants ?? []) {
    const s = newRoute.stops[w.stop]!;
    if (Math.hypot(s.point.x - w.want.x, s.point.y - w.want.y) > (w.tolerance ?? ROUND_TOLERANCE)) return { ok: false, reason: "That point couldn't be written where it was dropped." };
  }
  const problem = edit.check?.(newRoute, held.layout);
  if (problem) return { ok: false, reason: problem };
  return { ok: true, changes: held.changes, text: held.text, layout: held.layout, notes: [] };
}

export interface StopWrite {
  /** Index into the route's stops. */
  stop: number;
  /** The text for the stop's whole range. */
  text: string;
  /** Where the stop should land, or undefined to check only that it still exists. */
  want?: Point;
  /** How far off it may land (default: whole-millimetre rounding). */
  tolerance?: number;
}

/**
 * Replaces stops of `edge`'s path with new text, holds the path's other
 * points in place, and checks the result. The stop a `\node ... edge` path
 * starts from is the node itself and can't be rewritten here.
 */
export function writeStops(text: string, picIndex: number, edge: Edge, writes: readonly StopWrite[]): EditOutcome {
  const changes: Change[] = [];
  for (const w of writes) {
    const s = edge.route.stops[w.stop];
    if (!s || s.item < 0) return { ok: false, reason: "This end is the node the path starts from; change it in the code." };
    changes.push({ from: s.range.from, to: s.range.to, insert: w.text });
  }
  return editPath(text, picIndex, edge, {
    changes,
    map: (k) => (writes.some((w) => w.stop === k) ? null : k),
    wants: writes.flatMap((w) => (w.want ? [{ stop: w.stop, want: w.want, ...(w.tolerance !== undefined ? { tolerance: w.tolerance } : {}) }] : [])),
  });
}

/**
 * Moves waypoint `index` (a route stop strictly inside `edge`) to `p`,
 * written in the first form that lands there. Returns the edit and the form.
 */
export function planWaypoint(text: string, picIndex: number, edgeId: string, index: number, p: Point): (EditOutcome & { ok: true; form: PointForm }) | { ok: false; reason: string } {
  const doc = analyzeDocument(text);
  const layout = layoutDocumentPicture(doc, picIndex);
  const edge = layout && findEdge(layout, edgeId);
  if (!layout || !edge) return { ok: false, reason: "There is no such edge." };
  const inside = edge.segs.slice(1).map((k) => edge.route.segs[k]!.a);
  if (!inside.includes(index)) return { ok: false, reason: "That isn't a point inside this edge." };
  let last: string | null = null;
  for (const c of waypointCandidates(doc, picIndex, layout, edge, index, p)) {
    const r = writeStops(text, picIndex, edge, [{ stop: index, text: c.text, want: p, tolerance: c.form === "perpendicular" ? POINT_EPS : ROUND_TOLERANCE }]);
    if (r.ok) return { ...r, form: c.form };
    last = r.reason;
  }
  return { ok: false, reason: last ?? "That point couldn't be written." };
}

// ---------------------------------------------------------------- snapping

export interface PointSnap {
  point: Point;
  guides: Guide[];
}

/**
 * Snaps a point being dragged on `edge` (route stop `index`, or a new point
 * between stops `index - 1` and `index`): to the centre lines and sides of
 * nodes it can refer to, and level or plumb with the points before and after
 * it, so segments come out straight. `threshold` is in pt.
 */
export function snapWaypoint(layout: PictureLayout, edge: Edge, neighbours: readonly Point[], raw: Point, threshold: number): PointSnap {
  const xs: Array<{ at: number; from: number }> = [];
  const ys: Array<{ at: number; from: number }> = [];
  for (const n of pathReferences(layout, edge.path)) {
    const lines = nodeLines(n);
    for (const l of lines.xs) xs.push({ at: l.at, from: n.shape.center.y });
    for (const l of lines.ys) ys.push({ at: l.at, from: n.shape.center.x });
  }
  for (const q of neighbours) {
    xs.push({ at: q.x, from: q.y });
    ys.push({ at: q.y, from: q.x });
  }
  const best = (list: Array<{ at: number; from: number }>, v: number) => {
    let b: { at: number; from: number } | null = null;
    for (const c of list) if (Math.abs(c.at - v) <= threshold && (!b || Math.abs(c.at - v) < Math.abs(b.at - v))) b = c;
    return b;
  };
  const bx = best(xs, raw.x);
  const by = best(ys, raw.y);
  const point = { x: bx ? bx.at : raw.x, y: by ? by.at : raw.y };
  const guides: Guide[] = [];
  if (bx) guides.push({ axis: "v", at: bx.at, from: Math.min(bx.from, point.y), to: Math.max(bx.from, point.y) });
  if (by) guides.push({ axis: "h", at: by.at, from: Math.min(by.from, point.x), to: Math.max(by.from, point.x) });
  return { point, guides };
}

/** The stop an edge starts or ends at. */
export function endStop(edge: Edge, which: "from" | "to"): RouteStop {
  return edge.route.stops[which === "from" ? edge.from : edge.to]!;
}

// ---------------------------------------------------------------- ends and new edges

/** The anchors an end can be attached to, in the order they are offered. */
export const END_ANCHORS = ["north", "north east", "east", "south east", "south", "south west", "west", "north west"] as const;

/** Where an end goes: a node, at one of its anchors or (no anchor) on its border. */
export interface EndTarget {
  node: string;
  anchor?: string;
}

/** The code for an end at `t`: "(b.west)", or "(b)" for the border. */
function endText(layout: PictureLayout, t: EndTarget): string | null {
  const n = layout.nodes.find((x) => x.id === t.node);
  if (!n?.name || n.implicitName || !SIMPLE_NAME.test(n.name)) return null;
  return t.anchor ? `(${n.name}.${t.anchor})` : `(${n.name})`;
}

/** Where the stop for an end at `t` lands: the anchor, or the node's centre (the path clips to the border). */
function endPoint(layout: PictureLayout, t: EndTarget): Point | null {
  const n = layout.nodes.find((x) => x.id === t.node);
  if (!n) return null;
  return t.anchor ? anchorPoint(n.shape, t.anchor) : n.shape.center;
}

/** Why `which` end of `edge` can't be moved, or null if it can. */
export function endBlocker(edge: Edge, which: "from" | "to"): string | null {
  if (edge.lock) return `This edge can't be edited: ${edge.lock.message}.`;
  const stop = endStop(edge, which);
  if (stop.item < 0) return "This edge starts at the node its code is written on (\\node ... edge); change that in the code.";
  const split = 'Right-click the edge and choose "Split into separate edges" to give each edge its own \\draw (arrow tips stay where they are), then move it.';
  if (which === "from" && edge.sharedStart) return `This end is shared with the edge before it in the same \\draw, so moving it would move that edge too. ${split}`;
  if (which === "to" && edge.sharedEnd) return `This end is shared with the edge after it in the same \\draw, so moving it would move that edge too. ${split}`;
  return null;
}

/** "x,y" for comparing where things are, to 0.01 pt. */
const spot = (p: Point) => `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`;

/** Every node, label and path of a layout, as sorted lists: what a reordering of statements must leave unchanged. */
function picture(l: PictureLayout): string {
  const nodes = [...l.nodes, ...l.pathNodes].map((n) => `${n.name ?? ""}@${spot(n.shape.center)}`).sort();
  const paths = l.paths.map((p) => p.d).sort();
  return JSON.stringify([nodes, paths]);
}

/**
 * Moves the statement holding `edge` to right after the top-level item that
 * holds `node`, so the edge can refer to it (TikZ only knows nodes defined
 * earlier). Only safe when the statement stands alone at the top level and
 * defines no names other code uses; the picture must draw exactly the same.
 */
function planRelocate(text: string, picIndex: number, edge: Edge, node: LaidOutNode): { ok: true; changes: Change[]; text: string; edgeId: string } | { ok: false; reason: string } {
  const doc = analyzeDocument(text);
  const pic = doc.syntax.pictures[picIndex];
  const layout = layoutDocumentPicture(doc, picIndex);
  if (!pic || !layout) return { ok: false, reason: "There is no picture." };
  const syn = edge.path.syntax;
  const name = node.name ?? "That node";
  const why = `${name} comes after this edge in the code, and TikZ can only refer to nodes defined earlier`;
  if (syn.command === "\\node") return { ok: false, reason: `${why}. This edge is part of a \\node statement, so it can't be moved below it; change it in the code.` };
  if (!isTopLevelItem(doc, pic, syn)) return { ok: false, reason: `${why}. The edge's code is inside a scope, so it can't be moved below it safely; change it in the code.` };
  // Names the statement defines that other code uses would then be used before they exist.
  const picText = text.slice(pic.from, pic.to);
  const word = /[A-Za-z0-9_-]/;
  for (const n of [...layout.nodes, ...layout.pathNodes]) {
    if (!n.name || n.statement.from !== syn.from) continue;
    for (let i = picText.indexOf(n.name); i >= 0; i = picText.indexOf(n.name, i + 1)) {
      const at = pic.from + i;
      if (at >= syn.from && at < syn.to) continue;
      if (!word.test(picText[i - 1] ?? "") && !word.test(picText[i + n.name.length] ?? "")) {
        return { ok: false, reason: `${why}. Moving the edge's code below it would also move ${n.name}, which other code uses; change it in the code.` };
      }
    }
  }
  const anchor = afterTopItem(doc, pic, node.statement.from);
  if (!anchor) return { ok: false, reason: `${why}. The code around ${name} has a syntax error, so the edge's code can't be moved below it. Fix that first.` };
  // The statement goes with its whole line, comment included, when nothing else is on it.
  const ls = lineStart(text, syn.from);
  const le = lineEnd(text, syn.to);
  const alone = /^[ \t]*$/.test(text.slice(ls, syn.from)) && restOfLineBlank(text, syn.to);
  const brk = text.indexOf("\n", le);
  let del: Change;
  let statement = text.slice(syn.from, syn.to);
  if (alone && brk >= 0) {
    del = { from: ls, to: brk + 1, insert: "" };
    statement = text.slice(syn.from, le).replace(/[ \t]+$/, "");
  } else {
    let from = syn.from;
    while (text[from - 1] === " " || text[from - 1] === "\t") from--;
    del = { from, to: syn.to, insert: "" };
  }
  const ins = insertStatements(text, pic, anchor, [statement]);
  if (ins.from < del.to) return { ok: false, reason: `${why}, and the edge's code can't be moved below it.` };
  const changes = [del, ins];
  const next = applyChanges(text, changes);
  const doc2 = analyzeDocument(next);
  const layout2 = layoutDocumentPicture(doc2, picIndex);
  if (doc2.errors.length > doc.errors.length || !layout2 || picture(layout2) !== picture(layout)) {
    return { ok: false, reason: `${why}, and moving the edge's code below it would change the picture. Change it in the code.` };
  }
  const newFrom = ins.from - (del.to - del.from) + ins.insert.indexOf(statement);
  return { ok: true, changes, text: next, edgeId: edge.id.replace(/^path@\d+/, `path@${newFrom}`) };
}

/**
 * Attaches `which` end of edge `edgeId` to `target`: another anchor of the
 * same node, its border, or another node (reconnecting). Only that end's
 * text changes. The node must be defined before the edge's code, as TikZ
 * requires.
 */
export function planEnd(text: string, picIndex: number, edgeId: string, which: "from" | "to", target: EndTarget): EditOutcome & { edgeId?: string } {
  const doc = analyzeDocument(text);
  const layout = layoutDocumentPicture(doc, picIndex);
  const edge = layout && findEdge(layout, edgeId);
  if (!layout || !edge) return { ok: false, reason: "There is no such edge." };
  const blocked = endBlocker(edge, which);
  if (blocked) return { ok: false, reason: blocked };
  const node = layout.nodes.find((n) => n.id === target.node);
  if (!node || node.kind !== "statement") return { ok: false, reason: "Drop the end on a node." };
  const other = which === "from" ? edge.target : edge.source;
  if (other === node.id) return { ok: false, reason: "Both ends would be on the same node; drop it on another node." };
  if (!pathReferences(layout, edge.path).some((n) => n.id === node.id)) {
    // A node defined later: move the edge's code below it first, when that's safe (owner, 2b steps 1–3).
    if (!node.name || node.implicitName || !SIMPLE_NAME.test(node.name)) return { ok: false, reason: "That node has no name the code can refer to; give it one first." };
    const moved = planRelocate(text, picIndex, edge, node);
    if (!moved.ok) return moved;
    const node2 = layoutDocumentPicture(analyzeDocument(moved.text), picIndex)?.nodes.find((n) => n.name === node.name && n.kind === "statement" && n.statement.from < moved.text.length);
    if (!node2) return { ok: false, reason: "That end couldn't be attached there." };
    const r = planEnd(moved.text, picIndex, moved.edgeId, which, { ...target, node: node2.id });
    if (!r.ok) return r;
    return { ...r, changes: composeChanges(text, moved.changes, r.changes), notes: [...r.notes, `moved the edge's code below ${node.name}, so it can refer to it`], edgeId: r.edgeId ?? moved.edgeId };
  }
  const t = endText(layout, target);
  const want = endPoint(layout, target);
  if (!t || !want) return { ok: false, reason: "That node has no name the code can refer to; give it one first." };
  const stop = which === "from" ? edge.from : edge.to;
  const range = edge.route.stops[stop]!.range;
  if (text.slice(range.from, range.to) === t) return { ok: false, reason: "The end is already there." };
  const r = writeStops(text, picIndex, edge, [{ stop, text: t, want, tolerance: POINT_EPS }]);
  if (!r.ok) return r;
  // The edge must still run between nodes, ending at the new one.
  const after = findEdge(r.layout, edgeId);
  const end = after && (which === "from" ? after.source : after.target);
  if (end !== node.id) return { ok: false, reason: "That end couldn't be attached there." };
  return r;
}

/**
 * Draws a new edge from `from` to `to`, written like the picture's other
 * connections (`\draw[->] (a) -- (b);`, D34) after its last path and after
 * both nodes. An unnamed node gets a name in the same edit (D44).
 */
export function planConnect(
  text: string,
  picIndex: number,
  from: EndTarget,
  to: EndTarget,
  head: string,
): (EditOutcome & { ok: true; edgeId: string }) | { ok: false; reason: string } {
  const doc = analyzeDocument(text);
  const layout = layoutDocumentPicture(doc, picIndex);
  const pic = doc.syntax.pictures[picIndex];
  if (!layout || !pic) return { ok: false, reason: "There is no picture." };
  const a = layout.nodes.find((n) => n.id === from.node);
  const b = layout.nodes.find((n) => n.id === to.node);
  if (!a || !b || a.kind !== "statement" || b.kind !== "statement") return { ok: false, reason: "Drop the edge on a node." };
  if (a.id === b.id) return { ok: false, reason: "Drop the edge on another node." };
  const changes: Change[] = [];
  const notes: string[] = [];
  const taken = takenNames(doc, pic, layout);
  const style = nameStyle(layout.nodes.flatMap((n) => (n.name ? [n.name] : [])));
  const defined = definedStyleNames(styleSites(doc, pic));
  const nameOf = (n: LaidOutNode): string | null => {
    if (n.name) return !n.implicitName && SIMPLE_NAME.test(n.name) ? n.name : null;
    const name = nameForUnnamed(n, nodeStyles(n.syntax, defined), taken, style);
    taken.add(name);
    changes.push(nameNodeChange(text, n.syntax, name));
    notes.push(`named a node ${name} so the edge can refer to it`);
    return name;
  };
  const an = nameOf(a);
  const bn = nameOf(b);
  if (!an || !bn) return { ok: false, reason: "A node's name can't be referred to in code (it is made up or contains special characters)." };
  const end = (name: string, anchor?: string) => (anchor ? `(${name}.${anchor})` : `(${name})`);
  const statement = `${head} ${end(an, from.anchor)} -- ${end(bn, to.anchor)};`;
  // After both nodes' statements, and after the last path, as hand-written flowcharts are laid out.
  const after = nodeAnchor(doc, pic, Math.max(a.statement.to, b.statement.to));
  if (!after) return { ok: false, reason: "The code right after the last node has a syntax error, so the edge can't be added safely. Fix that first." };
  const insert = insertStatements(text, pic, pathAnchor(doc, pic, after), [statement]);
  changes.push(insert);
  const next = applyChanges(text, changes);
  const doc2 = analyzeDocument(next);
  if (doc2.errors.length > doc.errors.length) return { ok: false, reason: "The edge couldn't be written without breaking the code." };
  const layout2 = layoutDocumentPicture(doc2, picIndex);
  if (!layout2 || layout2.nodes.length !== layout.nodes.length) return { ok: false, reason: "The edge couldn't be written." };
  for (let i = 0; i < layout.nodes.length; i++) {
    const p = layout.nodes[i]!.shape.center;
    const q = layout2.nodes[i]!.shape.center;
    if (Math.hypot(p.x - q.x, p.y - q.y) > KEEP_TOLERANCE) return { ok: false, reason: "Adding the edge would move a node, so it wasn't written." };
  }
  // The new statement starts where it was inserted, shifted by any names added before it.
  const shift = changes.filter((c) => c !== insert && c.to <= insert.from).reduce((s, c) => s + c.insert.length - (c.to - c.from), 0);
  const at = next.indexOf(statement, insert.from + shift);
  const edge = pictureEdges(layout2).find((e) => e.path.syntax.from === at);
  // A node that was just named has a new id, so compare by position in the picture.
  const index = (id?: string) => layout2.nodes.findIndex((n) => n.id === id);
  if (!edge || index(edge.source) !== layout.nodes.indexOf(a) || index(edge.target) !== layout.nodes.indexOf(b)) {
    return { ok: false, reason: "The edge couldn't be written between those nodes." };
  }
  return { ok: true, changes, text: next, layout: layout2, notes, edgeId: edge.id };
}
