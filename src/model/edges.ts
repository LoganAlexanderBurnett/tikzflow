// The edge model (M2b): a path's route split into node-to-node edges, each
// tied to the code that draws it. `\draw (a) -- (b) -- (c);` is two edges,
// and each `edge` operation is its own (D45). Edges the editor can't safely
// rewrite are locked, with a plain-language reason.
import type { LaidOutNode, LaidOutPath, PictureLayout, Route, RouteSeg, RouteStop } from "../tikz/layout.ts";
import type { Point } from "../tikz/shapes.ts";
import type { PathItemSyntax, Range } from "./syntax.ts";

/**
 * How an edge runs, from how it is written: `|-`/`-|` is orthogonal; `bend`,
 * `out`/`in` or `.. controls ..` is curved; several `--` pieces are a polyline.
 */
export type EdgeMode = "straight" | "polyline" | "orthogonal" | "curved";

export interface EdgeLock {
  kind: "broken" | "shapes";
  message: string;
}

export interface Edge {
  /** `${path id}:${index within the path}`. */
  id: string;
  path: LaidOutPath;
  route: Route;
  /** Stop indices (into route.stops) of its two ends. */
  from: number;
  to: number;
  /** Segment indices (into route.segs), in order. */
  segs: number[];
  /** Ids of the nodes at its ends, when an end is a node (not a coordinate or a point). */
  source?: string;
  target?: string;
  mode: EdgeMode;
  /** Labels (path nodes) on this edge. */
  labels: LaidOutNode[];
  /** The code to highlight: the whole statement when the path is this one edge. */
  range: Range;
  /** Why it can't be edited visually. */
  lock?: EdgeLock;
  /** The start is also the end of the edge before it in the same path, or the end the start of the next. */
  sharedStart: boolean;
  sharedEnd: boolean;
}

/** Where a path item starts in the source. */
export function itemFrom(it: PathItemSyntax): number {
  switch (it.kind) {
    case "coord":
      return it.coord.from;
    case "options":
      return it.list.from;
    case "node":
      return it.node.from;
    default:
      return it.range.from;
  }
}

/** Where a path item ends in the source. */
export function itemTo(it: PathItemSyntax): number {
  switch (it.kind) {
    case "coord":
      return it.coord.to;
    case "options":
      return it.list.to;
    case "node":
      return it.node.to;
    default:
      return it.range.to;
  }
}

/** A laid-out node by id, including nodes placed on paths. */
function nodeById(layout: PictureLayout, id: string): LaidOutNode | undefined {
  return layout.nodes.find((x) => x.id === id) ?? layout.pathNodes.find((x) => x.id === id);
}

/** Whether a stop names a node with a shape (not a coordinate): a place an edge starts or ends. */
function isNodeStop(stop: RouteStop, layout: PictureLayout): boolean {
  if (!stop.node) return false;
  const n = nodeById(layout, stop.node);
  return !!n && n.kind !== "coordinate" && n.shape.kind !== "coordinate";
}

function modeOf(segs: readonly RouteSeg[]): EdgeMode {
  if (segs.some((s) => s.kind === "curve")) return "curved";
  if (segs.some((s) => s.kind === "hv" || s.kind === "vh")) return "orthogonal";
  return segs.length > 1 ? "polyline" : "straight";
}

function lockOf(route: Route): EdgeLock | undefined {
  if (route.broken) return { kind: "broken", message: "part of this path isn't understood (a macro, a loop, or a coordinate the editor can't evaluate), so it's kept exactly as written" };
  if (route.shapes) return { kind: "shapes", message: "this path also draws shapes (a rectangle, circle, arc or closed cycle), so it's kept exactly as written" };
  return undefined;
}

/** The segment (an index into route.segs) a label on a path belongs to: the last one whose operation starts before it. */
export function labelSegIndex(path: LaidOutPath, n: LaidOutNode): number {
  const route = path.route;
  if (!route) return 0;
  let best = 0;
  route.segs.forEach((s, k) => {
    const opItem = path.syntax.items[s.op];
    if (opItem && itemFrom(opItem) <= n.syntax.from) best = k;
  });
  return best;
}

/** The edges of one path, in order. */
export function pathEdges(path: LaidOutPath, layout: PictureLayout): Edge[] {
  const route = path.route;
  // A path that draws nothing (\path used to place labels) has no edges.
  if (!route || !path.stroke || !route.segs.length) return [];
  const lock = lockOf(route);
  const items = path.syntax.items;
  // Runs of segments that follow on from each other, cut at every node.
  const groups: number[][] = [];
  let cur: number[] = [];
  route.segs.forEach((seg, k) => {
    const prev = cur.length ? route.segs[cur[cur.length - 1]!]! : null;
    if (prev && (prev.b !== seg.a || isNodeStop(route.stops[seg.a]!, layout))) {
      groups.push(cur);
      cur = [];
    }
    cur.push(k);
  });
  if (cur.length) groups.push(cur);

  const isEdgeOp = path.id.includes("/edge");
  const labels = layout.pathNodes.filter((n) => n.statement.from === path.syntax.from && n.statement.to === path.syntax.to && n.syntax.from >= path.range.from && n.syntax.to <= path.range.to);
  const labelSeg = (n: LaidOutNode): number => labelSegIndex(path, n);

  return groups.map((g, k) => {
    const first = route.segs[g[0]!]!;
    const last = route.segs[g[g.length - 1]!]!;
    const from = first.a;
    const to = last.b;
    const fromStop = route.stops[from]!;
    const toStop = route.stops[to]!;
    const segs = g.map((i) => route.segs[i]!);
    const range: Range =
      groups.length === 1 || isEdgeOp ? { ...path.range } : { from: Math.min(fromStop.range.from, toStop.range.from), to: Math.max(fromStop.range.to, toStop.range.to) };
    const edge: Edge = {
      id: `${path.id}:${k}`,
      path,
      route,
      from,
      to,
      segs: g,
      mode: modeOf(segs),
      labels: isEdgeOp ? labels : labels.filter((n) => g.includes(labelSeg(n))),
      range,
      sharedStart: k > 0 && route.segs[groups[k - 1]![groups[k - 1]!.length - 1]!]!.b === from,
      sharedEnd: k < groups.length - 1 && route.segs[groups[k + 1]![0]!]!.a === to,
    };
    if (isNodeStop(fromStop, layout)) edge.source = fromStop.node!;
    if (isNodeStop(toStop, layout)) edge.target = toStop.node!;
    if (lock) edge.lock = lock;
    return edge;
  });
}

/** Every edge of a picture, in drawing order. */
export function pictureEdges(layout: PictureLayout): Edge[] {
  return layout.paths.flatMap((p) => pathEdges(p, layout));
}

const f3 = (v: number) => Math.round(v * 1000) / 1000;
const P = (p: Point) => `${f3(p.x)} ${f3(p.y)}`;

/** SVG path data (model coordinates, y up) for some of a route's segments. */
export function segmentsD(segs: readonly RouteSeg[]): string {
  let d = "";
  let last: Point | null = null;
  for (const s of segs) {
    if (!last || Math.hypot(s.from.x - last.x, s.from.y - last.y) > 0.01) d += `${d ? " " : ""}M ${P(s.from)}`;
    if (s.kind === "line") d += ` L ${P(s.to)}`;
    else if (s.kind === "hv") d += ` L ${f3(s.to.x)} ${f3(s.from.y)} L ${P(s.to)}`;
    else if (s.kind === "vh") d += ` L ${f3(s.from.x)} ${f3(s.to.y)} L ${P(s.to)}`;
    else d += ` C ${P(s.c1!)} ${P(s.c2!)} ${P(s.to)}`;
    last = s.to;
  }
  return d;
}

/** SVG path data for an edge. */
export function edgeD(edge: Edge): string {
  return segmentsD(edge.segs.map((i) => edge.route.segs[i]!));
}

/** Where an edge starts and ends as drawn: on the node borders for bare names. */
export function edgeEnds(edge: Edge): { start: Point; end: Point } {
  const segs = edge.segs.map((i) => edge.route.segs[i]!);
  return { start: segs[0]!.from, end: segs[segs.length - 1]!.to };
}

/** What an end of an edge is called: the node's name, or the coordinate as written. */
export function endName(edge: Edge, which: "from" | "to", layout: PictureLayout): string {
  const stop = edge.route.stops[which === "from" ? edge.from : edge.to]!;
  const n = stop.node ? nodeById(layout, stop.node) : undefined;
  if (n?.name) return stop.anchor ? `${n.name}.${stop.anchor}` : n.name;
  return `(${stop.relative ?? ""}${stop.text.trim()})`;
}

/** A short title for an edge, e.g. "start → check". */
export function edgeTitle(edge: Edge, layout: PictureLayout): string {
  return `${endName(edge, "from", layout)} → ${endName(edge, "to", layout)}`;
}

/** The edge a path label belongs to. */
export function edgeOfLabel(edges: readonly Edge[], labelId: string): Edge | undefined {
  return edges.find((e) => e.labels.some((n) => n.id === labelId));
}
