// SPDX-License-Identifier: GPL-3.0-or-later
// Where TeX put each named node against where the quick preview put it (D98).
// The compile input asks TeX to write the anchors of the picture's named nodes
// to its log; a node more than a point away, or more than a point bigger or
// smaller, means the quick preview's geometry is wrong for it, so its outline on
// the canvas and the positions a drag writes would be off. The editor can't
// tell which of its rules is wrong, so it says so rather than correcting.

import type { LaidOutNode, PictureLayout } from "../tikz/layout.ts";
import { undrawable } from "../model/explain.ts";
import { anchorPoint } from "../tikz/shapes.ts";
import { REPORTABLE_NAME } from "./input.ts";
import type { TexPlacement } from "./log.ts";

/** How far TeX and the quick preview may disagree, in pt (the fidelity checks' bar, D23). */
export const PLACEMENT_TOLERANCE = 1;

export interface Misplaced {
  id: string;
  name: string;
  /** The larger of the distance between the two centers and the differences in width and height, in pt. */
  off: number;
  /** TeX's box: the midpoints of its compass anchors and its size. */
  tex: { x: number; y: number; w: number; h: number };
}

/** The nodes TeX is asked about: named in the code (not made up for chains), placed by the editor (not locked, except group boxes and chains), the last of each name, as in TeX. */
function reportable(layout: PictureLayout): Map<string, LaidOutNode> {
  const out = new Map<string, LaidOutNode>();
  for (const n of layout.nodes) {
    // Group and lane boxes are placed by the editor too (they fit their members); other locked nodes are where it can't say.
    if (!n.name || n.implicitName || (n.locked && n.lock?.kind !== "fit" && n.lock?.kind !== "chain") || !REPORTABLE_NAME.test(n.name)) continue;
    out.delete(n.name);
    out.set(n.name, n);
  }
  return out;
}

/** The names whose placement the compile input should ask TeX for. */
export function reportNames(layout: PictureLayout): string[] {
  return [...reportable(layout).keys()];
}

/** The nodes TeX puts elsewhere, or draws another size, than the quick preview, worst first. */
export function misplaced(layout: PictureLayout, placements: ReadonlyMap<string, TexPlacement>, tolerance = PLACEMENT_TOLERANCE): Misplaced[] {
  const out: Misplaced[] = [];
  for (const [name, node] of reportable(layout)) {
    const t = placements.get(name);
    if (!t) continue;
    // The preview already says it doesn't draw these as TeX does: the "not drawn" marker, or label text
    // "shown approximately" in the summary (a macro or command it can't typeset).
    if (undrawable(node).length || node.unrendered.length) continue;
    const at = (a: string) => anchorPoint(node.shape, a) ?? node.shape.center;
    const [n, s, e, w] = [at("north"), at("south"), at("east"), at("west")];
    const tex = { x: (t.east.x + t.west.x) / 2, y: (t.north.y + t.south.y) / 2, w: t.east.x - t.west.x, h: t.north.y - t.south.y };
    const off = Math.max(Math.hypot((e.x + w.x) / 2 - tex.x, (n.y + s.y) / 2 - tex.y), Math.abs(e.x - w.x - tex.w), Math.abs(n.y - s.y - tex.h));
    if (off > tolerance) out.push({ id: node.id, name, off, tex });
  }
  return out.sort((a, b) => b.off - a.off);
}
