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
import { fitBoxes, laneSets, laneUpkeep } from "./lanes.ts";
import { withLibraries } from "./libraries.ts";
import { ALIGN_EPS, formatDistance, planMove, type PositionSpec, positioningText, specChanges } from "./move.ts";
import { removeItems } from "./optionEdits.ts";
import type { OptionItem, Range } from "../model/syntax.ts";
import { labelsOnTheirLine, planLabelBesideLine, planLabelsBesideLine } from "./labels.ts";
import { edgeVertices, planRemoveVertex, planStraighten, straightenChanges } from "./vertices.ts";

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
  /**
   * Keep the nodes of each group (a `fit` node that isn't a lane) together, groups inside groups
   * included, so a group's box doesn't run over other nodes (D84). True always does (the importer);
   * by default it is done when the plain layout would make groups cross (D86 item 1, D87); false never.
   * Ignored when the picture has lanes.
   */
  groups?: boolean;
  /** Told as each stage starts, so a long layout can show how far it is (D83 item 4). */
  onProgress?: (p: LayoutProgress) => void;
  /** "Allow reordering statements" (D81 item 4): a node's statement may move later in the code when that is safe and gives it a plain relation. Off unless true. */
  reorder?: boolean;
}

/** How far a layout is: stage `step` of `steps`, and what it is doing. */
export interface LayoutProgress {
  step: number;
  steps: number;
  what: string;
}

/** The stages of a layout, in order, as told to onProgress. */
export const LAYOUT_STAGES = [
  "writing out chains",
  "running ELK",
  "choosing each node's relation",
  "lining nodes up (second pass)",
  "lining nodes up (third pass)",
  "writing the relations",
  "removing stale corners",
  "tidying edges and labels",
  "checking the result",
] as const;

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
      /** Statements moved later in the code (reorder), each with the node it now follows and how many moved along. */
      reordered: Array<{ id: string; name: string; after: string; carried: number }>;
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

/**
 * The lane of each member, by its place in its set (D81), and whether the lanes
 * run along the flow (columns in a picture laid out top to bottom) or across it.
 */
export interface LaneOrder {
  index: ReadonlyMap<string, number>;
  along: boolean;
}

/** The members' lanes, for keeping lanes apart in the layout. Null when there are none. */
export function laneOrder(text: string, layout: PictureLayout, members: readonly LaidOutNode[], direction: LayoutDirection): LaneOrder | null {
  const set = laneSets(text, layout)[0];
  if (!set) return null;
  const index = new Map<string, number>();
  set.lanes.forEach((lane, i) => {
    for (const id of lane.members) if (members.some((m) => m.id === id)) index.set(id, i);
  });
  if (!index.size) return null;
  return { index, along: (set.orientation === "columns") === (direction === "down") };
}

/** Room a group's box takes around what it holds: its inner sep and border, and a title above. */
const GROUP_PAD = 4 * MM;
const TITLE_PAD = 5 * MM;

/** The groups to keep together (D84): each fit node with the nodes and fit nodes it lists, and what each member sits in. */
export interface GroupTree {
  /** Group (fit node) ids, outermost first. */
  order: string[];
  /** Ids of what a group lists directly: laid-out nodes and other groups. */
  children: Map<string, string[]>;
  /** The group directly around a node or group. */
  parent: Map<string, string>;
  /** Whether a group has a title above it. */
  titled: Set<string>;
  /** How far each group's box reaches past what it holds (its inner sep and border), in pt. */
  pad: Map<string, number>;
}

/**
 * The groups of the picture as a tree, for the layout: a fit node counts when
 * every node it holds is laid out. A node listed by several groups sits in the
 * smallest; a group that only partly overlaps another is left out.
 */
export function groupTree(text: string, layout: PictureLayout, members: readonly LaidOutNode[]): GroupTree | null {
  const inScope = new Set(members.map((n) => n.id));
  const boxes = fitBoxes(text, layout).filter((b) => b.members.length > 0);
  const byId = new Map(boxes.map((b) => [b.node.id, b]));
  // The laid-out nodes under a group, nested groups included.
  const leaves = (id: string, seen = new Set<string>()): string[] | null => {
    if (seen.has(id)) return null;
    seen.add(id);
    const box = byId.get(id);
    if (!box) return inScope.has(id) ? [id] : null;
    const out: string[] = [];
    for (const m of box.members) {
      const l = leaves(m, seen);
      if (!l) return null;
      out.push(...l);
    }
    return out;
  };
  const sizes = new Map<string, number>();
  const eligible: string[] = [];
  for (const b of boxes) {
    const l = leaves(b.node.id);
    if (l && l.length) {
      sizes.set(b.node.id, l.length);
      eligible.push(b.node.id);
    }
  }
  if (!eligible.length) return null;
  // Each member goes to the smallest group that lists it.
  const parent = new Map<string, string>();
  for (const id of eligible) {
    for (const m of byId.get(id)!.members) {
      if (!inScope.has(m) && !sizes.has(m)) continue;
      const was = parent.get(m);
      if (!was || sizes.get(id)! < sizes.get(was)!) parent.set(m, id);
    }
  }
  const children = new Map<string, string[]>(eligible.map((id) => [id, []]));
  for (const [m, p] of parent) children.get(p)!.push(m);
  // A group that lost all its members to smaller ones, or is nested in itself, is dropped.
  const usable = eligible.filter((id) => children.get(id)!.length > 0);
  const keep = new Set(usable);
  for (const [m, p] of [...parent]) if (!keep.has(p) || (sizes.has(m) && !keep.has(m))) parent.delete(m);
  for (const id of usable) children.set(id, children.get(id)!.filter((m) => parent.get(m) === id));
  const depth = (id: string): number => (parent.has(id) ? 1 + depth(parent.get(id)!) : 0);
  const order = usable.filter((id) => children.get(id)!.length).sort((a, b) => depth(a) - depth(b));
  if (!order.length) return null;
  const titled = new Set(order.filter((id) => byId.get(id)!.title));
  // The box's own margin round its members, as drawn now: it doesn't depend on where they are.
  const nodeById = new Map(layout.nodes.map((n) => [n.id, n]));
  const pad = new Map<string, number>();
  for (const id of order) {
    const box = shapeBounds(nodeById.get(id)!.shape);
    const held = children.get(id)!.flatMap((m) => nodeById.get(m) ?? []).map((n) => shapeBounds(n.shape));
    const margin = held.length ? Math.min(box.minX < Infinity ? Math.min(...held.map((b) => b.minX)) - box.minX : 0, box.maxX - Math.max(...held.map((b) => b.maxX)), box.maxY - Math.max(...held.map((b) => b.maxY)), Math.min(...held.map((b) => b.minY)) - box.minY) : 0;
    pad.set(id, Math.max(GROUP_PAD, margin));
  }
  return { order, children, parent, titled, pad };
}

/**
 * Whether, laid out without groups (ELK's centers), two groups' boxes would
 * cross (overlap without one holding the other) or a group's box would cover
 * a node of another group. Nodes in no group may sit inside a box: authors
 * often fit only the corner nodes of a row. Depends only on what ELK is given,
 * so a second layout decides the same way.
 */
export function groupsCross(layout: PictureLayout, members: readonly LaidOutNode[], centers: ReadonlyMap<string, Point>, groups: GroupTree): boolean {
  const byId = new Map(members.map((n) => [n.id, n]));
  const rect = (id: string) => {
    const n = byId.get(id)!;
    const c = centers.get(id)!;
    return shapeBounds({ ...n.shape, center: c });
  };
  const leaves = (id: string): string[] => (groups.children.get(id) ?? [id]).flatMap((m) => (groups.children.has(m) ? leaves(m) : byId.has(m) && centers.has(m) ? [m] : []));
  const boxes = new Map(
    groups.order.map((g) => {
      const rs = leaves(g).map(rect);
      const pad = groups.pad.get(g) ?? GROUP_PAD;
      return [g, { minX: Math.min(...rs.map((r) => r.minX)) - pad, maxX: Math.max(...rs.map((r) => r.maxX)) + pad, minY: Math.min(...rs.map((r) => r.minY)) - pad, maxY: Math.max(...rs.map((r) => r.maxY)) + pad + (groups.titled.has(g) ? TITLE_PAD : 0) }];
    }),
  );
  const within = (g: string, h: string): boolean => groups.parent.get(g) === h || (groups.parent.has(g) && within(groups.parent.get(g)!, h));
  const meet = (a: { minX: number; maxX: number; minY: number; maxY: number }, b: typeof a) => Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > CLEAR && Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY) > CLEAR;
  const groupOf = new Map<string, string>();
  for (const g of groups.order) for (const id of leaves(g)) if (!groupOf.has(id) || within(g, groupOf.get(id)!)) groupOf.set(id, g);
  for (const g of groups.order) {
    const box = boxes.get(g)!;
    for (const h of groups.order) if (g < h && !within(g, h) && !within(h, g) && meet(box, boxes.get(h)!)) return true;
    for (const [id, h] of groupOf) if (h !== g && !within(h, g) && meet(box, rect(id))) return true;
  }
  return false;
}

/** The graph for ELK: the members with their outer sizes, and the edges between them. */
export function elkGraph(layout: PictureLayout, members: readonly LaidOutNode[], direction: LayoutDirection, lanes: LaneOrder | null = null, groups: GroupTree | null = null): ElkNode {
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
    // "on grid" measures center to center: what is left between the borders.
    if (members.filter((n) => n.onGrid).length * 2 > members.length) {
      const s = median(members.map((n) => (axis === "v" ? size(n).h : size(n).w)));
      return Math.max(d - s, 5 * MM);
    }
    return d;
  };
  const between = direction === "down" ? gap("v") : gap("h");
  const within = direction === "down" ? gap("h") : gap("v");
  // Lanes across the flow (D81) are ELK's partitions: each lane's nodes take layers after
  // the lanes before it. Lanes along the flow are placed after ELK (laneColumns).
  const partitions = lanes && !lanes.along;
  const partition = (n: LaidOutNode) => String(lanes?.index.get(n.id) ?? lanes!.index.size);
  // The gaps, for the picture and, with groups, inside each group's box too.
  const spacing = {
    "elk.direction": direction === "down" ? "DOWN" : "RIGHT",
    "elk.spacing.nodeNode": String(r2(within)),
    "elk.layered.spacing.nodeNodeBetweenLayers": String(r2(between)),
    "elk.spacing.edgeNode": String(r2(within / 2)),
    "elk.spacing.edgeEdge": String(r2(within / 4)),
    "elk.layered.spacing.edgeNodeBetweenLayers": "0",
    "elk.layered.spacing.edgeEdgeBetweenLayers": "0",
  };
  return {
    id: "picture",
    layoutOptions: {
      "elk.algorithm": "layered",
      ...spacing,
      // Edges into one node meet at one point, so nodes line up center to center.
      "elk.layered.mergeEdges": "true",
      // Back edges are found by following the code's own order.
      "elk.layered.cycleBreaking.strategy": "DEPTH_FIRST",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.separateConnectedComponents": "false",
      ...(groups ? { "elk.hierarchyHandling": "INCLUDE_CHILDREN" } : {}),
      ...(partitions ? { "elk.partitioning.activate": "true" } : {}),
    },
    children: groups ? groupChildren(members, size, groups, spacing) : members.map((n) => ({
      id: n.id,
      width: size(n).w,
      height: size(n).h,
      ...(partitions ? { layoutOptions: { "elk.partitioning.partition": partition(n) } } : {}),
    })),
    edges,
  };
}

/** ELK's hierarchy for groups: each group is a node holding its members, so its nodes stay together. */
function groupChildren(members: readonly LaidOutNode[], size: (n: LaidOutNode) => { w: number; h: number }, groups: GroupTree, spacing: Record<string, string>): ElkNode[] {
  const leaf = new Map(members.map((n) => [n.id, n]));
  const build = (id: string): ElkNode => {
    const n = leaf.get(id);
    if (n) return { id, width: size(n).w, height: size(n).h };
    const pad = groups.pad.get(id) ?? GROUP_PAD;
    const top = r2(pad + (groups.titled.has(id) ? TITLE_PAD : 0));
    return {
      id,
      layoutOptions: { ...spacing, "elk.padding": `[top=${top},left=${r2(pad)},bottom=${r2(pad)},right=${r2(pad)}]` },
      children: (groups.children.get(id) ?? []).map(build),
    };
  };
  const roots = [...members.map((n) => n.id), ...groups.order].filter((id) => !groups.parent.has(id));
  return roots.map(build);
}

type ElkLayout = (graph: ElkNode) => Promise<ElkNode>;

let elkInstance: Promise<ElkLayout> | null = null;

/** elk.js, loaded on first use (it is 1.6 MB). */
function loadElk(): Promise<ElkLayout> {
  elkInstance ??= (async () => {
    // Where there is no document (the layout worker, D87), elk.js takes itself for a worker script
    // and takes over the worker's messages. It is shown a stand-in while it loads and starts, so it
    // runs as a library here as it does on the page.
    const g = globalThis as { document?: unknown };
    const stand = g.document === undefined;
    if (stand) g.document = {};
    try {
      const m = await import("elkjs/lib/elk.bundled.js");
      const elk = new m.default();
      return (graph: ElkNode) => elk.layout(graph);
    } finally {
      if (stand) delete g.document;
    }
  })();
  return elkInstance;
}

/** Runs ELK and returns each member's center in canvas pt (y up). */
export async function elkCenters(graph: ElkNode): Promise<Map<string, Point>> {
  const out = await (await loadElk())(graph);
  const centers = new Map<string, Point>();
  // Nodes in groups are placed relative to their group's corner.
  const visit = (nodes: readonly ElkNode[], ox: number, oy: number) => {
    for (const c of nodes) {
      const x = ox + (c.x ?? 0);
      const y = oy + (c.y ?? 0);
      if (c.children?.length) visit(c.children, x, y);
      else centers.set(c.id, { x: x + (c.width ?? 0) / 2, y: -(y + (c.height ?? 0) / 2) });
    }
  };
  visit(out.children ?? [], 0, 0);
  return centers;
}

/**
 * Lanes along the flow (D81): ELK's layers are kept, and each lane gets a band
 * of its own across them, in the lanes' order. Within a lane, the nodes of one
 * layer sit side by side in ELK's order, centered in the band, so a lane with
 * one node per layer is one straight column. Nodes in no lane come last.
 */
export function laneColumns(members: readonly LaidOutNode[], centers: ReadonlyMap<string, Point>, direction: LayoutDirection, lanes: LaneOrder): Map<string, Point> {
  const frame = FRAMES[direction];
  const grid = readGrid(members, centers, frame);
  const node = new Map(members.map((n) => [n.id, n]));
  const across = (id: string) => {
    const b = shapeBounds(node.get(id)!.shape);
    return direction === "down" ? b.maxX - b.minX : b.maxY - b.minY;
  };
  const gap = median(members.map((n) => (direction === "down" ? n.nodeDistance.h : n.nodeDistance.v) * n.vectorScale));
  const count = lanes.index.size ? Math.max(...lanes.index.values()) + 2 : 1;
  const laneOf = (id: string) => lanes.index.get(id) ?? count - 1;
  const width: number[] = [];
  const widest: number[] = [];
  for (let i = 0; i < count; i++) {
    const ids = members.filter((n) => laneOf(n.id) === i).map((n) => n.id);
    widest[i] = ids.length ? Math.max(...ids.map(across)) : 0;
    const slots = Math.max(0, ...grid.layers.map((layer) => layer.filter((id) => laneOf(id) === i).length));
    width[i] = slots ? slots * widest[i]! + (slots - 1) * gap : 0;
  }
  // Lanes are a node distance apart, plus room for their own padding.
  const laneGap = 2 * gap;
  const start: number[] = [];
  let at = 0;
  for (let i = 0; i < count; i++) {
    start[i] = at;
    if (width[i]) at += width[i]! + laneGap;
  }
  const out = new Map<string, Point>();
  for (const layer of grid.layers) {
    for (let i = 0; i < count; i++) {
      const ids = layer.filter((id) => laneOf(id) === i).sort((a, b) => frame.across(centers.get(a)!) - frame.across(centers.get(b)!));
      const used = ids.length * widest[i]! + (ids.length - 1) * gap;
      ids.forEach((id, k) => {
        const c = start[i]! + (width[i]! - used) / 2 + k * (widest[i]! + gap) + widest[i]! / 2;
        const along = frame.along(centers.get(id)!);
        out.set(id, direction === "down" ? { x: c, y: -along } : { x: along, y: -c });
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- reading ELK's grid

interface Grid {
  layer: Map<string, number>;
  /** Position within its layer. */
  index: Map<string, number>;
  /** Nodes whose centers line up across layers share a column. */
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

/** The center `dir=<v and h> of ref` gives `n`, with the ref's center at `at`; distances in the node's own units, undefined for its node distance. */
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
 * Distances are rounded to whole millimetres, and the center returned is where
 * the rounded relation puts the node.
 */
function toward(ref: LaidOutNode, at: Point, n: LaidOutNode, target: Point): Placement | null {
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
  // Who refers to each member in the previous pass, for following placements back to a node.
  const referredBy = new Map<string, string[]>();
  for (const [id, refs] of previous?.refs ?? []) for (const r of refs) referredBy.set(r, [...(referredBy.get(r) ?? []), id]);
  const hintFor = (n: string) => {
    if (!previous) return new Map<string, Point>();
    // The placements that go through n, directly or not.
    const through = new Set<string>([n]);
    const queue = [n];
    while (queue.length) for (const m of referredBy.get(queue.pop()!) ?? []) if (!through.has(m)) through.add(m), queue.push(m);
    return new Map([...previous.placements].filter(([id]) => !through.has(id)).map(([id, p]) => [id, p.center]));
  };
  const crowded: string[] = [];
  const named = (id: string) => {
    const m = byId.get(id)!;
    return !!m.name && !m.implicitName && SIMPLE_NAME.test(m.name);
  };
  const at = (id: string) => placed.get(id)!.center;
  // The boxes of the placed members, kept as they are placed: clear() is asked many times per node.
  const boxes: Array<ReturnType<typeof boxAt>> = [boxAt(first, first.shape.center)];
  const clear = (n: LaidOutNode, c: Point) => {
    const box = boxAt(n, c);
    return boxes.every((b) => !overlaps(box, b));
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
    // The other members, nearest to n in ELK's picture first.
    const tn = target.get(n.id)!;
    const byNearness = members.map((m) => m.id).filter((id) => id !== n.id).map((id) => ({ id, d: dist(target.get(id)!, tn) })).sort((p, q) => p.d - q.d).map((x) => x.id);
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
    // 3. Beside its neighbor in the layer, at ELK's gap.
    const rowMates = refs.filter((id) => grid.layer.get(id) === L).sort((p, q) => Math.abs(grid.index.get(p)! - I) - Math.abs(grid.index.get(q)! - I));
    /**
     * ELK's place for `n` seen from `r`, lined up with its column and layer:
     * with the nearest of them placed, else with where the previous pass put
     * one defined later in the code.
     */
    /** Members from the previous pass that lineUp lined n up with: n's place depends on theirs. */
    const aligned = new Set<string>();
    const lineUp = (r: string): Point => {
      // Measured from the node nearest in ELK's picture, placed or from the previous pass, so that a
      // distance written to a far-away node doesn't carry the difference between ELK's gaps and TikZ's.
      const base = byNearness.find((id) => placed.has(id) || hints.has(id)) ?? r;
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
      for (const id of [base, xFrom, yFrom]) if (id && !placed.has(id) && hints.has(id)) aligned.add(id);
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
    for (const id of [...colMates, ...rowMates].slice(0, 2)) add(toward(byId.get(id)!, at(id), mv, lineUp(id)));
    // 6. Anywhere: from the nearest node placed, lined up with what is placed of its column and layer.
    const near = [...refs].sort((p, q) => dist(target.get(p)!, target.get(n.id)!) - dist(target.get(q)!, target.get(n.id)!))[0];
    let fallback: Placement | null = null;
    if (near) fallback = toward(byId.get(near)!, at(near), mv, lineUp(near));
    add(fallback);

    // Nothing clear: the nearest clear place to ELK's, searched outwards in 5 mm steps.
    if (near && !candidates.some((c) => clear(n, c.center))) {
      const goal = lineUp(near);
      search: for (let k = 1; k <= 40; k++) {
        const d = k * 5 * MM;
        const tries = [frame.across({ x: 1, y: 0 }) !== 0 ? { x: d, y: 0 } : { x: 0, y: -d }, frame.along({ x: 1, y: 0 }) !== 0 ? { x: d, y: 0 } : { x: 0, y: -d }];
        for (const t of [tries[0]!, { x: -tries[0]!.x, y: -tries[0]!.y }, tries[1]!]) {
          const p = toward(byId.get(near)!, at(near), mv, { x: goal.x + t.x, y: goal.y + t.y });
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
      boxes.push(boxAt(n, n.shape.center));
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
    boxes.push(boxAt(n, chosen.center));
    // The members it now refers to: the latest placed member of each name it uses.
    const byName = (name: string) => [...placed.keys()].reverse().find((id) => id !== n.id && byId.get(id)!.name === name);
    const names = chosen.spec === "keep" ? (was ? [was.name!] : []) : chosen.spec.kind === "perp" ? [chosen.spec.xFrom, chosen.spec.yFrom] : chosen.spec.kind === "positioning" ? [chosen.spec.target] : [];
    // And the ones it was lined up with, so the next pass doesn't line them up with n's own old place.
    refsOf.set(n.id, [...new Set([...names.flatMap((name) => byName(name) ?? []), ...aligned])]);
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
 * node's center.
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
 * Whether straightening the edges at `indices` (of pictureEdges) left
 * everything else as it was: the nodes where they were, the other edges'
 * points too, and each of those edges now one straight line.
 */
function straightenedOnly(a: PictureLayout, b: PictureLayout, indices: ReadonlySet<number>): boolean {
  if (a.nodes.length !== b.nodes.length || a.nodes.some((n, i) => dist(n.shape.center, b.nodes[i]!.shape.center) > 0.05)) return false;
  const ea = pictureEdges(a);
  const eb = pictureEdges(b);
  if (ea.length !== eb.length) return false;
  return ea.every((e, i) => {
    const f = eb[i]!;
    if (e.source !== f.source || e.target !== f.target) return false;
    if (indices.has(i)) return f.segs.length === 1 && f.route.segs[f.segs[0]!]!.kind === "line";
    return e.route.stops.length === f.route.stops.length && e.route.stops.every((s, k) => dist(s.point, f.route.stops[k]!.point) <= 0.05);
  });
}

/**
 * After the nodes moved: orthogonal edges whose ends now line up run
 * straight (`--`), and labels that the moved lines now cut through (and
 * didn't before) are put beside the line with `auto`, as a form change does
 * (D63). Each kind is written all at once and checked with one layout (D87);
 * what doesn't hold in a batch goes through the edge editor's own planners,
 * one at a time, each checked.
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
  const straightNote = (l: PictureLayout, e: Edge) => `the orthogonal edge ${nameOf(l, e.source)} → ${nameOf(l, e.target)} now runs straight, so it is written with --`;

  // Every orthogonal edge whose ends line up, in one go.
  const l0 = layoutDocumentPicture(analyzeDocument(current), picIndex);
  if (l0) {
    const batch = pictureEdges(l0).flatMap((e, i) => {
      const c = degenerateCorner(e, l0) ? straightenChanges(current, e) : null;
      return c ? [{ e, i, c }] : [];
    });
    if (batch.length) {
      const cs = batch.flatMap((x) => x.c).sort((p, q) => p.from - q.from);
      const next = applyChanges(current, cs);
      const doc = analyzeDocument(next);
      const l1 = layoutDocumentPicture(doc, picIndex);
      if (l1 && doc.errors.length <= analyzeDocument(current).errors.length && straightenedOnly(l0, l1, new Set(batch.map((x) => x.i)))) {
        changes = composeChanges(text, changes, cs);
        current = next;
        straightened += batch.length;
        for (const x of batch) notes.push(straightNote(l0, x.e));
      }
    }
  }

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
      notes.push(straightNote(l, edge));
      continue;
    }
    const cuts = labelsOnTheirLine(l).filter((x) => !failed.has(`l${key(current, l, x.labelId)}`) && !cutBefore.has(key(current, l, x.labelId)));
    if (!cuts.length) break;
    // All at once; the ones that don't hold there are tried one at a time.
    const batch = planLabelsBesideLine(current, picIndex, l, cuts.map((x) => x.labelId));
    for (const f of batch.fixed) {
      const label = l.pathNodes.find((n) => n.id === f.labelId)!;
      notes.push(`the label ${labelText(current, label)} was written as ${f.written}: its line now runs through where it was`);
    }
    if (batch.fixed.length) {
      changes = composeChanges(text, changes, batch.changes);
      current = batch.text;
      labels += batch.fixed.length;
      if (batch.rest.length) continue;
      break;
    }
    const cut = cuts[0]!;
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

// ---------------------------------------------------------------- reordering statements (D81 item 4)

/** A placement a person wouldn't write if the node could refer to its neighbor: a distance, a diagonal or a shift. */
function roundabout(spec: PositionSpec | "keep"): boolean {
  if (spec === "keep") return false;
  if (spec.kind !== "positioning") return spec.kind !== "perp";
  return spec.v !== undefined || spec.h !== undefined || !!spec.shift || spec.dir.includes(" ");
}

/** The range of whole lines a statement fills by itself (comments after it included), or null if it shares a line. */
function ownLines(text: string, r: Range): Range | null {
  const start = text.lastIndexOf("\n", r.from - 1) + 1;
  if (text.slice(start, r.from).trim()) return null;
  const nl = text.indexOf("\n", r.to);
  const end = nl < 0 ? text.length : nl + 1;
  const rest = text.slice(r.to, nl < 0 ? text.length : nl);
  if (rest.trim() && !rest.trim().startsWith("%")) return null;
  return { from: start, to: end };
}

/** Whether `text` uses the name `name` as a whole word. */
function mentions(text: string, name: string): boolean {
  const esc = name.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_\\-:])${esc}([^A-Za-z0-9_\\-:]|$)`).test(text);
}

export interface Reordered {
  changes: Change[];
  text: string;
  /** Each node moved, the node it now follows in the code, and how many statements moved along (placed against it or after it in the flow). */
  moved: Array<{ id: string; name: string; after: string; carried: number }>;
}

/**
 * The opt-in "Allow reordering statements" (D81 item 4): a node the plan
 * places in a roundabout way (`below=20cm of init`) because the node it
 * follows in the flow comes later in the code gets its statement moved to
 * just after that node's, when that is safe: both are top-level statements on
 * lines of their own, everything in between is a node statement of the layout
 * (or a coordinate) that doesn't mention the moved node's name, and the node
 * isn't on a chain. Nothing in between can then depend on it, and the drawing
 * order only changes among nodes the layout keeps apart. Each move is checked:
 * no node may move.
 */
export function planReorder(text: string, picIndex: number, layout: PictureLayout, members: readonly LaidOutNode[], centers: ReadonlyMap<string, Point>, plan: Plan, direction: LayoutDirection, only?: ReadonlySet<string>): Reordered | null {
  const frame = FRAMES[direction];
  const grid = readGrid(members, centers, frame);
  const order = new Map(members.map((n, i) => [n.id, i]));
  const named = (n: LaidOutNode) => !!n.name && !n.implicitName && SIMPLE_NAME.test(n.name);
  const edges = pictureEdges(layout);
  /**
   * The nodes a node follows in the flow, in order of preference: the one above it in its column,
   * the one before it in its layer, the nearest one an edge comes from in the layer above.
   */
  const leaders = (n: LaidOutNode): LaidOutNode[] => {
    const L = grid.layer.get(n.id)!;
    const above = members.find((m) => grid.column.get(m.id) === grid.column.get(n.id) && grid.layer.get(m.id) === L - 1);
    const before = members.find((m) => grid.layer.get(m.id) === L && grid.index.get(m.id) === grid.index.get(n.id)! - 1);
    const across = (m: LaidOutNode) => Math.abs(frame.across(centers.get(m.id)!) - frame.across(centers.get(n.id)!));
    const from = members.filter((m) => grid.layer.get(m.id) === L - 1 && edges.some((e) => e.source === m.id && e.target === n.id)).sort((p, q) => across(p) - across(q))[0];
    return [above, before, from].filter((m): m is LaidOutNode => !!m && named(m));
  };
  const wanted: Array<{ node: LaidOutNode; after: LaidOutNode }> = [];
  for (const n of members.slice(1)) {
    if (only && !only.has(n.id)) continue;
    if (!roundabout(plan.placements.get(n.id)!.spec) || !named(n) || n.chain || plan.crowded.includes(n.id)) continue;
    const after = leaders(n).find((m) => order.get(m.id)! > order.get(n.id)!);
    if (after) wanted.push({ node: n, after });
  }
  /** Whom each member follows in the flow, by id: what moves along with a moved node. */
  const leader = new Map(members.map((m) => [m.id, leaders(m)[0]?.id]));
  if (!wanted.length) return null;
  let current = text;
  let changes: Change[] = [];
  const moved: Reordered["moved"] = [];
  const memberIds = new Set(members.map((n) => n.id));
  for (const w of wanted) {
    const doc = analyzeDocument(current);
    const pic = doc.syntax.pictures[picIndex];
    const l = layoutDocumentPicture(doc, picIndex);
    if (!pic || !l) break;
    const n = l.nodes.find((x) => x.id === w.node.id);
    const a = l.nodes.find((x) => x.id === w.after.id);
    if (!n || !a) continue;
    // The top-level items from n's statement to a's.
    let depth = 0;
    let from = -1;
    let to = -1;
    const top: Array<{ item: (typeof pic.items)[number]; depth: number }> = pic.items.map((item) => {
      if (item.kind === "scope-begin") depth++;
      const d = depth;
      if (item.kind === "scope-end") depth--;
      return { item, depth: d };
    });
    top.forEach(({ item, depth: d }, i) => {
      if (item.kind !== "node" || d !== 0) return;
      if (item.node.from === n.syntax.from) from = i;
      if (item.node.from === a.syntax.from) to = i;
    });
    if (from < 0 || to <= from) continue;
    const between = top.slice(from + 1, to + 1);
    const nodes = between.map(({ item, depth: d }) => (item.kind === "node" && d === 0 ? l.nodes.find((x) => x.syntax.from === item.node.from) : undefined));
    if (nodes.some((m) => !m || (!memberIds.has(m.id) && m.shape.kind !== "coordinate"))) continue;
    // The statements between that are placed against n, or follow it in the flow, directly or not,
    // move with it, in their order.
    const carried: LaidOutNode[] = [];
    const names = [n.name!];
    const ids = new Set([n.id]);
    for (const m of nodes.slice(0, -1) as LaidOutNode[]) {
      const said = current.slice(m.statement.from, m.statement.to);
      if (names.some((x) => mentions(said, x)) || ids.has(leader.get(m.id) ?? "")) {
        carried.push(m);
        ids.add(m.id);
        if (m.name) names.push(m.name);
      }
    }
    const group = [n, ...carried];
    const lines = group.map((m) => ownLines(current, m.statement));
    const target = ownLines(current, a.statement);
    const chained = group.some((m) => m.chain || m.syntax.options.some((o) => o.items.some((i) => i.key === "on chain" || i.key === "join")));
    if (!target || lines.some((x) => !x) || chained || names.some((x) => mentions(current.slice(a.statement.from, a.statement.to), x))) continue;
    const step: Change[] = [
      ...(lines as Range[]).map((r) => ({ from: r.from, to: r.to, insert: "" })),
      { from: target.to, to: target.to, insert: (lines as Range[]).map((r) => current.slice(r.from, r.to)).join("") },
    ];
    const next = applyChanges(current, step);
    const doc2 = analyzeDocument(next);
    const l2 = layoutDocumentPicture(doc2, picIndex);
    // Nothing may move, and nothing may break.
    if (!l2 || doc2.errors.length > doc.errors.length || l2.nodes.length !== l.nodes.length) continue;
    if (l.nodes.some((x) => {
      const y = l2.nodes.find((z) => z.id === x.id);
      return !y || dist(x.shape.center, y.shape.center) > 0.01 || !!y.locked !== !!x.locked;
    })) continue;
    changes = composeChanges(text, changes, step);
    current = next;
    moved.push({ id: n.id, name: n.name!, after: a.name!, carried: carried.length });
  }
  return moved.length ? { changes, text: current, moved } : null;
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
  const stage = (k: number) => options.onProgress?.({ step: k + 1, steps: LAYOUT_STAGES.length, what: LAYOUT_STAGES[k]! });
  stage(0);
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

  let start = layoutDocumentPicture(analyzeDocument(base), picIndex);
  if (!start) return { ok: false, reason: "The picture couldn't be laid out." };
  let { members } = layoutScope(start, ids);
  if (members.length < 2) return { ok: false, reason: "There are fewer than two nodes that can be moved, so there is nothing to lay out." };
  const lanes = laneOrder(base, start, members, options.direction);
  const tree = options.groups !== false && !lanes ? groupTree(base, start, members) : null;
  stage(1);
  let raw = await elkCenters(elkGraph(start, members, options.direction, lanes, null));
  // Groups are kept together when asked (the importer), or by default when the plain layout would
  // make groups cross (D86 item 1, D87).
  const groups = tree && (options.groups === true || groupsCross(start, members, raw, tree)) ? tree : null;
  if (groups) raw = await elkCenters(elkGraph(start, members, options.direction, lanes, groups));
  const centers = lanes?.along && members.every((n) => raw.has(n.id)) ? laneColumns(members, raw, options.direction, lanes) : raw;
  if (members.some((n) => !centers.has(n.id))) return { ok: false, reason: "The layout engine left out some nodes, so nothing was changed." };
  // A second pass lines nodes up with the ones the first placed after them in the code.
  const planFor = (l: PictureLayout, ms: readonly LaidOutNode[], t: string, report: boolean) => {
    const movers = inheritedDistances(t, picIndex, ms);
    if (report) stage(2);
    let p = choosePlacements(l, ms, centers, options.direction, undefined, movers);
    for (let pass = 0; pass < PASSES; pass++) {
      if (report) stage(3 + pass);
      p = choosePlacements(l, ms, centers, options.direction, p, movers);
    }
    return p;
  };
  let plan = planFor(start, members, base, true);
  // "Allow reordering statements" (D81 item 4): moves, then the plan again in the new code order.
  // ELK's result stays: named nodes keep their ids. Moves that don't end in a plain relation are undone.
  let reordered: Reordered["moved"] = [];
  if (options.reorder) {
    // Round by round: a moved node can leave the one that followed it without a neighbor before
    // it in the code, which the next round moves too. The best state is kept, and only if it has
    // fewer roundabout placements than the plan without moves.
    const count = (p: Plan) => [...p.placements.values()].filter((x) => roundabout(x.spec)).length;
    const state = { pre, base, start, members, plan, moved: [] as Reordered["moved"] };
    let best = { ...state, n: count(plan) };
    let only: Set<string> | undefined;
    for (let round = 0; round < 8; round++) {
      const r = planReorder(state.base, picIndex, state.start, state.members, centers, state.plan, options.direction, only);
      if (!r) break;
      const l2 = layoutDocumentPicture(analyzeDocument(r.text), picIndex);
      const ms2 = l2 ? layoutScope(l2, ids).members : [];
      if (!l2 || ms2.length !== state.members.length || ms2.some((m) => !centers.has(m.id))) break;
      const p2 = planFor(l2, ms2, r.text, false);
      const clean = new Set(r.moved.filter((m) => !roundabout(p2.placements.get(m.id)!.spec)).map((m) => m.id));
      if (clean.size < r.moved.length) {
        if (!clean.size) break;
        only = clean;
        continue;
      }
      only = undefined;
      Object.assign(state, { pre: composeChanges(text, state.pre, r.changes), base: r.text, start: l2, members: ms2, plan: p2, moved: [...state.moved, ...r.moved] });
      if (count(p2) < best.n) best = { ...state, n: count(p2) };
    }
    if (best.moved.length) ({ pre, base, start, members, plan, moved: reordered } = best);
  }
  stage(5);

  const w = writePlacements(base, picIndex, members, plan);
  if ("reason" in w) return { ok: false, reason: w.reason };
  stage(6);
  const corners = removeStaleCorners(w.text, picIndex, start);
  let changes = composeChanges(text, pre, w.changes);
  changes = composeChanges(text, changes, corners.changes);
  stage(7);
  const tidy = tidyEdges(corners.text, picIndex, start);
  changes = composeChanges(text, changes, tidy.changes);
  // Lanes keep their shared top and bottom at the members' extremes (D81).
  const upkeep = laneUpkeep(tidy.text, picIndex);
  changes = composeChanges(text, changes, upkeep);
  const final = applyChanges(tidy.text, upkeep);
  if (applyChanges(text, changes) !== final) return { ok: false, reason: "The layout couldn't be written as one edit." };

  // Nodes outside the layout stay where they were, unless they follow a laid-out node.
  stage(8);
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
    reordered,
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
  if (r.reordered.length) s += ` Moved ${listNames(r.reordered.map((m) => `${m.name}'s line${m.carried ? ` (and ${m.carried === 1 ? "the line" : `the ${m.carried} lines`} placed against it or after it in the flow)` : ""} after ${m.after}'s`))}, so each can be placed relative to the node before it in the flow.`;
  for (const n of r.notes) s += ` Note: ${n}.`;
  return s;
}
