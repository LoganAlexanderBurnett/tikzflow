// Edges that a straight line would draw through other nodes get a bend (M4
// step 5, D84): an imported diagram's loop back to an earlier step, or an edge
// that skips a layer. ELK routes such edges around the nodes; the code writes
// straight `--` lines, so the gap is closed here the way a person would: a
// `bend left` or `bend right` on that edge, the smallest angle that clears
// every node. Only edges the importer wrote are touched, and only by changing
// their `--` into `to[bend …]`.
import { analyzeDocument, layoutDocumentPicture } from "../model/document.ts";
import { pictureEdges } from "../model/edges.ts";
import type { LaidOutNode } from "../tikz/layout.ts";
import { anchorPoint, type Point, shapeBounds } from "../tikz/shapes.ts";
import { applyChanges, type Change } from "../edit/changes.ts";

const DEG = 180 / Math.PI;
/** TikZ's control distance for looseness 1, as a share of the distance between the ends (tikzlibrarytopaths). */
const SPAN = 0.3915;
/** Bend angles tried, smallest first. */
const ANGLES = [30, 45, 60, 75, 90];
/** A node counts as in the way when the line comes this close to its box, in pt (shrinks the box). */
const MARGIN = 1;

interface Box {
  id: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const polar = (p: Point, deg: number, d: number): Point => ({ x: p.x + Math.cos(deg / DEG) * d, y: p.y + Math.sin(deg / DEG) * d });
const angleOf = (a: Point, b: Point) => Math.atan2(b.y - a.y, b.x - a.x) * DEG;

/** Whether the segment from a to b passes through the box (Liang–Barsky). */
function segmentHits(a: Point, b: Point, box: Box): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return clip(-dx, a.x - box.minX) && clip(dx, box.maxX - a.x) && clip(-dy, a.y - box.minY) && clip(dy, box.maxY - a.y) && t0 < t1;
}

/** Points along the cubic Bézier p0, p1, p2, p3. */
function sample(p0: Point, p1: Point, p2: Point, p3: Point, n = 24): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
  }
  return out;
}

const shrink = (n: LaidOutNode): Box => {
  const b = shapeBounds(n.shape);
  return { id: n.id, minX: b.minX + MARGIN, minY: b.minY + MARGIN, maxX: b.maxX - MARGIN, maxY: b.maxY - MARGIN };
};

/**
 * The curve `to[bend left=K]` (or right) draws between two nodes, as TikZ does
 * it: out at the line's angle plus K, in at the opposite angle minus K, control
 * points a share of the distance away, ends on the borders where the curve
 * leaves and arrives.
 */
function bendPoints(a: LaidOutNode, b: LaidOutNode, k: number, side: 1 | -1): Point[] | null {
  const alpha = angleOf(a.shape.center, b.shape.center);
  const out = alpha + side * k;
  const into = alpha + 180 - side * k;
  const p0 = anchorPoint(a.shape, String(((out % 360) + 360) % 360));
  const p3 = anchorPoint(b.shape, String(((into % 360) + 360) % 360));
  if (!p0 || !p3) return null;
  const d = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  return sample(p0, polar(p0, out, SPAN * d), polar(p3, into, SPAN * d), p3);
}

export interface RouteResult {
  text: string;
  /** Edges given a bend. */
  bent: number;
  /** Edges that cross a node and couldn't be cleared. */
  left: number;
}

/** Gives a bend to every straight edge of picture 0 that runs through a node. */
export function routeAroundNodes(text: string): RouteResult {
  const doc = analyzeDocument(text);
  const layout = layoutDocumentPicture(doc, 0);
  if (!layout) return { text, bent: 0, left: 0 };
  const nodes = layout.nodes.filter((n) => n.kind === "statement" && n.position.kind !== "fit" && n.shape.kind !== "coordinate");
  const boxes = nodes.map(shrink);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const changes: Change[] = [];
  let left = 0;
  for (const edge of pictureEdges(layout)) {
    if (edge.lock || edge.mode !== "straight" || !edge.source || !edge.target || edge.source === edge.target) continue;
    const a = byId.get(edge.source);
    const b = byId.get(edge.target);
    const seg = edge.route.segs[edge.segs[0]!];
    const op = seg && edge.path.syntax.items[seg.op];
    if (!a || !b || !seg || seg.kind !== "line" || op?.kind !== "op" || op.op !== "--") continue;
    const others = boxes.filter((x) => x.id !== a.id && x.id !== b.id);
    if (!others.some((box) => segmentHits(seg.from, seg.to, box))) continue;
    let chosen: string | null = null;
    search: for (const k of ANGLES) {
      for (const side of [1, -1] as const) {
        const pts = bendPoints(a, b, k, side);
        if (!pts) continue;
        const clear = others.every((box) => pts.every((p, i) => i === 0 || !segmentHits(pts[i - 1]!, p, box)));
        // A curve that comes back through its own ends isn't a way round.
        if (clear) {
          chosen = `to[bend ${side === 1 ? "left" : "right"}=${k}]`;
          break search;
        }
      }
    }
    if (chosen) changes.push({ from: op.range.from, to: op.range.to, insert: chosen });
    else left++;
  }
  if (!changes.length) return { text, bent: 0, left };
  return { text: applyChanges(text, changes), bent: changes.length, left };
}
