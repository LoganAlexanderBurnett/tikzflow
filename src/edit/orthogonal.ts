// Orthogonal mode (M2b step 5): "Make orthogonal", and sliding a segment of
// an orthogonal edge perpendicular to itself. Routes are written as `|-` and
// `-|` chains, with a single corner where it can (D45): `(a) -| (b)`, else
// `(a) -- ++(0,-6mm) -| (b)`. Points are written in emitter order (D47).
import { analyzeDocument, layoutDocumentPicture } from "../model/document.ts";
import type { Edge } from "../model/edges.ts";
import type { LaidOutNode, PictureLayout, Route } from "../tikz/layout.ts";
import { anchorPoint, type Point } from "../tikz/shapes.ts";
import { applyLinear, invert } from "../tikz/state.ts";
import { PT_PER_UNIT } from "../tikz/units.ts";
import { endBlocker, type EditOutcome, findEdge, formatLength, isPlainStop, nodeLines, pathReferences, perpendicularText, POINT_EPS, relativeStyle, relativeText, absoluteText } from "./edges.ts";
import type { Guide } from "./snap.ts";
import { viaLine } from "./edgeop.ts";
import { fixLabelSides } from "./labels.ts";
import { edgeMiddle, type EndWrite, isEdgeOperation, labelOfItem, projectOnSegment, rewriteMiddle, type Step } from "./vertices.ts";

const MM = PT_PER_UNIT.mm!;
const EPS = 0.01;
/** Whole-millimetre rounding, as for every written point (D44). */
const ROUND = Math.SQRT2 * 0.75 * MM;

/** One straight piece of an orthogonal edge: horizontal ("h", y fixed) or vertical ("v", x fixed). */
export interface Piece {
  axis: "h" | "v";
  /** Its ends: the edge's own ends (a node's centre for a bare name) or its corners. */
  from: Point;
  to: Point;
  /** Its ends as drawn, clipped at node borders: where its handle goes. */
  drawnFrom: Point;
  drawnTo: Point;
}

/**
 * The edge as a run of horizontal and vertical pieces, corners included
 * (the corner of `|-` is not written but is one), or null when a piece is
 * diagonal or curved. Pieces of no length go; pieces in line are merged.
 */
export function orthoPolyline(edge: Edge): { points: Point[]; pieces: Piece[] } | null {
  const route = edge.route;
  const pts: Point[] = [route.stops[edge.from]!.point];
  for (const k of edge.segs) {
    const s = route.segs[k]!;
    const a = route.stops[s.a]!.point;
    const b = route.stops[s.b]!.point;
    if (s.kind === "curve") return null;
    if (s.kind === "hv") pts.push({ x: b.x, y: a.y });
    else if (s.kind === "vh") pts.push({ x: a.x, y: b.y });
    pts.push(b);
  }
  const points = simplify(pts);
  if (points.length < 2) return null;
  const pieces: Piece[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const p = points[i]!;
    const q = points[i + 1]!;
    const axis = Math.abs(p.y - q.y) <= EPS ? "h" : Math.abs(p.x - q.x) <= EPS ? "v" : null;
    if (!axis) return null;
    pieces.push({ axis, from: p, to: q, drawnFrom: p, drawnTo: q });
  }
  // The first and last pieces as drawn: clipped where they meet a node's border.
  const first = route.segs[edge.segs[0]!]!;
  const last = route.segs[edge.segs[edge.segs.length - 1]!]!;
  pieces[0]!.drawnFrom = first.from;
  pieces[pieces.length - 1]!.drawnTo = last.to;
  return { points, pieces };
}

/** Drops repeated points and points in line with their neighbours; keeps the first and last. */
function simplify(pts: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const prev = out[out.length - 1];
    if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) <= EPS) continue;
    out.push(p);
  }
  for (let i = 1; i + 1 < out.length; ) {
    const a = out[i - 1]!;
    const b = out[i]!;
    const c = out[i + 1]!;
    const sameX = Math.abs(a.x - b.x) <= EPS && Math.abs(b.x - c.x) <= EPS;
    const sameY = Math.abs(a.y - b.y) <= EPS && Math.abs(b.y - c.y) <= EPS;
    if (sameX || sameY) out.splice(i, 1);
    else i++;
  }
  return out;
}

type Axis = "h" | "v";

/** A run of pieces: its points, and which way each piece between them runs. */
interface Run {
  points: Point[];
  axes: Axis[];
}

/**
 * Tidies a run: pieces of no length go, and pieces running the same way are
 * merged. The way each piece runs is kept as given, not read back from the
 * points: an end at a border angle may sit a fraction off the line.
 */
function tidy(run: Run): Run {
  const points = run.points.slice();
  const axes = run.axes.slice();
  let changed = true;
  while (changed && axes.length > 1) {
    changed = false;
    for (let i = 0; i < axes.length; i++) {
      const p = points[i]!;
      const q = points[i + 1]!;
      if (Math.hypot(p.x - q.x, p.y - q.y) <= EPS) {
        // Drop the piece and the corner it leaves behind (never an end of the run).
        points.splice(i + 1 < points.length - 1 ? i + 1 : i, 1);
        axes.splice(i, 1);
        changed = true;
        break;
      }
      if (i + 1 < axes.length && axes[i] === axes[i + 1]) {
        points.splice(i + 1, 1);
        axes.splice(i + 1, 1);
        changed = true;
        break;
      }
    }
  }
  return { points, axes };
}

/** The steps that draw a run of horizontal and vertical pieces: corners in pairs from the end, `-|` or `|-`, and a lone `--` first. */
function chain(run: Run): Array<{ op: "--" | "-|" | "|-"; to: number }> {
  const axes = run.axes;
  const out: Array<{ op: "--" | "-|" | "|-"; to: number }> = [];
  let i = axes.length - 1;
  while (i >= 1) {
    out.unshift({ op: axes[i - 1] === "h" ? "-|" : "|-", to: i + 1 });
    i -= 2;
  }
  if (i === 0) out.unshift({ op: "--", to: 1 });
  return out;
}

/** Where a relative point lands: its offset is rounded to whole millimetres in the path's own frame. */
function relativeLanding(route: Route, base: Point, p: Point): Point {
  const inv = invert(route.frame.matrix);
  if (!inv) return p;
  const [lx, ly] = applyLinear(inv, p.x - base.x, p.y - base.y);
  const [dx, dy] = applyLinear(route.frame.matrix, Math.round(lx / MM) * MM, Math.round(ly / MM) * MM);
  return { x: base.x + dx, y: base.y + dy };
}

/**
 * Writes the corners of `points` (all but the first and last) as the steps
 * of a chain: each as a perpendicular coordinate if it lines up with two
 * nodes, else relative to the point written before it, else plain numbers.
 * Returns the steps and where each written corner must land.
 */
function writeChain(text: string, picIndex: number, layout: PictureLayout, edge: Edge, run: Run, plain: boolean): { steps: Step[]; wants: Array<{ step: number; want: Point; tolerance: number }> } | null {
  const doc = analyzeDocument(text);
  const pic = doc.syntax.pictures[picIndex]!;
  const route = edge.route;
  const style = relativeStyle(text, pic);
  const ends = [edge.source, edge.target].filter((x): x is string => !!x);
  const steps: Step[] = [];
  const wants: Array<{ step: number; want: Point; tolerance: number }> = [];
  const points = run.points;
  let landed = points[0]!;
  const ops = chain(run);
  for (let k = 0; k < ops.length; k++) {
    const { op, to } = ops[k]!;
    if (k === ops.length - 1) {
      steps.push({ op });
      break;
    }
    const p = points[to]!;
    const perp = perpendicularText(layout, edge.path, p, ends);
    let target: string | null;
    let tolerance = ROUND;
    if (perp) {
      target = perp;
      landed = p;
      tolerance = POINT_EPS;
    } else if (plain) {
      target = absoluteText(route, p, ",");
    } else {
      target = relativeText(route, { x: p.x - landed.x, y: p.y - landed.y }, "++", style);
      landed = relativeLanding(route, landed, p);
    }
    if (!target) return null;
    steps.push({ op, target });
    wants.push({ step: k, want: p, tolerance });
  }
  return { steps, wants };
}

/** Each label after the step whose pieces it is nearest. */
function placeByDistance(edge: Edge, run: Run): (item: number) => number {
  const ops = chain(run);
  const points = run.points;
  return (item) => {
    const label = labelOfItem(edge, item);
    if (!label) return ops.length - 1;
    let best = 0;
    let bestD = Infinity;
    let from = 0;
    ops.forEach((o, k) => {
      for (let i = from; i < o.to; i++) {
        const d = projectOnSegment({ from: points[i]!, to: points[i + 1]! }, label.shape.center).dist;
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
      from = o.to;
    });
    return best;
  };
}

/** How many other nodes a run of pieces passes through. */
function collisions(layout: PictureLayout, edge: Edge, points: readonly Point[]): number {
  let n = 0;
  for (const node of layout.nodes) {
    if (node.kind !== "statement" || node.id === edge.source || node.id === edge.target) continue;
    const { center: c, hw, hh } = node.shape;
    for (let i = 0; i + 1 < points.length; i++) {
      const p = points[i]!;
      const q = points[i + 1]!;
      const x0 = Math.min(p.x, q.x);
      const x1 = Math.max(p.x, q.x);
      const y0 = Math.min(p.y, q.y);
      const y1 = Math.max(p.y, q.y);
      if (x1 > c.x - hw && x0 < c.x + hw && y1 > c.y - hh && y0 < c.y + hh) {
        n++;
        break;
      }
    }
  }
  return n;
}

function edgeIn(text: string, picIndex: number, edgeId: string) {
  const doc = analyzeDocument(text);
  const layout = layoutDocumentPicture(doc, picIndex);
  const edge = layout && findEdge(layout, edgeId);
  return { doc, layout, edge };
}

/** Why an edge can't be made orthogonal or slid, or null. */
function blocker(edge: Edge): string | null {
  if (edge.lock) return `This edge can't be edited: ${edge.lock.message}.`;
  if (isEdgeOperation(edge)) return 'This edge is an "edge" operation, which joins its ends directly. Write it with "--" to give it corners.';
  return edgeMiddle(edge).problem;
}

/** The side an anchor faces, as the axis a piece leaving it runs along. */
function anchorAxis(anchor: string | undefined): "h" | "v" | null {
  if (anchor === "east" || anchor === "west") return "h";
  if (anchor === "north" || anchor === "south") return "v";
  return null;
}

/**
 * "Make orthogonal" (D45): a single corner, `(a) -| (b)` or `(a) |- (b)`,
 * whichever passes through no other node (horizontal first when the ends are
 * further apart across than down, or as anchors facing a side ask); else two
 * corners through the middle, `(a) -- ++(15mm,0) |- (b)`. Labels go to the
 * nearest piece.
 */
export function planMakeOrthogonal(text: string, picIndex: number, edgeId: string): EditOutcome {
  return fixLabelSides(text, picIndex, edgeId, makeOrthogonal(text, picIndex, edgeId));
}

function makeOrthogonal(text: string, picIndex: number, edgeId: string): EditOutcome {
  const { doc, layout, edge } = edgeIn(text, picIndex, edgeId);
  if (!layout || !edge) return { ok: false, reason: "There is no such edge." };
  if (isEdgeOperation(edge) && !edge.lock) {
    if (edge.mode === "orthogonal") return { ok: false, reason: "It is already orthogonal: drag a segment to slide it." };
    // An "edge" operation joins its ends directly: it becomes a "--" first, in the same edit (D53).
    return viaLine(text, picIndex, edge, (t2, id2) => planMakeOrthogonal(t2, picIndex, id2));
  }
  const why = blocker(edge);
  if (why) return { ok: false, reason: why };
  if (edge.mode === "orthogonal") return { ok: false, reason: "It is already orthogonal: drag a segment to slide it." };
  const route = edge.route;
  const A = route.stops[edge.from]!;
  const B = route.stops[edge.to]!;
  const a = A.point;
  const b = B.point;
  const plain = isPlainStop(A) || isPlainStop(B);
  type Candidate = { run: Run; rank: number };
  const candidates: Candidate[] = [];
  if (Math.abs(a.x - b.x) <= POINT_EPS || Math.abs(a.y - b.y) <= POINT_EPS) {
    if (edge.mode === "straight") return { ok: false, reason: "It already runs straight across or down." };
    candidates.push({ run: { points: [a, b], axes: [Math.abs(a.y - b.y) <= POINT_EPS ? "h" : "v"] }, rank: 0 });
  } else {
    // Horizontal first when the ends are further apart across, or the anchors face that way.
    const wide = Math.abs(a.x - b.x) >= Math.abs(a.y - b.y);
    const pref = (first: Axis) => (anchorAxis(A.anchor) === first ? -2 : anchorAxis(A.anchor) ? 2 : 0) + (anchorAxis(B.anchor) === (first === "h" ? "v" : "h") ? -2 : anchorAxis(B.anchor) ? 2 : 0) + (wide === (first === "h") ? 0 : 1);
    candidates.push({ run: { points: [a, { x: b.x, y: a.y }, b], axes: ["h", "v"] }, rank: pref("h") }, { run: { points: [a, { x: a.x, y: b.y }, b], axes: ["v", "h"] }, rank: pref("v") });
    // Two corners through the middle, for when one corner would cross a node.
    const xm = a.x + Math.round((b.x - a.x) / 2 / MM) * MM;
    const ym = a.y + Math.round((b.y - a.y) / 2 / MM) * MM;
    candidates.push(
      { run: { points: [a, { x: xm, y: a.y }, { x: xm, y: b.y }, b], axes: ["h", "v", "h"] }, rank: 10 + pref("h") },
      { run: { points: [a, { x: a.x, y: ym }, { x: b.x, y: ym }, b], axes: ["v", "h", "v"] }, rank: 10 + pref("v") },
    );
  }
  const score = (c: Candidate) => collisions(layout, edge, c.run.points) * 100 + c.rank;
  candidates.sort((p, q) => score(p) - score(q));
  let last: string | null = null;
  for (const c of candidates) {
    const written = writeChain(doc.text, picIndex, layout, edge, c.run, plain);
    if (!written) continue;
    const r = rewriteMiddle(text, picIndex, edge, written.steps, placeByDistance(edge, c.run), written.wants);
    if (r.ok) return r;
    last = r.reason;
  }
  return { ok: false, reason: last ?? "The edge couldn't be made orthogonal." };
}

/**
 * The part of a node's side that is straight, across a piece leaving it on
 * `axis` by `side`: [lo, hi] in y for "east"/"west", in x for "north"/"south".
 * Null when that side has no straight part (a diamond, an ellipse, a
 * rounded end).
 */
function straightSpan(n: LaidOutNode, axis: "h" | "v", side: string): [number, number] | null {
  const { center: c, hw, hh, kind } = n.shape;
  let span: [number, number] | null = null;
  // "rounded corners" only changes how a rectangle is drawn: its border, which
  // anchors and paths use, keeps sharp corners, as in PGF.
  if (kind === "rectangle") span = axis === "h" ? [c.y - hh, c.y + hh] : [c.x - hw, c.x + hw];
  else if (kind === "rounded rectangle" && axis === "v") span = [c.x - hw + hh, c.x + hw - hh];
  else if (kind === "trapezium" && axis === "v") {
    const w = anchorPoint(n.shape, `${side} west`);
    const e = anchorPoint(n.shape, `${side} east`);
    if (w && e) span = [Math.min(w.x, e.x), Math.max(w.x, e.x)];
  }
  return span && span[1] - span[0] > 1 ? span : null;
}

/**
 * The border angle (whole degrees, as TikZ anchors like "a.30" take) where
 * a piece on `axis` at `value` leaves the node by `side`.
 */
function borderAngle(n: LaidOutNode, axis: "h" | "v", side: string, value: number): number {
  // Along the side, the border point's y (or x) moves one way as the angle grows.
  const range: Record<string, [number, number]> = { east: [-89.9, 89.9], west: [269.9, 90.1], north: [179.9, 0.1], south: [180.1, 359.9] };
  let [lo, hi] = range[side]!;
  const at = (deg: number) => {
    const p = anchorPoint(n.shape, String(((deg % 360) + 360) % 360))!;
    return axis === "h" ? p.y : p.x;
  };
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid) < value) lo = mid;
    else hi = mid;
  }
  return ((Math.round((lo + hi) / 2) % 360) + 360) % 360;
}

/**
 * Where an end piece now leaves its node, when it slides along the node's
 * side: "(a)" back on the centre line; on a straight part of the side
 * "(a.east |- c)" when it lines up with another node, else
 * "([yshift=3mm]a.east)"; elsewhere a border angle, "(a.20)".
 */
function slidEnd(layout: PictureLayout, edge: Edge, which: "from" | "to", piece: Piece, value: number): EndWrite | "keep" | "outside" {
  const stop = edge.route.stops[which === "from" ? edge.from : edge.to]!;
  const node = layout.nodes.find((n) => n.id === (which === "from" ? edge.source : edge.target));
  if (!node?.name || !/^[A-Za-z0-9_\-:]+$/.test(node.name)) return "outside";
  const { center: c, hw, hh } = node.shape;
  const across = piece.axis === "h" ? { lo: c.y - hh, hi: c.y + hh } : { lo: c.x - hw, hi: c.x + hw };
  if (value <= across.lo + 0.5 || value >= across.hi - 0.5) return "outside";
  // The end as written already sits there.
  if (Math.abs((piece.axis === "h" ? stop.point.y : stop.point.x) - value) <= EPS) return "keep";
  const name = node.name;
  if (Math.abs((piece.axis === "h" ? c.y : c.x) - value) <= EPS) return { text: `(${name})`, want: c };
  // The side it leaves by: towards the other end of the piece.
  const other = which === "from" ? piece.to : piece.from;
  const side = piece.axis === "h" ? (other.x > c.x ? "east" : "west") : other.y > c.y ? "north" : "south";
  const span = straightSpan(node, piece.axis, side);
  if (!span || value < span[0] - EPS || value > span[1] + EPS) {
    const deg = borderAngle(node, piece.axis, side, value);
    return { text: `(${name}.${deg})`, want: anchorPoint(node.shape, String(deg))!, tolerance: POINT_EPS };
  }
  const anchor = anchorPoint(node.shape, side)!;
  const want = piece.axis === "h" ? { x: anchor.x, y: value } : { x: value, y: anchor.y };
  // In line with another node: a perpendicular coordinate.
  for (const n of pathReferences(layout, edge.path)) {
    if (n.id === node.id) continue;
    const lines = nodeLines(n);
    const hit = (piece.axis === "h" ? lines.ys : lines.xs).find((l) => Math.abs(l.at - value) <= EPS);
    if (hit) return { text: piece.axis === "h" ? `(${name}.${side} |- ${hit.ref})` : `(${name}.${side} -| ${hit.ref})`, want };
  }
  const shift = value - (piece.axis === "h" ? anchor.y : anchor.x);
  const len = formatLength(shift);
  if (len === "0") return { text: `(${name}.${side})`, want: anchor };
  return { text: `([${piece.axis === "h" ? "yshift" : "xshift"}=${len}]${name}.${side})`, want, tolerance: ROUND };
}

/**
 * Slides piece `index` of an orthogonal edge to `value` (its new y for a
 * horizontal piece, x for a vertical one). A middle piece takes its corners
 * along. A piece at an end moves where the edge leaves the node if it stays
 * within the node's side, else a short piece out of the node is added. The
 * route is written again as a `|-`/`-|` chain.
 */
export function planSlide(text: string, picIndex: number, edgeId: string, index: number, value: number): EditOutcome {
  const { doc, layout, edge } = edgeIn(text, picIndex, edgeId);
  if (!layout || !edge) return { ok: false, reason: "There is no such edge." };
  const why = blocker(edge);
  if (why) return { ok: false, reason: why };
  const poly = orthoPolyline(edge);
  if (!poly) return { ok: false, reason: "Only orthogonal edges slide: choose Make orthogonal first." };
  const piece = poly.pieces[index];
  if (!piece) return { ok: false, reason: "There is no such segment." };
  const set = (p: Point): Point => (piece.axis === "h" ? { x: p.x, y: value } : { x: value, y: p.y });
  const across: Axis = piece.axis === "h" ? "v" : "h";
  const pts = poly.points.slice();
  const axes = poly.pieces.map((p) => p.axis);
  const last = poly.pieces.length - 1;
  const ends: { from?: EndWrite; to?: EndWrite } = {};
  // Each end of the piece: a corner moves with it; the edge's own end moves along its node's side or gets a stub.
  const atEnd = (which: "from" | "to"): string | null => {
    const i = which === "from" ? index : index + 1;
    const isEnd = which === "from" ? index === 0 : index === last;
    if (!isEnd) {
      pts[i] = set(pts[i]!);
      return null;
    }
    const along = slidEnd(layout, edge, which, piece, value);
    if (along === "keep") return null;
    if (along === "outside") {
      // A short piece out of the node, then the slid piece.
      if (which === "from") {
        pts.splice(1, 0, set(pts[0]!));
        axes.unshift(across);
      } else {
        pts.splice(pts.length - 1, 0, set(pts[pts.length - 1]!));
        axes.push(across);
      }
      return null;
    }
    const blocked = endBlocker(edge, which);
    if (blocked) return blocked;
    ends[which] = along;
    pts[i] = along.want;
    return null;
  };
  // Do the far end first: a stub added at the start would shift its index.
  const toWhy = atEnd("to");
  const fromWhy = atEnd("from");
  if (toWhy ?? fromWhy) return { ok: false, reason: (toWhy ?? fromWhy)! };
  const run = tidy({ points: pts, axes });
  const route = edge.route;
  const plain = isPlainStop(route.stops[edge.from]) || isPlainStop(route.stops[edge.to]);
  const written = writeChain(doc.text, picIndex, layout, edge, run, plain);
  if (!written) return { ok: false, reason: "The edge couldn't be written there." };
  return rewriteMiddle(text, picIndex, edge, written.steps, placeByDistance(edge, run), written.wants, undefined, ends);
}

/**
 * Snaps a piece being slid to the centre lines and sides of nodes it may
 * refer to, its own end nodes, and the other pieces of the edge that run the
 * same way. `threshold` is in pt.
 */
export function snapSlide(layout: PictureLayout, edge: Edge, piece: Piece, raw: number, threshold: number): { value: number; guides: Guide[] } {
  const lines: number[] = [];
  const refs = pathReferences(layout, edge.path);
  for (const n of layout.nodes) {
    if (!refs.includes(n) && n.id !== edge.source && n.id !== edge.target) continue;
    const l = nodeLines(n);
    for (const v of piece.axis === "h" ? l.ys : l.xs) lines.push(v.at);
  }
  for (const p of orthoPolyline(edge)?.pieces ?? []) if (p.axis === piece.axis && p !== piece) lines.push(piece.axis === "h" ? p.from.y : p.from.x);
  let best: number | null = null;
  for (const v of lines) if (Math.abs(v - raw) <= threshold && (best === null || Math.abs(v - raw) < Math.abs(best - raw))) best = v;
  if (best === null) return { value: raw, guides: [] };
  const lo = piece.axis === "h" ? Math.min(piece.from.x, piece.to.x) : Math.min(piece.from.y, piece.to.y);
  const hi = piece.axis === "h" ? Math.max(piece.from.x, piece.to.x) : Math.max(piece.from.y, piece.to.y);
  return { value: best, guides: [{ axis: piece.axis, at: best, from: lo - 20, to: hi + 20 }] };
}
