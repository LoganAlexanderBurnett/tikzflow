// Style definitions as edit targets: where a picture's styles are defined,
// setting a key in a style, and adding new styles where the document already
// keeps its styles (D34).
import type { DocumentModel } from "../model/document.ts";
import { type NodeSyntax, type OptionItem, type OptionList, type PictureSyntax, type Range, type StyleDef, styleDefs } from "../model/syntax.ts";
import type { Change } from "./changes.ts";
import { appendItem, type OptionTarget, setOption } from "./optionEdits.ts";
import { eolNear, indentAt, indentUnit, lineEnd } from "./text.ts";

/** A place where styles are defined. */
export interface StyleSite {
  where: "preamble" | "picture" | "body";
  /** "\tikzset{...}", "\tikzstyle{...}=[...]", or the picture's own options. */
  form: "tikzset" | "tikzstyle" | "options";
  range: Range;
  /** The list the definitions are items of. \tikzstyle has none. */
  list?: OptionList;
  defs: StyleDef[];
}

/**
 * Where styles that apply to picture `pic` are defined, in the order TikZ
 * reads them: the preamble before it, its own options, then \tikzset and
 * \tikzstyle at the top level of its body. Definitions inside scopes only
 * apply there, so they aren't edit targets.
 */
export function styleSites(doc: DocumentModel, pic: PictureSyntax): StyleSite[] {
  const sites: StyleSite[] = [];
  const site = (where: StyleSite["where"], item: { range: Range; defs: StyleDef[]; list?: OptionList }): StyleSite => {
    const s: StyleSite = { where, form: item.list ? "tikzset" : "tikzstyle", range: item.range, defs: item.defs };
    if (item.list) s.list = item.list;
    return s;
  };
  for (const item of doc.syntax.preamble) {
    if (item.range.from >= pic.from) break;
    if (item.kind === "styles") sites.push(site("preamble", item));
  }
  if (pic.options) {
    sites.push({ where: "picture", form: "options", range: pic.options, list: pic.options, defs: styleDefs(pic.options, doc.text).defs });
  }
  let depth = 0;
  for (const item of pic.items) {
    if (item.kind === "scope-begin") depth++;
    else if (item.kind === "scope-end") depth--;
    else if (item.kind === "styles" && depth === 0) sites.push(site("body", item));
  }
  return sites;
}

/** Names of the styles the document defines for `pic`, excluding TikZ's "every ..." styles. */
export function definedStyleNames(sites: readonly StyleSite[]): Set<string> {
  const out = new Set<string>();
  for (const s of sites) for (const d of s.defs) if (!/^every /.test(d.name)) out.add(d.name);
  return out;
}

/** Whether a definition's body is a braced or bracketed list the editor can edit. */
function editableBody(text: string, def: StyleDef): def is StyleDef & { body: OptionList } {
  if (!def.body) return false;
  const open = text[def.body.from];
  return open === "{" || open === "[";
}

/**
 * The definitions that make up style `name` now: the last one that sets it,
 * plus the appends after it. ".default" definitions are left out.
 */
export function styleChain(sites: readonly StyleSite[], name: string): StyleDef[] {
  const defs = sites.flatMap((s) => s.defs).filter((d) => d.name === name && d.defaultArg === undefined);
  let base = -1;
  defs.forEach((d, i) => {
    if (d.mode === "set") base = i;
  });
  return base < 0 ? defs : defs.slice(base);
}

/** The style as an option target: the editable bodies of its chain. */
export function styleTarget(text: string, sites: readonly StyleSite[], name: string): OptionTarget | null {
  const lists = styleChain(sites, name)
    .filter((d) => editableBody(text, d))
    .map((d) => d.body!);
  return lists.length ? { lists, keepEmpty: true } : null;
}

/**
 * Sets a key in style `name`, as setOption does for a node. Returns null if
 * the style has no body the editor can edit.
 */
export function setStyleOption(
  doc: DocumentModel,
  pic: PictureSyntax,
  name: string,
  match: (item: OptionItem) => boolean,
  itemText: string | null,
): Change[] | null {
  const target = styleTarget(doc.text, styleSites(doc, pic), name);
  return target ? setOption(doc.text, target, match, itemText) : null;
}

/** The document styles a node uses directly, in the order its options name them. */
export function nodeStyles(syn: NodeSyntax, defined: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const list of syn.options) for (const item of list.items) if (defined.has(item.key) && !out.includes(item.key)) out.push(item.key);
  return out;
}

export interface NewStyle {
  name: string;
  /** The body without braces, e.g. "draw, rounded corners". */
  body: string;
}

/**
 * The change that defines `styles` for picture `pic`, in the place the
 * document already keeps most of its styles. With none, a new \tikzset goes
 * into the preamble, or into the picture's options for a bare picture.
 */
export function addStyles(doc: DocumentModel, pic: PictureSyntax, styles: readonly NewStyle[]): Change {
  const text = doc.text;
  const sites = styleSites(doc, pic);
  const count = (s: StyleSite) => s.defs.filter((d) => d.defaultArg === undefined).length;
  let best: StyleSite | undefined;
  for (const s of sites) if (count(s) > 0 && (!best || count(s) >= count(best))) best = s;
  const eol = eolNear(text, pic.from);

  if (best?.form === "tikzstyle") {
    const last = [...sites].reverse().find((s) => s.form === "tikzstyle")!;
    const sample = text.slice(last.range.from, last.range.to);
    const braced = /^\\tikzstyle\s*\{/.test(sample);
    const spacing = /^\\tikzstyle\s*(?:\{[^}]*\}|[^=[]*?)(\s*)=(\s*)\[/.exec(sample);
    const [before, after] = spacing ? [spacing[1]!, spacing[2]!] : ["", ""];
    const indent = indentAt(text, last.range.from);
    const lines = styles.map((s) => `${eol}${indent}\\tikzstyle${braced ? `{${s.name}}` : ` ${s.name}`}${before}=${after}[${s.body}]`);
    const at = lineEnd(text, last.range.to);
    return { from: at, to: at, insert: lines.join("") };
  }
  const items = styles.map((s) => `${s.name}/.style={${s.body}}`);
  if (best?.list) return appendList(text, best.list, items);

  const before = text.slice(0, pic.from);
  const anchor = preambleAnchor(doc, pic);
  if (anchor >= 0 && /\\documentclass|\\usepackage/.test(before)) {
    const unit = indentUnit(text);
    const at = lineEnd(text, anchor);
    return { from: at, to: at, insert: `${eol}\\tikzset{${eol}${items.map((i) => unit + i).join(`,${eol}`)}${eol}}` };
  }
  if (pic.options) return appendList(text, pic.options, items);
  return { from: pic.begin.to, to: pic.begin.to, insert: `[${items.join(", ")}]` };
}

function appendList(text: string, list: OptionList, items: string[]): Change {
  const first = appendItem(text, list, items[0]!);
  if (items.length === 1) return first;
  // Later items use the separator the first one got.
  const sep = list.items.length ? first.insert.slice(0, first.insert.length - items[0]!.length) : ", ";
  return { ...first, insert: first.insert + items.slice(1).map((i) => sep + i).join("") };
}

/**
 * Where a new preamble line goes: after the last \usetikzlibrary before the
 * picture, else after \usepackage{tikz}, else after \documentclass. -1 if none.
 */
export function preambleAnchor(doc: DocumentModel, pic: PictureSyntax): number {
  let at = -1;
  for (const item of doc.syntax.preamble) {
    if (item.range.from >= pic.from) break;
    if (item.kind === "library") at = item.range.to;
  }
  if (at >= 0) return at;
  const before = doc.text.slice(0, pic.from);
  for (const m of before.matchAll(/\\usepackage\s*(\[[^\]]*\])?\s*\{[^}]*\btikz\b[^}]*\}/g)) at = m.index + m[0].length;
  if (at >= 0) return at;
  const cls = /\\documentclass\s*(\[[^\]]*\])?\s*\{[^}]*\}/.exec(before);
  return cls ? cls.index + cls[0].length : -1;
}
