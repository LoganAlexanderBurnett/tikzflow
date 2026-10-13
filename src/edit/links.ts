// Placement links (M6 step 1, D102, D104): what a node is placed against
// ("below=of read") and what is placed against it, and the edits that cut
// those links without anything moving on screen: Unlink, Detach, and keeping
// a dragged node's followers where they are when only it moves. A node whose
// link is cut is re-attached to something else where it stands, written
// exactly (distances to the tenth of a millimetre when whole ones don't
// reproduce its place), or pinned with coordinates as a last resort.
//
// Not placement links, and left to follow as they always do: a group or lane
// box around its members, the coordinates a set of lanes shares (D81), and
// nodes on a path (labels follow their edge). A chain's nodes are written out
// first (D79) when one of them has to stay where it is.
import { analyzeDocument, layoutDocumentPicture } from "../model/document.ts";
import type { LaidOutNode, PictureLayout } from "../tikz/layout.ts";
import { coordNames } from "../model/references.ts";
import { borderToward, type Point } from "../tikz/shapes.ts";
import { applyChanges, type Change, composeChanges } from "./changes.ts";
import { planChainConversion } from "./chains.ts";
import { laneSets } from "./lanes.ts";
import { ALIGN_EPS, isRelationalItem, type MoveResult, planMove, planPin, positioningText, type PositionSpec } from "./move.ts";

/** One link: the other node, and the placement that makes it, as written. */
export interface Link {
  id: string;
  name: string;
  /** "below=of read", "at (a |- b)": the follower's own placement text. */
  how: string;
}

export interface Links {
  /** What the node is placed against. */
  follows: Link[];
  /** Nodes placed against it directly (each may carry others along). */
  followers: Link[];
}

/** A node placed on a path: it goes where its path goes, like an edge label. */
const onPath = (n: LaidOutNode) => n.kind === "path" || n.lock?.kind === "path";

/** Nodes that follow other nodes by design rather than by a placement someone wrote: group and lane boxes, and the coordinates lanes share. */
export function followsByDesign(text: string, layout: PictureLayout): Set<string> {
  const out = new Set(layout.nodes.filter((n) => n.position.kind === "fit").map((n) => n.id));
  for (const s of laneSets(text, layout)) for (const e of s.ends) out.add(e.id);
  return out;
}

/** The node a name refers to at `before`: the latest definition earlier in the code. */
function named(layout: PictureLayout, name: string, before: LaidOutNode): LaidOutNode | undefined {
  const index = layout.nodes.indexOf(before);
  return layout.nodes.slice(0, index).reverse().find((n) => n.name === name);
}

/** The node's placement as written: its relational options and its `at` clause. */
export function placementText(text: string, n: LaidOutNode): string {
  const parts: string[] = [];
  for (const list of n.syntax.options) for (const item of list.items) if (isRelationalItem(item) && item.key !== "at") parts.push(text.slice(item.from, item.to).replace(/\s+/g, " ").trim());
  if (n.syntax.at) parts.push(`at ${text.slice(n.syntax.at.coord.from, n.syntax.at.coord.to).replace(/\s+/g, " ").trim()}`);
  return parts.join(", ");
}

/** The nodes `n` is placed against, and the nodes placed against it, in code order. */
export function placementLinks(text: string, layout: PictureLayout, n: LaidOutNode, design: ReadonlySet<string> = followsByDesign(text, layout)): Links {
  const follows: Link[] = [];
  if (!design.has(n.id) && !onPath(n)) {
    for (const r of n.position.refs) {
      const t = named(layout, r, n);
      if (t && !onPath(t) && !follows.some((l) => l.id === t.id)) follows.push({ id: t.id, name: r, how: placementText(text, n) });
    }
  }
  const followers: Link[] = [];
  if (n.name) {
    for (const m of layout.nodes) {
      if (m === n || onPath(m) || design.has(m.id) || !m.position.refs.includes(n.name)) continue;
      if (named(layout, n.name, m)?.id !== n.id) continue;
      followers.push({ id: m.id, name: m.name ?? m.id, how: placementText(text, m) });
    }
  }
  return { follows, followers };
}

/** Draws nothing but its text, and has some: no border, fill, shading, shadow or double line. */
const textOnly = (n: LaidOutNode) => n.kind === "statement" && !!n.syntax.label?.text.trim() && !n.stroke && !n.fill && !n.shading && !n.shadow && !n.double;

/** Whether `name` appears as a word in `code` (a `\foreach` list of names, a coordinate). */
const mentions = (code: string, name: string) => new RegExp(`(^|[^A-Za-z0-9_-])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^A-Za-z0-9_-])`).test(code);

/** Whether `p` is inside node `m`'s border. */
function inside(m: LaidOutNode, p: Point): boolean {
  const c = m.shape.center;
  if (Math.abs(p.x - c.x) > m.shape.hw || Math.abs(p.y - c.y) > m.shape.hh) return false;
  const b = borderToward(m.shape, p);
  return Math.hypot(p.x - c.x, p.y - c.y) <= Math.hypot(b.x - c.x, b.y - c.y) + 0.01;
}

/**
 * The annotations of the nodes `members` (D107): followers that only label them, so they move
 * with them even when only the dragged nodes move. A follower is an annotation when it
 * - draws nothing but its text (no `draw`, `fill`, shading or shadow) and has some,
 * - is placed only against the members or their other annotations,
 * - has no edge or path drawn to or from it (in the code the editor reads or in a block kept as
 *   it is, such as a `\foreach`),
 * - has nothing else placed against it (a column of labels other things line up with stays),
 * - isn't named in a group box's `fit` (a group's title belongs to the group), and
 * - doesn't sit inside another drawn node (a count in the overlap of two Venn sets belongs to both).
 * Everything else that follows them is a part of the diagram and stays where it is.
 */
export function annotationsOf(text: string, layout: PictureLayout, members: readonly string[], design: ReadonlySet<string>): string[] {
  // Names and ids any path goes through: a node an edge or a line reaches is a part of the diagram.
  const reached = new Set<string>();
  for (const p of layout.paths) {
    for (const s of p.route?.stops ?? []) {
      if (s.node) reached.add(s.node);
      for (const c of coordNames(s.text)) reached.add(c.name);
    }
  }
  const opaque = layout.opaque.map((o) => text.slice(o.range.from, o.range.to)).join("\n");
  const drawn = layout.nodes.filter((m) => m.kind === "statement" && (m.stroke || m.fill || m.shading) && !design.has(m.id));
  const grouped = new Set(layout.nodes.filter((m) => m.position.kind === "fit").flatMap((m) => m.position.refs));
  const candidate = (n: LaidOutNode) =>
    !members.includes(n.id) &&
    !design.has(n.id) &&
    !onPath(n) &&
    textOnly(n) &&
    n.position.refs.length > 0 &&
    !reached.has(n.id) &&
    !(n.name && (reached.has(n.name) || grouped.has(n.name) || mentions(opaque, n.name)));
  const moving = new Set(members);
  const hangsOnMoving = (n: LaidOutNode) => n.position.refs.every((r) => moving.has(named(layout, r, n)?.id ?? ""));
  const placedAgainst = (n: LaidOutNode) =>
    n.name ? layout.nodes.filter((m) => m !== n && !onPath(m) && !design.has(m.id) && m.position.refs.includes(n.name!) && named(layout, n.name!, m)?.id === n.id) : [];
  // Grow from the members through candidates placed only against what moves; then drop each one
  // that something staying is placed against, and what hung off it. A dropped node stays dropped.
  const dropped = new Set<string>();
  for (let changed = true; changed; ) {
    changed = false;
    for (let grew = true; grew; ) {
      grew = false;
      for (const n of layout.nodes) {
        if (moving.has(n.id) || dropped.has(n.id) || !candidate(n) || !hangsOnMoving(n)) continue;
        if (drawn.some((m) => !moving.has(m.id) && inside(m, n.shape.center))) continue;
        moving.add(n.id);
        grew = true;
      }
    }
    for (const n of layout.nodes) {
      if (!moving.has(n.id) || members.includes(n.id)) continue;
      if (hangsOnMoving(n) && placedAgainst(n).every((m) => moving.has(m.id))) continue;
      moving.delete(n.id);
      dropped.add(n.id);
      changed = true;
    }
  }
  return layout.nodes.filter((n) => moving.has(n.id) && !members.includes(n.id)).map((n) => n.id);
}

/** A node rewritten so it stays put, and how it is placed now. */
export interface Kept {
  id: string;
  name: string;
  how: string;
}

export type LinkOutcome = { ok: true; changes: Change[]; text: string; kept: Kept[]; ids: Map<string, string> } | { ok: false; reason: string };

/** How a planned position reads, in a few words. */
export function specSummary(spec: PositionSpec): string {
  if (spec.kind === "positioning") return positioningText(spec);
  if (spec.kind === "perp") return `at (${spec.xFrom} |- ${spec.yFrom})`;
  if (spec.kind === "shift") return "its own shift adjusted";
  return "pinned with coordinates";
}

/** A sequence of edits to one text, kept as one set of changes against the original, and the ids that changed on the way. */
class Work {
  readonly base: string;
  text: string;
  changes: Change[] = [];
  /** Original id → id now, for nodes named when their chain was written out. */
  ids = new Map<string, string>();
  constructor(base: string) {
    this.base = base;
    this.text = base;
  }
  apply(step: readonly Change[]): void {
    if (!step.length) return;
    this.changes = composeChanges(this.base, this.changes, step);
    this.text = applyChanges(this.text, step);
  }
  /** The id now of a node that had `id` at the start. */
  now(id: string): string {
    return this.ids.get(id) ?? id;
  }
  /** Writes out the chain that places node `id` (D79), so it can be rewritten. Null when that worked. */
  unchain(picIndex: number, id: string): string | null {
    const c = planChainConversion(this.text, picIndex, id);
    if (!c.ok) return c.reason;
    this.apply(c.changes);
    for (const [cur, next] of c.ids) {
      const originals = [...this.ids].filter(([, v]) => v === cur).map(([k]) => k);
      if (originals.length) for (const k of originals) this.ids.set(k, next);
      else this.ids.set(cur, next);
    }
    return null;
  }
}

const layoutOf = (text: string, picIndex: number) => layoutDocumentPicture(analyzeDocument(text), picIndex);
const far = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) > ALIGN_EPS;
const nameOf = (n: LaidOutNode) => n.name ?? "a node";

/**
 * Writes node `id` so it stays at `center` without referring to any of
 * `exclude`: re-attached to another node (those in `prefer` first), or
 * pinned with coordinates.
 */
function reattach(text: string, picIndex: number, id: string, center: Point, exclude: ReadonlySet<string>, prefer?: ReadonlySet<string>): MoveResult | null {
  return planMove(text, picIndex, id, center, exclude, { exact: true, ...(prefer ? { prefer } : {}) }) ?? planPin(text, picIndex, id, center, true);
}

/** Checks that every node of `before` except `allowed`, nodes on paths and those that follow by design is where it was in `after`. */
function stillInPlace(w: Work, before: PictureLayout, after: PictureLayout, allowed: ReadonlySet<string>, design: ReadonlySet<string>): string | null {
  for (const b of before.nodes) {
    if (onPath(b) || allowed.has(b.id) || design.has(b.id)) continue;
    const a = after.nodes.find((n) => n.id === w.now(b.id));
    if (!a) return `${nameOf(b)} would be lost`;
    if (far(a.shape.center, b.shape.center)) return `${nameOf(b)} would move`;
  }
  return null;
}

/**
 * After the nodes `allowed` moved in `text` (from `base`, the layout before
 * the move), puts every other node that moved with them back where it was:
 * the earliest one first, re-attached to something that didn't move (`prefer`
 * first) or pinned, until nothing else has moved. Fails with a reason when a
 * node can't be rewritten (locked, or in a block kept as it is), so the caller
 * can refuse rather than move it. `renamed` maps ids of `base` to ids in
 * `text` for nodes the edit renamed.
 */
export function keepInPlace(text: string, picIndex: number, base: PictureLayout, allowed: ReadonlySet<string>, prefer?: ReadonlySet<string>, renamed?: ReadonlyMap<string, string>): LinkOutcome {
  const w = new Work(text);
  // Nodes the edit before this one renamed (a chain written out, D79): original id → id in `text`.
  if (renamed) for (const [k, v] of renamed) w.ids.set(k, v);
  const kept: Kept[] = [];
  const tried = new Set<string>();
  const was = new Map(base.nodes.map((n) => [n.id, n.shape.center]));
  const start = layoutOf(text, picIndex);
  if (!start) return { ok: false, reason: "The picture couldn't be laid out." };
  const design = followsByDesign(text, start);
  for (let round = 0; round < 500; round++) {
    const now = layoutOf(w.text, picIndex);
    if (!now) return { ok: false, reason: "The picture couldn't be laid out." };
    const origin = new Map([...was.keys()].map((id) => [w.now(id), id]));
    const moved = now.nodes.filter((n) => !onPath(n) && origin.has(n.id) && far(n.shape.center, was.get(origin.get(n.id)!)!));
    const next = moved.find((n) => !allowed.has(origin.get(n.id)!) && !design.has(n.id));
    if (!next) break;
    const name = nameOf(next);
    if (next.lock?.kind === "chain") {
      const why = w.unchain(picIndex, next.id);
      if (why) return { ok: false, reason: `${name} would move along, and its chain can't be written out: ${why}` };
      continue;
    }
    if (tried.has(next.id)) return { ok: false, reason: `${name} couldn't be kept where it is.` };
    tried.add(next.id);
    if (next.locked) return { ok: false, reason: `${name} would move along, and it can't be rewritten: ${next.locked}.` };
    // What moved can't be referred to: it is no longer where the node needs it.
    const movedNames = new Set(moved.flatMap((n) => (n.name ? [n.name] : [])));
    const usable = prefer ? new Set([...prefer].filter((p) => !movedNames.has(p))) : undefined;
    const r = reattach(w.text, picIndex, next.id, was.get(origin.get(next.id)!)!, movedNames, usable);
    if (!r) return { ok: false, reason: `${name} couldn't be written where it is.` };
    w.apply(r.changes);
    kept.push({ id: next.id, name, how: specSummary(r.spec) });
  }
  const after = layoutOf(w.text, picIndex);
  if (!after) return { ok: false, reason: "The picture couldn't be laid out." };
  const problem = stillInPlace(w, base, after, allowed, design);
  if (problem) return { ok: false, reason: `It can't be done without moving other nodes: ${problem}.` };
  return { ok: true, changes: w.changes, text: w.text, kept, ids: w.ids };
}

/**
 * Unlink: node `id` stops being placed against `other` (direction
 * "follows"), or `other`, one of its followers, stops being placed against
 * node `id` (direction "follower"). Nothing moves.
 */
export function planUnlink(text: string, picIndex: number, id: string, other: string, direction: "follows" | "follower"): LinkOutcome {
  const layout = layoutOf(text, picIndex);
  const n = layout?.nodes.find((x) => x.id === id);
  const o = layout?.nodes.find((x) => x.id === other);
  if (!layout || !n || !o) return { ok: false, reason: "That node isn't in the picture any more." };
  const [moving, from] = direction === "follows" ? [n, o] : [o, n];
  if (!from.name) return { ok: false, reason: "There is no link to cut." };
  const w = new Work(text);
  if (moving.lock?.kind === "chain") {
    const why = w.unchain(picIndex, moving.id);
    if (why) return { ok: false, reason: `${nameOf(moving)} is placed by a chain that can't be written out: ${why}` };
  } else if (moving.locked) return { ok: false, reason: `${nameOf(moving)} can't be rewritten: ${moving.locked}.` };
  const r = reattach(w.text, picIndex, w.now(moving.id), moving.shape.center, new Set([from.name]));
  if (!r) return { ok: false, reason: `${nameOf(moving)} couldn't be written where it is without ${from.name}.` };
  w.apply(r.changes);
  const after = layoutOf(w.text, picIndex);
  const problem = after && stillInPlace(w, layout, after, new Set(), followsByDesign(text, layout));
  if (!after || problem) return { ok: false, reason: `Unlinking would move other nodes: ${problem ?? "the picture couldn't be laid out"}.` };
  return { ok: true, changes: w.changes, text: w.text, kept: [{ id: w.now(moving.id), name: nameOf(moving), how: specSummary(r.spec) }], ids: w.ids };
}

/**
 * Detach: the nodes `ids` lose every placement link in both directions with
 * nothing moving. Each node gets its current position as coordinates; the
 * nodes placed against them are re-attached to something else (what the
 * detached node was placed against first) or pinned where they are.
 */
export function planDetach(text: string, picIndex: number, ids: readonly string[]): LinkOutcome {
  const layout = layoutOf(text, picIndex);
  if (!layout) return { ok: false, reason: "There is no picture." };
  const design = followsByDesign(text, layout);
  const nodes = layout.nodes.filter((n) => ids.includes(n.id) && !onPath(n) && !design.has(n.id));
  if (!nodes.length) return { ok: false, reason: "There is nothing to detach: group and lane boxes follow their members, and labels follow their edges." };
  const set = new Set(nodes.map((n) => n.id));
  const names = new Set(nodes.flatMap((n) => (n.name ? [n.name] : [])));
  const prefer = new Set(nodes.flatMap((n) => n.position.refs).filter((r) => !names.has(r)));
  const followers = nodes.flatMap((n) => placementLinks(text, layout, n, design).followers.filter((f) => !set.has(f.id)).map((f) => ({ f, of: n })));
  const w = new Work(text);
  // Chains first: a node placed by a chain is rewritten only once the chain is written out (D79).
  for (const id of [...set, ...followers.map((x) => x.f.id)]) {
    const n = layoutOf(w.text, picIndex)?.nodes.find((x) => x.id === w.now(id));
    if (n?.lock?.kind !== "chain") continue;
    const why = w.unchain(picIndex, n.id);
    if (why) return { ok: false, reason: `${nameOf(n)} is placed by a chain that can't be written out: ${why}` };
  }
  const kept: Kept[] = [];
  // 1. The nodes placed against them, outside the selection, in code order. Read again after the
  // chains were written out: those nodes now name what they follow.
  const was = new Map(layout.nodes.map((n) => [w.now(n.id), n.shape.center]));
  const cur = layoutOf(w.text, picIndex);
  if (!cur) return { ok: false, reason: "The picture couldn't be laid out." };
  const curSet = new Set([...set].map((id) => w.now(id)));
  const curNames = new Set(cur.nodes.filter((n) => curSet.has(n.id) && n.name).map((n) => n.name!));
  const curDesign = followsByDesign(w.text, cur);
  const todo = cur.nodes.filter((n) => curSet.has(n.id)).flatMap((n) => placementLinks(w.text, cur, n, curDesign).followers.filter((f) => !curSet.has(f.id)).map((f) => ({ f, of: n })));
  for (const { f, of } of todo) {
    if (kept.some((k) => k.id === f.id)) continue;
    const now = layoutOf(w.text, picIndex)?.nodes.find((x) => x.id === f.id);
    if (!now) return { ok: false, reason: "A node couldn't be found while detaching." };
    if (now.locked) return { ok: false, reason: `${nameOf(now)} is placed against ${nameOf(of)} and can't be rewritten: ${now.locked}.` };
    const r = reattach(w.text, picIndex, now.id, was.get(now.id) ?? now.shape.center, curNames, prefer);
    if (!r) return { ok: false, reason: `${nameOf(now)} couldn't be written where it is without ${nameOf(of)}.` };
    w.apply(r.changes);
    kept.push({ id: now.id, name: nameOf(now), how: specSummary(r.spec) });
  }
  // 2. Each node itself, at its current position. One already in plain coordinates has nothing to cut.
  let pinned = 0;
  for (const n of nodes) {
    const now = layoutOf(w.text, picIndex)?.nodes.find((x) => x.id === w.now(n.id));
    if (!now?.position.refs.length) continue;
    const r = planPin(w.text, picIndex, now.id, n.shape.center, true);
    if (!r) return { ok: false, reason: `${nameOf(n)} couldn't be pinned where it is.` };
    w.apply(r.changes);
    pinned++;
  }
  if (!pinned && !kept.length && !w.changes.length) {
    return { ok: false, reason: nodes.length === 1 ? `${nameOf(nodes[0]!)} is already detached: it isn't placed against another node, and nothing is placed against it.` : "These nodes are already detached." };
  }
  const after = layoutOf(w.text, picIndex);
  const problem = after && stillInPlace(w, layout, after, new Set(), design);
  if (!after || problem) return { ok: false, reason: `Detaching would move nodes: ${problem ?? "the picture couldn't be laid out"}.` };
  return { ok: true, changes: w.changes, text: w.text, kept, ids: w.ids };
}

/** The status-bar sentence for nodes kept where they were: "Kept in place: c (below=19mm of a), d (pinned with coordinates)." */
export function keptMessage(kept: readonly Kept[], lead = "Kept in place"): string {
  if (!kept.length) return "";
  const shown = kept.slice(0, 4).map((k) => `${k.name} (${k.how})`);
  const more = kept.length > 4 ? `, and ${kept.length - 4} more` : "";
  return ` ${lead}: ${shown.join(", ")}${more}.`;
}
