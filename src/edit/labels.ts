// Edge labels (M2b step 7, D54): adding a label to an edge, sliding it along
// the edge (`pos=`), and the Yes/No labels on the branches of a decision.
// Labels are nodes inside the path, written before the end they belong to:
// `(a) -- node[pos=0.3, above] {yes} (b)`.
import { analyzeDocument, layoutDocumentPicture } from "../model/document.ts";
import { type Edge, edgeOfLabel, labelSegIndex, pictureEdges } from "../model/edges.ts";
import type { LaidOutNode, LaidOutPath, PictureLayout, RouteSeg } from "../tikz/layout.ts";
import { segPoint } from "../tikz/layout.ts";
import type { Point } from "../tikz/shapes.ts";
import { applyChanges, type Change } from "./changes.ts";
import { findEdge } from "./edges.ts";
import { labelProblem } from "./label.ts";
import { formatOption, nodeTarget, setOption } from "./optionEdits.ts";

export type LabelAdded = { ok: true; changes: Change[]; text: string; layout: PictureLayout; edgeId: string; labelId: string; written: string } | { ok: false; reason: string };
export type LabelSlid = { ok: true; changes: Change[]; text: string; layout: PictureLayout; pos: number; written: string } | { ok: false; reason: string };

const near = (a: Point, b: Point, eps = 0.05) => Math.hypot(a.x - b.x, a.y - b.y) <= eps;

/** Keys that set where a label sits along its segment. */
const POS_KEYS = new Set(["pos", "midway", "near start", "near end", "very near start", "very near end", "at start", "at end"]);

/** A position written the way a person would: 0.3, 0.5, 1. */
export function formatPos(t: number): string {
  return String(Math.round(t * 100) / 100);
}

/** How a path looks as drawn, for checking that a label edit didn't change it. */
function drawnOf(p: LaidOutPath): string {
  return JSON.stringify([p.d, p.stroke, p.lineWidth, p.dash, p.tips.map((t) => [Math.round(t.at.x * 100), Math.round(t.at.y * 100), Math.round(t.angle * 1000)])]);
}

/** The point of `seg` nearest `p`: where along it (0 to 1, as TikZ's `pos` counts it), the point, and how far away. */
export function closestOnSegment(seg: RouteSeg, p: Point): { t: number; point: Point; dist: number } {
  const N = 120;
  let bestT = 0;
  let bestD = Infinity;
  for (let i = 0; i <= N; i++) {
    const q = segPoint(seg, i / N).point;
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < bestD) {
      bestD = d;
      bestT = i / N;
    }
  }
  // Refine between the neighbouring samples.
  let lo = Math.max(0, bestT - 1 / N);
  let hi = Math.min(1, bestT + 1 / N);
  for (let k = 0; k < 24; k++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    const d1 = Math.hypot(segPoint(seg, m1).point.x - p.x, segPoint(seg, m1).point.y - p.y);
    const d2 = Math.hypot(segPoint(seg, m2).point.x - p.x, segPoint(seg, m2).point.y - p.y);
    if (d1 < d2) hi = m2;
    else lo = m1;
  }
  const t = (lo + hi) / 2;
  const point = segPoint(seg, t).point;
  return { t, point, dist: Math.hypot(point.x - p.x, point.y - p.y) };
}

/** The side of a label that keeps it off the line: above or below a mostly level edge, left or right of a mostly upright one. */
export function labelSide(angle: number, at: Point, on: Point): "above" | "below" | "left" | "right" {
  const level = Math.abs(Math.cos(angle)) >= Math.abs(Math.sin(angle));
  if (level) return at.y < on.y - 0.5 ? "below" : "above";
  return at.x < on.x - 0.5 ? "left" : "right";
}

/** What `t` is written as: snapped to quarters, else to hundredths (Alt) or twentieths. */
export function roundPos(t: number, snap: boolean): number {
  const c = Math.min(1, Math.max(0, t));
  if (!snap) return Math.round(c * 100) / 100;
  for (const q of [0.25, 0.5, 0.75]) if (Math.abs(c - q) <= 0.03) return q;
  return Math.round(c * 20) / 20;
}

// ---------------------------------------------------------------- adding a label

/** Why no label can be added to this edge, or null. */
export function addLabelBlocker(edge: Edge): string | null {
  if (edge.lock) return `This edge can't be edited: ${edge.lock.message}.`;
  const seg = edge.segs.map((k) => edge.route.segs[k]!).find((s) => !s.cycle);
  if (!seg) return "This edge has no segment a label can be written on.";
  return null;
}

/**
 * Adds a label to the edge, at the point of the edge nearest `at`, written
 * before the end of that segment: `(a) -- node[pos=0.3, above] {text} (b)`.
 * `side` picks above/below/left/right; the default depends on how the edge runs.
 */
export function planAddLabel(text: string, picIndex: number, edgeId: string, at: Point, label: string, side?: "above" | "below" | "left" | "right"): LabelAdded {
  const problem = labelProblem(label);
  if (problem) return { ok: false, reason: problem };
  const doc = analyzeDocument(text);
  const layout = layoutDocumentPicture(doc, picIndex);
  const edge = layout && findEdge(layout, edgeId);
  if (!layout || !edge) return { ok: false, reason: "There is no such edge." };
  const blocked = addLabelBlocker(edge);
  if (blocked) return { ok: false, reason: blocked };
  // The segment nearest the point.
  let best: { k: number; t: number; point: Point; dist: number } | null = null;
  for (const k of edge.segs) {
    const s = edge.route.segs[k]!;
    if (s.cycle) continue;
    const c = closestOnSegment(s, at);
    if (!best || c.dist < best.dist) best = { k, ...c };
  }
  if (!best) return { ok: false, reason: "This edge has no segment a label can be written on." };
  const seg = edge.route.segs[best.k]!;
  const stop = edge.route.stops[seg.b]!;
  if (stop.item < 0) return { ok: false, reason: "The end of this segment can't be found in the code." };
  const t = roundPos(best.t, true);
  const angle = segPoint(seg, t).angle;
  const where = segPoint(seg, t).point;
  const opts = [Math.abs(t - 0.5) < 0.03 ? null : `pos=${formatPos(t)}`, side ?? labelSide(angle, at, where)].filter(Boolean).join(", ");
  const insert = `node[${opts}] {${label}} `;
  const changes: Change[] = [{ from: stop.range.from, to: stop.range.from, insert }];
  const next = applyChanges(text, changes);
  const doc2 = analyzeDocument(next);
  const layout2 = layoutDocumentPicture(doc2, picIndex);
  const refused = { ok: false as const, reason: "The label couldn't be written there without changing the drawing, so it wasn't added." };
  if (!layout2 || doc2.errors.length > doc.errors.length) return refused;
  if (layout2.nodes.length !== layout.nodes.length || layout2.pathNodes.length !== layout.pathNodes.length + 1) return refused;
  if (layout2.nodes.some((n, i) => !near(n.shape.center, layout.nodes[i]!.shape.center))) return refused;
  if (JSON.stringify(layout.paths.map(drawnOf)) !== JSON.stringify(layout2.paths.map(drawnOf))) return refused;
  const made = layout2.pathNodes.find((n) => n.syntax.from === stop.range.from);
  const edge2 = findEdge(layout2, edgeId);
  if (!made || !edge2 || !edge2.labels.some((n) => n.id === made.id)) return refused;
  return { ok: true, changes, text: next, layout: layout2, edgeId, labelId: made.id, written: insert.trim() };
}

// ---------------------------------------------------------------- sliding a label

/** Why this label can't be slid along its edge, or null. */
export function slideBlocker(layout: PictureLayout, labelId: string): string | null {
  const label = layout.pathNodes.find((n) => n.id === labelId);
  if (!label) return "There is no such label.";
  const edge = edgeOfLabel(pictureEdges(layout), labelId);
  if (!edge) return "This label isn't on an edge, so it can't be slid along one.";
  if (edge.lock) return `This edge can't be edited: ${edge.lock.message}.`;
  if (!label.pathPos) return "This label isn't placed along a segment of its edge.";
  return null;
}

/**
 * Moves a label along its edge to where `p` is nearest, writing `pos=`. The
 * label stays on its own segment. The key that set its position before
 * (`pos`, `midway`, `near start`, …) is replaced; with none, `pos=` is added.
 */
export function planSlideLabel(text: string, picIndex: number, labelId: string, p: Point, snap = true): LabelSlid {
  const doc = analyzeDocument(text);
  const layout = layoutDocumentPicture(doc, picIndex);
  if (!layout) return { ok: false, reason: "There is no picture." };
  const blocked = slideBlocker(layout, labelId);
  if (blocked) return { ok: false, reason: blocked };
  const label = layout.pathNodes.find((n) => n.id === labelId)!;
  const edge = edgeOfLabel(pictureEdges(layout), labelId)!;
  const seg = edge.route.segs[edge.path.id.includes("/edge") ? edge.segs[0]! : labelSegIndex(edge.path, label)];
  if (!seg) return { ok: false, reason: "The label's segment couldn't be found." };
  const pos = roundPos(closestOnSegment(seg, p).t, snap);
  const current = label.pathPos!.t;
  const hasKey = label.syntax.options.some((l) => l.items.some((i) => POS_KEYS.has(i.key)));
  if (Math.abs(pos - current) < 0.001 && (hasKey || Math.abs(current - 0.5) < 0.001 || Math.abs(current - 1) < 0.001)) {
    return { ok: true, changes: [], text, layout, pos, written: `pos=${formatPos(pos)}` };
  }
  // Where it already sits by default (halfway, or at the end for a label after its end) needs nothing written.
  const written = formatOption("pos", formatPos(pos));
  const changes = setOption(text, nodeTarget(label.syntax), (i) => POS_KEYS.has(i.key), written);
  if (!changes) return { ok: false, reason: "This label's position comes from a style argument, so it can't be changed here. Change it in the code." };
  const next = applyChanges(text, changes);
  const doc2 = analyzeDocument(next);
  const layout2 = layoutDocumentPicture(doc2, picIndex);
  const refused = { ok: false as const, reason: "Sliding the label there would change the drawing in another way, so it wasn't done." };
  if (!layout2 || doc2.errors.length > doc.errors.length) return refused;
  if (layout2.nodes.length !== layout.nodes.length || layout2.pathNodes.length !== layout.pathNodes.length) return refused;
  if (layout2.nodes.some((n, i) => !near(n.shape.center, layout.nodes[i]!.shape.center))) return refused;
  if (JSON.stringify(layout.paths.map(drawnOf)) !== JSON.stringify(layout2.paths.map(drawnOf))) return refused;
  const moved = layout2.pathNodes.find((n) => n.syntax.from === label.syntax.from);
  if (!moved?.pathPos || Math.abs(moved.pathPos.t - pos) > 0.011) return refused;
  return { ok: true, changes, text: next, layout: layout2, pos, written };
}

// ---------------------------------------------------------------- Yes/No on decisions

/** The pairs of branch labels the editor knows, in the order it writes them. */
const PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["Yes", "No"],
  ["yes", "no"],
  ["Y", "N"],
  ["y", "n"],
  ["True", "False"],
  ["true", "false"],
  ["Ja", "Nein"],
  ["ja", "nein"],
];

/** Whether a node is a decision: a diamond, or styled `decision`. */
export function isDecision(n: LaidOutNode): boolean {
  return n.kind === "statement" && (n.shape.kind === "diamond" || n.syntax.options.some((l) => l.items.some((i) => i.key === "decision")));
}

const innerText = (text: string, n: LaidOutNode): string => {
  const inner = n.syntax.label?.inner;
  return inner ? text.slice(inner.from, inner.to).trim() : "";
};

/**
 * The label for the next branch out of decision `from`: "Yes" for the first
 * edge and "No" for the second (D45), or the other half of the pair the figure
 * already uses ("yes"/"no", "Ja"/"Nein"). Null when the figure uses other
 * wording, the decision already has two branches, or its branches are unlabelled
 * but not the first.
 */
export function branchLabel(text: string, layout: PictureLayout, from: LaidOutNode): string | null {
  if (!isDecision(from) || usesOtherWording(text, layout)) return null;
  const out = pictureEdges(layout).filter((e) => e.source === from.id);
  const used = out.flatMap((e) => e.labels.map((n) => innerText(text, n)).filter(Boolean));
  if (!out.length) return pairOf(text, layout)[0];
  if (out.length >= 2) return null;
  // One branch so far: the other half of its pair. An unlabelled one gives no clue.
  const first = used[0];
  if (first === undefined) return null;
  const pair = PAIRS.find((p) => p.includes(first));
  if (!pair) return null;
  return pair[pair[0] === first ? 1 : 0];
}

/** The pair a figure uses for its decisions, from the labels already on their branches; "Yes"/"No" when it has none. */
function pairOf(text: string, layout: PictureLayout): readonly [string, string] {
  const decisions = new Set(layout.nodes.filter(isDecision).map((n) => n.id));
  for (const e of pictureEdges(layout)) {
    if (!e.source || !decisions.has(e.source)) continue;
    for (const n of e.labels) {
      const pair = PAIRS.find((p) => p.includes(innerText(text, n)));
      if (pair) return pair;
    }
  }
  return PAIRS[0]!;
}

/** Whether the figure writes other wording on its decisions' branches, so no automatic label should be added. */
export function usesOtherWording(text: string, layout: PictureLayout): boolean {
  const decisions = new Set(layout.nodes.filter(isDecision).map((n) => n.id));
  let any = false;
  for (const e of pictureEdges(layout)) {
    if (!e.source || !decisions.has(e.source)) continue;
    for (const n of e.labels) {
      const t = innerText(text, n);
      if (t && !PAIRS.some((p) => p.includes(t))) any = true;
    }
  }
  return any;
}

/** The label node written for a new branch: `node[near start, above] {Yes}`; the side follows the direction the edge leaves in. */
export function branchLabelText(label: string, direction: "below" | "above" | "left" | "right"): string {
  const side = direction === "below" || direction === "above" ? "right" : "above";
  return `node[near start, ${side}] {${label}}`;
}
