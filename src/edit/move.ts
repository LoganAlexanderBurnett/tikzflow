// Moving a node: choose how to write its new position (the emitter rules in
// SPEC.md), turn that into a minimal text patch, and check the result by
// laying out the patched text again.
import { analyzeDocument, layoutDocumentPicture } from "../model/document.ts";
import { pictureReferences } from "../model/references.ts";
import type { NodeSyntax, OptionItem, OptionList } from "../model/syntax.ts";
import type { LaidOutNode, PictureLayout } from "../tikz/layout.ts";
import { positioningAnchor, positioningDirection } from "../tikz/layout.ts";
import { anchorOffset, anchorPoint, type Point } from "../tikz/shapes.ts";
import { applyLinear, applyMatrix, invert, type Matrix } from "../tikz/state.ts";
import { evalLength, PT_PER_UNIT, trimNumber } from "../tikz/units.ts";
import { applyChanges, type Change } from "./changes.ts";
import { ensureLibrary } from "./libraries.ts";
import { addOptionList, appendItem, removeAtClause, removeItems, setAtClause } from "./optionEdits.ts";

const MM = PT_PER_UNIT.mm!;
/** How far an alignment may be off and still count, in pt. */
export const ALIGN_EPS = 0.5;
/** Distances are written to the nearest millimetre. */
const ROUND_TOLERANCE = 0.75 * MM;

export type PositionSpec =
  /** positioning library; distances in pt, undefined meaning "node distance". */
  | { kind: "positioning"; dir: string; target: string; v?: number; h?: number; shift?: Point }
  /** "at (a |- b)": x from one node, y from another. */
  | { kind: "perp"; xFrom: string; yFrom: string }
  /** "at (x,y)" in the node's own frame. */
  | { kind: "absolute"; local: Point }
  /** Keep the position as written and set the node's own xshift/yshift, in local pt. */
  | { kind: "shift"; shift: Point };

export interface MoveResult {
  spec: PositionSpec;
  /** All changes, including a library the new position needs. */
  changes: Change[];
  /** The change that loads a library, if one was needed. */
  library?: Change;
  /** Things the user should know, e.g. a library to add by hand. */
  notes: string[];
  /** The whole text after the change. */
  text: string;
  /** Where the node's centre ends up, which may differ from the request by rounding. */
  center: Point;
}

const STRAIGHT = ["below", "above", "right", "left"] as const;
const DIAGONAL = ["below right", "below left", "above right", "above left"] as const;

/** Keys in a node's own options that set its position. */
const POSITIONING_KEY = /^(above|below|left|right|above left|above right|below left|below right|base left|base right|mid left|mid right)( of)?$/;
const SHIFT_KEY = /^(anchor|xshift|yshift|shift)$/;

export function isPlacementKey(key: string): boolean {
  return POSITIONING_KEY.test(key) || key === "at" || SHIFT_KEY.test(key);
}

/** Names that can be referred to in emitted code. */
const SIMPLE_NAME = /^[A-Za-z0-9_\-:]+$/;

/** Nodes whose position depends on `id`, directly or not. */
export function dependents(layout: PictureLayout, id: string): Set<string> {
  const out = new Set<string>();
  const queue = [id];
  while (queue.length) {
    const curId = queue.pop();
    const cur = layout.nodes.find((n) => n.id === curId);
    // Names that move when this node moves: its own, and bounding boxes around it.
    const names = [...layout.boxes].filter(([, ids]) => ids.includes(curId!)).map(([name]) => name);
    if (cur?.name) names.push(cur.name);
    for (const m of layout.nodes) {
      if (!out.has(m.id) && m.id !== id && m.position.refs.some((r) => names.includes(r))) {
        out.add(m.id);
        queue.push(m.id);
      }
    }
  }
  return out;
}

/** Nodes a moved node may be positioned relative to: defined earlier, named, not depending on it. */
export function referenceCandidates(layout: PictureLayout, node: LaidOutNode): LaidOutNode[] {
  const index = layout.nodes.indexOf(node);
  const deps = dependents(layout, node.id);
  const latest = new Map<string, LaidOutNode>();
  for (const n of layout.nodes.slice(0, index)) if (n.name) latest.set(n.name, n);
  return [...latest.values()].filter(
    (n) => n.kind === "statement" && n.name && !n.implicitName && SIMPLE_NAME.test(n.name) && !deps.has(n.id) && n.name !== node.name,
  );
}

const OPPOSITE_ANCHOR: Record<string, string> = {
  north: "south",
  south: "north",
  east: "west",
  west: "east",
  "north east": "south west",
  "north west": "south east",
  "south east": "north west",
  "south west": "north east",
};

/** Candidate specs for putting `node` with its centre at `c`, best first. */
export function candidateSpecs(layout: PictureLayout, node: LaidOutNode, c: Point): PositionSpec[] {
  const refs = referenceCandidates(layout, node).sort(
    (a, b) => Math.hypot(a.shape.center.x - c.x, a.shape.center.y - c.y) - Math.hypot(b.shape.center.x - c.x, b.shape.center.y - c.y),
  );
  // Positioning distances and node shifts are not scaled by the picture's
  // transformation (nodes keep only its translation), so they are canvas pt.
  const sx = node.vectorScale;
  const sy = node.vectorScale;
  const nd = node.nodeDistance;
  const grid = node.onGrid;
  const specs: PositionSpec[] = [];
  const explicit: PositionSpec[] = [];
  const diagonal: PositionSpec[] = [];
  const shifted: PositionSpec[] = [];
  const perp: PositionSpec[] = [];
  const kept: PositionSpec[] = [];
  const prev = previousRelation(layout, node);
  // The node it was positioned relative to stays a candidate even if it is a coordinate.
  const prevTarget = prev && layout.nodes.find((n) => n.name === prev.target && !refs.includes(n));
  const targets = prevTarget ? [...refs, prevTarget] : refs;
  // Keeping the position as written and setting the node's own shifts.
  const own = ownShift(node.syntax);
  const keepShift: PositionSpec | null = own && {
    kind: "shift",
    shift: { x: own.x + (c.x - node.shape.center.x) / node.vectorScale, y: own.y + (c.y - node.shape.center.y) / node.vectorScale },
  };
  // A relation with a shift along its direction ("below=of a, yshift=-2mm")
  // keeps the relation as written and updates the shifts, so repeated nudges
  // change the same items instead of adding more (D36).
  const [pux, puy] = prev ? positioningDirection(prev.dir) : [0, 0];
  const ownAlong = !!own && ((pux !== 0 && own.x !== 0) || (puy !== 0 && own.y !== 0));
  const alongShift = ownAlong && !prev!.dir.includes(" ") ? keepShift : null;
  const nudged: PositionSpec[] = [];

  /**
   * The offset from the target's anchor to the moved node's anchor for a
   * positioning direction, as positioning measures it. Shapes like diamonds
   * have their diagonal anchors on the edges, not at the box corners.
   */
  const offsetFor = (t: LaidOutNode, dir: string): Point | null => {
    if (grid) return { x: c.x - t.shape.center.x, y: c.y - t.shape.center.y };
    const own = anchorOffset(node.shape, positioningAnchor(dir));
    const theirs = anchorPoint(t.shape, OPPOSITE_ANCHOR[positioningAnchor(dir)]!);
    if (!own || !theirs) return null;
    return { x: c.x + own.x - theirs.x, y: c.y + own.y - theirs.y };
  };

  for (const t of targets) {
    const isPrev = t === prevTarget || (prev !== null && t.name === prev.target);
    const onlyPrev = t === prevTarget;
    for (const dir of STRAIGHT) {
      const off = offsetFor(t, dir);
      if (!off) continue;
      const vertical = dir === "below" || dir === "above";
      const [ux, uy] = positioningDirection(dir);
      // Distance along the direction, and the offset across it, in canvas pt.
      const gap = off.x * ux + off.y * uy;
      const cross = vertical ? off.x : off.y;
      if (gap < -ALIGN_EPS) continue;
      const local = vertical ? gap / sy : gap / sx;
      const nodeDist = vertical ? nd.v : nd.h;
      const base: PositionSpec & { kind: "positioning" } = { kind: "positioning", dir, target: t.name! };
      if (Math.abs(cross) <= ALIGN_EPS) {
        if (Math.abs(local - nodeDist) <= ROUND_TOLERANCE) (onlyPrev ? kept : specs).push(base);
        else if (isPrev && dir === prev!.dir && alongShift) nudged.push(alongShift);
        else if (onlyPrev || gap <= FAR) (onlyPrev ? kept : explicit).push(vertical ? { ...base, v: local } : { ...base, h: local });
        continue;
      }
      // Off-axis: keep the direction and add a shift across it, but only while
      // the two still overlap across the axis; past that it is a diagonal.
      const overlap = vertical ? t.shape.hw + node.shape.hw : t.shape.hh + node.shape.hh;
      if (Math.abs(cross) >= overlap) continue;
      const shift = vertical ? { x: cross / sx, y: 0 } : { x: 0, y: cross / sy };
      // A gap that is the node distance stays "below=of a"; only the shift is added.
      const atDistance = Math.abs(local - nodeDist) <= ROUND_TOLERANCE;
      const spec: PositionSpec = atDistance ? { ...base, shift } : vertical ? { ...base, v: local, shift } : { ...base, h: local, shift };
      if (isPrev && dir === prev!.dir && alongShift) nudged.push(alongShift);
      else if (isPrev && dir === prev!.dir) kept.push(spec);
      else if (!onlyPrev && Math.abs(cross) <= NEARBY) shifted.push(spec);
    }
    for (const dir of DIAGONAL) {
      const off = offsetFor(t, dir);
      if (!off) continue;
      const [ux, uy] = positioningDirection(dir);
      const h = off.x * ux;
      const v = off.y * uy;
      if (h < -ALIGN_EPS || v < -ALIGN_EPS) continue;
      const spec: PositionSpec = { kind: "positioning", dir, target: t.name!, v: v / sy, h: h / sx };
      if (isPrev && dir === prev!.dir) kept.push(spec);
      else if (!onlyPrev && h <= NEARBY && v <= NEARBY) diagonal.push(spec);
    }
  }
  // Perpendicular: x from one node and y from another.
  const xAligned = refs.filter((t) => Math.abs(t.shape.center.x - c.x) <= ALIGN_EPS);
  const yAligned = refs.filter((t) => Math.abs(t.shape.center.y - c.y) <= ALIGN_EPS);
  for (const a of xAligned) for (const b of yAligned) if (a !== b) perp.push({ kind: "perp", xFrom: a.name!, yFrom: b.name! });

  // A node placed with a relational "at" ("at (a -| b)") keeps it and gets a shift.
  if (node.position.kind === "at" && node.position.refs.length && keepShift) kept.push(keepShift);
  if (prev?.dir.includes(" ") && ownAlong) kept.unshift(keepShift!);
  const absolute: PositionSpec = { kind: "absolute", local: toLocal(node.frame, c) };
  // A node that was placed with plain numbers keeps that style unless the
  // drop lines up with other nodes.
  const wasAbsolute = node.position.kind === "at" && node.position.refs.length === 0;
  if (wasAbsolute) return [...specs, ...perp.slice(0, 1), ...explicit.slice(0, 1), absolute];
  // Order: lined up at node distance; lined up with two nodes; lined up at
  // another distance; the relation it had before (with a shift if needed);
  // a nearby diagonal; a nearby node plus a shift; plain coordinates.
  return [...specs, ...perp.slice(0, 1), ...nudged.slice(0, 1), ...explicit.slice(0, 2), ...kept, ...diagonal.slice(0, 1), ...shifted.slice(0, 1), absolute];
}

/** Diagonal gaps and shifts are only used up to this distance, in pt. */
const NEARBY = 3 * PT_PER_UNIT.cm!;
/** Straight relations to another node are only used up to this distance, in pt. */
const FAR = 5 * PT_PER_UNIT.cm!;

/** The node's own xshift and yshift, in pt, or null if they aren't plain lengths. */
function ownShift(syn: NodeSyntax): Point | null {
  let x = 0;
  let y = 0;
  for (const list of syn.options) {
    for (const item of list.items) {
      if (item.key !== "xshift" && item.key !== "yshift" && item.key !== "shift") continue;
      const v = item.key === "shift" ? null : evalLength(item.value ?? "");
      if (v === null) return null;
      if (item.key === "xshift") x += v;
      else y += v;
    }
  }
  return { x, y };
}

/**
 * Updates the node's own xshift and yshift items to `shift` (local pt), in
 * place: the last item for each axis gets the new value. Returns the items it
 * kept and the shift still to be written for axes that have no item.
 */
function updateShifts(syn: NodeSyntax, shift: Point): { changes: Change[]; kept: OptionItem[]; missing?: Point } {
  const changes: Change[] = [];
  const kept: OptionItem[] = [];
  const missing = { x: 0, y: 0 };
  for (const axis of ["x", "y"] as const) {
    const value = formatDistance(shift[axis]);
    if (value === "0pt") continue;
    const item = ownItems(syn, (i) => i.key === `${axis}shift` && i.valueRange !== undefined && evalLength(i.value ?? "") !== null).at(-1)?.item;
    if (!item) {
      missing[axis] = shift[axis];
      continue;
    }
    kept.push(item);
    if (formatDistance(evalLength(item.value!)!) !== value) changes.push({ from: item.valueRange!.from, to: item.valueRange!.to, insert: value });
  }
  return missing.x || missing.y ? { changes, kept, missing } : { changes, kept };
}

function shiftText(shift: Point): string {
  const parts: string[] = [];
  if (formatDistance(shift.x) !== "0pt") parts.push(`xshift=${formatDistance(shift.x)}`);
  if (formatDistance(shift.y) !== "0pt") parts.push(`yshift=${formatDistance(shift.y)}`);
  return parts.join(", ");
}

/** The positioning relation the node's own options give it now, if it names a simple target. */
export function previousRelation(layout: PictureLayout, node: LaidOutNode): { dir: string; target: string } | null {
  for (const list of node.syntax.options) {
    for (const item of list.items) {
      if (!isRelationalItem(item) || item.key === "at") continue;
      const old = / of$/.test(item.key);
      const dir = item.key.replace(/ of$/, "");
      const target = (old ? item.value ?? "" : (item.value ?? "").replace(/^.*?\bof\s+/, "")).trim();
      if (!SIMPLE_NAME.test(target)) return null;
      const t = layout.nodes.find((n) => n.name === target);
      if (!t || t.id === node.id || dependents(layout, node.id).has(t.id)) return null;
      if (layout.nodes.indexOf(t) > layout.nodes.indexOf(node)) return null;
      return { dir, target };
    }
  }
  return null;
}

function toLocal(frame: Matrix, p: Point): Point {
  const inv = invert(frame);
  if (!inv) return p;
  const [x, y] = applyMatrix(inv, p.x, p.y);
  return { x, y };
}

/** "5mm", "1.5cm", "0pt": distances as a person would write them. */
export function formatDistance(pt: number): string {
  const mm = Math.round(pt / MM);
  if (mm === 0) return "0pt";
  if (Math.abs(mm) < 10) return `${mm}mm`;
  return `${trimNumber(mm / 10)}cm`;
}

/** The option text for a positioning spec, e.g. "below right=5mm and 1cm of a". */
export function positioningText(spec: PositionSpec & { kind: "positioning" }): string {
  const diag = spec.dir.includes(" ");
  let dist = "";
  if (diag && (spec.v !== undefined || spec.h !== undefined)) {
    const v = formatDistance(spec.v ?? 0);
    const h = formatDistance(spec.h ?? 0);
    dist = v === h ? `${v} ` : `${v} and ${h} `;
  } else if (spec.v !== undefined) dist = `${formatDistance(spec.v)} `;
  else if (spec.h !== undefined) dist = `${formatDistance(spec.h)} `;
  const main = `${spec.dir}=${dist}of ${spec.target}`;
  const shifts: string[] = [];
  if (spec.shift && formatDistance(spec.shift.x) !== "0pt") shifts.push(`xshift=${formatDistance(spec.shift.x)}`);
  if (spec.shift && formatDistance(spec.shift.y) !== "0pt") shifts.push(`yshift=${formatDistance(spec.shift.y)}`);
  return [main, ...shifts].join(", ");
}

/** Coordinate text in the node's units: "(1.5,-2)". Matches the spacing of the existing clause. */
function absoluteText(syn: NodeSyntax, local: Point, xUnit: number, yUnit: number): string {
  const sep = syn.at && /,\s/.test(syn.at.coord.text) ? ", " : ",";
  const fmt = (v: number, unit: number) => trimNumber(Math.round((v / unit) * 100) / 100);
  return `${fmt(local.x, xUnit)}${sep}${fmt(local.y, yUnit)}`;
}

interface OwnItem {
  list: OptionList;
  item: OptionItem;
}

function ownItems(syn: NodeSyntax, test: (item: OptionItem) => boolean): OwnItem[] {
  return syn.options.flatMap((list) => list.items.filter(test).map((item) => ({ list, item })));
}

/** "below=of a", "below=1cm of a", "below of=a", "at=(...)": items that place the node relative to something. */
export function isRelationalItem(item: OptionItem): boolean {
  if (item.key === "at" || / of$/.test(item.key)) return POSITIONING_KEY.test(item.key) || item.key === "at";
  return POSITIONING_KEY.test(item.key) && item.value !== undefined && /(^|\s)of(\s|$)/.test(item.value);
}

/** Text changes that give `syn` the position `spec`. */
export function specChanges(text: string, syn: NodeSyntax, spec: PositionSpec, coordText?: string): Change[] {
  const changes: Change[] = [];
  // An absolute position keeps anchors and shifts ("left", "anchor=west", "xshift")
  // and accounts for them; other kinds replace all of them.
  const removeTest =
    spec.kind === "absolute"
      ? isRelationalItem
      : spec.kind === "shift"
        ? (i: OptionItem) => /^(xshift|yshift|shift)$/.test(i.key)
        : (i: OptionItem) => isPlacementKey(i.key);
  let remove = ownItems(syn, removeTest);
  let replaced: OwnItem | undefined;
  if (spec.kind === "positioning" || spec.kind === "shift") {
    // Shifts the node already has are updated in place, one per axis; only a
    // missing one is added (D36).
    const shifts = updateShifts(syn, spec.shift ?? { x: 0, y: 0 });
    changes.push(...shifts.changes);
    remove = remove.filter((r) => !shifts.kept.includes(r.item));
    const extra = shifts.missing ? shiftText(shifts.missing) : "";
    if (spec.kind === "positioning") {
      const { shift: _, ...relation } = spec;
      const newText = [positioningText(relation), extra].filter(Boolean).join(", ");
      replaced = remove.find((r) => isRelationalItem(r.item)) ?? remove.find((r) => POSITIONING_KEY.test(r.item.key)) ?? remove[0];
      if (replaced) changes.push({ from: replaced.item.from, to: replaced.item.to, insert: newText });
      else if (syn.options[0]) changes.push(appendItem(text, syn.options[0], newText));
      else changes.push(addOptionList(syn, newText));
      const at = removeAtClause(text, syn);
      if (at) changes.push(at);
    } else if (extra) {
      // After the relation, in place of a shift item that goes, or at the end of the node's options.
      const rel = ownItems(syn, isRelationalItem).at(-1);
      replaced = rel ? undefined : remove[0];
      if (rel) changes.push({ from: rel.item.to, to: rel.item.to, insert: `, ${extra}` });
      else if (replaced) changes.push({ from: replaced.item.from, to: replaced.item.to, insert: extra });
      else if (syn.options.length) changes.push(appendItem(text, syn.options[syn.options.length - 1]!, extra));
      else changes.push(addOptionList(syn, extra));
    }
  } else {
    const coord = spec.kind === "perp" ? `${spec.xFrom} |- ${spec.yFrom}` : coordText!;
    changes.push(setAtClause(syn, coord));
  }
  // Remove the other placement items, list by list.
  for (const list of syn.options) {
    const items = remove.filter((r) => r.list === list && r !== replaced).map((r) => r.item);
    if (!items.length) continue;
    const keptAfter = list.items.filter((i) => !items.includes(i));
    if (!keptAfter.length && (spec.kind === "positioning" || spec.kind === "shift") && !replaced && list === syn.options[0]) {
      // The new item goes into this list, so keep the brackets.
      continue;
    }
    changes.push(...removeItems(text, list, items));
  }
  return mergeInserts(changes);
}

/** An append at the end of a list and a removal right before it can touch; merge them. */
function mergeInserts(changes: Change[]): Change[] {
  const sorted = [...changes].sort((a, b) => a.from - b.from || a.to - b.to);
  const out: Change[] = [];
  for (const c of sorted) {
    const prev = out[out.length - 1];
    if (prev && c.from < prev.to) {
      // Overlap: the later change is inside the earlier removal; keep the union.
      prev.to = Math.max(prev.to, c.to);
      prev.insert += c.insert;
    } else out.push({ ...c });
  }
  return out;
}

/**
 * Plans moving node `nodeId` of picture `picIndex` so its centre is at
 * `center`. Returns null if the node can't be moved.
 */
export function planMove(text: string, picIndex: number, nodeId: string, center: Point): MoveResult | null {
  const doc = analyzeDocument(text);
  const layout = layoutDocumentPicture(doc, picIndex);
  const node = layout?.nodes.find((n) => n.id === nodeId);
  if (!layout || !node || node.locked || node.kind === "path") return null;
  const syn = node.syntax;
  for (const spec of candidateSpecs(layout, node, center)) {
    const result = trySpec(text, picIndex, node, syn, spec, center);
    if (!result) continue;
    // Relational positions need the positioning library.
    if (spec.kind === "positioning") {
      const pic = doc.syntax.pictures[picIndex]!;
      const lib = ensureLibrary(doc, pic, "positioning");
      if (!lib.ok) {
        // A bare picture that already uses "=of" must have the library in its real preamble.
        const usesIt = /\b(above|below|left|right)( left| right)?\s*=[^,\]]*\bof\b/.test(text.slice(pic.from, pic.to));
        if (!usesIt) result.notes.push(lib.reason);
      } else if (lib.change) {
        result.library = lib.change;
        result.changes = [...result.changes, lib.change];
        result.text = applyChanges(text, result.changes);
      }
    }
    return result;
  }
  return null;
}

/**
 * "Pin at current position": writes plain coordinates for where the node is
 * drawn now, or at `center` when the node was dragged there, replacing a
 * placement the editor can't use (an undefined name, say). The node's anchor
 * and shifts stay and are accounted for. Returns null if the node would still
 * be locked afterwards.
 */
export function planPin(text: string, picIndex: number, nodeId: string, center?: Point): MoveResult | null {
  const layout = layoutDocumentPicture(analyzeDocument(text), picIndex);
  const node = layout?.nodes.find((n) => n.id === nodeId);
  if (!layout || !node || node.kind === "path") return null;
  const c = center ?? node.shape.center;
  const result = trySpec(text, picIndex, node, node.syntax, { kind: "absolute", local: toLocal(node.frame, c) }, c);
  if (!result) return null;
  const after = layoutDocumentPicture(analyzeDocument(result.text), picIndex)?.nodes.find((n) => n.id === nodeId);
  return after && !after.locked ? result : null;
}

/**
 * "Attach to another node": replaces the name `from` in the node's own
 * placement (its "at" clause and positioning options) with `to`, keeping
 * anchors, shifts and distances as written. Returns null if the node would
 * still be locked afterwards.
 */
export function planAttach(text: string, picIndex: number, nodeId: string, from: string, to: string): { changes: Change[]; text: string } | null {
  const doc = analyzeDocument(text);
  const pic = doc.syntax.pictures[picIndex];
  const node = layoutDocumentPicture(doc, picIndex)?.nodes.find((n) => n.id === nodeId);
  if (!pic || !node || !SIMPLE_NAME.test(to)) return null;
  const syn = node.syntax;
  const changes: Change[] = pictureReferences(text, pic)
    .filter((r) => r.in === "node" && r.name === from && r.nameRange && r.range.from >= syn.from && r.range.to <= syn.to)
    .map((r) => ({ from: r.nameRange!.from, to: r.nameRange!.to, insert: to }));
  if (!changes.length) return null;
  const next = applyChanges(text, changes);
  const after = layoutDocumentPicture(analyzeDocument(next), picIndex)?.nodes.find((n) => n.id === nodeId);
  return after && !after.locked ? { changes, text: next } : null;
}

/** Nodes a locked node could be attached to: named nodes defined before it. */
export function attachCandidates(layout: PictureLayout, node: LaidOutNode): LaidOutNode[] {
  const index = layout.nodes.indexOf(node);
  const seen = new Set<string>();
  return layout.nodes
    .slice(0, index)
    .reverse()
    .filter((n) => n.name && !n.implicitName && SIMPLE_NAME.test(n.name) && !seen.has(n.name) && seen.add(n.name))
    .reverse();
}

function centerOf(text: string, picIndex: number, nodeId: string): Point | null {
  const layout = layoutDocumentPicture(analyzeDocument(text), picIndex);
  const n = layout?.nodes.find((x) => x.id === nodeId);
  return n ? n.shape.center : null;
}

function trySpec(
  text: string,
  picIndex: number,
  node: LaidOutNode,
  syn: NodeSyntax,
  spec: PositionSpec,
  want: Point,
): MoveResult | null {
  const { x: ux, y: uy } = node.units;
  if (spec.kind === "absolute") {
    // First guess ignores the anchor and shifts; then correct by the measured offset.
    const guess = absoluteText(syn, spec.local, ux, uy);
    let changes = specChanges(text, syn, spec, guess);
    let next = applyChanges(text, changes);
    const got = centerOf(next, picIndex, node.id);
    if (!got) return null;
    const inv = invert(node.frame);
    const [dx, dy] = inv ? applyLinear(inv, want.x - got.x, want.y - got.y) : [want.x - got.x, want.y - got.y];
    const local = { x: spec.local.x + dx, y: spec.local.y + dy };
    changes = specChanges(text, syn, { kind: "absolute", local }, absoluteText(syn, local, ux, uy));
    next = applyChanges(text, changes);
    const final = centerOf(next, picIndex, node.id);
    if (!final || Math.hypot(final.x - want.x, final.y - want.y) > 2 * ROUND_TOLERANCE) return null;
    return { spec: { kind: "absolute", local }, changes, text: next, center: final, notes: [] };
  }
  const changes = specChanges(text, syn, spec);
  const next = applyChanges(text, changes);
  const got = centerOf(next, picIndex, node.id);
  if (!got) return null;
  const tolerance = spec.kind === "perp" ? ALIGN_EPS : Math.SQRT2 * ROUND_TOLERANCE;
  if (Math.hypot(got.x - want.x, got.y - want.y) > tolerance) return null;
  return { spec, changes, text: next, center: got, notes: [] };
}

/** The anchor point of a node, for guides. */
export function nodeAnchor(n: LaidOutNode, name: string): Point {
  return anchorPoint(n.shape, name) ?? n.shape.center;
}
