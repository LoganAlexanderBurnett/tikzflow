// The edge properties panel's edits (M2b step 8, D55): arrow direction and
// tips, dashed or dotted, colour and line width, for one edge or for a style it
// uses. Every edit replaces or removes only the option items it is about, then
// is checked by drawing the result again.
import { analyzeDocument, type DocumentModel, layoutDocumentPicture, pictureEnv } from "../model/document.ts";
import { type Edge, itemFrom, pathEdges, pictureEdges } from "../model/edges.ts";
import type { OptionItem, OptionList, PathItemSyntax, PictureSyntax } from "../model/syntax.ts";
import { arrowSides, isArrowKey } from "../tikz/keys.ts";
import type { LaidOutPath, PictureLayout } from "../tikz/layout.ts";
import type { KeyValue } from "../tikz/options.ts";
import { applyChanges, type Change } from "./changes.ts";
import { findEdge } from "./edges.ts";
import { ensureLibraries } from "./libraries.ts";
import { appendItem, findItems, formatOption, type OptionTarget, removeItems } from "./optionEdits.ts";
import { bodyKeys, itemKv, usesStyle } from "./properties.ts";
import { definedStyleNames, styleChain, styleSites, styleTarget, type StyleSite } from "./styles.ts";
import { opOptions } from "./vertices.ts";

export type Direction = "none" | "forward" | "backward" | "both";
/** The tips offered; "default" is whatever the figure's `>` says. */
export const TIPS = ["default", "Stealth", "Latex", "To", "Triangle"] as const;
export type TipName = (typeof TIPS)[number];

export const DASHES = ["solid", "dashed", "dotted"] as const;
export type DashName = (typeof DASHES)[number];

/** TikZ's named line widths, thinnest first, in pt. */
export const WIDTHS: ReadonlyArray<{ key: string; label: string; pt: number }> = [
  { key: "ultra thin", label: "Ultra thin", pt: 0.1 },
  { key: "very thin", label: "Very thin", pt: 0.2 },
  { key: "thin", label: "Thin (default)", pt: 0.4 },
  { key: "semithick", label: "Semithick", pt: 0.6 },
  { key: "thick", label: "Thick", pt: 0.8 },
  { key: "very thick", label: "Very thick", pt: 1.2 },
  { key: "ultra thick", label: "Ultra thick", pt: 1.6 },
];

export type EdgeEdit =
  | { kind: "arrow"; direction?: Direction; tip?: TipName }
  | { kind: "dash"; value: DashName }
  /** A colour name or xcolor expression, or null to drop the edge's own colour. */
  | { kind: "color"; value: string | null }
  /** A named width ("thick"), or null for the default. */
  | { kind: "width"; value: string | null };

/** Where an edit goes: this edge's own options, or a style it uses. */
export type EdgeScope = { kind: "edge" } | { kind: "style"; name: string };

export type EdgePropOutcome = { ok: true; changes: Change[]; text: string; layout: PictureLayout; notes: string[] } | { ok: false; reason: string };

// ---------------------------------------------------------------- which keys mean what

const DASH_KEYS = new Set(["solid", "dashed", "dotted", "densely dashed", "loosely dashed", "densely dotted", "loosely dotted", "dash pattern", "dash dot", "densely dash dot", "loosely dash dot", "dash dot dot", "densely dash dot dot", "loosely dash dot dot"]);
const WIDTH_KEYS = new Set([...WIDTHS.map((w) => w.key), "line width"]);

const isDash = (kv: KeyValue) => DASH_KEYS.has(kv.key);
const isWidth = (kv: KeyValue) => WIDTH_KEYS.has(kv.key);
const isArrow = (kv: KeyValue) => (kv.value === undefined && isArrowKey(kv.key)) || (kv.key === "arrows" && kv.value !== undefined);

/** Matches a colour: `draw=red`, `color=red`, or a bare colour name. */
function colorTest(parse: (e: string) => unknown): (kv: KeyValue) => boolean {
  return (kv) => kv.key === "draw" ? kv.value !== undefined && kv.value !== "none" : kv.key === "color" ? kv.value !== undefined : kv.value === undefined && !DASH_KEYS.has(kv.key) && !WIDTH_KEYS.has(kv.key) && !!parse(kv.key);
}

// ---------------------------------------------------------------- the keys an edge is drawn with

/** The option lists of a path that apply to all of it (not those of a `to` or `edge` operation). */
function pathLists(items: readonly PathItemSyntax[]): OptionList[] {
  const out: OptionList[] = [];
  items.forEach((it, i) => {
    const prev = items[i - 1];
    if (it.kind === "options" && !(prev && prev.kind === "keyword" && (prev.word === "to" || prev.word === "edge"))) out.push(it.list);
  });
  return out;
}

/** The keys an edge is drawn with, in the order TikZ applies them: `every path`, the statement's options, and for an `edge` operation `every edge` and its own. */
export function edgeKeys(edge: Edge): KeyValue[] {
  const items = edge.path.syntax.items;
  const keys: KeyValue[] = [{ key: "every path" }, ...pathLists(items).flatMap((l) => l.items.map(itemKv))];
  const op = edgeOpIndex(edge);
  if (op >= 0) {
    keys.push({ key: "every edge" });
    const list = opOptions(items, op);
    if (list) keys.push(...list.items.map(itemKv));
  }
  return keys;
}

/** The index of the `edge` keyword of an `edge` operation edge, or -1. */
function edgeOpIndex(edge: Edge): number {
  if (!edge.path.id.includes("/edge")) return -1;
  return edge.path.syntax.items.findIndex((it) => it.kind === "keyword" && it.word === "edge" && itemFrom(it) === edge.path.range.from);
}

export interface Found {
  kv: KeyValue;
  /** The style that sets it, or undefined when the edge (or style) sets it itself. */
  via?: string | undefined;
}

/**
 * The last key `test` accepts in `keys`, following the document's styles the
 * way TikZ applies them. With `skipOwn`, the keys' own matching items are
 * ignored, to find what would be inherited without them.
 */
export function lastMatch(sites: readonly StyleSite[], keys: readonly KeyValue[], test: (kv: KeyValue) => boolean, skipOwn = false): Found | null {
  let found: Found | null = null;
  const walk = (kvs: readonly KeyValue[], via: string | undefined, depth: number, own: boolean) => {
    if (depth > 20) return;
    for (const kv of kvs) {
      if (test(kv)) {
        if (!(own && skipOwn)) found = { kv, via };
        continue;
      }
      const name = kv.key === "style" && kv.value ? kv.value.replace(/^\{|\}$/g, "").trim() : kv.value === undefined ? kv.key : null;
      if (!name) continue;
      for (const def of styleChain(sites, name)) walk(bodyKeys(def), via ?? name, depth + 1, false);
    }
  };
  walk(keys, undefined, 0, true);
  return found;
}

// ---------------------------------------------------------------- reading

export interface EdgeProps {
  direction: Direction;
  tip: TipName | "custom";
  arrowVia?: string | undefined;
  dash: DashName | "other";
  dashVia?: string | undefined;
  /** The colour as written, if something sets one. */
  color?: string | undefined;
  colorVia?: string | undefined;
  /** The named width, "custom" for `line width=…`, or "thin" (the default) when nothing sets one. */
  width: string;
  widthText?: string | undefined;
  widthVia?: string | undefined;
}

const sideTip = (side: string): TipName | "custom" | null => {
  const t = side.trim().replace(/^\{|\}$/g, "").trim();
  if (!t) return null;
  if (/^[<>]+$/.test(t)) return "default";
  const name = TIPS.find((n) => n !== "default" && new RegExp(`^${n}\\b`).test(t));
  return name ?? "custom";
};

/** The arrow the keys give: its direction, tip and the style it comes from. */
export function arrowOf(sites: readonly StyleSite[], keys: readonly KeyValue[]): { direction: Direction; tip: TipName | "custom"; via?: string | undefined } | null {
  const arrow = lastMatch(sites, keys, isArrow);
  const sides = arrow && arrowSides(arrow.kv.key === "arrows" ? (arrow.kv.value ?? "") : arrow.kv.key);
  if (!arrow || !sides) return null;
  const a = sideTip(sides[0]);
  const b = sideTip(sides[1]);
  return { direction: a && b ? "both" : a ? "backward" : b ? "forward" : "none", tip: b ?? a ?? "default", via: arrow.via };
}

/** What an edge looks like, as its options and styles say. */
export function readEdgeProps(doc: DocumentModel, pic: PictureSyntax, edge: Edge): EdgeProps {
  return readProps(doc, pic, edgeKeys(edge));
}

/** What the style `name` gives an edge, by itself. */
export function readStyleProps(doc: DocumentModel, pic: PictureSyntax, name: string): EdgeProps {
  return readProps(doc, pic, styleChain(styleSites(doc, pic), name).flatMap(bodyKeys));
}

function readProps(doc: DocumentModel, pic: PictureSyntax, keys: readonly KeyValue[]): EdgeProps {
  const sites = styleSites(doc, pic);
  const parse = (e: string) => pictureEnv(doc, pic).colors.parse(e);
  const props: EdgeProps = { direction: "none", tip: "default", dash: "solid", width: "thin" };
  const arrow = arrowOf(sites, keys);
  if (arrow) {
    props.direction = arrow.direction;
    props.tip = arrow.tip;
    props.arrowVia = arrow.via;
  }
  const dash = lastMatch(sites, keys, isDash);
  if (dash) {
    const k = dash.kv.key;
    props.dash = k === "solid" ? "solid" : k.endsWith("dashed") ? "dashed" : k.endsWith("dotted") ? "dotted" : "other";
    props.dashVia = dash.via;
  }
  const color = lastMatch(sites, keys, colorTest(parse));
  if (color) {
    props.color = color.kv.value ?? color.kv.key;
    props.colorVia = color.via;
  }
  const width = lastMatch(sites, keys, isWidth);
  if (width) {
    props.width = width.kv.key === "line width" ? "custom" : width.kv.key;
    props.widthText = width.kv.value;
    props.widthVia = width.via;
  }
  return props;
}

// ---------------------------------------------------------------- scopes

/** The document styles an edge's options name directly, in order: the styles an edit can go to. */
export function edgeStyleNames(doc: DocumentModel, pic: PictureSyntax, edge: Edge): string[] {
  const defined = definedStyleNames(styleSites(doc, pic));
  const items = edge.path.syntax.items;
  const op = edgeOpIndex(edge);
  const lists = [...pathLists(items), ...(op >= 0 && opOptions(items, op) ? [opOptions(items, op)!] : [])];
  const out: string[] = [];
  for (const l of lists) for (const i of l.items) if (defined.has(i.key) && i.value === undefined && !out.includes(i.key)) out.push(i.key);
  return out;
}

/** How many drawn paths use style `name`. */
export function styleEdgeUsers(doc: DocumentModel, pic: PictureSyntax, layout: PictureLayout, name: string): number {
  const sites = styleSites(doc, pic);
  const seen = new Set<string>();
  for (const e of pictureEdges(layout)) {
    if (usesStyle(sites, edgeKeys(e), name)) seen.add(e.path.id);
  }
  return seen.size;
}

/** Why an edit can't go to this edge's own options, or null. */
export function edgeScopeBlocker(edge: Edge, layout: PictureLayout, edit?: EdgeEdit): string | null {
  if (edge.lock) return `This edge can't be edited: ${edge.lock.message}.`;
  if (edit?.kind === "arrow" && !edge.path.id.includes("/edge") && pathEdges(edge.path, layout).length > 1) {
    return "Arrow tips belong to the whole path, and this path has several edges. Use Split into separate edges first.";
  }
  return null;
}

/** The options an edge's own edits go to: its statement's, or an `edge` operation's. */
function edgeTarget(text: string, edge: Edge): OptionTarget | string {
  const syn = edge.path.syntax;
  const op = edgeOpIndex(edge);
  if (op >= 0) {
    const kw = syn.items[op]!;
    if (kw.kind !== "keyword") return "The edge's code couldn't be found.";
    const list = opOptions(syn.items, op);
    return { lists: list ? [list] : [], addList: (t) => ({ from: kw.range.to, to: kw.range.to, insert: `[${t}]` }) };
  }
  // The options right after the command; later lists apply too, but these are where hand-written code puts them.
  const lists: OptionList[] = [];
  for (const it of syn.items) {
    if (it.kind !== "options") break;
    lists.push(it.list);
  }
  void text;
  return { lists, addList: (t) => ({ from: syn.keyword.to, to: syn.keyword.to, insert: `[${t}]` }) };
}

// ---------------------------------------------------------------- planning

/**
 * Replaces the last item `match` accepts with `itemText` and removes the other
 * matching ones; with none, appends `itemText`. `itemText` null removes all of
 * them. Returns null when there is nowhere to add or an item uses `#1`.
 */
function editGroup(text: string, target: OptionTarget, match: (i: OptionItem) => boolean, itemText: string | null): Change[] | null {
  const found = findItems(target, match);
  if (found.some((f) => text.slice(f.item.from, f.item.to).includes("#"))) return null;
  const changes: Change[] = [];
  const last = found[found.length - 1];
  for (const list of target.lists) {
    const items = found.filter((f) => f.list === list && (itemText === null || f !== last)).map((f) => f.item);
    if (!items.length) continue;
    if (target.keepEmpty && items.length === list.items.length) changes.push({ from: list.items[0]!.from, to: list.items[list.items.length - 1]!.to, insert: "" });
    else changes.push(...removeItems(text, list, items));
  }
  if (itemText !== null) {
    if (last) changes.push({ from: last.item.from, to: last.item.to, insert: itemText });
    else {
      const list = target.lists[target.lists.length - 1];
      if (list) changes.push(appendItem(text, list, itemText));
      else if (target.addList) changes.push(target.addList(itemText));
      else return null;
    }
  }
  return changes;
}

const kvOf = (i: OptionItem): KeyValue => itemKv(i);

/** The arrow key written for a direction and tip: `->`, `<-`, `<->`, `-Stealth`, `Latex-Latex`. */
export function arrowText(direction: Direction, tip: TipName): string {
  const t = tip === "default" ? null : tip;
  const left = direction === "backward" || direction === "both" ? (t ?? "<") : "";
  const right = direction === "forward" || direction === "both" ? (t ?? ">") : "";
  return `${left}-${right}`;
}

const near = (a: { x: number; y: number }, b: { x: number; y: number }, eps = 0.05) => Math.hypot(a.x - b.x, a.y - b.y) <= eps;

/**
 * Applies `edit` to the options of edge `edgeId` or of the style it uses. The
 * result is drawn again: nothing else may move, and the edge must come out as
 * asked (a later key in the code can override what was written).
 */
export function planEdgeProperty(text: string, picIndex: number, edgeId: string, scope: EdgeScope, edit: EdgeEdit, extra: readonly Change[] = []): EdgePropOutcome {
  const doc = analyzeDocument(text);
  const pic = doc.syntax.pictures[picIndex];
  const layout = layoutDocumentPicture(doc, picIndex);
  const edge = layout && findEdge(layout, edgeId);
  if (!pic || !layout || !edge) return { ok: false, reason: "There is no such edge." };
  if (edge.lock) return { ok: false, reason: `This edge can't be edited: ${edge.lock.message}.` };
  const sites = styleSites(doc, pic);
  const parse = (e: string) => pictureEnv(doc, pic).colors.parse(e);
  const notes: string[] = [];

  let target: OptionTarget | string;
  let keys: KeyValue[];
  let what: string;
  if (scope.kind === "style") {
    const t = styleTarget(text, sites, scope.name);
    if (!t) return { ok: false, reason: `The ${scope.name} style isn't written in a form the editor can change.` };
    target = t;
    keys = styleChain(sites, scope.name).flatMap(bodyKeys);
    what = `the ${scope.name} style`;
  } else {
    const blocked = edgeScopeBlocker(edge, layout, edit);
    if (blocked) return { ok: false, reason: blocked };
    target = edgeTarget(text, edge);
    keys = edgeKeys(edge);
    what = "this edge";
  }
  if (typeof target === "string") return { ok: false, reason: target };

  const own = (test: (kv: KeyValue) => boolean) => (i: OptionItem) => test(kvOf(i));
  let changes: Change[] | null;
  if (edit.kind === "dash") {
    const inherited = lastMatch(sites, keys, isDash, true);
    const inheritedName = inherited ? inherited.kv.key : null;
    const text1 = edit.value === "solid" ? (inherited && inheritedName !== "solid" ? "solid" : null) : inheritedName === edit.value ? null : edit.value;
    changes = editGroup(text, target, own(isDash), text1);
  } else if (edit.kind === "width") {
    const inherited = lastMatch(sites, keys, isWidth, true);
    const current = inherited ? (inherited.kv.key === "line width" ? null : inherited.kv.key) : "thin";
    const want = edit.value ?? "thin";
    const text1 = want === current ? null : edit.value ?? "thin";
    changes = editGroup(text, target, own(isWidth), text1);
  } else if (edit.kind === "color") {
    const test = colorTest(parse);
    const found = findItems(target, own(test));
    let text1: string | null = null;
    if (edit.value !== null) {
      const last = found[found.length - 1]?.item;
      // Keep the form the edge already uses: draw=…, color=…, or a bare name.
      if (last && last.value === undefined && /^[A-Za-z][A-Za-z0-9!.]*$/.test(edit.value)) text1 = edit.value;
      else text1 = formatOption(last?.key === "color" ? "color" : "draw", edit.value);
    } else if (lastMatch(sites, keys, test, true)) notes.push("it falls back to the colour its styles give it");
    changes = editGroup(text, target, own(test), text1);
  } else {
    const current = arrowOf(sites, keys);
    const direction = edit.direction ?? current?.direction ?? "none";
    const tip = edit.tip ?? (!current || current.tip === "custom" ? "default" : current.tip);
    const inherited = lastMatch(sites, keys, isArrow, true);
    const sides = inherited ? arrowSides(inherited.kv.key === "arrows" ? (inherited.kv.value ?? "") : inherited.kv.key) : null;
    const inheritedText = sides ? `${sides[0]}-${sides[1]}` : "-";
    const wanted = arrowText(direction, tip);
    // Back to what it inherits (or to no arrow at all): drop the edge's own arrow rather than repeat it.
    const text1 = wanted === inheritedText ? null : wanted;
    changes = editGroup(text, target, own(isArrow), text1);
    if (tip !== "default" && direction !== "none") {
      const lib = ensureLibraries(doc, pic, ["arrows.meta"]);
      if (!lib.ok) notes.push(`the ${tip} tip needs the arrows.meta library: ${lib.reason}`);
      else if (lib.change) {
        changes = [...(changes ?? []), lib.change];
        notes.push("loaded the arrows.meta library");
      }
    }
  }
  if (!changes) return { ok: false, reason: `${what[0]!.toUpperCase()}${what.slice(1)} uses a style argument (#1) for this, so it can only be changed in the code.` };
  changes = [...changes, ...extra];
  if (!changes.length) return { ok: true, changes: [], text, layout, notes };

  // Draw the result: nothing else may move, and this edge must look as asked.
  const next = applyChanges(text, changes);
  const doc2 = analyzeDocument(next);
  const layout2 = layoutDocumentPicture(doc2, picIndex);
  const refused = (why: string): EdgePropOutcome => ({ ok: false, reason: why });
  if (!layout2 || doc2.errors.length > doc.errors.length) return refused("That would break the code around it, so it wasn't written.");
  if (layout2.nodes.length !== layout.nodes.length || layout2.paths.length !== layout.paths.length || layout2.pathNodes.length !== layout.pathNodes.length) return refused("That would change the structure of the picture, so it wasn't written.");
  if (layout2.nodes.some((n, i) => !near(n.shape.center, layout.nodes[i]!.shape.center))) return refused("That would move a node, so it wasn't written.");
  const index = pictureEdges(layout).findIndex((e) => e.id === edgeId);
  const edge2 = pictureEdges(layout2)[index];
  if (!edge2) return refused("The edge couldn't be found after the change.");
  const bad = misread(edit, scope.kind, edge2.path, parse);
  if (bad) return refused(`${bad} Another option later in the code probably overrides it; change it there.`);
  if (scope.kind === "style") {
    const users = styleEdgeUsers(doc, pic, layout, scope.name);
    if (users > 1) notes.push(`${users - 1} other ${users === 2 ? "edge uses" : "edges use"} the ${scope.name} style and change${users === 2 ? "s" : ""} too`);
  }
  return { ok: true, changes, text: next, layout: layout2, notes };
}

/** What is wrong with how `path` came out after `edit`, or null. */
function misread(edit: EdgeEdit, scope: EdgeScope["kind"], path: LaidOutPath, parse: (e: string) => readonly number[] | null): string | null {
  if (edit.kind === "dash") {
    if (edit.value === "solid" ? path.dash !== null : path.dash === null) return `The edge isn't ${edit.value} after the change.`;
  } else if (edit.kind === "width") {
    const want = WIDTHS.find((w) => w.key === (edit.value ?? "thin"))?.pt;
    if (want !== undefined && Math.abs(path.lineWidth - want) > 0.02) return "The line width didn't change.";
  } else if (edit.kind === "color" && edit.value !== null) {
    const want = parse(edit.value);
    if (want && path.stroke && want.some((v, i) => Math.abs(v - path.stroke![i]!) > 0.02)) return "The colour didn't change.";
  } else if (edit.kind === "arrow" && edit.direction !== undefined && scope === "edge") {
    const n = edit.direction === "none" ? 0 : edit.direction === "both" ? 2 : 1;
    if (path.tips.length !== n) return "The arrow tips didn't come out as asked.";
  }
  return null;
}
