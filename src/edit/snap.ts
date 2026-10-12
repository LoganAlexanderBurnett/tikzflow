// Snapping while dragging: line centers up with other nodes and snap gaps to
// the node distance, so drops land where a relational form describes them.
import type { LaidOutNode, PictureLayout } from "../tikz/layout.ts";
import { anchorOffset, type Point } from "../tikz/shapes.ts";
import { dependents } from "./move.ts";

export interface Guide {
  /** A vertical ("v", at x) or horizontal ("h", at y) alignment line, from one center to the other. */
  axis: "v" | "h";
  at: number;
  from: number;
  to: number;
}

export interface GapMark {
  from: Point;
  to: Point;
}

export interface SnapResult {
  center: Point;
  guides: Guide[];
  gaps: GapMark[];
  /** Ids of the nodes the result lines up with. */
  targets: string[];
}

interface Box {
  node: LaidOutNode;
  cx: number;
  cy: number;
  /** How far the north, south, east and west anchors are from the center: equal pairs except for shapes drawn off their text (a cylinder, D98). */
  n: number;
  s: number;
  e: number;
  w: number;
}

function box(n: LaidOutNode, c: Point = n.shape.center): Box {
  const off = (a: string, axis: "x" | "y", sign: number, fallback: number) => {
    const p = anchorOffset(n.shape, a);
    return p ? sign * p[axis] : fallback;
  };
  const hw = n.shape.hw + n.shape.outerX;
  const hh = n.shape.hh + n.shape.outerY;
  return { node: n, cx: c.x, cy: c.y, n: off("north", "y", 1, hh), s: off("south", "y", -1, hh), e: off("east", "x", 1, hw), w: off("west", "x", -1, hw) };
}

/**
 * Snaps a dragged node's center. `threshold` is in pt (a few screen pixels).
 * Nodes that move along with the dragged one are not snap targets, nor are
 * those in `moving` (the rest of a group dragged with it).
 */
export function snapNode(layout: PictureLayout, node: LaidOutNode, raw: Point, threshold: number, moving?: ReadonlySet<string>): SnapResult {
  const deps = dependents(layout, node.id);
  const targets = layout.nodes.filter((n) => n.id !== node.id && !deps.has(n.id) && !moving?.has(n.id) && n.kind !== "coordinate").map((n) => box(n));
  const me = box(node, raw);
  let x = raw.x;
  let y = raw.y;
  let bestX = threshold;
  let bestY = threshold;
  let alignX: Box | null = null;
  let alignY: Box | null = null;

  // Center alignment.
  for (const t of targets) {
    const dx = Math.abs(t.cx - raw.x);
    if (dx < bestX) {
      bestX = dx;
      x = t.cx;
      alignX = t;
    }
    const dy = Math.abs(t.cy - raw.y);
    if (dy < bestY) {
      bestY = dy;
      y = t.cy;
      alignY = t;
    }
  }

  // Gap snapping: in a column, snap the vertical gap to the nearest node above
  // or below to the node distance; in a row, the horizontal gap.
  const gaps: GapMark[] = [];
  const nd = node.nodeDistance;
  const grid = node.onGrid;
  if (alignX) {
    const column = targets.filter((t) => Math.abs(t.cx - x) < 0.5);
    let best = threshold;
    let snapY: number | null = null;
    let mark: GapMark | null = null;
    for (const t of column) {
      // Below t, then above t.
      const belowY = grid ? t.cy - nd.v : t.cy - t.s - nd.v - me.n;
      const aboveY = grid ? t.cy + nd.v : t.cy + t.n + nd.v + me.s;
      for (const [cand, isBelow] of [
        [belowY, true],
        [aboveY, false],
      ] as const) {
        const d = Math.abs(cand - raw.y);
        if (d < best) {
          best = d;
          snapY = cand;
          const edgeT = isBelow ? t.cy - t.s : t.cy + t.n;
          const edgeMe = isBelow ? cand + me.n : cand - me.s;
          mark = { from: { x, y: edgeT }, to: { x, y: edgeMe } };
        }
      }
    }
    if (snapY !== null && best < bestY + 0.01) {
      y = snapY;
      alignY = null;
      if (mark) gaps.push(mark);
    }
  }
  if (alignY && !gaps.length) {
    const row = targets.filter((t) => Math.abs(t.cy - y) < 0.5);
    let best = threshold;
    let snapX: number | null = null;
    let mark: GapMark | null = null;
    for (const t of row) {
      const rightX = grid ? t.cx + nd.h : t.cx + t.e + nd.h + me.w;
      const leftX = grid ? t.cx - nd.h : t.cx - t.w - nd.h - me.e;
      for (const [cand, isRight] of [
        [rightX, true],
        [leftX, false],
      ] as const) {
        const d = Math.abs(cand - raw.x);
        if (d < best) {
          best = d;
          snapX = cand;
          const edgeT = isRight ? t.cx + t.e : t.cx - t.w;
          const edgeMe = isRight ? cand - me.w : cand + me.e;
          mark = { from: { x: edgeT, y }, to: { x: edgeMe, y } };
        }
      }
    }
    if (snapX !== null && best < bestX + 0.01) {
      x = snapX;
      alignX = null;
      if (mark) gaps.push(mark);
    }
  }

  const guides: Guide[] = [];
  const aligned = new Set<string>();
  // Draw a guide for every node the final position lines up with.
  for (const t of targets) {
    if (Math.abs(t.cx - x) < 0.01) {
      guides.push({ axis: "v", at: x, from: t.cy, to: y });
      aligned.add(t.node.id);
    }
    if (Math.abs(t.cy - y) < 0.01) {
      guides.push({ axis: "h", at: y, from: t.cx, to: x });
      aligned.add(t.node.id);
    }
  }
  return { center: { x, y }, guides, gaps, targets: [...aligned] };
}
