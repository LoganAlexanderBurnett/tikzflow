// Moving several nodes at once (M4 step 1): a multi-selection, or a `fit`
// node's members, dragged as a group. Only the nodes placed against something
// outside the group are rewritten (through the single-node emitter, so the
// same relational forms come out); nodes placed against other members follow
// on their own. Absolute corners of edges between two members move along.
import { analyzeDocument, layoutDocumentPicture } from "../model/document.ts";
import { coordNames } from "../model/references.ts";
import { type Edge, pictureEdges } from "../model/edges.ts";
import type { LaidOutNode, PictureLayout } from "../tikz/layout.ts";
import type { Point } from "../tikz/shapes.ts";
import { PT_PER_UNIT } from "../tikz/units.ts";
import { applyChanges, type Change, composeChanges } from "./changes.ts";
import { absoluteText, isPlainStop, writeStops } from "./edges.ts";
import { type ChainConversion, conversionMessage, planChainConversion } from "./chains.ts";
import { dependents, planMove, planPin, positioningText, type PositionSpec } from "./move.ts";

const MM = PT_PER_UNIT.mm!;
/** Each rewritten node is rounded to whole millimetres (D24), so members may land this far from the exact shift. */
const GROUP_TOLERANCE = Math.SQRT2 * 0.75 * MM;
/** Nodes the edit doesn't mean to move must stay exactly where they were. */
const KEEP_TOLERANCE = 0.05;

export interface GroupMembers {
  /** Nodes that move with the group (fit nodes replaced by what they fit). */
  members: string[];
  /** Fit nodes in the selection: they follow their members. */
  boxes: string[];
}

export type GroupMoveResult =
  | {
      ok: true;
      changes: Change[];
      text: string;
      /** What was written for each rewritten node, by id after the edit. */
      written: Array<{ id: string; name: string; spec: PositionSpec }>;
      /** Chains written out first so their nodes could move (D77 item 4). */
      conversions: Array<ChainConversion & { ok: true }>;
      /** Edge corners moved along with the group. */
      corners: number;
      library: boolean;
      notes: string[];
    }
  | { ok: false; reason: string };

/** The node a name refers to at `before` (the latest definition earlier in the code), or undefined. */
function named(layout: PictureLayout, name: string, before: LaidOutNode): LaidOutNode | undefined {
  const index = layout.nodes.indexOf(before);
  return layout.nodes.slice(0, index).reverse().find((n) => n.name === name);
}

/**
 * The nodes that move when `ids` are dragged together: each selected node, and
 * for a `fit` node the nodes it fits (recursively), since a fit node follows
 * what it covers.
 */
export function groupMembers(layout: PictureLayout, ids: readonly string[]): GroupMembers {
  const members = new Set<string>();
  const boxes = new Set<string>();
  const visit = (id: string) => {
    const n = layout.nodes.find((x) => x.id === id);
    if (!n || members.has(id) || boxes.has(id)) return;
    if (n.position.kind === "fit") {
      boxes.add(id);
      for (const r of n.position.refs) {
        const m = named(layout, r, n);
        if (m) visit(m.id);
      }
    } else members.add(id);
  };
  ids.forEach(visit);
  // Keep code order: earlier nodes are written first.
  const order = (s: Set<string>) => layout.nodes.filter((n) => s.has(n.id)).map((n) => n.id);
  return { members: order(members), boxes: order(boxes) };
}

/**
 * Every node that moves when the members move: the members, what depends on
 * them, and the nodes placed on a path that runs from or to something that
 * moves (an edge label, `coordinate[midway]`), with what depends on those.
 */
export function movingWith(layout: PictureLayout, members: readonly string[]): Set<string> {
  const out = new Set<string>();
  const names = new Set<string>();
  const queue = [...members];
  const all = [...layout.nodes, ...layout.pathNodes];
  const add = (id: string) => {
    if (out.has(id)) return;
    out.add(id);
    const n = all.find((x) => x.id === id);
    if (n?.name) {
      names.add(n.name);
      // Nodes placed against it by name (a path label isn't in `dependents`' reach).
      for (const m of layout.nodes) if (m.position.refs.includes(n.name)) queue.push(m.id);
    }
    if (layout.nodes.some((x) => x.id === id)) for (const d of dependents(layout, id)) queue.push(d);
  };
  for (;;) {
    while (queue.length) add(queue.pop()!);
    // Paths whose points name a moving node carry the nodes placed on them along.
    let grew = false;
    for (const p of layout.paths) {
      const refs = (p.route?.stops ?? []).flatMap((s) => [...(s.node ? [s.node] : []), ...coordNames(s.text).map((c) => c.name)]);
      if (!refs.some((r) => out.has(r) || names.has(r))) continue;
      for (const n of all) {
        if (n.statement.from === p.syntax.from && n.statement.to === p.syntax.to && !out.has(n.id)) {
          queue.push(n.id);
          grew = true;
        }
      }
    }
    if (!grew) return out;
  }
}

/** Why the group can't be dragged, or null. */
export function groupBlocker(layout: PictureLayout, ids: readonly string[]): string | null {
  const { members } = groupMembers(layout, ids);
  if (!members.length) return "There is nothing in the selection that can be moved.";
  const set = new Set(members);
  for (const id of members) {
    const n = layout.nodes.find((x) => x.id === id)!;
    // An undefined name is pinned where it lands; a chain is written out first (D77 item 4).
    if (!n.locked || n.lock?.kind === "undefined-ref" || n.lock?.kind === "chain") continue;
    // A locked node that is placed against another member still moves with it.
    if (n.position.refs.some((r) => { const t = named(layout, r, n); return t && set.has(t.id); })) continue;
    return `${n.name ?? "A node"} can't be moved: ${n.locked}.`;
  }
  return null;
}

/**
 * Moves the nodes `ids` of picture `picIndex` (with what they fit, for fit
 * nodes) by `delta`, in canvas pt. Members placed against something outside
 * the group are rewritten in code order, so each one may refer to the members
 * before it; the others follow. The result is checked by laying it out: every
 * member lands `delta` away (within the millimetre rounding), and every node
 * that neither is a member nor depends on one stays exactly where it was.
 */
export function planGroupMove(text: string, picIndex: number, ids: readonly string[], delta: Point): GroupMoveResult {
  const layout = layoutDocumentPicture(analyzeDocument(text), picIndex);
  if (!layout) return { ok: false, reason: "There is no picture." };
  const blocked = groupBlocker(layout, ids);
  if (blocked) return { ok: false, reason: blocked };
  // Members a chain places: their chains are written out first, as one edit with the move.
  let base = text;
  let pre: Change[] = [];
  const idMap = new Map<string, string>();
  const conversions: Array<ChainConversion & { ok: true }> = [];
  const serials = new Set<number>();
  for (const id of groupMembers(layout, ids).members) {
    const n = layout.nodes.find((x) => x.id === id)!;
    if (n.lock?.kind !== "chain" || !n.chain || serials.has(n.chain.serial)) continue;
    serials.add(n.chain.serial);
    const c = planChainConversion(base, picIndex, idMap.get(id) ?? id);
    if (!c.ok) return c;
    pre = composeChanges(text, pre, c.changes);
    base = c.text;
    for (const [k, v] of idMap) if (c.ids.has(v)) idMap.set(k, c.ids.get(v)!);
    for (const [k, v] of c.ids) if (!idMap.has(k)) idMap.set(k, v);
    conversions.push(c);
  }
  const r = moveGroup(base, picIndex, ids.map((id) => idMap.get(id) ?? id), delta);
  if (!r.ok) return r;
  return { ...r, changes: conversions.length ? composeChanges(text, pre, r.changes) : r.changes, conversions };
}

function moveGroup(text: string, picIndex: number, ids: readonly string[], delta: Point): GroupMoveResult {
  const doc = analyzeDocument(text);
  const layout = layoutDocumentPicture(doc, picIndex);
  if (!layout) return { ok: false, reason: "There is no picture." };
  const blocked = groupBlocker(layout, ids);
  if (blocked) return { ok: false, reason: blocked };
  const { members } = groupMembers(layout, ids);
  const memberSet = new Set(members);
  const start = new Map(layout.nodes.map((n) => [n.id, n.shape.center]));
  const want = (id: string): Point => {
    const c = start.get(id)!;
    return { x: c.x + delta.x, y: c.y + delta.y };
  };
  const moving = movingWith(layout, members);

  let current = text;
  let changes: Change[] = [];
  const written: Array<{ id: string; name: string; spec: PositionSpec }> = [];
  let library = false;
  const notes = new Set<string>();
  const done = new Set<string>();
  const add = (next: Change[], nextText: string) => {
    changes = composeChanges(text, changes, next);
    current = nextText;
  };

  // Rounds: rewrite every member that isn't yet where it should be, in code
  // order. A member placed against another member arrives with it; one that
  // only partly follows ("at (a |- b)" with b outside the group) is rewritten
  // in a later round.
  for (let round = 0; round < 4; round++) {
    const now = layoutDocumentPicture(analyzeDocument(current), picIndex);
    if (!now) return { ok: false, reason: "The picture couldn't be laid out after the move." };
    const off = members.filter((id) => {
      const n = now.nodes.find((x) => x.id === id);
      const w = want(id);
      return !n || Math.hypot(n.shape.center.x - w.x, n.shape.center.y - w.y) > GROUP_TOLERANCE;
    });
    if (!off.length) break;
    // In the first round, only members that don't depend on another member: the rest follow.
    const todo = round === 0 ? off.filter((id) => !members.some((m) => m !== id && dependents(now, m).has(id))) : off;
    if (!todo.length) break;
    for (const id of todo) {
      if (done.has(id)) return { ok: false, reason: `${nameOf(layout, id)} couldn't be put where it was dropped.` };
      done.add(id);
      const n = layoutDocumentPicture(analyzeDocument(current), picIndex)?.nodes.find((x) => x.id === id);
      if (!n) return { ok: false, reason: "A node couldn't be found after the move." };
      // A member lines up with the other members only because it did before the move, which
      // the user didn't choose now: it isn't newly related to them. So a translation keeps each
      // member's own form (a plain-coordinate picture keeps its numbers, D24; an "at" keeps its
      // expression and gets a shift). A member that already refers to another one keeps doing so.
      // Everything that moves with the group counts, not only the members (a chain's next node, say).
      const memberNames = new Set([...moving].flatMap((m) => (m !== id && layout.nodes.find((x) => x.id === m)?.name) || []));
      const exclude = n.position.refs.some((r) => memberNames.has(r)) ? undefined : memberNames;
      // A node locked only by an undefined name is pinned where it lands, as when dragged alone.
      const r = n.lock?.kind === "undefined-ref" ? planPin(current, picIndex, id, want(id)) : planMove(current, picIndex, id, want(id), exclude);
      if (!r) return { ok: false, reason: `The new position of ${nameOf(layout, id)} couldn't be written; nothing was moved.` };
      add(r.changes, r.text);
      written.push({ id, name: nameOf(layout, id), spec: r.spec });
      if (r.library) library = true;
      for (const note of r.notes) notes.add(note);
    }
  }

  // Edge corners written as plain numbers, on edges between two nodes that
  // moved by exactly the group's shift, move along.
  let corners = 0;
  const shifted = (l: PictureLayout, id: string | undefined) => {
    if (!id || !moving.has(id)) return false;
    const n = l.nodes.find((x) => x.id === id);
    const w = want(id);
    return !!n && Math.hypot(n.shape.center.x - w.x, n.shape.center.y - w.y) <= GROUP_TOLERANCE;
  };
  const edgeIds = pictureEdges(layout).filter((e) => !e.lock && memberEnds(e, moving)).map((e) => e.id);
  for (const edgeId of edgeIds) {
    const l = layoutDocumentPicture(analyzeDocument(current), picIndex);
    const edge = l && pictureEdges(l).find((e) => e.id === edgeId);
    if (!l || !edge || !shifted(l, edge.source) || !shifted(l, edge.target)) continue;
    const before = pictureEdges(layout).find((e) => e.id === edgeId)!;
    const inside = edge.segs.slice(1).map((k) => edge.route.segs[k]!.a);
    const writes = inside.flatMap((k) => {
      const s = edge.route.stops[k]!;
      const was = before.route.stops[k];
      if (!was || !isPlainStop(s)) return [];
      const p = { x: was.point.x + delta.x, y: was.point.y + delta.y };
      const t = absoluteText(edge.route, p, /,\s/.test(s.text) ? ", " : ",");
      return t ? [{ stop: k, text: t, want: p }] : [];
    });
    if (!writes.length) continue;
    const r = writeStops(current, picIndex, edge, writes);
    if (!r.ok) {
      notes.add(`a corner of the edge ${edgeId} couldn't be moved along (${r.reason})`);
      continue;
    }
    add(r.changes, r.text);
    corners += writes.length;
  }

  // The check.
  const after = layoutDocumentPicture(analyzeDocument(current), picIndex);
  if (!after) return { ok: false, reason: "The picture couldn't be laid out after the move." };
  for (const n of after.nodes) {
    const was = start.get(n.id);
    if (!was) return { ok: false, reason: "The move would change the picture's nodes, so it wasn't written." };
    if (memberSet.has(n.id)) {
      const w = want(n.id);
      if (Math.hypot(n.shape.center.x - w.x, n.shape.center.y - w.y) > GROUP_TOLERANCE) return { ok: false, reason: `${nameOf(layout, n.id)} wouldn't land where it was dropped, so nothing was moved.` };
    } else if (!moving.has(n.id) && n.position.kind !== "fit" && Math.hypot(n.shape.center.x - was.x, n.shape.center.y - was.y) > KEEP_TOLERANCE) {
      return { ok: false, reason: `The move would also move ${nameOf(layout, n.id)}, so it wasn't written.` };
    }
  }
  if (applyChanges(text, changes) !== current) return { ok: false, reason: "The move couldn't be written as one edit." };
  return { ok: true, changes, text: current, written, corners, library, notes: [...notes], conversions: [] };
}

function memberEnds(e: Edge, moving: ReadonlySet<string>): boolean {
  return !!e.source && !!e.target && moving.has(e.source) && moving.has(e.target);
}

function nameOf(layout: PictureLayout, id: string): string {
  return layout.nodes.find((n) => n.id === id)?.name ?? "a node";
}

/** A one-line summary of a group move for the status bar. */
export function groupMessage(r: GroupMoveResult & { ok: true }, count: number): string {
  const parts = r.written.slice(0, 3).map(({ name, spec }) => `${name}: ${specText(spec)}`);
  const more = r.written.length > 3 ? `, and ${r.written.length - 3} more` : "";
  const follow = count - r.written.length;
  let s = `Moved ${count} node${count === 1 ? "" : "s"}. Wrote ${parts.join("; ")}${more}.`;
  if (follow > 0) s += ` ${follow === 1 ? "One follows" : `${follow} follow`} the node${follow === 1 ? "" : "s"} it is placed against.`;
  if (r.corners) s += ` Moved ${r.corners === 1 ? "a corner" : `${r.corners} corners`} of the edges between them.`;
  if (r.library) s += " Loaded the positioning library.";
  for (const c of r.conversions) s += ` ${conversionMessage(c)}`;
  for (const n of r.notes) s += ` Note: ${n}.`;
  return s;
}

function specText(s: PositionSpec): string {
  return s.kind === "positioning" ? positioningText(s) : s.kind === "perp" ? `at (${s.xFrom} |- ${s.yFrom})` : s.kind === "shift" ? "its shift adjusted" : "coordinates";
}
