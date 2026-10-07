// The properties panel's edits: colours, font and alignment, applied to the
// selected nodes or to a style they share (D37). Every edit goes through
// setOption-style item edits, so only the items it is about change.
import { type DocumentModel, pictureEnv } from "../model/document.ts";
import type { NodeSyntax, OptionItem, PictureSyntax } from "../model/syntax.ts";
import type { RGB } from "../tikz/colors.ts";
import type { LaidOutNode, PictureLayout } from "../tikz/layout.ts";
import { type KeyValue, parseOptionString } from "../tikz/options.ts";
import { PT_PER_UNIT } from "../tikz/units.ts";
import type { Change } from "./changes.ts";
import { appendItem, findItems, formatOption, nodeTarget, type OptionTarget, removeItems } from "./optionEdits.ts";
import { definedStyleNames, nodeStyles, preambleAnchor, type StyleSite, styleChain, styleSites, styleTarget } from "./styles.ts";
import { eolNear, indentAt, lineEnd } from "./text.ts";

// ---------------------------------------------------------------- fonts

/** LaTeX's size commands, smallest first. */
export const FONT_SIZES = ["\\tiny", "\\scriptsize", "\\footnotesize", "\\small", "\\normalsize", "\\large", "\\Large", "\\LARGE", "\\huge", "\\Huge"] as const;
export type Family = "rm" | "sf" | "tt";
const FAMILY_CS: Record<Family, string> = { rm: "\\rmfamily", sf: "\\sffamily", tt: "\\ttfamily" };

export interface FontState {
  /** A size command, "custom" for \fontsize, or undefined for the default size. */
  size?: string;
  bold: boolean;
  italic: boolean;
  family?: Family;
}

const BOLD = new Set(["\\bfseries", "\\bf"]);
const ITALIC = new Set(["\\itshape", "\\it", "\\slshape", "\\sl", "\\em"]);
const FAMILIES: Record<string, Family> = { "\\rmfamily": "rm", "\\rm": "rm", "\\sffamily": "sf", "\\sf": "sf", "\\ttfamily": "tt", "\\tt": "tt" };

/** Splits a font value into control words, brace groups and other characters. */
function fontTokens(value: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < value.length; ) {
    const ch = value[i]!;
    if (/\s/.test(ch)) {
      i++;
    } else if (ch === "\\") {
      const m = /^\\([A-Za-z@]+|.)/.exec(value.slice(i))!;
      out.push(m[0]);
      i += m[0].length;
    } else if (ch === "{") {
      let depth = 0;
      let j = i;
      for (; j < value.length; j++) {
        if (value[j] === "\\") j++;
        else if (value[j] === "{") depth++;
        else if (value[j] === "}" && --depth === 0) break;
      }
      out.push(value.slice(i, j + 1));
      i = j + 1;
    } else {
      out.push(ch);
      i++;
    }
  }
  return out;
}

function joinTokens(tokens: readonly string[]): string {
  let out = "";
  for (const t of tokens) {
    // A control word followed by a letter needs a space: "\bf x", not "\bfx".
    if (/\\[A-Za-z@]+$/.test(out) && /^[A-Za-z@]/.test(t)) out += " ";
    out += t;
  }
  return out;
}

/** Where the size is in `tokens`: a size command, or \fontsize{..}{..} with an optional \selectfont. */
function sizeSpan(tokens: readonly string[]): [number, number] | null {
  for (let i = 0; i < tokens.length; i++) {
    if ((FONT_SIZES as readonly string[]).includes(tokens[i]!)) return [i, i + 1];
    if (tokens[i] === "\\fontsize") {
      let j = Math.min(i + 3, tokens.length);
      if (tokens[j] === "\\selectfont") j++;
      return [i, j];
    }
  }
  return null;
}

export function readFont(value: string | undefined): FontState {
  const tokens = fontTokens(value ?? "");
  const span = sizeSpan(tokens);
  const state: FontState = { bold: tokens.some((t) => BOLD.has(t)), italic: tokens.some((t) => ITALIC.has(t)) };
  if (span) state.size = tokens[span[0]] === "\\fontsize" ? "custom" : tokens[span[0]]!;
  for (const t of tokens) if (FAMILIES[t]) state.family = FAMILIES[t];
  return state;
}

/**
 * Changes a font value: sets or clears the size, series, shape and family,
 * keeping every other command where it is ("\color{red}", "\scshape").
 * A size of "\normalsize" or a family of null removes the command.
 */
export function editFont(value: string | undefined, change: { size?: string; bold?: boolean; italic?: boolean; family?: Family | null }): string {
  let tokens = fontTokens(value ?? "");
  if (change.family !== undefined) {
    tokens = tokens.filter((t) => !FAMILIES[t]);
    if (change.family) tokens.unshift(FAMILY_CS[change.family]);
  }
  if (change.size !== undefined) {
    const span = sizeSpan(tokens);
    const replacement = change.size === "\\normalsize" || change.size === "custom" ? [] : [change.size];
    if (change.size === "custom") {
      // Keep a custom size as it is.
    } else if (span) tokens.splice(span[0], span[1] - span[0], ...replacement);
    else {
      const afterFamily = tokens.findIndex((t) => !FAMILIES[t]);
      tokens.splice(afterFamily < 0 ? tokens.length : afterFamily, 0, ...replacement);
    }
  }
  if (change.bold !== undefined) {
    tokens = tokens.filter((t) => !BOLD.has(t) && t !== "\\mdseries");
    if (change.bold) tokens.push("\\bfseries");
  }
  if (change.italic !== undefined) {
    tokens = tokens.filter((t) => !ITALIC.has(t) && t !== "\\upshape");
    if (change.italic) tokens.push("\\itshape");
  }
  return joinTokens(tokens);
}

// ---------------------------------------------------------------- reading options

/** The keys a statement or style body sets, in order, as plain key-values. */
function bodyKeys(def: { body?: { items: OptionItem[] }; bodyText: string }): KeyValue[] {
  return def.body ? def.body.items.map(itemKv) : parseOptionString(def.bodyText);
}

function itemKv(i: OptionItem): KeyValue {
  return i.value === undefined ? { key: i.key } : { key: i.key, value: i.value };
}

export interface Resolved {
  /** The value in effect, or undefined if nothing sets the key. */
  value?: string;
  /** The style that sets it, or undefined when the node (or style) sets it itself. */
  via?: string;
}

/**
 * The value of `key` in effect for a list of keys, following the document's
 * styles the way TikZ applies them: in order, a style's keys where it's named.
 * `own` keys that `skip` accepts are ignored, to find what would be inherited.
 */
function resolveKeys(sites: readonly StyleSite[], keys: readonly KeyValue[], key: string, skip?: (kv: KeyValue) => boolean): Resolved {
  let found: Resolved = {};
  const walk = (kvs: readonly KeyValue[], via: string | undefined, depth: number, own: boolean) => {
    if (depth > 20) return;
    for (const kv of kvs) {
      if (own && skip?.(kv)) continue;
      if (kv.key === key) found = kv.value === undefined ? { ...(via ? { via } : {}) } : { value: kv.value, ...(via ? { via } : {}) };
      else {
        const name = kv.key === "style" && kv.value ? kv.value.replace(/^\{|\}$/g, "").trim() : kv.value === undefined ? kv.key : null;
        if (!name) continue;
        const chain = styleChain(sites, name);
        for (const def of chain) walk(bodyKeys(def), via ?? name, depth + 1, false);
      }
    }
  };
  walk(keys, undefined, 0, true);
  return found;
}

/** Where an edit goes: the selected nodes, or a style they share. */
export type Scope = { kind: "nodes"; ids: readonly string[] } | { kind: "style"; name: string };

/** A node's keys as TikZ applies them: "every node" first, then its own options. */
function nodeKeys(syn: NodeSyntax): KeyValue[] {
  return [{ key: "every node" }, ...syn.options.flatMap((l) => l.items.map(itemKv))];
}

/** The value of `key` for a node, as its options and styles set it. */
export function nodeOption(sites: readonly StyleSite[], syn: NodeSyntax, key: string): Resolved {
  return resolveKeys(sites, nodeKeys(syn), key);
}

/** The value of `key` in a style, as its own keys and the styles it uses set it. */
export function styleOption(sites: readonly StyleSite[], name: string, key: string): Resolved {
  return resolveKeys(sites, styleChain(sites, name).flatMap(bodyKeys), key);
}

/** The value a node or style would have for `key` without its own `key=` items. */
function inherited(sites: readonly StyleSite[], keys: readonly KeyValue[], key: string): Resolved {
  return resolveKeys(sites, keys, key, (kv) => kv.key === key);
}

// ---------------------------------------------------------------- styles

/** Whether the keys use style `name`, directly or through other document styles. */
function usesStyle(sites: readonly StyleSite[], keys: readonly KeyValue[], name: string, depth = 0): boolean {
  if (depth > 20) return false;
  for (const kv of keys) {
    const s = kv.key === "style" && kv.value ? kv.value.replace(/^\{|\}$/g, "").trim() : kv.value === undefined ? kv.key : null;
    if (!s) continue;
    if (s === name) return true;
    const chain = styleChain(sites, s);
    if (chain.length && usesStyle(sites, chain.flatMap(bodyKeys), name, depth + 1)) return true;
  }
  return false;
}

/** The statement nodes that use style `name`, directly or through other styles. */
export function styleUsers(sites: readonly StyleSite[], layout: PictureLayout, name: string): LaidOutNode[] {
  return layout.nodes.filter((n) => n.kind === "statement" && usesStyle(sites, n.syntax.options.flatMap((l) => l.items.map(itemKv)), name));
}

/** Styles every one of the nodes names directly, in the order the first names them. */
export function sharedStyles(doc: DocumentModel, pic: PictureSyntax, nodes: readonly LaidOutNode[]): string[] {
  const defined = definedStyleNames(styleSites(doc, pic));
  const lists = nodes.map((n) => nodeStyles(n.syntax, defined));
  return lists[0]?.filter((s) => lists.every((l) => l.includes(s))) ?? [];
}

// ---------------------------------------------------------------- edits

export type PropEdit =
  | { kind: "color"; key: "fill" | "draw" | "text"; value: string }
  | { kind: "font"; change: { size?: string; bold?: boolean; italic?: boolean; family?: Family | null } }
  | { kind: "align"; value: "left" | "center" | "right" | "justify" };

export type PropResult = { ok: true; changes: Change[]; notes: string[] } | { ok: false; reason: string };

const keyIs = (k: string) => (i: OptionItem) => i.key === k;

/**
 * Sets several keys of one target in one go: each existing item is replaced
 * in place (the last one, which TikZ applies) and the rest are appended
 * together. `null` removes a key. Returns null if an item uses a style
 * argument (#1) or there is nowhere to add.
 */
export function setOptions(text: string, target: OptionTarget, items: ReadonlyArray<{ key: string; text: string | null }>): Change[] | null {
  const changes: Change[] = [];
  const appended: string[] = [];
  for (const { key, text: itemText } of items) {
    const found = findItems(target, keyIs(key));
    if (found.some((f) => text.slice(f.item.from, f.item.to).includes("#"))) return null;
    if (itemText === null) {
      for (const f of found) {
        const list = f.list;
        const all = list.items.filter((i) => found.some((g) => g.item === i));
        if (all[0] !== f.item) continue;
        if (target.keepEmpty && all.length === list.items.length) changes.push({ from: list.items[0]!.from, to: list.items.at(-1)!.to, insert: "" });
        else changes.push(...removeItems(text, list, all));
      }
    } else {
      const last = found.at(-1);
      if (last) changes.push({ from: last.item.from, to: last.item.to, insert: itemText });
      else appended.push(itemText);
    }
  }
  if (appended.length) {
    const list = target.lists.at(-1);
    if (list) {
      const first = appendItem(text, list, appended[0]!);
      const sep = list.items.length ? first.insert.slice(0, first.insert.length - appended[0]!.length) : ", ";
      changes.push({ ...first, insert: first.insert + appended.slice(1).map((a) => sep + a).join("") });
    } else if (target.addList) changes.push(target.addList(appended.join(", ")));
    else return null;
  }
  return changes;
}

/** A whole number of millimetres at least `pt`: "34mm", or "3cm" for whole centimetres. */
function roundUpMM(pt: number): string {
  const mm = Math.max(1, Math.ceil(pt / PT_PER_UNIT.mm! - 1e-6));
  return mm % 10 === 0 ? `${mm / 10}cm` : `${mm}mm`;
}

/** The changes for one node or style. */
function targetChanges(
  text: string,
  sites: readonly StyleSite[],
  target: OptionTarget,
  keys: KeyValue[],
  edit: PropEdit,
  textWidth: number | undefined,
  what: string,
): { changes: Change[]; notes: string[] } | string {
  const notes: string[] = [];
  let items: Array<{ key: string; text: string | null }>;
  if (edit.kind === "color") items = [{ key: edit.key, text: formatOption(edit.key, edit.value) }];
  else if (edit.kind === "font") {
    const current = resolveKeys(sites, keys, "font").value;
    const next = editFont(current, edit.change);
    const base = inherited(sites, keys, "font").value ?? "";
    // Back to what it inherits: drop its own font= rather than repeat it.
    const own = next === editFont(base, {}) ? null : next === "" ? "font={}" : formatOption("font", next);
    items = [{ key: "font", text: own }];
  } else {
    items = [{ key: "align", text: formatOption("align", edit.value) }];
    if (edit.value === "justify" && resolveKeys(sites, keys, "text width").value === undefined) {
      if (textWidth === undefined) return `Justify needs a text width, and ${what} doesn't set one. Set a text width first.`;
      const w = roundUpMM(textWidth);
      items.unshift({ key: "text width", text: `text width=${w}` });
      notes.push(`Justify needs a text width, so text width=${w} was set too`);
    }
  }
  const changes = setOptions(text, target, items);
  if (!changes) return `${what} uses a style argument (#1) for this option, so it can only be changed in the code.`;
  return { changes, notes };
}

/**
 * The changes that apply `edit` to the nodes or the style in `scope`, as one
 * edit. Fails as a whole if any target can't take it.
 */
export function propertyChanges(doc: DocumentModel, picIndex: number, layout: PictureLayout, scope: Scope, edit: PropEdit): PropResult {
  const pic = doc.syntax.pictures[picIndex];
  if (!pic) return { ok: false, reason: "There is no picture." };
  const sites = styleSites(doc, pic);
  const text = doc.text;
  if (scope.kind === "style") {
    const target = styleTarget(text, sites, scope.name);
    if (!target) return { ok: false, reason: `The ${scope.name} style isn't written in a form the editor can change.` };
    const keys = styleChain(sites, scope.name).flatMap(bodyKeys);
    const r = targetChanges(text, sites, target, keys, edit, undefined, `the ${scope.name} style`);
    if (typeof r === "string") return { ok: false, reason: r };
    // Nodes that set the key themselves keep their value.
    const key = edit.kind === "color" ? edit.key : edit.kind;
    const users = styleUsers(sites, layout, scope.name);
    const own = users.filter((n) => n.syntax.options.some((l) => l.items.some(keyIs(key))));
    if (own.length) r.notes.push(`${own.length} of the ${users.length} ${scope.name} nodes set their own ${key === "draw" ? "outline" : key}, so they keep it`);
    return { ok: true, ...r };
  }
  const changes: Change[] = [];
  const notes = new Set<string>();
  for (const id of scope.ids) {
    const n = layout.nodes.find((x) => x.id === id);
    if (!n || n.kind !== "statement") continue;
    const r = targetChanges(text, sites, nodeTarget(n.syntax), nodeKeys(n.syntax), edit, n.text?.width, `node ${n.name ?? n.id}`);
    if (typeof r === "string") return { ok: false, reason: r };
    changes.push(...r.changes);
    for (const note of r.notes) notes.add(note);
  }
  return { ok: true, changes, notes: [...notes] };
}

// ---------------------------------------------------------------- colours

/** Colours the document defines for the picture, in order: \definecolor and \colorlet before it and in it. */
export function documentColors(doc: DocumentModel, pic: PictureSyntax): Array<{ name: string; rgb?: RGB }> {
  const env = pictureEnv(doc, pic);
  const names: string[] = [];
  for (const item of doc.syntax.preamble) {
    if (item.range.from >= pic.from) break;
    if (item.kind === "definition" && item.def.kind !== "macro") names.push(item.def.name.trim());
  }
  for (const item of pic.items) if (item.kind === "definition" && item.def.kind !== "macro") names.push(item.def.name.trim());
  // Colours defined in the picture body aren't in the preamble's table yet.
  for (const item of pic.items) {
    if (item.kind !== "definition") continue;
    if (item.def.kind === "color") env.colors.define(item.def.name, item.def.model, item.def.spec);
    else if (item.def.kind === "colorlet") {
      const c = env.colors.parse(item.def.expr);
      if (c) env.colors.set(item.def.name, c);
    }
  }
  const out: Array<{ name: string; rgb?: RGB }> = [];
  for (const name of [...new Set(names)]) {
    const rgb = env.colors.parse(name);
    out.push(rgb ? { name, rgb } : { name });
  }
  return out;
}

/** Why `name` can't be a new colour name, or null if it can. */
export function colorNameProblem(doc: DocumentModel, pic: PictureSyntax, name: string): string | null {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) return "Use letters and digits only, starting with a letter.";
  if (documentColors(doc, pic).some((c) => c.name === name) || pictureEnv(doc, pic).colors.has(name)) return `"${name}" is already a colour.`;
  return null;
}

const hex2 = (v: number) => Math.round(v).toString(16).padStart(2, "0").toUpperCase();

/** "{rgb,255:red,R;green,G;blue,B}" for a colour given as 0-255 channels. */
export function rawColor(rgb: readonly [number, number, number]): string {
  return `{rgb,255:red,${Math.round(rgb[0])};green,${Math.round(rgb[1])};blue,${Math.round(rgb[2])}}`;
}

/**
 * The change that adds \definecolor{name}{...}{...} for picture `pic`: after
 * the last colour definition before or in it, in the same colour model; else
 * in the preamble after \usetikzlibrary; else at the start of the picture.
 */
export function addColorDefinition(doc: DocumentModel, pic: PictureSyntax, name: string, rgb: readonly [number, number, number]): Change {
  const text = doc.text;
  let last: { range: { from: number; to: number }; model?: string } | undefined;
  for (const item of doc.syntax.preamble) {
    if (item.range.from >= pic.from) break;
    if (item.kind === "definition" && item.def.kind === "color") last = { range: item.range, model: item.def.model.trim() };
  }
  for (const item of pic.items) if (item.kind === "definition" && item.def.kind === "color") last = { range: item.range, model: item.def.model.trim() };
  const spec = (model?: string): string => {
    if (model === "RGB") return `{RGB}{${rgb.map((v) => Math.round(v)).join(",")}}`;
    if (model === "rgb") return `{rgb}{${rgb.map((v) => +(v / 255).toFixed(3)).join(",")}}`;
    return `{HTML}{${rgb.map(hex2).join("")}}`;
  };
  if (last) {
    const at = lineEnd(text, last.range.to);
    return { from: at, to: at, insert: `${eolNear(text, last.range.from)}${indentAt(text, last.range.from)}\\definecolor{${name}}${spec(last.model)}` };
  }
  const anchor = preambleAnchor(doc, pic);
  if (anchor >= 0 && /\\documentclass|\\usepackage/.test(text.slice(0, pic.from))) {
    const at = lineEnd(text, anchor);
    return { from: at, to: at, insert: `${eolNear(text, anchor)}\\definecolor{${name}}${spec()}` };
  }
  // A bare picture: the first line of its body.
  const at = lineEnd(text, pic.options?.to ?? pic.begin.to);
  const firstBody = pic.items[0];
  const indent = firstBody ? indentAt(text, firstBody.kind === "node" ? firstBody.node.from : firstBody.kind === "path" ? firstBody.path.from : firstBody.range.from) : "  ";
  return { from: at, to: at, insert: `${eolNear(text, pic.from)}${indent}\\definecolor{${name}}${spec()}` };
}
