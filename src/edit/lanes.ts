// Groups and swimlanes (M4 step 4, D81). A group is a `fit` node on the
// background layer, drawn around the nodes it lists. A lane is a group that
// also fits two coordinates its whole set shares ("lanes top" and "lanes
// bottom" when the lanes stand side by side as columns, "lanes left" and
// "lanes right" when they lie as rows), so every lane of the set is as tall,
// or as wide, as the others: the owner's form B. Membership is the `fit=`
// list either way, which deleting a node (D61) and dragging a group (D78)
// already understand. The shared coordinates sit at the top and bottom of the
// highest and lowest member (`at (order.north)`); after every visual edit
// `laneUpkeep` moves them to whichever member is at the extremes now.
import { analyzeDocument, type DocumentModel, layoutDocumentPicture } from "../model/document.ts";
import { pictureEdges } from "../model/edges.ts";
import { coordNames, parenGroups } from "../model/references.ts";
import type { NodeSyntax, OptionItem, PictureSyntax, Range } from "../model/syntax.ts";
import type { LaidOutNode, PictureLayout } from "../tikz/layout.ts";
import { anchorPoint, shapeBounds } from "../tikz/shapes.ts";
import { applyChanges, type Change, composeChanges } from "./changes.ts";
import { insertStatements, itemRange } from "./insert.ts";
import { labelProblem } from "./label.ts";
import { withLibraries } from "./libraries.ts";
import { nameForUnnamed, nameNodeChange, nameStyle, newNodeName, takenNames } from "./names.ts";
import { appendItem, formatOption, removeItems } from "./optionEdits.ts";
import { addStyles, definedStyleNames, nodeStyles, styleSites } from "./styles.ts";
import { indentUnit } from "./text.ts";

export type Orientation = "columns" | "rows";

/** What a group in a `fit=` list is: a node, a node's anchor, a lane's line-up with a shared coordinate, or something else. */
export type FitGroupKind = "node" | "anchor" | "perp" | "other";

export interface FitGroup {
  /** The group with its parentheses. */
  range: Range;
  text: string;
  kind: FitGroupKind;
  /** The node, for "node" and "anchor". */
  name?: string;
  /** For "perp": `(member |- coordinate)` in columns, `(member -| coordinate)` in rows. */
  perp?: { member: string; coord: string; op: "|-" | "-|" };
}

/** A label written on a fit node, used as its title. */
export interface Title {
  item: OptionItem;
  /** Where it sits: "north", "west", or "" for the default. */
  dir: string;
  text: string;
  /** The title's text, without the options and the direction. */
  textRange: Range;
}

/** A fit node and what it is drawn around. */
export interface FitBox {
  node: LaidOutNode;
  item: OptionItem;
  groups: FitGroup[];
  /** Ids of the nodes it lists by plain name, in list order. */
  members: string[];
  title?: Title;
}

/** Lanes that share their two coordinates, in order across (left to right, or top to bottom). */
export interface LaneSet {
  orientation: Orientation;
  /** The shared coordinates: top and bottom for columns, left and right for rows. */
  ends: [LaidOutNode, LaidOutNode];
  lanes: FitBox[];
}

export type LaneOutcome = { ok: true; changes: Change[]; text: string; layout: PictureLayout; message: string; notes: string[]; id?: string } | { ok: false; reason: string };

// ---------------------------------------------------------------- reading

/** The `fit=` item of a node (the last one: it is the one in effect). */
export function fitItem(syn: NodeSyntax): OptionItem | undefined {
  let found: OptionItem | undefined;
  for (const list of syn.options) for (const item of list.items) if (item.key === "fit" && item.valueRange) found = item;
  return found;
}

/** What one group of a `fit=` list is (the text between its parentheses). */
export function classifyFitGroup(inner: string): Pick<FitGroup, "kind" | "name" | "perp"> {
  const t = inner.trim();
  const m = /^([^|$()[\]]+?)\s*(\|-|-\|)\s*([^|$()[\]]+)$/.exec(t);
  if (m) {
    const a = coordNames(m[1]!)[0];
    const b = coordNames(m[3]!)[0];
    if (a && b && a.full === a.name && b.full === b.name) return { kind: "perp", perp: { member: a.name, coord: b.name, op: m[2] as "|-" | "-|" } };
    return { kind: "other" };
  }
  if (/[$|]/.test(t)) return { kind: "other" };
  const names = coordNames(t);
  if (names.length !== 1) return { kind: "other" };
  return { kind: names[0]!.full === names[0]!.name ? "node" : "anchor", name: names[0]!.name };
}

/** The groups of a `fit=` item, with their positions in `text`. */
export function fitGroups(text: string, item: OptionItem): FitGroup[] {
  const vr = item.valueRange!;
  return parenGroups(text.slice(vr.from, vr.to)).map((g) => ({
    range: { from: vr.from + g.at - 1, to: vr.from + g.at + g.text.length + 1 },
    text: g.text,
    ...classifyFitGroup(g.text),
  }));
}

/**
 * The names a fit node is drawn around, for dragging it (D78): its nodes and
 * anchors, and the names in other coordinates, but not the lanes' line-ups
 * with their shared coordinates, which only make the box as tall as the others.
 */
export function fitMemberNames(syn: NodeSyntax): string[] {
  let value: string | undefined;
  for (const list of syn.options) for (const item of list.items) if (item.key === "fit" && item.value !== undefined) value = item.value;
  if (value === undefined) return [];
  const out: string[] = [];
  for (const g of parenGroups(value)) {
    const c = classifyFitGroup(g.text);
    if (c.kind === "perp") continue;
    if (c.name) out.push(c.name);
    else out.push(...coordNames(g.text).map((x) => x.name));
  }
  return [...new Set(out)];
}

/** The node a name refers to from `before`: the latest definition earlier in the code. */
function resolve(layout: PictureLayout, name: string, before: LaidOutNode): LaidOutNode | undefined {
  const index = layout.nodes.indexOf(before);
  return layout.nodes.slice(0, index < 0 ? undefined : index).reverse().find((n) => n.name === name);
}

/** Index of the matching closing bracket for the opening one at `open`, or -1. */
function closing(text: string, open: number, to: number): number {
  let depth = 0;
  for (let i = open; i < to; i++) {
    const ch = text[i];
    if (ch === "\\") i++;
    else if (ch === "{" || ch === "[") depth++;
    else if ((ch === "}" || ch === "]") && --depth === 0) return i;
  }
  return -1;
}

/** The last `label=` of a node, read as a title: "[options]direction:text". */
export function titleOf(text: string, syn: NodeSyntax): Title | undefined {
  let found: Title | undefined;
  for (const list of syn.options) {
    for (const item of list.items) {
      if (item.key !== "label" || !item.valueRange) continue;
      let from = item.valueRange.from;
      let to = item.valueRange.to;
      if (text[from] === "{" && closing(text, from, to) === to - 1) {
        from++;
        to--;
      }
      while (/\s/.test(text[from] ?? "")) from++;
      if (text[from] === "[") {
        const close = closing(text, from, to);
        if (close < 0) continue;
        from = close + 1;
      }
      // The direction ends at the first colon outside braces and before any math.
      let colon = -1;
      let depth = 0;
      for (let i = from; i < to && colon < 0; i++) {
        const ch = text[i];
        if (ch === "\\") i++;
        else if (ch === "$") break;
        else if (ch === "{") depth++;
        else if (ch === "}") depth--;
        else if (ch === ":" && depth === 0) colon = i;
      }
      const dir = colon >= 0 ? text.slice(from, colon).trim() : "";
      let start = colon >= 0 ? colon + 1 : from;
      while (/\s/.test(text[start] ?? "") && start < to) start++;
      let end = to;
      while (end > start && /\s/.test(text[end - 1]!)) end--;
      found = { item, dir, text: text.slice(start, end), textRange: { from: start, to: end } };
    }
  }
  return found;
}

/** Every fit node of the picture that the editor can read. */
export function fitBoxes(text: string, layout: PictureLayout): FitBox[] {
  const out: FitBox[] = [];
  for (const n of layout.nodes) {
    if (n.kind !== "statement" || n.position.kind !== "fit") continue;
    const item = fitItem(n.syntax);
    if (!item) continue;
    const groups = fitGroups(text, item);
    const members = [...new Set(groups.filter((g) => g.kind === "node").flatMap((g) => resolve(layout, g.name!, n)?.id ?? []))];
    const box: FitBox = { node: n, item, groups, members };
    const title = titleOf(text, n.syntax);
    if (title) box.title = title;
    out.push(box);
  }
  return out;
}

/** The lane sets of a picture: fit nodes that line up with the same two coordinates. */
export function laneSets(text: string, layout: PictureLayout, boxes: readonly FitBox[] = fitBoxes(text, layout)): LaneSet[] {
  const byKey = new Map<string, { op: "|-" | "-|"; ends: LaidOutNode[]; lanes: FitBox[] }>();
  for (const b of boxes) {
    const perps = b.groups.filter((g) => g.kind === "perp");
    const coords = [...new Set(perps.map((g) => g.perp!.coord))];
    const ops = [...new Set(perps.map((g) => g.perp!.op))];
    if (coords.length !== 2 || ops.length !== 1 || !b.members.length) continue;
    const ends = coords.map((c) => resolve(layout, c, b.node));
    if (ends.some((e) => !e || e.shape.kind !== "coordinate")) continue;
    const key = `${ops[0]}|${ends.map((e) => e!.id).sort().join("|")}`;
    const set = byKey.get(key) ?? { op: ops[0]!, ends: ends as LaidOutNode[], lanes: [] };
    set.lanes.push(b);
    byKey.set(key, set);
  }
  return [...byKey.values()].map((s) => {
    const orientation: Orientation = s.op === "|-" ? "columns" : "rows";
    const [a, b] = s.ends as [LaidOutNode, LaidOutNode];
    const ends: [LaidOutNode, LaidOutNode] =
      orientation === "columns" ? (a.shape.center.y >= b.shape.center.y ? [a, b] : [b, a]) : a.shape.center.x <= b.shape.center.x ? [a, b] : [b, a];
    const across = (f: FitBox) => (orientation === "columns" ? f.node.shape.center.x : -f.node.shape.center.y);
    return { orientation, ends, lanes: [...s.lanes].sort((p, q) => across(p) - across(q)) };
  });
}

/** The lane a node is in, with its set, or undefined. */
export function laneOf(sets: readonly LaneSet[], nodeId: string): { set: LaneSet; lane: FitBox } | undefined {
  for (const set of sets) for (const lane of set.lanes) if (lane.members.includes(nodeId)) return { set, lane };
  return undefined;
}

/** Which way new lanes go: columns when the picture runs down, rows when it runs across (the owner's rule, D81). */
export function laneOrientation(layout: PictureLayout): Orientation {
  let down = 0;
  let across = 0;
  const center = new Map(layout.nodes.map((n) => [n.id, n.shape.center]));
  for (const e of pictureEdges(layout)) {
    const a = e.source && center.get(e.source);
    const b = e.target && center.get(e.target);
    if (!a || !b) continue;
    if (Math.abs(a.x - b.x) > Math.abs(a.y - b.y)) across++;
    else down++;
  }
  return across > down ? "rows" : "columns";
}

// ---------------------------------------------------------------- writing

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

interface Picture {
  doc: DocumentModel;
  pic: PictureSyntax;
  layout: PictureLayout;
}

function read(text: string, picIndex: number): Picture | null {
  const doc = analyzeDocument(text);
  const pic = doc.syntax.pictures[picIndex];
  const layout = layoutDocumentPicture(doc, picIndex);
  return pic && layout ? { doc, pic, layout } : null;
}

export const LANE_STYLES = [
  { name: "lane", body: "draw=gray!60, fill=gray!8, rounded corners=2pt, inner sep=3mm" },
  { name: "lane title", body: "font=\\bfseries\\small" },
];
export const GROUP_STYLES = [
  { name: "group", body: "draw=gray!70, dashed, rounded corners=3pt, inner sep=3mm" },
  { name: "group title", body: "font=\\small" },
];

/** Adds the styles of `wanted` the document doesn't define yet. */
function ensureStyles(w: Work, picIndex: number, wanted: ReadonlyArray<{ name: string; body: string }>): void {
  const p = read(w.text, picIndex)!;
  const defined = definedStyleNames(styleSites(p.doc, p.pic));
  const missing = wanted.filter((s) => !defined.has(s.name));
  if (!missing.length) return;
  w.apply([addStyles(p.doc, p.pic, missing)]);
  w.notes.push(`added the ${missing.map((s) => s.name).join(" and ")} ${missing.length === 1 ? "style" : "styles"}`);
}

/**
 * Names the nodes that have no name written (or only a chain's), so a fit list
 * can name them (as for chains, D79). Returns the names, in the order of `ids`.
 */
function nameMembers(w: Work, picIndex: number, ids: readonly string[]): string[] | { reason: string } {
  const p = read(w.text, picIndex)!;
  const nodes = ids.map((id) => p.layout.nodes.find((n) => n.id === id));
  const taken = takenNames(p.doc, p.pic, p.layout);
  const style = nameStyle(p.layout.nodes.flatMap((n) => (n.name && !n.implicitName ? [n.name] : [])));
  const defined = definedStyleNames(styleSites(p.doc, p.pic));
  const changes: Change[] = [];
  const names: string[] = [];
  for (const n of nodes) {
    if (!n) return { reason: "A selected node isn't in the picture any more." };
    if (n.name && !n.implicitName) {
      if (/[\\#]/.test(n.name)) return { reason: `${n.name}'s name contains a macro, so a group can't list it.` };
      names.push(n.name);
      continue;
    }
    if (n.statement.from !== n.syntax.from) return { reason: "A node written inside a path can't be put in a group." };
    const name = nameForUnnamed(n, nodeStyles(n.syntax, defined), taken, style);
    taken.add(name);
    changes.push(nameNodeChange(w.text, n.syntax, name));
    names.push(name);
    w.notes.push(`named a node ${name} so the group can list it`);
  }
  w.apply(changes);
  return names;
}

/** The node named `name` in the picture as it is now (the last definition). */
function byName(p: Picture, name: string): LaidOutNode | undefined {
  return [...p.layout.nodes].reverse().find((n) => n.name === name);
}

/** The scopes of a picture, as begin and end markers. */
function scopes(pic: PictureSyntax): Array<{ begin: Range; end: Range }> {
  const out: Array<{ begin: Range; end: Range }> = [];
  const stack: Range[] = [];
  for (const item of pic.items) {
    if (item.kind === "scope-begin") stack.push(item.range);
    else if (item.kind === "scope-end") {
      const begin = stack.pop();
      if (begin) out.push({ begin, end: item.range });
    }
  }
  return out;
}

/** A scope on the background layer that holds `pos`, innermost first. */
function backgroundScopeAt(text: string, pic: PictureSyntax, pos: number): { begin: Range; end: Range } | undefined {
  return scopes(pic)
    .filter((s) => s.begin.to <= pos && pos <= s.end.from && /on background layer/.test(text.slice(s.begin.from, s.begin.to)))
    .sort((a, b) => b.begin.from - a.begin.from)[0];
}

/** The end of the picture's body: after its last item. */
function bodyEnd(pic: PictureSyntax): { pos: number; indentFrom: number | null } {
  const last = pic.items[pic.items.length - 1];
  if (!last) return { pos: pic.options?.to ?? pic.begin.to, indentFrom: null };
  const r = itemRange(last);
  return { pos: r.to, indentFrom: r.from };
}

/** Lines for a new scope on the background layer holding `inner`, each indented one more level. */
function backgroundBlock(text: string, inner: readonly string[]): string[] {
  const unit = indentUnit(text);
  return ["\\begin{scope}[on background layer]", ...inner.map((s) => unit + s), "\\end{scope}"];
}

/** Puts statements after the last statement of an existing background block, or in a new block at the end of the picture. */
function insertFurniture(w: Work, picIndex: number, after: Range | null, statements: readonly string[], memberNames: readonly string[]): string | null {
  const p = read(w.text, picIndex)!;
  let change: Change;
  let at: number;
  if (after) {
    at = after.to;
    change = insertStatements(w.text, p.pic, { pos: after.to, indentFrom: after.from }, statements);
  } else {
    const end = bodyEnd(p.pic);
    at = end.pos;
    change = insertStatements(w.text, p.pic, end, backgroundBlock(w.text, statements));
  }
  // TikZ needs every node a fit list names to be defined before it.
  for (const name of memberNames) {
    const n = byName(p, name);
    if (n && n.statement.from >= at) return `${name} comes after the groups in the code, so they can't list it. Move its line above them first.`;
  }
  w.apply([change]);
  return null;
}

/** Where a new group goes: after the last fit node of a background block that ends the picture, if there is one. */
function furnitureEnd(p: Picture): Range | null {
  const lastFit = [...p.layout.nodes].reverse().find((n) => n.kind === "statement" && n.position.kind === "fit");
  if (!lastFit) return null;
  const scope = backgroundScopeAt(p.doc.text, p.pic, lastFit.statement.from);
  if (!scope) return null;
  // Nothing but the ends of enclosing scopes may follow it.
  const later = p.pic.items.filter((it) => itemRange(it).from >= scope.end.to && it.kind !== "scope-end");
  return later.length ? null : lastFit.statement;
}

/** Checks a planned text: no new syntax errors, and nothing but fit nodes and the lanes' coordinates moved. */
function verify(before: string, w: Work, picIndex: number, message: string, id?: string): LaneOutcome {
  const was = read(before, picIndex)!;
  const now = read(w.text, picIndex);
  if (!now) return { ok: false, reason: "The picture couldn't be read afterwards, so nothing was changed." };
  if (now.doc.errors.length > was.doc.errors.length) return { ok: false, reason: "That would break the code around it, so nothing was changed." };
  for (const n of was.layout.nodes) {
    if (n.position.kind === "fit" || n.shape.kind === "coordinate" || !n.name) continue;
    const m = byName(now, n.name);
    if (m && Math.hypot(m.shape.center.x - n.shape.center.x, m.shape.center.y - n.shape.center.y) > 0.05) {
      return { ok: false, reason: `That would move ${n.name}, so nothing was changed.` };
    }
  }
  const out: LaneOutcome = { ok: true, changes: w.changes, text: w.text, layout: now.layout, message, notes: w.notes };
  if (id) out.id = id;
  return out;
}

/** Takes nodes out of a fit list: their groups go, and a lane's line-ups that used them use another member. */
function removalChanges(text: string, box: FitBox, names: ReadonlySet<string>): Change[] | null {
  const keep = box.groups.filter((g) => g.kind === "node" && !names.has(g.name!));
  if (!keep.length) return null;
  const substitute = keep[0]!.name!;
  const changes: Change[] = [];
  const gone = box.groups.map((g) => (g.kind === "node" || g.kind === "anchor" ? names.has(g.name!) : false));
  box.groups.forEach((g, i) => {
    if (g.kind === "perp" && names.has(g.perp!.member)) {
      changes.push({ from: g.range.from + 1, to: g.range.to - 1, insert: `${substitute} ${g.perp!.op} ${g.perp!.coord}` });
    }
    if (!gone[i]) return;
    // A group goes with the space after it, or the space before it at the end of the list.
    const next = box.groups.slice(i + 1).find((_, k) => !gone[i + 1 + k]);
    if (next) changes.push({ from: g.range.from, to: box.groups[i + 1]!.range.from, insert: "" });
    else {
      const prev = [...box.groups.slice(0, i)].reverse().find((_, k) => !gone[i - 1 - k]);
      changes.push({ from: prev ? prev.range.to : g.range.from, to: g.range.to, insert: "" });
    }
  });
  // Merge touching removals.
  const sorted = changes.sort((a, b) => a.from - b.from || a.to - b.to);
  const out: Change[] = [];
  for (const c of sorted) {
    const prev = out[out.length - 1];
    if (prev && c.from < prev.to) {
      if (c.insert || prev.insert) return null;
      prev.to = Math.max(prev.to, c.to);
    } else out.push({ ...c });
  }
  return out;
}

/** The change that adds `names` to a fit list, after its last node group. */
function additionChange(text: string, box: FitBox, names: readonly string[]): Change {
  const lastNode = [...box.groups].reverse().find((g) => g.kind === "node" || g.kind === "anchor") ?? box.groups[box.groups.length - 1];
  const add = names.map((n) => `(${n})`).join(" ");
  if (!lastNode) return { from: box.item.valueRange!.from, to: box.item.valueRange!.to, insert: add };
  return { from: lastNode.range.to, to: lastNode.range.to, insert: ` ${add}` };
}

/** Takes `names` out of the other lanes of `set`. Returns why not, or null. */
function leaveLanes(w: Work, picIndex: number, names: readonly string[], except: string | null): string | null {
  const p = read(w.text, picIndex)!;
  const sets = laneSets(w.text, p.layout);
  const ids = new Set(names.map((n) => byName(p, n)?.id).filter((x): x is string => !!x));
  const changes: Change[] = [];
  for (const set of sets) {
    for (const lane of set.lanes) {
      if (lane.node.id === except) continue;
      const hit = lane.members.filter((id) => ids.has(id));
      if (!hit.length) continue;
      const hitNames = new Set(hit.map((id) => p.layout.nodes.find((n) => n.id === id)!.name!));
      const c = removalChanges(w.text, lane, hitNames);
      if (!c) return `${[...hitNames].join(", ")} ${hitNames.size === 1 ? "is" : "are"} all that ${boxName(lane)} holds, and a lane can't be empty. Delete the lane instead, or add another node to it first.`;
      changes.push(...c);
      w.notes.push(`${[...hitNames].join(", ")} left ${boxName(lane)}`);
    }
  }
  w.apply(changes);
  return null;
}

/** What a fit node is called in messages: its title, else its name. */
export function boxName(box: FitBox): string {
  const t = box.title?.text.replace(/\\\\/g, " ").replace(/[{}]/g, "").trim();
  return t ? `"${t}"` : (box.node.name ?? "the group");
}

/** Statement nodes that can go in a group (not fit nodes or coordinates). */
function groupable(layout: PictureLayout, ids: readonly string[]): LaidOutNode[] {
  return ids.flatMap((id) => layout.nodes.find((n) => n.id === id && n.kind === "statement" && n.position.kind !== "fit" && n.shape.kind !== "coordinate") ?? []);
}

function fitText(members: readonly string[], extra: readonly string[] = []): string {
  return [...members.map((m) => `(${m})`), ...extra].join(" ");
}

function titleItem(styleName: string, dir: string, title: string, styled: boolean): string {
  return `label={${styled ? `[${styleName}]` : ""}${dir}:${title}}`;
}

/**
 * "Group": a box around the selected nodes, on the background layer, with an
 * optional title above it.
 */
export function planGroup(text: string, picIndex: number, ids: readonly string[], title: string): LaneOutcome {
  const p0 = read(text, picIndex);
  if (!p0) return { ok: false, reason: "There is no picture." };
  const t = title.trim();
  const problem = t ? labelProblem(t) : null;
  if (problem) return { ok: false, reason: problem };
  const nodes = groupable(p0.layout, ids);
  if (!nodes.length) return { ok: false, reason: "Select the nodes to group first (Shift-click adds more)." };
  const w = new Work(text);
  const names = nameMembers(w, picIndex, nodes.map((n) => n.id));
  if (!Array.isArray(names)) return { ok: false, reason: names.reason };
  ensureStyles(w, picIndex, GROUP_STYLES);
  const p = read(w.text, picIndex)!;
  const taken = takenNames(p.doc, p.pic, p.layout);
  const name = newNodeName(t || "group", taken, "group", nameStyle(p.layout.nodes.flatMap((n) => (n.name ? [n.name] : []))));
  const options = ["group", `fit=${fitText(names)}`, ...(t ? [titleItem("group title", "north", t, true)] : [])];
  const why = insertFurniture(w, picIndex, furnitureEnd(p), [`\\node[${options.join(", ")}] (${name}) {};`], names);
  if (why) return { ok: false, reason: why };
  const lib = withLibraries(text, picIndex, w.changes, ["fit", "backgrounds"]);
  const done = new Work(text);
  done.apply(lib.changes);
  done.notes.push(...w.notes, ...lib.added.map((l) => `loaded the ${l} library`), ...lib.notes);
  return verify(text, done, picIndex, `Grouped ${names.length === 1 ? names[0] : `${names.length} nodes`} in ${name}`, name);
}

/**
 * "New lane": a lane holding the selected nodes. The first lane of a picture
 * starts a set: columns when the picture runs down, rows when it runs across
 * (D81); later lanes join it. Nodes in another lane of the set move to the new one.
 */
export function planLane(text: string, picIndex: number, ids: readonly string[], title: string): LaneOutcome {
  const p0 = read(text, picIndex);
  if (!p0) return { ok: false, reason: "There is no picture." };
  const t = title.trim();
  const problem = t ? labelProblem(t) : null;
  if (problem) return { ok: false, reason: problem };
  const nodes = groupable(p0.layout, ids);
  if (!nodes.length) return { ok: false, reason: "Select the nodes the lane holds first (Shift-click adds more)." };
  const w = new Work(text);
  const names = nameMembers(w, picIndex, nodes.map((n) => n.id));
  if (!Array.isArray(names)) return { ok: false, reason: names.reason };
  const left = leaveLanes(w, picIndex, names, null);
  if (left) return { ok: false, reason: left };
  ensureStyles(w, picIndex, LANE_STYLES);
  const p = read(w.text, picIndex)!;
  const set = laneSets(w.text, p.layout)[0];
  const style = nameStyle(p.layout.nodes.flatMap((n) => (n.name ? [n.name] : [])));
  const taken = takenNames(p.doc, p.pic, p.layout);
  const name = newNodeName(t || `lane ${(set?.lanes.length ?? 0) + 1}`, taken, "lane", style);
  taken.add(name);
  const orientation = set?.orientation ?? laneOrientation(p.layout);
  const op = orientation === "columns" ? "|-" : "-|";
  let ends: [string, string];
  const statements: string[] = [];
  if (set) ends = [set.ends[0].name!, set.ends[1].name!];
  else {
    const words: [string, string] = orientation === "columns" ? ["lanes top", "lanes bottom"] : ["lanes left", "lanes right"];
    ends = words.map((wd) => {
      let n = wd;
      for (let i = 2; taken.has(n); i++) n = `${wd} ${i}`;
      taken.add(n);
      return n;
    }) as [string, string];
    // The coordinates start at this lane's own extremes; the upkeep widens them to every lane's.
    const members = names.map((n) => byName(p, n)!);
    const ext = extremes(members, orientation);
    statements.push(`\\coordinate (${ends[0]}) at (${ext[0].node.name}.${ext[0].anchor});`, `\\coordinate (${ends[1]}) at (${ext[1].node.name}.${ext[1].anchor});`);
  }
  const first = names[0]!;
  const options = ["lane", `fit=${fitText(names, [`(${first} ${op} ${ends[0]})`, `(${first} ${op} ${ends[1]})`])}`, ...(t ? [titleItem("lane title", orientation === "columns" ? "north" : "west", t, true)] : [])];
  statements.push(`\\node[${options.join(", ")}] (${name}) {};`);
  const after = set ? set.lanes.reduce((a, l) => (l.node.statement.to > a.to ? l.node.statement : a), set.lanes[0]!.node.statement) : null;
  // A new set goes into a background block of groups at the end, if there is one.
  const why = insertFurniture(w, picIndex, after ?? furnitureEnd(p), statements, names);
  if (why) return { ok: false, reason: why };
  w.apply(laneUpkeep(w.text, picIndex));
  const lib = withLibraries(text, picIndex, w.changes, ["fit", "backgrounds"]);
  const done = new Work(text);
  done.apply(lib.changes);
  done.notes.push(...w.notes, ...lib.added.map((l) => `loaded the ${l} library`), ...lib.notes);
  const where = set ? `next to the other ${set.lanes.length === 1 ? "lane" : `${set.lanes.length} lanes`}` : `as the first of a set of ${orientation === "columns" ? "lanes side by side (the picture runs down)" : "lanes one above the other (the picture runs across)"}`;
  return verify(text, done, picIndex, `Made a lane, ${name}, ${where}`, name);
}

/** "Add to group" or "Move to lane": the nodes join fit node `boxId`; for a lane they leave the set's other lanes. */
export function planJoin(text: string, picIndex: number, ids: readonly string[], boxId: string): LaneOutcome {
  const p0 = read(text, picIndex);
  if (!p0) return { ok: false, reason: "There is no picture." };
  const box0 = fitBoxes(text, p0.layout).find((b) => b.node.id === boxId);
  if (!box0) return { ok: false, reason: "That group can't be edited here: its fit list isn't written in a form the editor reads." };
  const nodes = groupable(p0.layout, ids).filter((n) => !box0.members.includes(n.id));
  if (!nodes.length) return { ok: false, reason: `Everything selected is already in ${boxName(box0)}.` };
  const isLane = laneSets(text, p0.layout).some((s) => s.lanes.some((l) => l.node.id === boxId));
  const boxRef = box0.node.name;
  if (!boxRef || box0.node.implicitName) return { ok: false, reason: "That group has no name, so it can't be found again after the edit." };
  const w = new Work(text);
  const names = nameMembers(w, picIndex, nodes.map((n) => n.id));
  if (!Array.isArray(names)) return { ok: false, reason: names.reason };
  if (isLane) {
    const why = leaveLanes(w, picIndex, names, boxId);
    if (why) return { ok: false, reason: why };
  }
  const p = read(w.text, picIndex)!;
  const box = fitBoxes(w.text, p.layout).find((b) => b.node.id === byName(p, boxRef)?.id);
  if (!box) return { ok: false, reason: "The group couldn't be found after the edit, so nothing was changed." };
  for (const n of names) {
    const m = byName(p, n);
    if (m && m.statement.from >= box.node.statement.from) return { ok: false, reason: `${n} comes after ${boxName(box)} in the code, so it can't be listed there. Move its line above the group first.` };
  }
  w.apply([additionChange(w.text, box, names)]);
  if (isLane) w.apply(laneUpkeep(w.text, picIndex));
  return verify(text, w, picIndex, `${isLane ? "Moved" : "Added"} ${names.length === 1 ? names[0] : `${names.length} nodes`} to ${boxName(box)}`);
}

/** "Take out of group": the nodes leave every group and lane that lists them. */
export function planLeave(text: string, picIndex: number, ids: readonly string[]): LaneOutcome {
  const p = read(text, picIndex);
  if (!p) return { ok: false, reason: "There is no picture." };
  const boxes = fitBoxes(text, p.layout);
  const set = new Set(ids);
  const w = new Work(text);
  const changes: Change[] = [];
  const left: string[] = [];
  for (const box of boxes) {
    const hit = box.members.filter((id) => set.has(id));
    if (!hit.length) continue;
    const names = new Set(hit.map((id) => p.layout.nodes.find((n) => n.id === id)!.name!));
    const c = removalChanges(text, box, names);
    if (!c) return { ok: false, reason: `${[...names].join(", ")} ${names.size === 1 ? "is" : "are"} all that ${boxName(box)} holds, and it can't be empty. Delete it instead.` };
    changes.push(...c);
    left.push(boxName(box));
  }
  if (!changes.length) return { ok: false, reason: "The selected nodes aren't in a group or lane." };
  w.apply(changes);
  w.apply(laneUpkeep(w.text, picIndex));
  return verify(text, w, picIndex, `Took ${ids.length === 1 ? "the node" : `${ids.length} nodes`} out of ${left.join(" and ")}`);
}

/** Sets the title of fit node `boxId`; an empty title removes it. */
export function planTitle(text: string, picIndex: number, boxId: string, title: string): LaneOutcome {
  const p = read(text, picIndex);
  if (!p) return { ok: false, reason: "There is no picture." };
  const box = fitBoxes(text, p.layout).find((b) => b.node.id === boxId);
  if (!box) return { ok: false, reason: "That group's code isn't in a form the editor reads." };
  const t = title.trim();
  const problem = t ? labelProblem(t) : null;
  if (problem) return { ok: false, reason: problem };
  if (box.title && t === box.title.text) return { ok: false, reason: "Nothing to change: it already has that title." };
  const w = new Work(text);
  if (box.title && t) w.apply([{ from: box.title.textRange.from, to: box.title.textRange.to, insert: t }]);
  else if (box.title) {
    const list = box.node.syntax.options.find((l) => l.items.includes(box.title!.item))!;
    w.apply(removeItems(text, list, [box.title.item]));
  } else if (t) {
    const set = laneSets(text, p.layout).find((s) => s.lanes.some((l) => l.node.id === boxId));
    const defined = definedStyleNames(styleSites(p.doc, p.pic));
    const styleName = set ? "lane title" : "group title";
    const dir = set?.orientation === "rows" ? "west" : "north";
    const list = box.node.syntax.options[box.node.syntax.options.length - 1]!;
    w.apply([appendItem(text, list, titleItem(styleName, dir, t, defined.has(styleName)))]);
  } else return { ok: false, reason: "It has no title to remove." };
  return verify(text, w, picIndex, t ? `Titled ${box.node.name ?? "the group"} "${t}"` : `Removed the title of ${box.node.name ?? "the group"}`);
}

// ---------------------------------------------------------------- upkeep

/** The members at the two extremes of a set, with the anchors that touch them. */
function extremes(members: readonly LaidOutNode[], orientation: Orientation): [{ node: LaidOutNode; anchor: string }, { node: LaidOutNode; anchor: string }] {
  const [a0, a1] = orientation === "columns" ? ["north", "south"] : ["west", "east"];
  const value = (n: LaidOutNode, a: string) => {
    const pt = anchorPoint(n.shape, a) ?? n.shape.center;
    return orientation === "columns" ? pt.y : pt.x;
  };
  let lo = members[0]!;
  let hi = members[0]!;
  for (const m of members) {
    if (orientation === "columns") {
      if (value(m, a0) > value(lo, a0) + 1e-6) lo = m;
      if (value(m, a1) < value(hi, a1) - 1e-6) hi = m;
    } else {
      if (value(m, a0) < value(lo, a0) - 1e-6) lo = m;
      if (value(m, a1) > value(hi, a1) + 1e-6) hi = m;
    }
  }
  return [
    { node: lo, anchor: a0! },
    { node: hi, anchor: a1! },
  ];
}

/**
 * Keeps every lane set's shared coordinates at the top and bottom (or left and
 * right) of its members: a coordinate written as `at (member.north)` is moved
 * to the member that is highest now. Coordinates written any other way are the
 * author's and stay. Returns changes against `text` (none when all is well).
 */
export function laneUpkeep(text: string, picIndex: number): Change[] {
  const p = read(text, picIndex);
  if (!p) return [];
  const changes: Change[] = [];
  for (const set of laneSets(text, p.layout)) {
    const members = [...new Set(set.lanes.flatMap((l) => l.members))].flatMap((id) => p.layout.nodes.find((n) => n.id === id) ?? []);
    if (!members.length) continue;
    const want = extremes(members, set.orientation);
    set.ends.forEach((end, i) => {
      const w = want[i]!;
      const at = end.syntax.at;
      if (!at || !w.node.name) return;
      const written = /^\s*(.+?)\.(north|south|west|east)\s*$/.exec(at.coord.text);
      if (!written || written[2] !== w.anchor || !members.some((m) => m.name === written[1])) return;
      if (written[1] === w.node.name) return;
      const target = anchorPoint(w.node.shape, w.anchor)!;
      const same = set.orientation === "columns" ? Math.abs(target.y - end.shape.center.y) < 0.01 : Math.abs(target.x - end.shape.center.x) < 0.01;
      if (same) return;
      // The coordinate can only name a node defined before it.
      if (w.node.statement.from >= end.statement.from) return;
      changes.push({ from: at.coord.inner.from, to: at.coord.inner.to, insert: `${w.node.name}.${w.anchor}` });
    });
  }
  return changes;
}

/**
 * For deleting nodes: the change that moves lane coordinate `endId`, written
 * at a member being deleted, to the remaining member at that extreme. Null if
 * it isn't such a coordinate.
 */
export function laneEndRetarget(text: string, picIndex: number, endId: string, deleted: ReadonlySet<string>): Change | null {
  const p = read(text, picIndex);
  if (!p) return null;
  for (const set of laneSets(text, p.layout)) {
    const i = set.ends.findIndex((e) => e.id === endId);
    if (i < 0) continue;
    const end = set.ends[i]!;
    const written = end.syntax.at && /^\s*(.+?)\.(north|south|west|east)\s*$/.exec(end.syntax.at.coord.text);
    if (!written || !deleted.has(written[1]!)) return null;
    const members = [...new Set(set.lanes.flatMap((l) => l.members))]
      .flatMap((id) => p.layout.nodes.find((n) => n.id === id) ?? [])
      .filter((n) => n.name && !deleted.has(n.name) && n.statement.from < end.statement.from);
    if (!members.length) return null;
    const w = extremes(members, set.orientation)[i]!;
    return { from: end.syntax.at!.coord.inner.from, to: end.syntax.at!.coord.inner.to, insert: `${w.node.name}.${w.anchor}` };
  }
  return null;
}

/** `changes` to `text` followed by the lanes' upkeep, as one set of changes against `text`, and whether the upkeep did anything. */
export function withLaneUpkeep(text: string, picIndex: number, changes: readonly Change[]): { changes: Change[]; kept: boolean } {
  const after = applyChanges(text, changes);
  const more = laneUpkeep(after, picIndex);
  if (!more.length) return { changes: [...changes], kept: false };
  return { changes: composeChanges(text, changes, more), kept: true };
}

/**
 * The lane a node dropped at `p` goes to, if it isn't its own: lanes are bands,
 * so for lanes side by side only the drop's x counts (a node dropped below the
 * lanes still lands in the lane above it), for lanes one above the other its y.
 */
export function laneAt(text: string, layout: PictureLayout, p: { x: number; y: number }, nodeId: string): FitBox | undefined {
  for (const set of laneSets(text, layout)) {
    const own = set.lanes.find((l) => l.members.includes(nodeId));
    const inside = (b: FitBox) => {
      const r = shapeBounds(b.node.shape);
      return set.orientation === "columns" ? p.x >= r.minX && p.x <= r.maxX : p.y >= r.minY && p.y <= r.maxY;
    };
    if (own && inside(own)) continue;
    const hit = set.lanes.find((l) => l !== own && inside(l));
    if (hit) return hit;
  }
  return undefined;
}

/** The fit boxes that list node `id`, for the panel. */
export function boxesOf(text: string, layout: PictureLayout, id: string): FitBox[] {
  return fitBoxes(text, layout).filter((b) => b.members.includes(id));
}

/** The furniture a statement belongs to, for messages: "lane", "group", or null. */
export function boxKind(text: string, layout: PictureLayout, id: string): "lane" | "group" | null {
  const box = fitBoxes(text, layout).find((b) => b.node.id === id);
  if (!box) return null;
  return laneSets(text, layout).some((s) => s.lanes.some((l) => l.node.id === id)) ? "lane" : "group";
}
