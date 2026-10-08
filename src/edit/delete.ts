// Deleting nodes, edges and paths (M2b step 9, D56). Deleting never leaves a
// reference LaTeX would reject: nodes placed relative to a deleted node are
// re-attached to what they could be placed against instead (or pinned at
// their current position), corners that were written relative to it are
// rewritten, and edges that would be left dangling are deleted too. The
// result is drawn again: every other node must stay where it was and every
// other edge must still be there.
import { analyzeDocument, layoutDocumentPicture } from "../model/document.ts";
import { type Edge, edgeTitle, pathEdges, pictureEdges } from "../model/edges.ts";
import { coordNames, parenGroups, pictureReferences, unresolvedReferences } from "../model/references.ts";
import type { Range } from "../model/syntax.ts";
import type { PictureLayout } from "../tikz/layout.ts";
import { PT_PER_UNIT } from "../tikz/units.ts";
import { applyChanges, type Change, composeChanges } from "./changes.ts";
import { edgeOpBlocker, planEdgeToLine } from "./edgeop.ts";
import { findEdge, planWaypoint } from "./edges.ts";
import { type MoveResult, planMove, planPin, positioningText } from "./move.ts";
import { planSplit } from "./split.ts";
import { lineEnd, lineStart } from "./text.ts";
import { isEdgeOperation } from "./vertices.ts";

export type DeleteTarget = { kind: "nodes"; ids: readonly string[] } | { kind: "edge"; id: string } | { kind: "path"; id: string };
export type DeleteOutcome = { ok: true; changes: Change[]; text: string; layout: PictureLayout; notes: string[]; message: string } | { ok: false; reason: string };

/** Nodes may move this far (re-attached placements are written to whole millimetres), in pt. */
const KEEP = 1.5 * PT_PER_UNIT.mm!;
const isHSpace = (ch: string | undefined) => ch === " " || ch === "\t";

/** The change that removes a statement: its whole line, with a comment after it, when it is alone there. */
export function statementRemoval(text: string, from: number, to: number): Change {
  const ls = lineStart(text, from);
  const le = lineEnd(text, to);
  if (/^[ \t]*$/.test(text.slice(ls, from)) && /^[ \t]*(%.*)?$/.test(text.slice(to, le))) {
    const eol = text[le] === "\r" ? 2 : text[le] === "\n" ? 1 : 0;
    return { from: ls, to: le + eol, insert: "" };
  }
  // Something else shares the line: take the spaces after the statement, or before it at the end of the line.
  let end = to;
  while (isHSpace(text[end])) end++;
  if (end >= text.length || text[end] === "\n" || text[end] === "\r") {
    let start = from;
    while (isHSpace(text[start - 1])) start--;
    return { from: start, to, insert: "" };
  }
  return { from, to: end, insert: "" };
}

/** A sequence of edits to one text, kept as one set of changes against the original. */
class Work {
  readonly base: string;
  text: string;
  changes: Change[] = [];
  notes: string[] = [];
  constructor(base: string) {
    this.base = base;
    this.text = base;
  }
  apply(step: readonly Change[]): void {
    if (!step.length) return;
    this.changes = composeChanges(this.base, this.changes, step);
    this.text = applyChanges(this.text, step);
  }
}

const layoutOf = (text: string, picIndex: number) => layoutDocumentPicture(analyzeDocument(text), picIndex);
const wordIn = (name: string, text: string) => new RegExp(`(?<![A-Za-z0-9_\\-])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_\\-])`).test(text);

/** How a re-attached node is placed now, in a few words. */
function describePlacement(move: MoveResult): string {
  const s = move.spec;
  if (s.kind === "positioning") return positioningText(s);
  if (s.kind === "perp") return `at (${s.xFrom} |- ${s.yFrom})`;
  return "at its current position";
}

// ---------------------------------------------------------------- edges

/**
 * Deletes one edge: its statement when it is alone in it. An `edge` operation
 * is made a `--` of its own first, and a `\draw` with several edges is split,
 * so only that edge goes (D49, D53). Returns why not, or null.
 */
function deleteEdge(w: Work, picIndex: number, edgeId: string): string | null {
  let id = edgeId;
  for (let step = 0; step < 4; step++) {
    const layout = layoutOf(w.text, picIndex);
    const edge = layout && findEdge(layout, id);
    if (!layout || !edge) return "There is no such edge.";
    if (edge.lock) return `${edgeTitle(edge, layout)} is kept as written: ${edge.lock.message}.`;
    if (isEdgeOperation(edge)) {
      const c = planEdgeToLine(w.text, picIndex, id);
      if (!c.ok) return c.reason;
      w.apply(c.changes);
      id = c.edgeId;
      continue;
    }
    const siblings = pathEdges(edge.path, layout);
    if (siblings.length > 1) {
      const index = siblings.findIndex((e) => e.id === id);
      const s = planSplit(w.text, picIndex, id);
      if (!s.ok) return s.reason;
      w.apply(s.changes);
      id = s.edgeIds[index] ?? id;
      continue;
    }
    const syn = edge.path.syntax;
    w.apply([statementRemoval(w.text, syn.from, syn.to)]);
    return null;
  }
  return "The edge couldn't be taken out of its statement.";
}

/** The key of an edge for comparing before and after: the indices of its end nodes. */
function edgeKey(l: PictureLayout, e: Edge, gone: ReadonlySet<number> = new Set()): string {
  // The index the node has once the deleted ones are out of the list.
  const idx = (id: string | undefined) => {
    if (id === undefined) return "-";
    const i = l.nodes.findIndex((n) => n.id === id);
    return String(i - [...gone].filter((g) => g < i).length);
  };
  return `${idx(e.source)}>${idx(e.target)}`;
}

// ---------------------------------------------------------------- planning

/**
 * Plans deleting the selected nodes, edge or path. See the file comment for
 * what happens to what depends on them.
 */
export function planDelete(text: string, picIndex: number, target: DeleteTarget): DeleteOutcome {
  const doc = analyzeDocument(text);
  const pic = doc.syntax.pictures[picIndex];
  const layout = layoutDocumentPicture(doc, picIndex);
  if (!pic || !layout) return { ok: false, reason: "There is no picture." };
  const w = new Work(text);
  const refused = (reason: string): DeleteOutcome => ({ ok: false, reason });

  // The edges that must still be there afterwards, by their end nodes' positions in the picture.
  const before = pictureEdges(layout);
  const keep = new Map<string, number>();
  const count = (m: Map<string, number>, k: string, by = 1) => m.set(k, (m.get(k) ?? 0) + by);
  let message: string;
  /** Which of the original nodes go (by index), for matching the rest afterwards. */
  const gone = new Set<number>();
  /** The nodes whose `fit=` list lost a member. They change size, so they may move (by index). */
  const fitted = new Set<number>();

  if (target.kind === "edge") {
    const edge = findEdge(layout, target.id);
    if (!edge) return refused("There is no such edge.");
    const title = edgeTitle(edge, layout);
    const why = deleteEdge(w, picIndex, target.id);
    if (why) return refused(why);
    for (const e of before) if (e.id !== edge.id) count(keep, edgeKey(layout, e));
    message = `Deleted the edge ${title}`;
  } else if (target.kind === "path") {
    const path = layout.paths.find((p) => p.id === target.id);
    const item = path && pic.items.find((it) => it.kind === "path" && it.path.from === path.syntax.from);
    if (!path || !item || item.kind !== "path") return refused("Only a statement of its own can be deleted here.");
    w.apply([statementRemoval(w.text, item.path.from, item.path.to)]);
    for (const e of before) if (e.path.id !== path.id) count(keep, edgeKey(layout, e));
    message = "Deleted the path";
  } else {
    const nodes = target.ids.map((id) => layout.nodes.find((n) => n.id === id)).filter((n): n is NonNullable<typeof n> => !!n);
    if (!nodes.length) return refused("There is nothing to delete.");
    for (const n of nodes) {
      if (n.kind === "path" || n.statement.from !== n.syntax.from) return refused(`${n.name ?? "This node"} is written inside a path, so it can only be deleted with the path.`);
      gone.add(layout.nodes.indexOf(n));
    }
    const names = new Set(nodes.flatMap((n) => (n.name ? [n.name] : [])));
    const label = nodes.length === 1 ? (nodes[0]!.name ?? "the node") : `${nodes.length} nodes`;
    // Code the editor keeps as-is may use the name; it can't be rewritten.
    const opaque = layout.opaque.map((o) => text.slice(o.range.from, o.range.to)).join("\n");
    for (const name of names) {
      if (wordIn(name, opaque)) return refused(`${name} is used inside code the editor keeps as written (a loop, a matrix, …), so it can't be deleted here. Delete it in the code.`);
    }
    // 1. Nodes placed relative to a deleted one are re-attached or pinned where they are.
    for (let guard = 0; guard < 400; guard++) {
      const now = analyzeDocument(w.text);
      const picNow = now.syntax.pictures[picIndex]!;
      const l = layoutDocumentPicture(now, picIndex)!;
      const goneNow = new Set([...gone].map((i) => l.nodes[i]!.id));
      let owner: (typeof l.nodes)[number] | undefined;
      let fitDone = false;
      for (const r of pictureReferences(w.text, picNow)) {
        if (r.in !== "node" || !names.has(r.name)) continue;
        const m = l.nodes.find((n) => n.kind !== "path" && n.syntax.from === r.statement.from);
        if (!m || goneNow.has(m.id)) continue;
        if (/^fit\b/.test(w.text.slice(r.range.from, r.range.to))) {
          // A deleted member leaves the `fit=` list, and the fitted node shrinks (D58 item 4, D61).
          const out = planFitRemoval(w.text, r.range, names);
          const who = m.name ?? "another node";
          if (!out.ok) return refused(`${out.removed.join(", ")} ${out.removed.length === 1 ? "is the last node" : "are the last nodes"} that ${who} fits around, so ${out.removed.length === 1 ? "it" : "they"} can't be taken out of its fit. Delete ${who} as well, or change its fit in the code first.`);
          w.apply(out.changes);
          fitted.add(l.nodes.indexOf(m));
          w.notes.push(`${out.removed.join(", ")} left the fit of ${who}, which now fits the nodes that remain`);
          fitDone = true;
          break;
        }
        owner = m;
        break;
      }
      if (fitDone) continue;
      if (!owner) break;
      const move = planMove(w.text, picIndex, owner.id, owner.shape.center, names);
      const label2 = owner.name ?? "A node";
      if (move) {
        w.apply(move.changes);
        w.notes.push(`${label2} is now placed ${describePlacement(move)}`);
      } else {
        const pin = planPin(w.text, picIndex, owner.id);
        if (!pin) return refused(`${label2} is placed relative to ${[...names].join(", ")}, and it couldn't be placed against anything else without moving. Move it or change its position in the code first.`);
        w.apply(pin.changes);
        w.notes.push(`${label2} is pinned at its current position`);
      }
      if (guard === 399) return refused("The nodes that depend on this one couldn't all be re-attached.");
    }
    // 2. Corners of edges that stay, written relative to a deleted node, are written another way.
    for (let guard = 0; guard < 200; guard++) {
      const l = layoutOf(w.text, picIndex)!;
      const goneNow = new Set([...gone].map((i) => l.nodes[i]!.id));
      let hit: { edge: Edge; stop: number } | undefined;
      for (const e of pictureEdges(l)) {
        if ((e.source && goneNow.has(e.source)) || (e.target && goneNow.has(e.target))) continue;
        for (const k of e.segs.slice(1).map((s) => e.route.segs[s]!.a)) {
          const stop = e.route.stops[k]!;
          if (!stop.node && coordNames(stop.text).some((c) => names.has(c.name))) hit ??= { edge: e, stop: k };
        }
      }
      if (!hit) break;
      const r = planWaypoint(w.text, picIndex, hit.edge.id, hit.stop, hit.edge.route.stops[hit.stop]!.point, names);
      if (!r.ok) return refused(`A corner of ${edgeTitle(hit.edge, l)} is written relative to a node being deleted, and couldn't be rewritten: ${r.reason}`);
      w.apply(r.changes);
      w.notes.push(`rewrote a corner of ${edgeTitle(hit.edge, l)} so it no longer refers to the deleted node`);
    }
    // 3. Edges that would be left dangling go too.
    let removed = 0;
    for (let guard = 0; guard < 200; guard++) {
      const l = layoutOf(w.text, picIndex)!;
      const goneNow = new Set([...gone].map((i) => l.nodes[i]!.id));
      const dangling = pictureEdges(l).find((e) => {
        const touches = (e.source && goneNow.has(e.source)) || (e.target && goneNow.has(e.target));
        if (!touches) return false;
        // A path that starts in a deleted node's own statement goes with it.
        const start = e.route.stops[0]!;
        return !(start.item < 0 && e.source && goneNow.has(e.source));
      });
      if (!dangling) break;
      const why = deleteEdge(w, picIndex, dangling.id);
      if (why) return refused(why);
      removed++;
    }
    // 4. The nodes themselves.
    const l = layoutOf(w.text, picIndex)!;
    const doomed = [...gone].map((i) => l.nodes[i]!).sort((a, b) => b.statement.from - a.statement.from);
    w.apply(doomed.map((n) => statementRemoval(w.text, n.statement.from, n.statement.to)));
    for (const e of before) {
      const touches = (e.source && gone.has(layout.nodes.findIndex((n) => n.id === e.source))) || (e.target && gone.has(layout.nodes.findIndex((n) => n.id === e.target)));
      if (!touches) count(keep, edgeKey(layout, e, gone));
    }
    message = `Deleted ${label}${removed ? ` and ${removed} ${removed === 1 ? "edge" : "edges"} that led to ${nodes.length === 1 ? "it" : "them"}` : ""}`;
  }

  // Draw the result: nothing else may have moved or gone.
  const next = w.text;
  const doc2 = analyzeDocument(next);
  const layout2 = layoutDocumentPicture(doc2, picIndex);
  const pic2 = doc2.syntax.pictures[picIndex];
  if (!layout2 || !pic2) return refused("The picture couldn't be read after the deletion, so nothing was changed.");
  if (doc2.errors.length > doc.errors.length) return refused("That would break the code around it, so nothing was deleted.");
  const survivors = layout.nodes.flatMap((n, i) => (gone.has(i) ? [] : [n]));
  if (layout2.nodes.length !== survivors.length) return refused("That would change which nodes the picture has, so nothing was deleted.");
  const survivorIndex = layout.nodes.flatMap((n, i) => (gone.has(i) ? [] : [i]));
  for (let i = 0; i < survivors.length; i++) {
    if (fitted.has(survivorIndex[i]!)) continue;
    const a = survivors[i]!.shape.center;
    const b = layout2.nodes[i]!.shape.center;
    if (Math.hypot(a.x - b.x, a.y - b.y) > KEEP) return refused(`That would move ${survivors[i]!.name ?? "another node"}, so nothing was deleted.`);
  }
  const was = new Set(unresolvedReferences(text, pic, layout).map((u) => `${u.name}:${u.kind}`));
  const now = unresolvedReferences(next, pic2, layout2).find((u) => !was.has(`${u.name}:${u.kind}`));
  if (now) return refused(`${now.name} is still used in the code (${next.slice(now.refs[0]!.range.from, now.refs[0]!.range.to).replace(/\s+/g, " ").slice(0, 40)}), so nothing was deleted. Change that first.`);
  const after = new Map<string, number>();
  for (const e of pictureEdges(layout2)) count(after, edgeKey(layout2, e));
  const same = keep.size === after.size && [...keep].every(([k, n]) => after.get(k) === n);
  if (!same) return refused("That would change the other edges of the picture, so nothing was deleted.");
  return { ok: true, changes: w.changes, text: next, layout: layout2, notes: w.notes, message };
}

/**
 * Takes the groups that name a deleted node out of a `fit=(a) (b) (c)` option
 * item, with the space that separates them. Fails, naming the nodes, when no
 * member would be left.
 */
function planFitRemoval(text: string, item: Range, names: ReadonlySet<string>): { ok: true; changes: Change[]; removed: string[] } | { ok: false; removed: string[] } {
  const raw = text.slice(item.from, item.to);
  const eq = raw.indexOf("=") + 1;
  const groups = parenGroups(raw.slice(eq)).map((g) => ({
    from: item.from + eq + g.at - 1,
    to: item.from + eq + g.at + g.text.length + 1,
    hit: coordNames(g.text).filter((c) => names.has(c.name)).map((c) => c.name),
  }));
  const removed = [...new Set(groups.flatMap((g) => g.hit))];
  let lastKept = -1;
  groups.forEach((g, i) => {
    if (!g.hit.length) lastKept = i;
  });
  if (lastKept < 0) return { ok: false, removed };
  const changes: Change[] = [];
  // A removed group goes with the space up to the next one; the ones at the end go with the space before them.
  groups.forEach((g, i) => {
    if (g.hit.length && i < lastKept) changes.push({ from: g.from, to: groups[i + 1]!.from, insert: "" });
  });
  if (lastKept < groups.length - 1) changes.push({ from: groups[lastKept]!.to, to: groups[groups.length - 1]!.to, insert: "" });
  return { ok: true, changes, removed };
}

/** Why an edge or statement can't be deleted at all, or null. */
export function deleteBlocker(edge: Edge): string | null {
  if (edge.lock) return `This edge is kept as written: ${edge.lock.message}.`;
  if (isEdgeOperation(edge)) return edgeOpBlocker(edge);
  return null;
}
