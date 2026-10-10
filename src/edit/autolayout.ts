// Auto-layout (M4 step 3, D80). elk.js's layered algorithm decides the
// layers, the order within each layer, and which nodes line up. That is
// written back the way a person places nodes: each node gets a relation to a
// node defined before it ("below=of a", "right=of b", "at (a |- b)"), and a
// relation the author already wrote is kept when it still says what the
// layout says. ELK's own coordinates are only a guide, never written. Edges
// keep their form; corners written as plain coordinates on an edge whose ends
// moved are removed, since they would point at where the nodes used to be
// (D77 items 1 and 2).
import type { ElkNode } from "elkjs/lib/elk-api.js";
import { analyzeDocument, layoutDocumentPicture } from "../model/document.ts";
import { type Edge, pictureEdges } from "../model/edges.ts";
import type { LaidOutNode, PictureLayout } from "../tikz/layout.ts";
import { positioningAnchor, positioningDirection } from "../tikz/layout.ts";
import { anchorOffset, anchorPoint, type Point, shapeBounds } from "../tikz/shapes.ts";
import { evalLength, PT_PER_UNIT } from "../tikz/units.ts";
import { applyChanges, type Change, composeChanges } from "./changes.ts";
import { type ChainConversion, conversionMessage, planChainConversion } from "./chains.ts";
import { groupMembers, movingWith } from "./group.ts";
import { withLibraries } from "./libraries.ts";
import { ALIGN_EPS, formatDistance, planMove, type PositionSpec, positioningText, specChanges } from "./move.ts";
import { removeItems } from "./optionEdits.ts";
import type { OptionItem } from "../model/syntax.ts";
import { labelsOnTheirLine, planLabelBesideLine } from "./labels.ts";
import { edgeVertices, planRemoveVertex, planStraighten } from "./vertices.ts";

const MM = PT_PER_UNIT.mm!;
/** A written position must land within this of where the layout put the node, in pt. */
const EXACT = 0.6;
/** Distances within this of the node distance are written as "=of", in pt. */
const ROUND_TOLERANCE = 0.75 * MM;
/** ELK coordinates within this count as the same row or column, in pt. */
const SAME = 0.5;
/** Two nodes closer than this along both axes overlap, in pt. */
const CLEAR = 0.5;
/** Passes after the first: each lines nodes up with where the one before put later nodes. */
const PASSES = 2;
/** Names that can be referred to in emitted code. */
const SIMPLE_NAME = /^[A-Za-z0-9_\-:]+$/;

export type LayoutDirection = "down" | "right";

export interface AutoLayoutOptions {
  direction: LayoutDirection;
  /** The selection: with two or more nodes, only they are laid out (D77 item 2). */
  ids?: readonly string[];
}

export type AutoLayoutResult =
  | {
      ok: true;
      changes: Change[];
      text: string;
      direction: LayoutDirection;
      /** Nodes laid out. */
      count: number;
      /** Nodes whose position was written, with what was written. */
      written: Array<{ id: string; name: string; text: string }>;
      /** Nodes whose position as written already says what the layout says. */
      kept: number;
      /** Corners removed from edges. */
      corners: number;
      /** Orthogonal edges whose ends now line up, written with --. */
      straightened: number;
      /** Labels the moved lines now cut through, put beside them with auto. */
      labels: number;
      conversions: Array<ChainConversion & { ok: true }>;
      added: string[];
      notes: string[];
    }
  | { ok: false; reason: string };

/** Which way the layers run, in canvas terms: `along` grows from one layer to the next, `across` within a layer. */
interface Frame {
  next: string;
  back: string;
  after: string;
  before: string;
  along: (p: Point) => number;
  across: (p: Point) => number;
}

const FRAMES: Record<LayoutDirection, Frame> = {
  down: { next: "below", back: "above", after: "right", before: "left", along: (p) => -p.y, across: (p) => p.x },
  right: { next: "right", back: "left", after: "below", before: "above", along: (p) => p.x, across: (p) => -p.y },
};

// ---------------------------------------------------------------- what is laid out

/** Why a node of the scope stays where it is, or null if it is laid out. */
function stays(n: LaidOutNode): string | null {
  if (n.kind !== "statement" || n.shape.kind === "coordinate") return "a coordinate";
  if (n.position.kind === "fit") return "it fits other nodes and follows them";
  // A chain is written out first (D77 item 4); other locked nodes stay (D77 item 2).
  if (n.locked && n.lock?.kind !== "chain") return n.locked;
  return null;
}

/** The nodes laid out: the whole picture, or the selection when it has two or more nodes. In code order. */
export function layoutScope(layout: PictureLayout, ids?: readonly string[]): { members: LaidOutNode[]; staying: LaidOutNode[] } {
  const pool = ids && ids.length >= 2 ? groupMembers(layout, ids).members.map((id) => layout.nodes.find((n) => n.id === id)!) : layout.nodes;
  const members = pool.filter((n) => !stays(n));
  const staying = pool.filter((n) => stays(n) && n.kind === "statement" && n.shape.kind !== "coordinate" && n.position.kind !== "fit");
  return { members, staying };
}

/** The way the picture mostly runs now: down when most edges between laid-out nodes run more down than across. */
export function guessDirection(layout: PictureLayout, ids?: readonly string[]): LayoutDirection {
  const { members } = layoutScope(layout, ids);
  const set = new Set(members.map((n) => n.id));
  let down = 0;
  let across = 0;
  for (const e of pictureEdges(layout)) {
    if (!e.source || !e.target || !set.has(e.source) || !set.has(e.target)) continue;
    const a = members.find((n) => n.id === e.source)!.shape.center;
    const b = members.find((n) => n.id === e.target)!.shape.center;
    if (Math.abs(a.x - b.x) > Math.abs(a.y - b.y)) across++;
    else down++;
  }
  return across > down ? "right" : "down";
}

// ---------------------------------------------------------------- ELK

/** The median of some numbers (0 for none). */
/** To 0.01 pt. */
const r2 = (v: number) => Math.round(v * 100) / 100;

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

/** The graph for ELK: the members with their outer sizes, and the edges between them. */
export function elkGraph(layout: PictureLayout, members: readonly LaidOutNode[], direction: LayoutDirection): ElkNode {
  const set = new Set(members.map((n) => n.id));
  const size = (n: LaidOutNode) => {
    const b = shapeBounds(n.shape);
    // Rounded: ELK breaks ties on the last bit, and the same picture must always give the same layout.
    return { w: r2(b.maxX - b.minX), h: r2(b.maxY - b.minY) };
  };
  // Small nodes (connector circles, junction dots) shouldn't pull the main flow out of line:
  // edges between full-size nodes are kept straight first.
  const area = median(members.map((n) => size(n).w * size(n).h));
  const minor = new Set(members.filter((n) => size(n).w * size(n).h < area / 4).map((n) => n.id));
  const seen = new Set<string>();
  const edges: Array<{ id: string; sources: string[]; targets: string[]; layoutOptions: Record<string, string> }> = [];
  for (const e of pictureEdges(layout)) {
    if (!e.source || !e.target || e.source === e.target || !set.has(e.source) || !set.has(e.target)) continue;
    const key = `${e.source}\u0000${e.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const straightness = minor.has(e.source) || minor.has(e.target) ? "0" : "10";
    edges.push({ id: `e${edges.length}`, sources: [e.source], targets: [e.target], layoutOptions: { "elk.layered.priority.straightness": straightness } });
  }
  const gap = (axis: "v" | "h") => {
    const d = median(members.map((n) => n.nodeDistance[axis] * n.vectorScale));
    // "on grid" measures centre to centre: what is left between the borders.
    if (members.filter((n) => n.onGrid).length * 2 > members.length) {
      const s = median(members.map((n) => (axis === "v" ? size(n).h : size(n).w)));
      return Math.max(d - s, 5 * MM);
    }
    return d;
  };
  const between = direction === "down" ? gap("v") : gap("h");
  const within = direction === "down" ? gap("h") : gap("v");
  return {
    id: "picture",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction === "down" ? "DOWN" : "RIGHT",
      "elk.spacing.nodeNode": String(r2(within)),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(r2(between)),
      "elk.spacing.edgeNode": String(r2(within / 2)),
      "elk.spacing.edgeEdge": String(r2(within / 4)),
      "elk.layered.spacing.edgeNodeBetweenLayers": "0",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "0",
      // Edges into one node meet at one point, so nodes line up centre to centre.
      "elk.layered.mergeEdges": "true",
      // Back edges are found by following the code's own order.
      "elk.layered.cycleBreaking.strategy": "DEPTH_FIRST",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.separateConnectedComponents": "false",
    },
    children: members.map((n) => ({ id: n.id, width: size(n).w, height: size(n).h })),
    edges,
  };
}

type ElkLayout = (graph: ElkNode) => Promise<ElkNode>;

let elkInstance: Promise<ElkLayout> | null = null;

/** elk.js, loaded on first use (it is 1.6 MB). */
function loadElk(): Promise<ElkLayout> {
  elkInstance ??= import("elkjs/lib/elk.bundled.js").then((m) => {
    const elk = new m.default();
    return (g: ElkNode) => elk.layout(g);
  });
  return elkInstance;
}

/** Runs ELK and returns each member's centre in canvas pt (y up). */
export async function elkCenters(graph: ElkNode): Promise<Map<string, Point>> {
  const out = await (await loadElk())(graph);
  const centers = new Map<string, Point>();
  for (const c of out.children ?? []) centers.set(c.id, { x: (c.x ?? 0) + (c.width ?? 0) / 2, y: -((c.y ?? 0) + (c.height ?? 0) / 2) });
  return centers;
}

// ---------------------------------------------------------------- reading ELK's grid

interface Grid {
  layer: Map<string, number>;
  /** Position within its layer. */
  index: Map<string, number>;
  /** Nodes whose centres line up across layers share a column. */
  column: Map<string, number>;
  /** Nodes by layer, in order. */
  layers: string[][];
}

export function readGrid(members: readonly LaidOutNode[], centers: ReadonlyMap<string, Point>, frame: Frame): Grid {
  const half = (n: LaidOutNode) => {
    const b = shapeBounds(n.shape);
    // The extent along the layer axis.
    return frame.along({ x: 1, y: 0 }) !== 0 ? (b.maxX - b.minX) / 2 : (b.maxY - b.minY) / 2;
  };
  // Layers are bands along the layer axis that don't overlap.
  const spans = members.map((n) => {
    const a = frame.along(centers.get(n.id)!);
    return { id: n.id, lo: a - half(n), hi: a + half(n) };
  });
  spans.sort((p, q) => p.lo - q.lo);
  const layers: string[][] = [];
  let end = -Infinity;
  for (const s of spans) {
    if (!layers.length || s.lo > end) {
      layers.push([]);
      end = s.hi;
    } else end = Math.max(end, s.hi);
    layers[layers.length - 1]!.push(s.id);
  }
  const layer = new Map<string, number>();
  const index = new Map<string, number>();
  layers.forEach((ids, k) => {
    ids.sort((p, q) => frame.across(centers.get(p)!) - frame.across(centers.get(q)!));
    ids.forEach((id, i) => {
      layer.set(id, k);
      index.set(id, i);
    });
  });
  const column = new Map<string, number>();
  const byAcross = [...members].map((n) => n.id).sort((p, q) => frame.across(centers.get(p)!) - frame.across(centers.get(q)!));
  let col = -1;
  let last = -Infinity;
  for (const id of byAcross) {
    const a = frame.across(centers.get(id)!);
    if (a - last > SAME) col++;
    last = a;
    column.set(id, col);
  }
  return { layer, index, column, layers };
}

// ---------------------------------------------------------------- where a relation puts a node

/** The centre `dir=<v and h> of ref` gives `n`, with the ref's centre at `at`; distances in the node's own units, undefined for its node distance. */
export function placeRelative(ref: LaidOutNode, at: Point, n: LaidOutNode, dir: string, v?: number, h?: number): Point | null {
  const [ux, uy] = positioningDirection(dir);
  const s = n.vectorScale;
  const dv = (v ?? n.nodeDistance.v) * s;
  const dh = (h ?? n.nodeDistance.h) * s;
  const shift = { x: ux * dh, y: uy * dv };
  if (n.onGrid) return { x: at.x + shift.x, y: at.y + shift.y };
  const anchor = positioningAnchor(dir);
  const theirs = anchorPoint({ ...ref.shape, center: at }, OPPOSITE[anchor]!);
  const own = anchorOffset(n.shape, anchor);
  if (!theirs || !own) return null;
  return { x: theirs.x + shift.x - own.x, y: theirs.y + shift.y - own.y };
}

const OPPOSITE: Record<string, string> = {
  north: "south",
  south: "north",
  east: "west",
  west: "east",
  "north east": "south west",
  "north west": "south east",
  "south east": "north west",
  "south west": "north east",
};

const STRAIGHT = ["below", "above", "right", "left"] as const;
const DIAGONAL = ["below right", "below left", "above right", "above left"] as const;

/** A written distance as it will be read back: "1.2cm" is 34.14 pt. */
function written(pt: number): number {
  return evalLength(formatDistance(pt)) ?? 0;
}

interface Placement {
  spec: PositionSpec | "keep";
  center: Point;
}

/** A straight relation to `ref` at the node distance, or at `distance` (pt, canvas) when it differs from that. */
function straight(ref: LaidOutNode, at: Point, n: LaidOutNode, dir: string, distance?: number): Placement | null {
  const vertical = dir === "below" || dir === "above";
  const nd = (vertical ? n.nodeDistance.v : n.nodeDistance.h) * n.vectorScale;
  const local = distance === undefined || Math.abs(distance - nd) <= ROUND_TOLERANCE ? undefined : written(distance / n.vectorScale);
  if (local !== undefined && local < 0) return null;
  const center = vertical ? placeRelative(ref, at, n, dir, local) : placeRelative(ref, at, n, dir, undefined, local);
  if (!center) return null;
  const spec: PositionSpec = { kind: "positioning", dir, target: ref.name! };
  if (local !== undefined) {
    if (vertical) spec.v = local;
    else spec.h = local;
  }
  return { spec, center };
}

/**
 * A relation to `ref` that puts `n` at `target`: a straight one when the two
 * line up, else a diagonal, else a straight one with a shift across it.
 * Distances are rounded to whole millimetres, and the centre returned is where
 * the rounded relation puts the node.
 */
function towards(ref: LaidOutNode, at: Point, n: LaidOutNode, target: Point): Placement | null {
  const s = n.vectorScale;
  for (const dir of STRAIGHT) {
    const zero = placeRelative(ref, at, n, dir, 0, 0);
    if (!zero) continue;
    const [ux, uy] = positioningDirection(dir);
    const d = (target.x - zero.x) * ux + (target.y - zero.y) * uy;
    const cross = ux !== 0 ? target.y - zero.y : target.x - zero.x;
    if (d < -ALIGN_EPS || Math.abs(cross) > ALIGN_EPS) continue;
    return straight(ref, at, n, dir, Math.max(0, d));
  }
  const options: Array<Placement & { error: number }> = [];
  for (const dir of DIAGONAL) {
    const zero = placeRelative(ref, at, n, dir, 0, 0);
    if (!zero) continue;
    const [ux, uy] = positioningDirection(dir);
    const h = written(((target.x - zero.x) * ux) / s);
    const v = written(((target.y - zero.y) * uy) / s);
    if (h <= 0 || v <= 0) continue;
    const center = placeRelative(ref, at, n, dir, v, h);
    if (!center) continue;
    options.push({ spec: { kind: "positioning", dir, target: ref.name!, v, h }, center, error: Math.hypot(center.x - target.x, center.y - target.y) });
  }
  options.sort((p, q) => p.error - q.error);
  if (options.length) return options[0]!;
  // Overlapping across the axis: the straight relation with the widest gap between the borders, with a shift.
  let dir = "below";
  let best = -Infinity;
  for (const d of STRAIGHT) {
    const z = placeRelative(ref, at, n, d, 0, 0);
    if (!z) continue;
    const [ux, uy] = positioningDirection(d);
    const gap = (target.x - z.x) * ux + (target.y - z.y) * uy;
    if (gap > best) {
      best = gap;
      dir = d;
    }
  }
  const zero = placeRelative(ref, at, n, dir, 0, 0);
  if (!zero) return null;
  const [ux, uy] = positioningDirection(dir);
  const d = written(Math.max(0, (target.x - zero.x) * ux + (target.y - zero.y) * uy) / s);
  const vertical = ux === 0;
  const shift = vertical ? { x: written((target.x - zero.x) / s), y: 0 } : { x: 0, y: written((target.y - zero.y) / s) };
  const center = vertical ? placeRelative(ref, at, n, dir, d) : placeRelative(ref, at, n, dir, undefined, d);
  if (!center) return null;
  const spec: PositionSpec = vertical ? { kind: "positioning", dir, target: ref.name!, v: d, shift } : { kind: "positioning", dir, target: ref.name!, h: d, shift };
  return { spec, center: { x: center.x + shift.x * s, y: center.y + shift.y * s } };
}

// ---------------------------------------------------------------- choosing each node's relation

function boxAt(n: LaidOutNode, c: Point) {
  return shapeBounds({ ...n.shape, center: c });
}

function overlaps(a: ReturnType<typeof boxAt>, b: ReturnType<typeof boxAt>): boolean {
  return Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > CLEAR && Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY) > CLEAR;
}

/** The single node a node's position follows (a positioning relation, or "at" one node), or null. */
function followsOne(layout: PictureLayout, n: LaidOutNode): LaidOutNode | null {
  if (!["positioning", "old-positioning", "at"].includes(n.position.kind) || n.position.refs.length !== 1) return null;
  const name = n.position.refs[0]!;
  const index = layout.nodes.indexOf(n);
  return layout.nodes.slice(0, index).reverse().find((m) => m.name === name) ?? null;
}

/** Which grid relation `n` has to `r`: "next", "back" (same column, adjacent layers), "after", "before" (same layer, side by side), or null. */
function gridRelation(grid: Grid, r: string, n: string): "next" | "back" | "after" | "before" | null {
  const dl = grid.layer.get(n)! - grid.layer.get(r)!;
  if (grid.column.get(n) === grid.column.get(r) && Math.abs(dl) === 1) return dl > 0 ? "next" : "back";
  const di = grid.index.get(n)! - grid.index.get(r)!;
  if (dl === 0 && Math.abs(di) === 1) return di > 0 ? "after" : "before";
  return null;
}

/** The same classification for an offset between two placed nodes. */
function offsetRelation(frame: Frame, d: Point): "next" | "back" | "after" | "before" | null {
  const along = frame.along(d);
  const across = frame.across(d);
  if (Math.abs(across) <= ALIGN_EPS && Math.abs(along) > ALIGN_EPS) return along > 0 ? "next" : "back";
  if (Math.abs(along) <= ALIGN_EPS && Math.abs(across) > ALIGN_EPS) return across > 0 ? "after" : "before";
  return null;
}

export interface Plan {
  placements: Map<string, Placement>;
  /** The members each member's placement refers to. */
  refs: Map<string, string[]>;
  /** Nodes that couldn't be put clear of the others. */
  crowded: string[];
}

/**
 * Chooses each member's relation, in code order, so that it refers only to
 * members before it. The first member stays where it is and keeps its code;
 * the layout is built around it. `previous` is an earlier pass: where it put
 * each member, so a node can line up with one defined after it.
 */
export function choosePlacements(
  layout: PictureLayout,
  members: readonly LaidOutNode[],
  elk: ReadonlyMap<string, Point>,
  direction: LayoutDirection,
  previous?: Plan,
  movers?: ReadonlyMap<string, LaidOutNode>,
): Plan {
  const frame = FRAMES[direction];
  const grid = readGrid(members, elk, frame);
  const first = members[0]!;
  // ELK's coordinates, moved so the first member stays put.
  const e0 = elk.get(first.id)!;
  const target = new Map([...elk].map(([id, p]) => [id, { x: p.x - e0.x + first.shape.center.x, y: p.y - e0.y + first.shape.center.y }]));
  const byId = new Map(members.map((n) => [n.id, n]));
  const placed = new Map<string, Placement>();
  const refsOf = new Map<string, string[]>();
  placed.set(first.id, { spec: "keep", center: first.shape.center });
  refsOf.set(first.id, []);
  /** Where the previous pass put a member, unless that went through `n` (then it carries n's old error). */
  const hintFor = (n: string) => {
    if (!previous) return new Map<string, Point>();
    const through = new Set<string>();
    const reaches = (id: string, seen = new Set<string>()): boolean => {
      if (id === n || through.has(id)) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      const hit = (previous.refs.get(id) ?? []).some((r) => reaches(r, seen));
      if (hit) through.add(id);
      return hit;
    };
    return new Map([...previous.placements].filter(([id]) => !reaches(id)).map(([id, p]) => [id, p.center]));
  };
  const crowded: string[] = [];
  const named = (id: string) => {
    const m = byId.get(id)!;
    return !!m.name && !m.implicitName && SIMPLE_NAME.test(m.name);
  };
  const at = (id: string) => placed.get(id)!.center;
  const clear = (n: LaidOutNode, c: Point) => {
    const box = boxAt(n, c);
    return [...placed].every(([id, p]) => !overlaps(box, boxAt(byId.get(id)!, p.center)));
  };
  /** The ELK offset between two members, moved onto where the first is placed. */
  const relative = (r: string, n: string): Point => {
    const pr = at(r);
    const tr = target.get(r)!;
    const tn = target.get(n)!;
    return { x: pr.x + tn.x - tr.x, y: pr.y + tn.y - tr.y };
  };

  for (const n of members.slice(1)) {
    const hints = hintFor(n.id);
    // Relations written now use the node distance it inherits: its own served the old relation and goes.
    const mv = movers?.get(n.id) ?? n;
    const candidates: Placement[] = [];
    const add = (p: Placement | null) => p && candidates.push(p);
    const refs = [...placed.keys()].filter(named);
    const L = grid.layer.get(n.id)!;
    const C = grid.column.get(n.id)!;
    const I = grid.index.get(n.id)!;

    // 1. The relation as written, when it still says what the layout says.
    const was = followsOne(layout, n);
    if (was && placed.has(was.id)) {
      const off = { x: n.shape.center.x - was.shape.center.x, y: n.shape.center.y - was.shape.center.y };
      const rel = gridRelation(grid, was.id, n.id);
      if (rel && rel === offsetRelation(frame, off)) add({ spec: "keep", center: { x: at(was.id).x + off.x, y: at(was.id).y + off.y } });
    }
    // 2. Below (or after) the node above it in its column; above the one below it.
    const colMates = refs.filter((id) => grid.column.get(id) === C).sort((p, q) => Math.abs(grid.layer.get(p)! - L) - Math.abs(grid.layer.get(q)! - L));
    for (const id of colMates) {
      const dl = L - grid.layer.get(id)!;
      if (Math.abs(dl) === 1) add(straight(byId.get(id)!, at(id), mv, dl > 0 ? frame.next : frame.back));
    }
    // 3. Beside its neighbour in the layer, at ELK's gap.
    const rowMates = refs.filter((id) => grid.layer.get(id) === L).sort((p, q) => Math.abs(grid.index.get(p)! - I) - Math.abs(grid.index.get(q)! - I));
    /**
     * ELK's place for `n` seen from `r`, lined up with its column and layer:
     * with the nearest of them placed, else with where the previous pass put
     * one defined later in the code.
     */
    const lineUp = (r: string): Point => {
      // Measured from the node nearest in ELK's picture, placed or from the previous pass, so that a
      // distance written to a far-away node doesn't carry the difference between ELK's gaps and TikZ's.
      const known = members.map((m) => m.id).filter((id) => id !== n.id && (placed.has(id) || hints?.has(id)));
      const base = known.sort((p, q) => dist(target.get(p)!, target.get(n.id)!) - dist(target.get(q)!, target.get(n.id)!))[0] ?? r;
      const bp = placed.get(base)?.center ?? hints?.get(base) ?? at(r);
      const t = base === r ? relative(r, n.id) : { x: bp.x + target.get(n.id)!.x - target.get(base)!.x, y: bp.y + target.get(n.id)!.y - target.get(base)!.y };
      const later = (list: string[]) => list.find((id) => !placed.has(id) && hints?.has(id));
      const allCol = members.map((m) => m.id).filter((id) => id !== n.id && grid.column.get(id) === C).sort((p, q) => Math.abs(grid.layer.get(p)! - L) - Math.abs(grid.layer.get(q)! - L));
      const allRow = members.map((m) => m.id).filter((id) => id !== n.id && grid.layer.get(id) === L).sort((p, q) => Math.abs(grid.index.get(p)! - I) - Math.abs(grid.index.get(q)! - I));
      const col = colMates[0] ?? later(allCol);
      const row = rowMates[0] ?? later(allRow);
      const pos = (id: string) => placed.get(id)?.center ?? hints!.get(id)!;
      // A column fixes x when the layers run down, y when they run right; a layer the other.
      const [xFrom, yFrom] = direction === "down" ? [col, row] : [row, col];
      return { x: xFrom ? pos(xFrom).x : t.x, y: yFrom ? pos(yFrom).y : t.y };
    };
    for (const id of rowMates) {
      const di = I - grid.index.get(id)!;
      if (Math.abs(di) !== 1) continue;
      const r = byId.get(id)!;
      const zero = placeRelative(r, at(id), mv, di > 0 ? frame.after : frame.before, 0, 0);
      if (!zero) continue;
      const t = relative(id, n.id);
      // At the node distance when that leaves room, as a person would write it; else at ELK's gap.
      add(straight(r, at(id), mv, di > 0 ? frame.after : frame.before));
      add(straight(r, at(id), mv, di > 0 ? frame.after : frame.before, Math.abs(frame.across({ x: t.x - zero.x, y: t.y - zero.y }))));
    }
    // 4. In line with a node of its column and one of its layer: "at (a |- b)".
    if (colMates.length && rowMates.length) {
      const a = colMates[0]!;
      const b = rowMates[0]!;
      const [xFrom, yFrom] = direction === "down" ? [a, b] : [b, a];
      add({ spec: { kind: "perp", xFrom: byId.get(xFrom)!.name!, yFrom: byId.get(yFrom)!.name! }, center: { x: at(xFrom).x, y: at(yFrom).y } });
    }
    // 5. Further along its column or layer, at ELK's distance.
    for (const id of [...colMates, ...rowMates].slice(0, 2)) add(towards(byId.get(id)!, at(id), mv, lineUp(id)));
    // 6. Anywhere: from the nearest node placed, lined up with what is placed of its column and layer.
    const near = [...refs].sort((p, q) => dist(target.get(p)!, target.get(n.id)!) - dist(target.get(q)!, target.get(n.id)!))[0];
    let fallback: Placement | null = null;
    if (near) fallback = towards(byId.get(near)!, at(near), mv, lineUp(near));
    add(fallback);

    // Nothing clear: the nearest clear place to ELK's, searched outwards in 5 mm steps.
    if (near && !candidates.some((c) => clear(n, c.center))) {
      const goal = lineUp(near);
      search: for (let k = 1; k <= 40; k++) {
        const d = k * 5 * MM;
        const tries = [frame.across({ x: 1, y: 0 }) !== 0 ? { x: d, y: 0 } : { x: 0, y: -d }, frame.along({ x: 1, y: 0 }) !== 0 ? { x: d, y: 0 } : { x: 0, y: -d }];
        for (const t of [tries[0]!, { x: -tries[0]!.x, y: -tries[0]!.y }, tries[1]!]) {
          const p = towards(byId.get(near)!, at(near), mv, { x: goal.x + t.x, y: goal.y + t.y });
          if (p && clear(n, p.center)) {
            add(p);
            break search;
          }
        }
      }
    }
    let chosen = candidates.find((c) => clear(n, c.center)) ?? fallback ?? candidates[0];
    if (!chosen) {
      // Nothing to refer to (no named node before it): it stays as written.
      placed.set(n.id, { spec: "keep", center: n.shape.center });
      refsOf.set(n.id, []);
      continue;
    }
    // Where the relation as written puts it already: nothing to write.
    if (chosen.spec !== "keep" && was && placed.has(was.id)) {
      const kept = { x: at(was.id).x + n.shape.center.x - was.shape.center.x, y: at(was.id).y + n.shape.center.y - was.shape.center.y };
      if (dist(kept, chosen.center) <= EXACT / 2) chosen = { spec: "keep", center: kept };
    }
    if (!clear(n, chosen.center)) crowded.push(n.id);
    placed.set(n.id, chosen);
    // The members it now refers to: the latest placed member of each name it uses.
    const byName = (name: string) => [...placed.keys()].reverse().find((id) => id !== n.id && byId.get(id)!.name === name);
    const names = chosen.spec === "keep" ? (was ? [was.name!] : []) : chosen.spec.kind === "perp" ? [chosen.spec.xFrom, chosen.spec.yFrom] : chosen.spec.kind === "positioning" ? [chosen.spec.target] : [];
    refsOf.set(n.id, names.flatMap((name) => byName(name) ?? []));
  }
  return { placements: placed, refs: refsOf, crowded };
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ---------------------------------------------------------------- writing

/** A node's own `node distance` (and `on grid`): it served the relation the layout replaces. */
const ownDistance = (i: OptionItem) => i.key === "node distance" || i.key === "on grid";

/**
 * The members that set their own node distance, as they would be without it:
 * the node distance and grid setting they inherit, which a relation written
 * by the layout uses once their own item is gone.
 */
function inheritedDistances(text: string, picIndex: number, members: readonly LaidOutNode[]): Map<string, LaidOutNode> {
  const own = members.filter((n) => n.syntax.options.some((l) => l.items.some(ownDistance)));
  if (!own.length) return new Map();
  const changes = own.flatMap((n) => n.syntax.options.flatMap((l) => (l.items.some(ownDistance) ? removeItems(text, l, l.items.filter(ownDistance)) : [])));
  const l = layoutDocumentPicture(analyzeDocument(applyChanges(text, changes)), picIndex);
  const out = new Map<string, LaidOutNode>();
  for (const n of own) {
    const m = l?.nodes.find((x) => x.id === n.id);
    if (m) out.set(n.id, { ...n, nodeDistance: m.nodeDistance, onGrid: m.onGrid });
  }
  return out;
}

/** The text of a placement, for the status bar. */
function placementText(spec: PositionSpec): string {
  if (spec.kind === "positioning") return positioningText(spec);
  if (spec.kind === "perp") return `at (${spec.xFrom} |- ${spec.yFrom})`;
  return "coordinates";
}

interface Written {
  changes: Change[];
  text: string;
  written: Array<{ id: string; name: string; text: string }>;
  added: string[];
  notes: string[];
}

/**
 * Writes the placements and checks them by laying the result out: every
 * member must land where it was planned. All at once when that works; else
 * node by node, each checked, with the general emitter (D24) for a node whose
 * planned relation doesn't land.
 */
function writePlacements(text: string, picIndex: number, members: readonly LaidOutNode[], plan: Plan): Written | { reason: string } {
  // A relation written exactly as it already is isn't a change.
  const real = (t: string, cs: readonly Change[]) => cs.filter((c) => t.slice(c.from, c.to) !== c.insert);
  const specs = members.filter((n) => {
    const spec = plan.placements.get(n.id)!.spec;
    return spec !== "keep" && real(text, specChanges(text, n.syntax, spec, undefined, ownDistance)).length > 0;
  });
  const needsPositioning = specs.some((n) => (plan.placements.get(n.id)!.spec as PositionSpec).kind === "positioning");
  const libs = needsPositioning ? ["positioning"] : [];
  const lands = (t: string, ids: readonly string[]) => {
    const l = layoutDocumentPicture(analyzeDocument(t), picIndex);
    return !!l && ids.every((id) => {
      const got = l.nodes.find((x) => x.id === id);
      const want = plan.placements.get(id)!.center;
      return !!got && !got.locked && dist(got.shape.center, want) <= EXACT;
    });
  };
  const describe = (n: LaidOutNode) => ({ id: n.id, name: n.name ?? "a node", text: placementText(plan.placements.get(n.id)!.spec as PositionSpec) });

  // All at once.
  const all = specs.flatMap((n) => real(text, specChanges(text, n.syntax, plan.placements.get(n.id)!.spec as PositionSpec, undefined, ownDistance)));
  const lib = withLibraries(text, picIndex, all, libs);
  const once = applyChanges(text, lib.changes);
  if (lands(once, members.map((n) => n.id))) return { changes: lib.changes, text: once, written: specs.map(describe), added: lib.added, notes: lib.notes };

  // Node by node.
  let current = text;
  let changes: Change[] = [];
  const out: Written["written"] = [];
  const added = new Set<string>();
  const notes = new Set<string>();
  for (const m of specs) {
    const l = layoutDocumentPicture(analyzeDocument(current), picIndex);
    const n = l?.nodes.find((x) => x.id === m.id);
    if (!l || !n) return { reason: "A node couldn't be found while writing the layout." };
    const spec = plan.placements.get(m.id)!.spec as PositionSpec;
    const step = withLibraries(current, picIndex, real(current, specChanges(current, n.syntax, spec, undefined, ownDistance)), spec.kind === "positioning" ? libs : []);
    const next = applyChanges(current, step.changes);
    if (lands(next, [m.id])) {
      changes = composeChanges(text, changes, step.changes);
      current = next;
      out.push(describe(m));
      step.added.forEach((a) => added.add(a));
      step.notes.forEach((x) => notes.add(x));
      continue;
    }
    const want = plan.placements.get(m.id)!.center;
    const r = planMove(current, picIndex, m.id, want);
    if (!r || dist(r.center, want) > EXACT) return { reason: `The new position of ${m.name ?? "a node"} couldn't be written exactly, so nothing was changed.` };
    changes = composeChanges(text, changes, r.changes);
    current = r.text;
    out.push({ id: m.id, name: m.name ?? "a node", text: placementText(r.spec) });
    if (r.library) added.add("positioning");
    r.notes.forEach((x) => notes.add(x));
  }
  if (!lands(current, members.map((n) => n.id))) return { reason: "The layout couldn't be written exactly, so nothing was changed." };
  return { changes, text: current, written: out, added: [...added], notes: [...notes] };
}

/** A route stop written as plain numbers, "(2,1)", "(-3.5cm,1cm)" or "(30:2cm)": fixed on the page. */
function isAbsoluteStop(text: string, relative?: string, node?: string): boolean {
  if (relative || node) return false;
  const num = String.raw`\s*[-+]?(\d+\.?\d*|\.\d+)\s*(cm|mm|pt|in|bp|em|ex)?\s*`;
  return new RegExp(`^${num}[,:]${num}$`).test(text);
}

/** Corners written as plain coordinates on an edge whose ends moved: they would point at where the nodes used to be. */
function staleCorner(edge: Edge, moved: ReadonlySet<string>): number | null {
  if (edge.lock || !((edge.source && moved.has(edge.source)) || (edge.target && moved.has(edge.target)))) return null;
  for (const k of edgeVertices(edge)) {
    const s = edge.route.stops[k]!;
    if (isAbsoluteStop(s.text, s.relative, s.node)) return k;
  }
  return null;
}

/**
 * A one-corner orthogonal edge between bare node names whose ends now line
 * up: its corner falls inside a node, so TikZ would run the line to that
 * node's centre.
 */
function degenerateCorner(edge: Edge, layout: PictureLayout): boolean {
  if (edge.lock || edge.mode !== "orthogonal" || edge.segs.length !== 1) return false;
  const s = edge.route.segs[edge.segs[0]!]!;
  const a = edge.route.stops[edge.from]!;
  const b = edge.route.stops[edge.to]!;
  const corner = s.kind === "vh" ? { x: a.point.x, y: b.point.y } : { x: b.point.x, y: a.point.y };
  const inside = (stop: typeof a, id: string | undefined) => {
    const n = id && layout.nodes.find((x) => x.id === id);
    if (!n || stop.anchor) return false;
    const { center: c, hw, hh } = n.shape;
    return Math.abs(corner.x - c.x) < hw - ALIGN_EPS && Math.abs(corner.y - c.y) < hh - ALIGN_EPS;
  };
  return inside(a, edge.source) || inside(b, edge.target);
}

/** What a label is called in a note: its text as written. */
function labelText(text: string, n: LaidOutNode): string {
  const t = text.slice(n.syntax.from, n.syntax.to);
  const m = /\{([^{}]*)\}\s*$/.exec(t);
  return m ? `"${m[1]!.trim()}"` : "a label";
}

/**
 * After the nodes moved: orthogonal edges whose ends now line up run
 * straight (`--`), and labels that the moved lines now cut through (and
 * didn't before) are put beside the line with `auto`, as a form change does
 * (D63). Each through the edge editor's own planners, so each is checked.
 */
function tidyEdges(text: string, picIndex: number, before: PictureLayout): { changes: Change[]; text: string; straightened: number; labels: number; notes: string[] } {
  let current = text;
  let changes: Change[] = [];
  let straightened = 0;
  let labels = 0;
  const notes: string[] = [];
  const key = (t: string, l: PictureLayout, labelId: string) => {
    const edge = pictureEdges(l).find((e) => e.labels.some((n) => n.id === labelId));
    const n = l.pathNodes.find((x) => x.id === labelId);
    return `${nameOf(l, edge?.source)}>${nameOf(l, edge?.target)}:${n ? t.slice(n.syntax.from, n.syntax.to) : labelId}`;
  };
  const cutBefore = new Set(labelsOnTheirLine(before).map((x) => key(text, before, x.labelId)));
  const failed = new Set<string>();
  for (let guard = 0; guard < 500; guard++) {
    const l = layoutDocumentPicture(analyzeDocument(current), picIndex);
    if (!l) break;
    const edge = pictureEdges(l).find((e) => !failed.has(`s${e.source}>${e.target}`) && degenerateCorner(e, l));
    if (edge) {
      const r = planStraighten(current, picIndex, edge.id);
      if (!r.ok) {
        failed.add(`s${edge.source}>${edge.target}`);
        continue;
      }
      changes = composeChanges(text, changes, r.changes);
      current = r.text;
      straightened++;
      notes.push(`the orthogonal edge ${nameOf(l, edge.source)} → ${nameOf(l, edge.target)} now runs straight, so it is written with --`);
      continue;
    }
    const cut = labelsOnTheirLine(l).find((x) => !failed.has(`l${key(current, l, x.labelId)}`) && !cutBefore.has(key(current, l, x.labelId)));
    if (!cut) break;
    const r = planLabelBesideLine(current, picIndex, cut.labelId);
    if (!r.ok) {
      failed.add(`l${key(current, l, cut.labelId)}`);
      continue;
    }
    const label = l.pathNodes.find((n) => n.id === cut.labelId)!;
    notes.push(`the label ${labelText(current, label)} was written as ${r.written}: its line now runs through where it was`);
    changes = composeChanges(text, changes, r.changes);
    current = r.text;
    labels++;
  }
  return { changes, text: current, straightened, labels, notes };
}

/** Removes stale corners, one at a time (each removal is checked by the edge editor). */
function removeStaleCorners(text: string, picIndex: number, before: PictureLayout): { changes: Change[]; text: string; corners: number; notes: string[] } {
  let current = text;
  let changes: Change[] = [];
  let corners = 0;
  const notes: string[] = [];
  const failed = new Set<string>();
  for (let guard = 0; guard < 500; guard++) {
    const l = layoutDocumentPicture(analyzeDocument(current), picIndex);
    if (!l) break;
    const moved = new Set(l.nodes.filter((n) => {
      const was = before.nodes.find((m) => m.id === n.id);
      return was && dist(was.shape.center, n.shape.center) > ALIGN_EPS;
    }).map((n) => n.id));
    const edge = pictureEdges(l).find((e) => !failed.has(`${e.source}>${e.target}`) && staleCorner(e, moved) !== null);
    if (!edge) break;
    const r = planRemoveVertex(current, picIndex, edge.id, staleCorner(edge, moved)!);
    if (!r.ok) {
      failed.add(`${edge.source}>${edge.target}`);
      notes.push(`a corner of the edge ${nameOf(l, edge.source)} → ${nameOf(l, edge.target)} couldn't be removed (${r.reason.replace(/\.$/, "")})`);
      continue;
    }
    changes = composeChanges(text, changes, r.changes);
    current = r.text;
    corners++;
  }
  // Curves drawn through fixed control points keep them.
  const l = layoutDocumentPicture(analyzeDocument(current), picIndex);
  if (l) {
    for (const e of pictureEdges(l)) {
      if (e.lock || e.mode !== "curved") continue;
      const fixed = e.route.segs.some((s, k) => e.segs.includes(k) && s.kind === "curve" && /\.\.\s*controls\s*\(\s*[-+\d.]/.test(current.slice(e.range.from, e.range.to)));
      if (fixed) notes.push(`the curve ${nameOf(l, e.source)} → ${nameOf(l, e.target)} has control points at fixed coordinates; they were left as written`);
    }
  }
  return { changes, text: current, corners, notes };
}

function nameOf(layout: PictureLayout, id: string | undefined): string {
  return (id && layout.nodes.find((n) => n.id === id)?.name) || "a point";
}

// ---------------------------------------------------------------- the whole edit

/** Why the picture (or the selection) can't be laid out, or null. */
export function layoutBlocker(layout: PictureLayout, ids?: readonly string[]): string | null {
  const { members } = layoutScope(layout, ids);
  if (members.length < 2) return ids && ids.length >= 2 ? "Fewer than two of the selected nodes can be moved, so there is nothing to lay out." : "There are fewer than two nodes that can be moved, so there is nothing to lay out.";
  return null;
}

/**
 * Lays out picture `picIndex` (or the selected nodes) with ELK's layered
 * algorithm and writes the result as relative positions, as one edit.
 */
export async function planAutoLayout(text: string, picIndex: number, options: AutoLayoutOptions): Promise<AutoLayoutResult> {
  const layout = layoutDocumentPicture(analyzeDocument(text), picIndex);
  if (!layout) return { ok: false, reason: "There is no picture." };
  const blocked = layoutBlocker(layout, options.ids);
  if (blocked) return { ok: false, reason: blocked };

  // Chains are written out first so their nodes can be placed (D77 item 4).
  let base = text;
  let pre: Change[] = [];
  const idMap = new Map<string, string>();
  const conversions: Array<ChainConversion & { ok: true }> = [];
  const serials = new Set<number>();
  for (const n of layoutScope(layout, options.ids).members) {
    if (n.lock?.kind !== "chain" || !n.chain || serials.has(n.chain.serial)) continue;
    serials.add(n.chain.serial);
    const c = planChainConversion(base, picIndex, idMap.get(n.id) ?? n.id);
    if (!c.ok) return { ok: false, reason: c.reason };
    pre = composeChanges(text, pre, c.changes);
    base = c.text;
    for (const [k, v] of idMap) if (c.ids.has(v)) idMap.set(k, c.ids.get(v)!);
    for (const [k, v] of c.ids) if (!idMap.has(k)) idMap.set(k, v);
    conversions.push(c);
  }
  const ids = options.ids?.map((id) => idMap.get(id) ?? id);

  const start = layoutDocumentPicture(analyzeDocument(base), picIndex);
  if (!start) return { ok: false, reason: "The picture couldn't be laid out." };
  const { members } = layoutScope(start, ids);
  if (members.length < 2) return { ok: false, reason: "There are fewer than two nodes that can be moved, so there is nothing to lay out." };
  const centers = await elkCenters(elkGraph(start, members, options.direction));
  if (members.some((n) => !centers.has(n.id))) return { ok: false, reason: "The layout engine left out some nodes, so nothing was changed." };
  // A second pass lines nodes up with the ones the first placed after them in the code.
  const movers = inheritedDistances(base, picIndex, members);
  let plan = choosePlacements(start, members, centers, options.direction, undefined, movers);
  for (let pass = 0; pass < PASSES; pass++) plan = choosePlacements(start, members, centers, options.direction, plan, movers);

  const w = writePlacements(base, picIndex, members, plan);
  if ("reason" in w) return { ok: false, reason: w.reason };
  const corners = removeStaleCorners(w.text, picIndex, start);
  let changes = composeChanges(text, pre, w.changes);
  changes = composeChanges(text, changes, corners.changes);
  const tidy = tidyEdges(corners.text, picIndex, start);
  changes = composeChanges(text, changes, tidy.changes);
  const final = tidy.text;
  if (applyChanges(text, changes) !== final) return { ok: false, reason: "The layout couldn't be written as one edit." };

  // Nodes outside the layout stay where they were, unless they follow a laid-out node.
  const after = layoutDocumentPicture(analyzeDocument(final), picIndex);
  if (!after) return { ok: false, reason: "The picture couldn't be laid out after the change." };
  const moving = movingWith(start, members.map((n) => n.id));
  for (const n of after.nodes) {
    const was = start.nodes.find((m) => m.id === n.id);
    if (!was) return { ok: false, reason: "The layout would change the picture's nodes, so it wasn't written." };
    if (!moving.has(n.id) && n.position.kind !== "fit" && dist(was.shape.center, n.shape.center) > 0.05) {
      return { ok: false, reason: `The layout would also move ${n.name ?? "a node"}, which isn't part of it, so it wasn't written.` };
    }
  }
  const notes = [...w.notes, ...corners.notes, ...tidy.notes];
  const memberSet = new Set(members.map((n) => n.id));
  const crowdedNames = plan.crowded.map((id) => start.nodes.find((n) => n.id === id)?.name ?? "a node");
  if (crowdedNames.length) notes.push(`${listNames(crowdedNames)} couldn't be placed clear of the other nodes`);
  // Laid-out nodes that now sit on a node the layout didn't move.
  for (const n of after.nodes) {
    if (!memberSet.has(n.id)) continue;
    const box = shapeBounds(n.shape);
    const hit = after.nodes.find((m) => !memberSet.has(m.id) && m.kind === "statement" && m.position.kind !== "fit" && m.shape.kind !== "coordinate" && overlaps(box, shapeBounds(m.shape)));
    if (hit) notes.push(`${n.name ?? "a node"} now overlaps ${hit.name ?? "a node"}, which stays where it is`);
  }
  return {
    ok: true,
    changes,
    text: final,
    direction: options.direction,
    count: members.length,
    written: w.written,
    kept: members.length - w.written.length,
    corners: corners.corners,
    straightened: tidy.straightened,
    labels: tidy.labels,
    conversions,
    added: w.added,
    notes,
  };
}

function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** A one-line summary for the status bar. */
export function autoLayoutMessage(r: AutoLayoutResult & { ok: true }): string {
  const how = r.direction === "down" ? "top to bottom" : "left to right";
  if (!r.changes.length) return `The ${r.count} nodes already follow this layout (${how}); nothing was changed.`;
  const parts = r.written.slice(0, 3).map((x) => `${x.name}: ${x.text}`);
  const more = r.written.length > 3 ? `, and ${r.written.length - 3} more` : "";
  let s = `Laid out ${r.count} nodes ${how}.`;
  if (r.written.length) s += ` Wrote ${parts.join("; ")}${more}.`;
  if (r.kept) s += ` ${r.kept === 1 ? "One node keeps its" : `${r.kept} nodes keep their`} position as written.`;
  if (r.corners) s += ` Removed ${r.corners === 1 ? "a corner" : `${r.corners} corners`} written as fixed coordinates.`;
  if (r.added.length) s += ` Loaded ${r.added.join(", ")}.`;
  for (const c of r.conversions) s += ` ${conversionMessage(c)}`;
  for (const n of r.notes) s += ` Note: ${n}.`;
  return s;
}
