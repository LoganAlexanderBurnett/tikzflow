// Creating nodes (D41): the palette's shapes, and the code that adds a styled,
// named node (and the edge to it) in the place a person would write it.
//
// A new node is written as `\node[style, below=of parent] (name) {label};` after
// the picture's last node, with `\draw[->] (parent) -- (name);` after its last
// path. The style comes from the document if it defines one by that name;
// otherwise it is added where the document keeps its styles, together with the
// libraries its shape needs.
import { analyzeDocument, type DocumentModel, layoutDocumentPicture } from "../model/document.ts";
import type { PictureSyntax } from "../model/syntax.ts";
import type { LaidOutNode, LaidOutPath, PictureLayout } from "../tikz/layout.ts";
import type { Point } from "../tikz/shapes.ts";
import { applyChanges, type Change, composeChanges } from "./changes.ts";
import { insertStatements, nodeAnchor, pathAnchor, type Anchor } from "./insert.ts";
import { ensureLibraries, libraryLoaded, shapeLibraries } from "./libraries.ts";
import { formatDistance, type MoveResult, planMove, positioningText, previousRelation } from "./move.ts";
import { nameStyle, newNodeName, takenNames } from "./names.ts";
import { labelProblem } from "./label.ts";
import { styleUsers } from "./properties.ts";
import { snapNode } from "./snap.ts";
import { addStyles, definedStyleNames, styleSites } from "./styles.ts";

/** One shape in the palette: a style to use and, if the document lacks it, the style to add. */
export interface PaletteEntry {
  id: string;
  /** The name on the button. */
  label: string;
  /** The style the node is written with, e.g. "process". */
  style: string;
  /** The shape the style gives, for the button's icon. */
  shape: string;
  /** The label a new node starts with, selected for typing over. */
  placeholder: string;
  /** What the style is defined as when the document doesn't define it. Left out for the document's own styles. */
  body?: string;
  /** "standard" entries are the built-in flowchart shapes; "document" ones are the picture's own styles. */
  source: "standard" | "document";
}

const BOX = "minimum width=28mm, minimum height=9mm, align=center";

/** The flowchart shapes (D34): process, decision, terminal, I/O, connector and document. */
export const STANDARD_ENTRIES: readonly PaletteEntry[] = [
  { id: "process", label: "Process", style: "process", shape: "rectangle", placeholder: "Process", body: `draw, rectangle, ${BOX}`, source: "standard" },
  { id: "decision", label: "Decision", style: "decision", shape: "diamond", placeholder: "Decision?", body: "draw, diamond, aspect=2, inner sep=1pt, align=center", source: "standard" },
  { id: "terminal", label: "Terminal", style: "terminal", shape: "rounded rectangle", placeholder: "Start", body: `draw, rounded rectangle, ${BOX}`, source: "standard" },
  {
    id: "io",
    label: "I/O",
    style: "io",
    shape: "trapezium",
    placeholder: "Input",
    body: `draw, trapezium, trapezium left angle=70, trapezium right angle=110, ${BOX}`,
    source: "standard",
  },
  { id: "connector", label: "Connector", style: "connector", shape: "circle", placeholder: "A", body: "draw, circle, minimum size=7mm, inner sep=0pt", source: "standard" },
  { id: "document", label: "Document", style: "document", shape: "tape", placeholder: "Document", body: "draw, tape, minimum width=28mm, minimum height=10mm, align=center", source: "standard" },
];

/** Keys that mark a style as one for nodes, for styles no node uses yet. */
const NODE_STYLE_KEYS = /\b(minimum\s+(width|height|size)|text\s+width|inner\s+(x|y)?sep|outer\s+(x|y)?sep|rectangle|circle|diamond|ellipse|trapezium|cylinder|tape|rounded\s+rectangle)\b/;

/** A label from a style name: "kin" → "Kin". */
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The palette for a picture: the six standard shapes, using the document's own
 * style where it defines one of that name, then the document's other node
 * styles so that extending a figure keeps its look.
 */
export function paletteEntries(doc: DocumentModel, pic: PictureSyntax, layout: PictureLayout): PaletteEntry[] {
  const sites = styleSites(doc, pic);
  const defined = definedStyleNames(sites);
  const standard = new Set(STANDARD_ENTRIES.map((e) => e.style));
  const out: PaletteEntry[] = STANDARD_ENTRIES.map((e) => {
    if (!defined.has(e.style)) return { ...e };
    const { body: _body, ...own } = e;
    return own;
  });
  for (const name of defined) {
    if (standard.has(name)) continue;
    const users = styleUsers(sites, layout, name);
    const defs = sites.flatMap((s) => s.defs).filter((d) => d.name === name);
    // A style that takes an argument isn't one a node can be created with.
    if (defs.some((d) => /#\d/.test(d.bodyText))) continue;
    // A node style is one a node uses itself. A style only other styles build on
    // (like `base`) stays out, and so does one no node uses unless it looks like one.
    const usedByNode = layout.nodes.some((n) => n.kind === "statement" && n.syntax.options.some((l) => l.items.some((i) => i.key === name)));
    const buildingBlock = sites.some((s) => s.defs.some((d) => d.name !== name && new RegExp(`(^|[\\s,{\\[=])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*([,}\\]]|$)`).test(d.bodyText)));
    if (!usedByNode && (buildingBlock || !defs.some((d) => NODE_STYLE_KEYS.test(d.bodyText)))) continue;
    out.push({ id: name, label: name, style: name, shape: users[0]?.shape.kind ?? "rectangle", placeholder: titleCase(name), source: "document" });
  }
  return out;
}

/** The entry a new node starts as when nothing has been chosen: the document's own `process`, else its most used style, else the standard process. */
export function defaultEntry(entries: readonly PaletteEntry[], doc: DocumentModel, pic: PictureSyntax, layout: PictureLayout): PaletteEntry {
  const sites = styleSites(doc, pic);
  const own = entries.filter((e) => e.source === "document");
  const process = entries.find((e) => e.id === "process")!;
  if (!own.length || !process.body) return process;
  const best = own.map((e) => ({ e, n: styleUsers(sites, layout, e.style).length })).sort((a, b) => b.n - a.n)[0]!;
  return best.n > 0 ? best.e : process;
}

// ---------------------------------------------------------------- placing

export type Direction = "below" | "above" | "right" | "left";

export type Placement =
  /** Next to a node and connected to it (Tab). */
  | { kind: "child"; of: string }
  /** Beside a node, connected to the node that leads to it (Enter). */
  | { kind: "sibling"; of: string }
  /** Where the node is dropped, snapped like a drag. `threshold` is in pt. */
  | { kind: "at"; center: Point; threshold: number };

export interface CreateRequest {
  entry: PaletteEntry;
  label: string;
  placement: Placement;
}

export type CreateOutcome =
  | {
      ok: true;
      changes: Change[];
      text: string;
      layout: PictureLayout;
      /** The new node, as it is laid out. */
      id: string;
      name: string;
      /** What was written, for the status bar. */
      written: string;
      /** Libraries and styles added, and things to do by hand. */
      notes: string[];
    }
  | { ok: false; reason: string };

const OPPOSITE: Record<Direction, Direction> = { below: "above", above: "below", right: "left", left: "right" };
const SIMPLE_NAME = /^[A-Za-z0-9_\-:]+$/;

/** A name the editor can refer to in written code, or null. */
function usableName(n: LaidOutNode): string | null {
  return n.kind === "statement" && n.name && !n.implicitName && SIMPLE_NAME.test(n.name) ? n.name : null;
}

/** The direction a node's flow runs in: how the edge into it goes, else how it is placed, else down. */
export function flowDirection(layout: PictureLayout, node: LaidOutNode): Direction {
  const incoming = layout.paths.flatMap((p) => p.edges.filter(([, to]) => to === node.id).map(([from]) => from));
  for (const id of incoming) {
    const from = layout.nodes.find((n) => n.id === id);
    if (!from || from.id === node.id) continue;
    const dx = node.shape.center.x - from.shape.center.x;
    const dy = node.shape.center.y - from.shape.center.y;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    return Math.abs(dy) >= Math.abs(dx) ? (dy < 0 ? "below" : "above") : dx > 0 ? "right" : "left";
  }
  const rel = previousRelation(layout, node);
  const first = rel?.dir.split(" ")[0];
  return first === "below" || first === "above" || first === "right" || first === "left" ? first : "below";
}

/** Whether two laid-out nodes' outlines get in each other's way (a small overlap is fine). */
function overlaps(a: LaidOutNode, b: LaidOutNode): boolean {
  const dx = Math.abs(a.shape.center.x - b.shape.center.x);
  const dy = Math.abs(a.shape.center.y - b.shape.center.y);
  return dx < a.shape.hw + b.shape.hw - 0.5 && dy < a.shape.hh + b.shape.hh - 0.5;
}

/** The first node of `layout` (other than `node`) that `node` overlaps. */
function collision(layout: PictureLayout, node: LaidOutNode): LaidOutNode | undefined {
  return layout.nodes.find((n) => n.id !== node.id && n.kind === "statement" && overlaps(node, n));
}

/**
 * The `\draw` form the picture already uses most for a plain connection, e.g.
 * `\draw[->]` or `\draw[-Stealth]`; `\draw[->]` if there is none (D34).
 */
export function edgeHead(doc: DocumentModel, layout: PictureLayout): string {
  const counts = new Map<string, number>();
  for (const p of layout.paths) {
    const head = connectionHead(doc.text, p);
    if (head) counts.set(head, (counts.get(head) ?? 0) + 1);
  }
  let best = "\\draw[->]";
  let bestCount = 0;
  for (const [head, n] of counts) {
    if (n > bestCount) {
      best = head;
      bestCount = n;
    }
  }
  return best;
}

/** The text of a path's command and options if it is a plain `(a) -- (b)` connection, else null. */
function connectionHead(text: string, p: LaidOutPath): string | null {
  if (p.syntax.command !== "\\draw") return null;
  const parts = p.syntax.items.filter((i) => i.kind !== "node");
  const options = parts.filter((i) => i.kind === "options");
  const rest = parts.filter((i) => i.kind !== "options");
  if (rest.length !== 3 || rest[0]!.kind !== "coord" || rest[1]!.kind !== "op" || rest[1]!.op !== "--" || rest[2]!.kind !== "coord") return null;
  if (options.length > 1) return null;
  const list = options[0]?.kind === "options" ? options[0].list : undefined;
  const end = list ? list.to : p.syntax.keyword.to;
  // Options must come right after the command, as in `\draw[->]` or `\draw [->]`.
  if (list && list.from < p.syntax.keyword.to) return null;
  return text.slice(p.syntax.keyword.from, end).replace(/\s+/g, " ");
}

/** The `\draw` head of the edge that leads into `node` from another node, for a sibling to copy. */
function incomingEdge(doc: DocumentModel, layout: PictureLayout, node: LaidOutNode): { from: LaidOutNode; head: string } | null {
  for (const p of layout.paths) {
    const hit = p.edges.find(([, to]) => to === node.id);
    if (!hit) continue;
    const from = layout.nodes.find((n) => n.id === hit[0]);
    const head = connectionHead(doc.text, p);
    if (from && head && usableName(from) && from.id !== node.id) return { from, head };
  }
  return null;
}

// ---------------------------------------------------------------- planning

interface Prepared {
  doc: DocumentModel;
  pic: PictureSyntax;
  layout: PictureLayout;
  name: string;
  /** The changes that give the picture the style and libraries the node needs. */
  setup: Change[];
  notes: string[];
}

/** Style and libraries for `entry`, and a name for the node. */
function prepare(text: string, picIndex: number, req: CreateRequest, relative: boolean): Prepared | { reason: string } {
  const doc = analyzeDocument(text);
  const pic = doc.syntax.pictures[picIndex];
  const layout = layoutDocumentPicture(doc, picIndex);
  if (!pic || !layout) return { reason: "There is no picture to add to." };
  const problem = labelProblem(req.label);
  if (problem) return { reason: problem };
  const sites = styleSites(doc, pic);
  const defined = definedStyleNames(sites);
  const notes: string[] = [];
  const setup: Change[] = [];
  const needed: string[] = [];
  if (relative) needed.push("positioning");
  const { entry } = req;
  if (!defined.has(entry.style) && entry.body) {
    setup.push(addStyles(doc, pic, [{ name: entry.style, body: entry.body }]));
    notes.push(`added the ${entry.style} style`);
    needed.push(...shapeLibraries(entry.shape));
  }
  const lib = ensureLibraries(doc, pic, needed);
  if (!lib.ok) notes.push(lib.reason);
  else if (lib.change) {
    // The library line goes before a new style, which may be inserted at the same spot.
    setup.unshift(lib.change);
    notes.push(`loaded the ${needed.filter((l) => !libraryLoaded(doc, pic, l)).join(", ")} library`);
  }
  const taken = takenNames(doc, pic, layout);
  const name = newNodeName(req.label, taken, entry.style, nameStyle(layout.nodes.flatMap((n) => (n.name ? [n.name] : []))));
  return { doc, pic, layout, name, setup, notes };
}

/** The statement for the new node. */
function nodeStatement(entry: PaletteEntry, relation: string | null, at: string | null, name: string, label: string): string {
  const options = [entry.style, relation].filter(Boolean).join(", ");
  return `\\node[${options}] (${name})${at ? ` at ${at}` : ""} {${label}};`;
}

/** The text change that puts `nodeText` (and `edgeText`) into the picture, or why not. */
function insertion(p: Prepared, text: string, parent: LaidOutNode | null, nodeText: string, edgeText: string | null): Change[] | { reason: string } {
  const statements = [nodeText];
  // A parent whose name is used again later can't be referred to from the end of the picture.
  const reused = parent && p.layout.nodes.some((n) => n !== parent && n.name === parent.name && p.layout.nodes.indexOf(n) > p.layout.nodes.indexOf(parent));
  if (reused && parent) {
    const anchor: Anchor = { pos: parent.statement.to, indentFrom: parent.statement.from };
    if (edgeText) statements.push(edgeText);
    return [insertStatements(text, p.pic, anchor, statements)];
  }
  const anchor = nodeAnchor(p.doc, p.pic);
  if (!anchor) return { reason: "The code right after the last node has a syntax error, so a new node can't be added safely. Fix that first." };
  if (!edgeText) return [insertStatements(text, p.pic, anchor, statements)];
  const edgeAnchor = pathAnchor(p.doc, p.pic, anchor);
  if (edgeAnchor.pos === anchor.pos) return [insertStatements(text, p.pic, anchor, [nodeText, edgeText])];
  return [insertStatements(text, p.pic, anchor, statements), insertStatements(text, p.pic, edgeAnchor, [edgeText])];
}

/** Lays out `changes` applied to `text` and finds the node named `name`. */
function check(text: string, picIndex: number, changes: readonly Change[], name: string): { text: string; layout: PictureLayout; node: LaidOutNode } | null {
  const next = applyChanges(text, changes);
  const layout = layoutDocumentPicture(analyzeDocument(next), picIndex);
  const node = layout?.nodes.filter((n) => n.name === name).at(-1);
  return layout && node ? { text: next, layout, node } : null;
}

const mm = (pt: number) => formatDistance(pt);

/**
 * Plans adding a node of `req.entry` labelled `req.label` to picture
 * `picIndex`. A child or sibling is placed beside its node, trying the flow's
 * direction first and moving on when the spot is taken; a node dropped at a
 * point is snapped and written as relationally as the move planner can.
 */
export function planCreate(text: string, picIndex: number, req: CreateRequest): CreateOutcome {
  const { placement } = req;
  const at = placement.kind === "at";
  const prepared = prepare(text, picIndex, req, !at);
  if ("reason" in prepared) return { ok: false, reason: prepared.reason };
  const { doc, layout, name, setup, notes } = prepared;
  const empty = !layout.nodes.some((n) => n.kind === "statement");

  // Absolute placement: write the node at the origin, then move it with the planner.
  if (at || empty) {
    const ins = insertion(prepared, text, null, nodeStatement(req.entry, null, "(0,0)", name, req.label), null);
    if (!Array.isArray(ins)) return { ok: false, reason: ins.reason };
    const first = [...setup, ...ins];
    const made = check(text, picIndex, first, name);
    if (!made) return { ok: false, reason: "The new node couldn't be written." };
    if (!at) return finish(text, picIndex, first, name, "at the origin", notes);
    const snapped = snapNode(made.layout, made.node, placement.center, placement.threshold).center;
    const move = planMove(made.text, picIndex, made.node.id, snapped);
    if (!move) return { ok: false, reason: "That position couldn't be written." };
    return finish(text, picIndex, composeChanges(text, first, move.changes), name, describePlacement(move), [...notes, ...move.notes]);
  }

  // Beside a node.
  const parent = layout.nodes.find((n) => n.id === placement.of);
  if (!parent || parent.kind !== "statement") return { ok: false, reason: "Select a node to add to." };
  const parentName = usableName(parent);
  if (!parentName) return { ok: false, reason: "This node has no name the code can refer to; give it one, such as (start), first." };
  if (parent.lock) return { ok: false, reason: `This node is locked (${parent.locked}), so a node placed relative to it wouldn't land where it looks. Fix that first.` };

  const flow = flowDirection(layout, parent);
  const sibling = placement.kind === "sibling";
  const incoming = sibling ? incomingEdge(doc, layout, parent) : null;
  const from = sibling ? incoming?.from : parent;
  const fromName = from && usableName(from);
  const head = sibling ? incoming?.head : edgeHead(doc, layout);
  const edge = fromName && head ? `${head} (${fromName}) -- (${name});` : null;
  const perpendicular: Direction = flow === "below" || flow === "above" ? "right" : "below";
  const order: Direction[] = sibling ? [perpendicular, OPPOSITE[perpendicular], flow, OPPOSITE[flow]] : [flow, perpendicular, OPPOSITE[perpendicular], OPPOSITE[flow]];

  // The edge refers to its start by name, so that name must mean this node where the edge is written.
  const tryRelation = (relation: string): { changes: Change[]; node: LaidOutNode; layout: PictureLayout } | { reason: string } => {
    const ins = insertion(prepared, text, parent, nodeStatement(req.entry, relation, null, name, req.label), edge);
    if (!Array.isArray(ins)) return ins;
    const changes = [...setup, ...ins];
    const made = check(text, picIndex, changes, name);
    if (!made) return { reason: "The new node couldn't be written." };
    return { changes, node: made.node, layout: made.layout };
  };

  let last: { changes: Change[]; relation: string } | null = null;
  const consider = (relation: string): boolean | { reason: string } => {
    const r = tryRelation(relation);
    if ("reason" in r) return r;
    last ??= { changes: r.changes, relation };
    if (r.node.lock || collision(r.layout, r.node)) return false;
    last = { changes: r.changes, relation };
    return true;
  };

  let chosen: string | null = null;
  for (const dir of order) {
    const relation = `${dir}=of ${parentName}`;
    const r = consider(relation);
    if (typeof r === "object") return { ok: false, reason: r.reason };
    if (r) {
      chosen = relation;
      break;
    }
  }
  // Every side is taken: line up beyond the node in the way, then shift along the flow's cross axis.
  if (!chosen) {
    const dir = sibling ? perpendicular : flow;
    const cross = dir === "below" || dir === "above" ? "xshift" : "yshift";
    const probe = tryRelation(`${dir}=of ${parentName}`);
    const step = "reason" in probe ? 0 : probe.node.shape.hw * 2 + 14;
    for (let k = 1; k <= 8 && !chosen; k++) {
      const sign = k % 2 ? 1 : -1;
      const relation = `${dir}=of ${parentName}, ${cross}=${mm(sign * Math.ceil(k / 2) * (cross === "xshift" ? step : (step / 2)))}`;
      const r = consider(relation);
      if (typeof r === "object") return { ok: false, reason: r.reason };
      if (r) chosen = relation;
    }
  }
  if (!chosen) return { ok: false, reason: "There is no free place next to this node; move something out of the way first." };
  return finish(text, picIndex, last!.changes, name, `${chosen}${edge ? `, with an edge from ${fromName}` : ""}`, notes);
}

/** How the move planner placed a dropped node, in a few words. */
function describePlacement(move: MoveResult): string {
  const s = move.spec;
  if (s.kind === "positioning") return positioningText(s);
  if (s.kind === "perp") return `at (${s.xFrom} |- ${s.yFrom})`;
  return "at the drop position";
}

/** Checks the final text and describes what was written. */
function finish(text: string, picIndex: number, changes: Change[], name: string, written: string, notes: string[]): CreateOutcome {
  const made = check(text, picIndex, changes, name);
  if (!made) return { ok: false, reason: "The new node couldn't be written." };
  if (made.node.lock) return { ok: false, reason: `The new node would be locked (${made.node.locked}).` };
  return { ok: true, changes, text: made.text, layout: made.layout, id: made.node.id, name, written, notes };
}
