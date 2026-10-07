// Moving a node: choose how to write its new position (the emitter rules in
// SPEC.md), turn that into a minimal text patch, and check the result by
// laying out the patched text again.
import { analyzeDocument, layoutDocumentPicture } from "../model/document.ts";
import type { NodeSyntax, OptionItem, OptionList } from "../model/syntax.ts";
import type { LaidOutNode, PictureLayout } from "../tikz/layout.ts";
import { positioningAnchor, positioningDirection } from "../tikz/layout.ts";
import { anchorOffset, anchorPoint, type Point } from "../tikz/shapes.ts";
import { applyLinear, applyMatrix, invert, type Matrix } from "../tikz/state.ts";
import { PT_PER_UNIT, trimNumber } from "../tikz/units.ts";
import { applyChanges, type Change } from "./changes.ts";
import { addOptionList, appendItem, removeAtClause, removeItems, setAtClause } from "./optionEdits.ts";

const MM = PT_PER_UNIT.mm!;
/** How far an alignment may be off and still count, in pt. */
export const ALIGN_EPS = 0.5;
/** Distances are written to the nearest millimetre. */
const ROUND_TOLERANCE = 0.75 * MM;

export type PositionSpec =
  /** positioning library; distances in pt, undefined meaning "node distance". */
  | { kind: "positioning"; dir: string; target: string; v?: number; h?: number }
  /** "at (a |- b)": x from one node, y from another. */
  | { kind: "perp"; xFrom: string; yFrom: string }
  /** "at (x,y)" in the node's own frame. */
  | { kind: "absolute"; local: Point };

export interface MoveResult {
  spec: PositionSpec;
  changes: Change[];
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
    const cur = layout.nodes.find((n) => n.id === queue.pop());
    if (!cur?.name) continue;
    for (const m of layout.nodes) {
      if (!out.has(m.id) && m.id !== id && m.position.refs.includes(cur.name)) {
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
    (n) => n.kind === "statement" && n.name && SIMPLE_NAME.test(n.name) && !deps.has(n.id) && n.name !== node.name,
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

function frameScale(m: Matrix): { sx: number; sy: number } {
  return { sx: Math.hypot(m[0], m[1]) || 1, sy: Math.hypot(m[2], m[3]) || 1 };
}

/** Candidate specs for putting `node` with its centre at `c`, best first. */
export function candidateSpecs(layout: PictureLayout, node: LaidOutNode, c: Point): PositionSpec[] {
  const refs = referenceCandidates(layout, node).sort(
    (a, b) => Math.hypot(a.shape.center.x - c.x, a.shape.center.y - c.y) - Math.hypot(b.shape.center.x - c.x, b.shape.center.y - c.y),
  );
  const { sx, sy } = frameScale(node.frame);
  const nd = node.nodeDistance;
  const grid = node.onGrid;
  const specs: PositionSpec[] = [];
  const explicit: PositionSpec[] = [];
  const diagonal: PositionSpec[] = [];
  const perp: PositionSpec[] = [];

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

  for (const t of refs) {
    for (const dir of STRAIGHT) {
      const off = offsetFor(t, dir);
      if (!off) continue;
      const vertical = dir === "below" || dir === "above";
      if (Math.abs(vertical ? off.x : off.y) > ALIGN_EPS) continue;
      const [ux, uy] = positioningDirection(dir);
      // Distance along the direction, in canvas pt.
      const gap = off.x * ux + off.y * uy;
      if (gap < -ALIGN_EPS) continue;
      const local = vertical ? gap / sy : gap / sx;
      const nodeDist = vertical ? nd.v : nd.h;
      if (Math.abs(local - nodeDist) <= ROUND_TOLERANCE) specs.push({ kind: "positioning", dir, target: t.name! });
      else explicit.push(vertical ? { kind: "positioning", dir, target: t.name!, v: local } : { kind: "positioning", dir, target: t.name!, h: local });
    }
    for (const dir of DIAGONAL) {
      const off = offsetFor(t, dir);
      if (!off) continue;
      const [ux, uy] = positioningDirection(dir);
      const h = off.x * ux;
      const v = off.y * uy;
      if (h < -ALIGN_EPS || v < -ALIGN_EPS) continue;
      diagonal.push({ kind: "positioning", dir, target: t.name!, v: v / sy, h: h / sx });
    }
  }
  // Perpendicular: x from one node and y from another.
  const xAligned = refs.filter((t) => Math.abs(t.shape.center.x - c.x) <= ALIGN_EPS);
  const yAligned = refs.filter((t) => Math.abs(t.shape.center.y - c.y) <= ALIGN_EPS);
  for (const a of xAligned) for (const b of yAligned) if (a !== b) perp.push({ kind: "perp", xFrom: a.name!, yFrom: b.name! });

  const absolute: PositionSpec = { kind: "absolute", local: toLocal(node.frame, c) };
  // A node that was placed with plain numbers keeps that style unless the
  // drop lines up with other nodes.
  const wasAbsolute = node.position.kind === "at" && node.position.refs.length === 0;
  if (wasAbsolute) return [...specs, ...perp.slice(0, 1), ...explicit.slice(0, 1), absolute];
  return [...specs, ...perp.slice(0, 1), ...explicit.slice(0, 2), ...diagonal.slice(0, 1), absolute];
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
  return `${spec.dir}=${dist}of ${spec.target}`;
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
  const removeTest = spec.kind === "absolute" ? isRelationalItem : (i: OptionItem) => isPlacementKey(i.key);
  const remove = ownItems(syn, removeTest);
  let replaced: OwnItem | undefined;
  if (spec.kind === "positioning") {
    const newText = positioningText(spec);
    replaced = remove.find((r) => isRelationalItem(r.item)) ?? remove.find((r) => POSITIONING_KEY.test(r.item.key)) ?? remove[0];
    if (replaced) changes.push({ from: replaced.item.from, to: replaced.item.to, insert: newText });
    else if (syn.options[0]) changes.push(appendItem(text, syn.options[0], newText));
    else changes.push(addOptionList(syn, newText));
    const at = removeAtClause(text, syn);
    if (at) changes.push(at);
  } else {
    const coord = spec.kind === "perp" ? `${spec.xFrom} |- ${spec.yFrom}` : coordText!;
    changes.push(setAtClause(syn, coord));
  }
  // Remove the other placement items, list by list.
  for (const list of syn.options) {
    const items = remove.filter((r) => r.list === list && r !== replaced).map((r) => r.item);
    if (!items.length) continue;
    const keptAfter = list.items.filter((i) => !items.includes(i));
    if (!keptAfter.length && spec.kind === "positioning" && !replaced && list === syn.options[0]) {
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
    if (result) return result;
  }
  return null;
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
    return { spec: { kind: "absolute", local }, changes, text: next, center: final };
  }
  const changes = specChanges(text, syn, spec);
  const next = applyChanges(text, changes);
  const got = centerOf(next, picIndex, node.id);
  if (!got) return null;
  const tolerance = spec.kind === "perp" ? ALIGN_EPS : Math.SQRT2 * ROUND_TOLERANCE;
  if (Math.hypot(got.x - want.x, got.y - want.y) > tolerance) return null;
  return { spec, changes, text: next, center: got };
}

/** The anchor point of a node, for guides. */
export function nodeAnchor(n: LaidOutNode, name: string): Point {
  return anchorPoint(n.shape, name) ?? n.shape.center;
}
