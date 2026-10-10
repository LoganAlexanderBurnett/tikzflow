// Making chain nodes draggable (M4 step 2, D77 item 4): the nodes a chain
// places get their position written out ("below=of p0"), so they can be moved
// like any other node. The whole chain is converted when one of its nodes is
// dragged. "on chain" and "join" stay: a position written after "on chain"
// wins over the chain's (spike/engines/probes/p8-chains-explicit.tex), so the
// nodes stay on the chain, keep their chain-n names and their joins, and
// \chainin still works. Nothing moves: every written position must land
// exactly where the chain put the node.
import { analyzeDocument, layoutDocumentPicture } from "../model/document.ts";
import type { LaidOutNode, PictureLayout } from "../tikz/layout.ts";
import { positioningDirection } from "../tikz/layout.ts";
import type { Point } from "../tikz/shapes.ts";
import { evalLength, trimNumber } from "../tikz/units.ts";
import { applyChanges, type Change, composeChanges } from "./changes.ts";
import { formatDistance, type MoveResult, planMove } from "./move.ts";
import { nameForUnnamed, nameNodeChange, nameStyle, takenNames } from "./names.ts";
import { addOptionList, appendItem } from "./optionEdits.ts";
import { definedStyleNames, nodeStyles, styleSites } from "./styles.ts";

/** A written position must reproduce the chain's to within this, in pt. */
const EXACT = 0.01;

export type ChainConversion =
  | {
      ok: true;
      changes: Change[];
      text: string;
      /** The nodes whose position was written out, by id after the edit. */
      converted: string[];
      /** Nodes that were given a name so the next one could refer to them. */
      named: Array<{ name: string }>;
      /** Ids that changed because a node was named: old id → new id. */
      ids: Map<string, string>;
    }
  | { ok: false; reason: string };

/** The nodes the chain of `node` places, in code order (empty if the chain doesn't place `node`). */
export function chainPlaced(layout: PictureLayout, node: LaidOutNode): LaidOutNode[] {
  const serial = node.chain?.serial;
  if (serial === undefined) return [];
  return layout.nodes.filter((n) => n.chain?.serial === serial && n.chain.placed);
}

/** "8mm", or exact points when the length isn't a whole number of millimetres. */
function exactLength(pt: number): string {
  const nice = formatDistance(pt);
  const back = evalLength(nice);
  return back !== null && Math.abs(back - pt) <= EXACT ? nice : `${trimNumber(Math.round(pt * 1000) / 1000)}pt`;
}

/** Ways to write "placed by the chain next to `prev`", best first. */
function placements(n: LaidOutNode, prev: string): string[] {
  const c = n.chain!;
  const diagonal = c.dir.includes(" ");
  const [, uy] = positioningDirection(c.dir);
  const dist = diagonal ? `${exactLength(c.distance.v)} and ${exactLength(c.distance.h)}` : exactLength(uy !== 0 ? c.distance.v : c.distance.h);
  const plain = `${c.dir}=of ${prev}`;
  const sized = `${c.dir}=${dist} of ${prev}`;
  const grid = c.onGrid ? "on grid" : "on grid=false";
  return [plain, sized, `${grid}, ${plain}`, `${grid}, ${sized}`];
}

/**
 * Writes out the position of every node the chain of `nodeId` places, so the
 * chain's nodes can be dragged. Unnamed nodes another one is placed next to
 * get a name from their label first (as Tab does, D44). Returns the edit, or
 * why the chain can't be converted. A node the chain doesn't place needs no
 * conversion: the result is then an empty edit.
 */
export function planChainConversion(text: string, picIndex: number, nodeId: string): ChainConversion {
  const doc = analyzeDocument(text);
  const pic = doc.syntax.pictures[picIndex];
  const layout = layoutDocumentPicture(doc, picIndex);
  const node = layout?.nodes.find((n) => n.id === nodeId);
  if (!pic || !layout || !node) return { ok: false, reason: "There is no such node." };
  const members = chainPlaced(layout, node);
  if (!node.chain?.placed || !members.length) return { ok: true, changes: [], text, converted: [], named: [], ids: new Map() };
  const start = new Map(layout.nodes.map((n) => [n.id, n.shape.center]));

  for (const m of members) {
    if (!m.chain || positioningDirection(m.chain.dir).every((v) => v === 0)) return { ok: false, reason: `The chain places its nodes "${m.chain?.dir}", which the editor can't write out.` };
    if (m.kind === "path") return { ok: false, reason: "A node of this chain is part of a path, so the chain can't be written out." };
  }

  // 1. Names for the nodes others are placed next to, if they have none written.
  const sites = styleSites(doc, pic);
  const defined = definedStyleNames(sites);
  const taken = takenNames(doc, pic, layout);
  const style = nameStyle(layout.nodes.flatMap((n) => (n.name && !n.implicitName ? [n.name] : [])));
  const naming: Change[] = [];
  const named: Array<{ name: string; was: string }> = [];
  const prevName = new Map<string, string>();
  for (const m of members) {
    const prev = layout.nodes.find((n) => n.id === m.chain!.prev);
    if (!prev) return { ok: false, reason: "The node a chain node follows couldn't be found." };
    const done = named.find((x) => x.was === prev.id);
    if (prev.name && !prev.implicitName) prevName.set(m.id, prev.name);
    else if (done) prevName.set(m.id, done.name);
    else {
      if (prev.kind === "path") return { ok: false, reason: "A node of this chain follows a node on a path, so the chain can't be written out." };
      const name = nameForUnnamed(prev, nodeStyles(prev.syntax, defined), taken, style);
      taken.add(name);
      naming.push(nameNodeChange(text, prev.syntax, name));
      named.push({ name, was: prev.id });
      prevName.set(m.id, name);
    }
  }
  let current = applyChanges(text, naming);
  let changes: Change[] = naming;

  // Ids after naming: a named node's id is its name.
  const after = layoutDocumentPicture(analyzeDocument(current), picIndex);
  if (!after || after.nodes.length !== layout.nodes.length) return { ok: false, reason: "Naming the chain's nodes would change the picture, so nothing was written." };
  const ids = new Map<string, string>();
  layout.nodes.forEach((n, i) => {
    const id = after.nodes[i]!.id;
    if (id !== n.id) ids.set(n.id, id);
  });
  const idOf = (id: string) => ids.get(id) ?? id;
  const moved = after.nodes.find((n, i) => Math.hypot(n.shape.center.x - layout.nodes[i]!.shape.center.x, n.shape.center.y - layout.nodes[i]!.shape.center.y) > EXACT);
  if (moved) return { ok: false, reason: `Naming the chain's nodes would move ${moved.name ?? "a node"}, so nothing was written.` };

  // 2. Each node's position, in code order, checked to land exactly where the chain put it.
  const converted: string[] = [];
  for (const m of members) {
    const id = idOf(m.id);
    const want = start.get(m.id)!;
    const l = layoutDocumentPicture(analyzeDocument(current), picIndex)!;
    const n = l.nodes.find((x) => x.id === id);
    if (!n) return { ok: false, reason: "A chain node couldn't be found after naming." };
    const syn = n.syntax;
    const list = syn.options[syn.options.length - 1];
    let found: { change: Change; text: string } | null = null;
    for (const p of placements(m, prevName.get(m.id)!)) {
      const change = list ? appendItem(current, list, p) : addOptionList(syn, p);
      const next = applyChanges(current, [change]);
      const got = layoutDocumentPicture(analyzeDocument(next), picIndex)?.nodes.find((x) => x.id === id);
      if (!got || got.chain?.placed || got.locked) continue;
      if (Math.hypot(got.shape.center.x - want.x, got.shape.center.y - want.y) > EXACT) continue;
      found = { change, text: next };
      break;
    }
    if (!found) return { ok: false, reason: `The chain's position for ${m.name && !m.implicitName ? m.name : "one of its nodes"} couldn't be written out exactly, so nothing was written.` };
    changes = composeChanges(text, changes, [found.change]);
    current = found.text;
    converted.push(id);
  }

  // 3. Nothing moved.
  const final = layoutDocumentPicture(analyzeDocument(current), picIndex);
  if (!final) return { ok: false, reason: "The picture couldn't be laid out after writing the chain out." };
  for (const [i, n] of final.nodes.entries()) {
    const was = layout.nodes[i]!.shape.center;
    if (Math.hypot(n.shape.center.x - was.x, n.shape.center.y - was.y) > EXACT) return { ok: false, reason: `Writing the chain out would move ${n.name ?? "a node"}, so nothing was written.` };
  }
  if (applyChanges(text, changes) !== current) return { ok: false, reason: "The chain couldn't be written out as one edit." };
  return { ok: true, changes, text: current, converted, named: named.map(({ name }) => ({ name })), ids };
}

export type ChainMove =
  | {
      ok: true;
      changes: Change[];
      text: string;
      conversion: ChainConversion & { ok: true };
      move: MoveResult;
      /** The dragged node's id after the edit. */
      id: string;
    }
  | { ok: false; reason: string };

/**
 * Dragging a node its chain places: the chain is written out (D77 item 4) and
 * the node moved, as one edit. Nothing is written if either part fails.
 */
export function planChainMove(text: string, picIndex: number, nodeId: string, center: Point): ChainMove {
  const conversion = planChainConversion(text, picIndex, nodeId);
  if (!conversion.ok) return conversion;
  const id = conversion.ids.get(nodeId) ?? nodeId;
  const move = planMove(conversion.text, picIndex, id, center);
  if (!move) return { ok: false, reason: "The chain could be written out, but not the new position, so nothing changed." };
  return { ok: true, changes: composeChanges(text, conversion.changes, move.changes), text: move.text, conversion, move, id };
}

/** "Wrote out the chain's positions (5 nodes; named checkInput)." */
export function conversionMessage(c: ChainConversion & { ok: true }): string {
  const n = c.converted.length;
  const named = c.named.length ? `; named ${c.named.map((x) => x.name).join(", ")} so the next node can refer to it` : "";
  return `Wrote out the chain's positions (${n} node${n === 1 ? "" : "s"}${named}); the nodes stay on the chain.`;
}
