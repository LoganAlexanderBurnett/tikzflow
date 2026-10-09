// Edge labels (M2b step 7, D54): adding a label to an edge, sliding it along
// the edge (`pos=`), and the Yes/No labels on the branches of a decision.
// Labels are nodes inside the path, written before the end they belong to:
// `(a) -- node[pos=0.3, above] {yes} (b)`.
import { analyzeDocument, layoutDocumentPicture } from "../model/document.ts";
import { type Edge, edgeOfLabel, labelSegIndex, pictureEdges } from "../model/edges.ts";
import type { LaidOutNode, LaidOutPath, PictureLayout, RouteSeg } from "../tikz/layout.ts";
import { segPoint } from "../tikz/layout.ts";
import type { Point } from "../tikz/shapes.ts";
import type { OptionItem } from "../model/syntax.ts";
import { applyChanges, type Change, composeChanges } from "./changes.ts";
import { type EditOutcome, findEdge } from "./edges.ts";
import { labelProblem } from "./label.ts";
import { findItems, formatOption, nodeTarget, removeItems, setOption } from "./optionEdits.ts";

export type LabelAdded = { ok: true; changes: Change[]; text: string; layout: PictureLayout; edgeId: string; labelId: string; written: string } | { ok: false; reason: string };
export type LabelSlid = { ok: true; changes: Change[]; text: string; layout: PictureLayout; pos: number; written: string } | { ok: false; reason: string };
export type LabelFlipped = { ok: true; changes: Change[]; text: string; layout: PictureLayout; edgeId: string; labelId: string; written: string; /** The label was on the line and is beside it now, rather than turned over. */ placed?: true } | { ok: false; reason: string };

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

// ---------------------------------------------------------------- which side of the edge a label is on (D57)

/** What a label's side is written as: `auto` is the left of the way the path runs, `auto, swap` the right. */
export type AutoKeys = "auto" | "auto, swap";

/**
 * The keys that put a label beside the path, on the side `toward` points to
 * (from the line towards where the label should sit). TikZ's `auto` keeps a
 * label beside the line on any segment, which `above` or `left` don't. When
 * `toward` doesn't say (it lies along the line), a level edge gets its label
 * above and an upright one on its right.
 */
export function autoSide(angle: number, toward: Point): AutoKeys {
  const left = { x: -Math.sin(angle), y: Math.cos(angle) };
  const len = Math.hypot(toward.x, toward.y);
  let d = len > 0 ? left.x * toward.x + left.y * toward.y : 0;
  if (len === 0 || Math.abs(d) < 0.1 * len) d = Math.abs(Math.cos(angle)) >= Math.abs(Math.sin(angle)) ? left.y : left.x;
  return d >= 0 ? "auto" : "auto, swap";
}

/** How far a line may cut into a label's box before the label counts as sitting on it, in pt. */
const OVERLAP = 1.5;

/** The segment of `edge` a label is placed on. */
function labelSegOf(edge: Edge, label: LaidOutNode): RouteSeg | undefined {
  return edge.route.segs[edge.path.id.includes("/edge") ? edge.segs[0]! : labelSegIndex(edge.path, label)];
}

export interface LabelGeometry {
  /** Where the label is attached to the path, and which way the path runs there. */
  point: Point;
  angle: number;
  /** The label's centre relative to that point. */
  offset: Point;
  /** How far the line cuts into the label's box: about 0 for a label beside the line, more for one on it. */
  overlap: number;
  /** +1 for a label on the left of the way the path runs, -1 on the right, 0 on the line. */
  side: -1 | 0 | 1;
}

/** Where a label sits relative to its edge, or null for a label that isn't placed along a segment. */
export function labelGeometry(edge: Edge, label: LaidOutNode): LabelGeometry | null {
  const seg = labelSegOf(edge, label);
  if (!seg || !label.pathPos) return null;
  const { point, angle } = segPoint(seg, label.pathPos.t);
  const c = label.shape.center;
  const offset = { x: c.x - point.x, y: c.y - point.y };
  // The distance from the line, along its left-hand normal.
  const across = -offset.x * Math.sin(angle) + offset.y * Math.cos(angle);
  const sh = label.shape;
  const reach = (sh.hw + sh.outerX) * Math.abs(Math.sin(angle)) + (sh.hh + sh.outerY) * Math.abs(Math.cos(angle));
  return { point, angle, offset, overlap: reach - Math.abs(across), side: Math.abs(across) < 0.5 ? 0 : across > 0 ? 1 : -1 };
}

const SIDE_WORDS: Record<string, readonly [number, number]> = { above: [0, 1], below: [0, -1], left: [-1, 0], right: [1, 0] };
const OPPOSITE_WORD: Record<string, string> = { above: "below", below: "above", left: "right", right: "left" };

/** `above`, `below left` and the like: the keys that put a label to one side of its point. */
const isSideKey = (i: OptionItem) => i.key.split(" ").every((w) => w in SIDE_WORDS);
const sideVector = (key: string): Point => {
  let x = 0;
  let y = 0;
  for (const w of key.split(" ")) {
    x += SIDE_WORDS[w]![0];
    y += SIDE_WORDS[w]![1];
  }
  return { x, y };
};
const oppositeKey = (key: string) => key.split(" ").map((w) => OPPOSITE_WORD[w]!).join(" ");
const sum = (vs: Point[]): Point => vs.reduce((a, v) => ({ x: a.x + v.x, y: a.y + v.y }), { x: 0, y: 0 });

/** The side keys written on the label itself. */
const ownSides = (label: LaidOutNode) => findItems(nodeTarget(label.syntax), isSideKey);

/** The changes that replace the label's own side keys by `keys`: the last one is replaced, any others go. */
function replaceSides(text: string, sides: ReturnType<typeof ownSides>, keys: string): Change[] {
  const last = sides[sides.length - 1]!;
  const changes: Change[] = [{ from: last.item.from, to: last.item.to, insert: keys }];
  for (const list of new Set(sides.map((x) => x.list))) {
    const others = sides.filter((x) => x.list === list && x !== last).map((x) => x.item);
    changes.push(...removeItems(text, list, others));
  }
  return changes;
}

/** Whether layout `b` leaves the picture as it was in `a`: the same nodes, the same drawn paths, and `labels` more labels. */
function sameDrawing(a: PictureLayout, b: PictureLayout, labels = 0): boolean {
  if (b.nodes.length !== a.nodes.length || b.pathNodes.length !== a.pathNodes.length + labels) return false;
  if (b.nodes.some((n, i) => !near(n.shape.center, a.nodes[i]!.shape.center))) return false;
  return JSON.stringify(a.paths.map(drawnOf)) === JSON.stringify(b.paths.map(drawnOf));
}

/**
 * A label written `above`, `left` and so on that the line now cuts through, more
 * than before (it was slid to a segment that runs the other way, D57), gets `auto` instead,
 * on the side it was on, so it stays beside the line wherever it is. Null when it
 * is beside the line already, has no side key of its own, or writes a distance
 * with it (`above=2mm`, which `auto` would lose).
 */
function planAutoSide(text: string, picIndex: number, layout: PictureLayout, labelId: string, before: number): { changes: Change[]; text: string; layout: PictureLayout; written: string } | null {
  const label = layout.pathNodes.find((n) => n.id === labelId);
  const edge = label && edgeOfLabel(pictureEdges(layout), labelId);
  const g = label && edge && labelGeometry(edge, label);
  // Only a label the slide made worse: one that already sat on a sloping line the same way is the author's choice.
  if (!label || !g || g.overlap <= OVERLAP || g.overlap <= before + 1) return null;
  // The layout doesn't turn a `sloped` label's anchors with the line, so where it sits can't be judged.
  if (label.rotate !== undefined) return null;
  const sides = ownSides(label);
  if (!sides.length || sides.some((x) => x.item.value !== undefined)) return null;
  const keys = autoSide(g.angle, sum(sides.map((x) => sideVector(x.item.key))));
  const changes = replaceSides(text, sides, keys);
  const next = applyChanges(text, changes);
  const doc2 = analyzeDocument(next);
  const layout2 = layoutDocumentPicture(doc2, picIndex);
  if (!layout2 || doc2.errors.length > analyzeDocument(text).errors.length || !sameDrawing(layout, layout2)) return null;
  const made = layout2.pathNodes.find((n) => n.syntax.from === label.syntax.from);
  const edge2 = made && edgeOfLabel(pictureEdges(layout2), made.id);
  const g2 = made && edge2 && labelGeometry(edge2, made);
  if (!g2 || g2.overlap > OVERLAP) return null;
  return { changes, text: next, layout: layout2, written: `${sides.map((x) => x.item.key).join(", ")} → ${keys}` };
}

/**
 * After an edit that changes the line of one edge: its form (Straight,
 * Orthogonal, Curved, D58 item 6), or a drag of one of its corners, curve
 * handles, segments or ends (D65): a label written `above`, `left` and so on
 * that the new line cuts through, and that the old line didn't, gets `auto` or
 * `auto, swap` instead, on the side it was on, by the same rule as sliding a
 * label (D57). Labels are matched to their old selves by their text in the
 * code. Returns `outcome` (made from `text`) with the fixes added to its
 * changes, in one set against `text`; a refused outcome is returned as it is.
 * Only labels of the edited edge are looked at: moving a node never rewrites
 * labels (D65).
 */
export function fixLabelSides<T extends EditOutcome>(text: string, picIndex: number, edgeId: string, outcome: T): T {
  if (!outcome.ok) return outcome;
  const layout0 = layoutDocumentPicture(analyzeDocument(text), picIndex);
  const edge0 = layout0 && findEdge(layout0, edgeId);
  if (!layout0 || !edge0 || !edge0.labels.length) return outcome;
  const was = new Map<string, number[]>();
  for (const l of edge0.labels) {
    const key = text.slice(l.syntax.from, l.syntax.to);
    was.set(key, [...(was.get(key) ?? []), labelGeometry(edge0, l)?.overlap ?? 0]);
  }
  const edge1 = findEdge(outcome.layout, outcome.edgeId ?? edgeId);
  if (!edge1) return outcome;
  // Each label of the new edge with how much the old line cut into it (unmatched ones are left alone).
  const todo = edge1.labels.map((l) => ({ from: l.syntax.from, before: was.get(outcome.text.slice(l.syntax.from, l.syntax.to))?.shift() ?? Infinity }));
  let { changes, text: cur, layout } = outcome;
  const notes = [...outcome.notes];
  // Last label first, so the offsets of the others stay valid.
  for (const t of todo.sort((a, b) => b.from - a.from)) {
    const label = layout.pathNodes.find((n) => n.syntax.from === t.from);
    if (!label || t.before === Infinity) continue;
    const fix = planAutoSide(cur, picIndex, layout, label.id, t.before);
    if (!fix) continue;
    const words = labelWords(cur, label);
    changes = composeChanges(text, changes, fix.changes);
    cur = fix.text;
    layout = fix.layout;
    const [from, to] = fix.written.split(" → ");
    notes.push(`wrote the label ${words} as ${to} instead of ${from}, so it stays beside the line`);
  }
  return { ...outcome, changes, text: cur, layout, notes } as T;
}

/** A label's text in a few words, for messages. */
function labelWords(text: string, label: LaidOutNode): string {
  const inner = label.syntax.label?.inner;
  const flat = inner ? text.slice(inner.from, inner.to).replace(/\s+/g, " ").trim() : "";
  return `"${flat.length > 24 ? `${flat.slice(0, 23)}…` : flat}"`;
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
 * The label is written with `auto` (or `auto, swap`), on the side of the edge
 * `at` is on, so it sits beside the line on any segment (D57); if the layout
 * doesn't bear that out, the plain `above`/`below`/`left`/`right` is written
 * instead. `side` forces one of the two.
 */
export function planAddLabel(text: string, picIndex: number, edgeId: string, at: Point, label: string, side?: AutoKeys): LabelAdded {
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
  // Which side of the way the edge runs the click is on; a click on the line itself leaves it to the edge's direction.
  const keys = side ?? autoSide(angle, { x: at.x - where.x, y: at.y - where.y });
  const wanted = keys === "auto" ? 1 : -1;
  const refused = { ok: false as const, reason: "The label couldn't be written there without changing the drawing, so it wasn't added." };
  // The plain side key is the way out when `auto` doesn't give what was asked (a style that sets an anchor, say).
  const plain = (): string => {
    const level = Math.abs(Math.cos(angle)) >= Math.abs(Math.sin(angle));
    const left = { x: -Math.sin(angle), y: Math.cos(angle) };
    const dir = wanted === 1 ? left : { x: -left.x, y: -left.y };
    return level ? (dir.y >= 0 ? "above" : "below") : dir.x >= 0 ? "right" : "left";
  };
  for (const sideKey of [keys, plain()]) {
    const opts = [Math.abs(t - 0.5) < 0.03 ? null : `pos=${formatPos(t)}`, sideKey].filter(Boolean).join(", ");
    const insert = `node[${opts}] {${label}} `;
    const changes: Change[] = [{ from: stop.range.from, to: stop.range.from, insert }];
    const next = applyChanges(text, changes);
    const doc2 = analyzeDocument(next);
    const layout2 = layoutDocumentPicture(doc2, picIndex);
    if (!layout2 || doc2.errors.length > doc.errors.length || !sameDrawing(layout, layout2, 1)) return refused;
    const made = layout2.pathNodes.find((n) => n.syntax.from === stop.range.from);
    const edge2 = findEdge(layout2, edgeId);
    if (!made || !edge2 || !edge2.labels.some((n) => n.id === made.id)) return refused;
    // The label has to come out beside the line, on the side asked for.
    const g = labelGeometry(edge2, made);
    if (sideKey === keys && g && (g.overlap > OVERLAP || g.side !== wanted)) continue;
    return { ok: true, changes, text: next, layout: layout2, edgeId, labelId: made.id, written: insert.trim() };
  }
  return refused;
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
  const seg = labelSegOf(edge, label);
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
  if (!layout2 || doc2.errors.length > doc.errors.length || !sameDrawing(layout, layout2)) return refused;
  const moved = layout2.pathNodes.find((n) => n.syntax.from === label.syntax.from);
  if (!moved?.pathPos || Math.abs(moved.pathPos.t - pos) > 0.011) return refused;
  // A side key that would put the label on the line where it has been slid to becomes `auto` (D57).
  const fix = planAutoSide(next, picIndex, layout2, moved.id, labelGeometry(edge, label)?.overlap ?? 0);
  if (fix) return { ok: true, changes: composeChanges(text, changes, fix.changes), text: fix.text, layout: fix.layout, pos, written: `${written}, ${fix.written}` };
  return { ok: true, changes, text: next, layout: layout2, pos, written };
}

// ---------------------------------------------------------------- flipping a label to the other side

/** Why this label's side can't be flipped, or null. */
export function flipBlocker(layout: PictureLayout, labelId: string): string | null {
  const label = layout.pathNodes.find((n) => n.id === labelId);
  if (!label) return "There is no such label.";
  const edge = edgeOfLabel(pictureEdges(layout), labelId);
  if (!edge) return "This label isn't on an edge.";
  if (edge.lock) return `This edge can't be edited: ${edge.lock.message}.`;
  const g = labelGeometry(edge, label);
  if (!g) return "This label isn't placed along a segment of its edge.";
  return null;
}

/**
 * Puts a label on the other side of its edge. A label written with `auto`
 * gets `swap` added, or removed if it had one; one written `above` or `left`
 * gets the opposite key (a label the line cuts through gets `auto` instead,
 * on the side its key didn't point to). A label with no side key at all sits
 * on the line: it gets `auto` (or `auto, swap`), the side TikZ uses for a
 * level or upright line (D64). Otherwise the result must be the label's mirror
 * image about its point on the edge, or nothing is written (D57).
 */
export function planFlipLabel(text: string, picIndex: number, labelId: string): LabelFlipped {
  const doc = analyzeDocument(text);
  const layout = layoutDocumentPicture(doc, picIndex);
  if (!layout) return { ok: false, reason: "There is no picture." };
  const blocked = flipBlocker(layout, labelId);
  if (blocked) return { ok: false, reason: blocked };
  const label = layout.pathNodes.find((n) => n.id === labelId)!;
  const edge = edgeOfLabel(pictureEdges(layout), labelId)!;
  const g = labelGeometry(edge, label)!;
  const target = nodeTarget(label.syntax);
  const sides = ownSides(label);
  let changes: Change[] | null;
  let written: string;
  let toAuto = false;
  let placed = false;
  if (sides.length) {
    if (sides.some((x) => x.item.value !== undefined && /(^|\s)of(\s|$)/.test(x.item.value))) return { ok: false, reason: "This label is placed relative to a node, so it can't be flipped here. Change it in the code." };
    if (g.overlap > OVERLAP && sides.every((x) => x.item.value === undefined)) {
      // On the line, so there is no mirror image: put it beside the line, on the side its key didn't point to.
      const keys = autoSide(g.angle, sum(sides.map((x) => sideVector(oppositeKey(x.item.key)))));
      changes = replaceSides(text, sides, keys);
      written = `${sides.map((x) => x.item.key).join(", ")} → ${keys}`;
      toAuto = true;
    } else {
      const flipped = sides.map((x) => (x.item.value === undefined ? oppositeKey(x.item.key) : formatOption(oppositeKey(x.item.key), x.item.value)));
      changes = sides.map((x, i) => ({ from: x.item.from, to: x.item.to, insert: flipped[i]! }));
      written = sides.map((x, i) => `${text.slice(x.item.from, x.item.to)} → ${flipped[i]}`).join(", ");
    }
  } else if (Math.hypot(g.offset.x, g.offset.y) < 1) {
    // No side key, and nothing beside the line: the label sits on it, with no side to flip. `auto` puts it beside it (D64).
    const keys = autoSide(g.angle, { x: 0, y: 0 });
    changes = setOption(text, target, () => false, keys);
    written = `added ${keys}`;
    toAuto = true;
    placed = true;
  } else {
    // `auto` (on the label, its path or a style): `swap` turns it over.
    const has = findItems(target, (i) => i.key === "swap").length > 0;
    changes = setOption(text, target, (i) => i.key === "swap", has ? null : "swap");
    written = has ? "removed swap" : "added swap";
  }
  if (!changes) return { ok: false, reason: "This label's side comes from a style argument, so it can't be flipped here. Change it in the code." };
  const next = applyChanges(text, changes);
  const doc2 = analyzeDocument(next);
  const layout2 = layoutDocumentPicture(doc2, picIndex);
  const refused = { ok: false as const, reason: "The label couldn't be flipped without changing the drawing, so it wasn't." };
  if (!layout2 || doc2.errors.length > doc.errors.length || !sameDrawing(layout, layout2)) return refused;
  const moved = layout2.pathNodes.find((n) => n.syntax.from === label.syntax.from);
  const edge2 = moved && edgeOfLabel(pictureEdges(layout2), moved.id);
  const g2 = moved && edge2 && labelGeometry(edge2, moved);
  if (!moved || !edge2 || !g2) return refused;
  if (toAuto ? g2.overlap > OVERLAP : !near(g2.offset, { x: -g.offset.x, y: -g.offset.y }, 0.5)) {
    return { ok: false, reason: "This label has no side to flip: it isn't written beside the line with auto, above, below, left or right." };
  }
  return { ok: true, changes, text: next, layout: layout2, edgeId: edge.id, labelId: moved.id, written, ...(placed ? { placed: true as const } : {}) };
}

// ---------------------------------------------------------------- labels on their own line (D65)

/**
 * Labels the line of their own edge cuts through although they are written
 * with a side key (`above`, `left=2mm`, …): the ones a node move or a hand
 * edit left on the line. The canvas marks them; moving a node never rewrites
 * them (D65). Sloped labels and labels placed against a node are left out.
 */
export function labelsOnTheirLine(layout: PictureLayout): Array<{ labelId: string; edgeId: string }> {
  const out: Array<{ labelId: string; edgeId: string }> = [];
  for (const edge of pictureEdges(layout)) {
    if (edge.lock) continue;
    for (const label of edge.labels) {
      if (label.rotate !== undefined) continue;
      const sides = ownSides(label);
      if (!sides.length || sides.some((x) => x.item.value !== undefined && /(^|\s)of(\s|$)/.test(x.item.value))) continue;
      const g = labelGeometry(edge, label);
      if (g && g.overlap > OVERLAP) out.push({ labelId: label.id, edgeId: edge.id });
    }
  }
  return out;
}

/**
 * The warning marker's other fix: the label's side key becomes `auto` or
 * `auto, swap` on the side the key pointed to, by the rule of D57 (Flip puts
 * it on the other side). Refused for keys with a distance, which `auto` would lose.
 */
export function planLabelBesideLine(text: string, picIndex: number, labelId: string): LabelFlipped {
  const layout = layoutDocumentPicture(analyzeDocument(text), picIndex);
  const label = layout?.pathNodes.find((n) => n.id === labelId);
  const edge = layout && edgeOfLabel(pictureEdges(layout), labelId);
  if (!layout || !label || !edge) return { ok: false, reason: "There is no such label." };
  if (ownSides(label).some((x) => x.item.value !== undefined)) {
    return { ok: false, reason: "This label's side key has a distance, which auto would lose. Use Flip side, or change it in the code." };
  }
  const fix = planAutoSide(text, picIndex, layout, labelId, 0);
  if (!fix) return { ok: false, reason: "This label couldn't be put beside the line with auto without changing the drawing." };
  const moved = fix.layout.pathNodes.find((n) => n.syntax.from === label.syntax.from);
  return { ok: true, changes: fix.changes, text: fix.text, layout: fix.layout, edgeId: edge.id, labelId: moved?.id ?? labelId, written: fix.written };
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

/**
 * The label node written for a new branch: `node[near start, auto] {Yes}`. It sits
 * to the right of an upright edge and above a level one, whichever way the edge
 * leaves (D54), written with `auto` so it stays beside the line if the edge is
 * later bent (D57).
 */
export function branchLabelText(label: string, direction: "below" | "above" | "left" | "right"): string {
  const heading = { below: -Math.PI / 2, above: Math.PI / 2, right: 0, left: Math.PI }[direction];
  const wanted = direction === "below" || direction === "above" ? { x: 1, y: 0 } : { x: 0, y: 1 };
  return `node[near start, ${autoSide(heading, wanted)}] {${label}}`;
}
