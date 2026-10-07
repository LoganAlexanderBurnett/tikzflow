// Node references in a picture's code, and the ones that don't resolve. This
// reads the code itself rather than the layout, so a path that stops drawing
// at its first bad coordinate still reports the others (D36).
import { mayBeOpaqueName, type PictureLayout } from "../tikz/layout.ts";
import { looksLikeNodeRef } from "../tikz/coords.ts";
import type { NodeSyntax, PathSyntax, PictureSyntax, Range } from "./syntax.ts";

export interface NameRef {
  /** The name as written, with any anchor removed. */
  name: string;
  /** The whole name with its anchor ("a.north"), for names that contain dots. */
  full: string;
  /** The coordinate or option the reference is in. */
  range: Range;
  /** Where the name itself is, when known. */
  nameRange?: Range;
  /** The statement it belongs to. */
  statement: Range;
  in: "node" | "path";
}

/** Names TikZ defines itself. */
const BUILTIN = /^(current bounding box|current path bounding box|current page|current page text area)$/;

/** Index of `needle` outside (), [], {} and $...$, or -1. */
function topLevel(s: string, needle: string): number {
  let depth = 0;
  let math = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (depth === 0 && !math && s.startsWith(needle, i)) return i;
    if (ch === "\\") i++;
    else if (ch === "$") math = !math;
    else if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
  }
  return -1;
}

/** The groups in balanced parentheses in `s`: "(a) (b.east)" gives ["a", "b.east"], with offsets. */
function parenGroups(s: string): Array<{ text: string; at: number }> {
  const out: Array<{ text: string; at: number }> = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\") i++;
    else if (ch === "(") {
      if (depth++ === 0) start = i + 1;
    } else if (ch === ")" && depth > 0 && --depth === 0) out.push({ text: s.slice(start, i), at: start });
  }
  return out;
}

/**
 * Node names referred to by the text inside a coordinate's parentheses, with
 * their offsets in it: "a.north" gives a; "a |- b" gives a and b;
 * "$(a)!0.5!(b)$" gives a and b; numbers and polar coordinates give nothing.
 */
export function coordNames(inner: string): Array<{ name: string; full: string; at: number }> {
  let t = inner;
  let base = 0;
  const lead = /^\s*/.exec(t)![0].length;
  t = t.slice(lead);
  base += lead;
  // Options in front: "[xshift=2mm] a.east".
  if (t.startsWith("[")) {
    const close = topLevel(t.slice(1), "]");
    if (close < 0) return [];
    base += close + 2;
    t = t.slice(close + 2);
  }
  if (t.includes("$")) {
    return parenGroups(t).flatMap((g) => coordNames(g.text).map((r) => ({ ...r, at: r.at + base + g.at })));
  }
  for (const op of ["|-", "-|"]) {
    const i = topLevel(t, op);
    if (i >= 0) {
      return [...coordNames(t.slice(0, i)).map((r) => ({ ...r, at: r.at + base })), ...coordNames(t.slice(i + 2)).map((r) => ({ ...r, at: r.at + base + i + 2 }))];
    }
  }
  const full = t.trim();
  if (!full || /[\\#]/.test(full) || !looksLikeNodeRef(full)) return [];
  const dot = full.lastIndexOf(".");
  const name = dot > 0 ? full.slice(0, dot).trim() : full;
  return [{ name, full, at: base }];
}

/** References in a node's "at" clause and placement options. */
function nodeRefs(text: string, n: NodeSyntax, statement: Range, kind: NameRef["in"], out: NameRef[]): void {
  const push = (inner: string, innerFrom: number, range: Range) => {
    for (const r of coordNames(inner)) {
      out.push({ name: r.name, full: r.full, range, nameRange: { from: innerFrom + r.at, to: innerFrom + r.at + r.name.length }, statement, in: kind });
    }
  };
  if (n.at) push(text.slice(n.at.coord.inner.from, n.at.coord.inner.to), n.at.coord.inner.from, n.at.coord);
  for (const list of n.options) {
    for (const item of list.items) {
      if (item.value === undefined || !item.valueRange) continue;
      const raw = text.slice(item.valueRange.from, item.valueRange.to);
      const vFrom = item.valueRange.from;
      if (/ of$/.test(item.key) || item.key === "at" || item.key === "fit") {
        // "below of=a", "at=(a.east)", "fit=(a) (b)".
        const groups = parenGroups(raw);
        if (groups.length) for (const g of groups) push(g.text, vFrom + g.at, item);
        else if (item.key !== "fit") push(raw.replace(/^\{|\}$/g, " "), vFrom, item);
      } else if (/^(above|below|left|right|above left|above right|below left|below right|base left|base right|mid left|mid right)$/.test(item.key)) {
        // "below=1cm of a".
        const m = /(^|\s)of\s+/.exec(raw);
        if (m) {
          const at = m.index + m[0].length;
          push(raw.slice(at).replace(/\}$/, ""), vFrom + at, item);
        }
      }
    }
  }
}

function pathRefs(text: string, p: PathSyntax, statement: Range, out: NameRef[]): void {
  for (const it of p.items) {
    if (it.kind === "coord") {
      for (const r of coordNames(text.slice(it.coord.inner.from, it.coord.inner.to))) {
        const from = it.coord.inner.from + r.at;
        out.push({ name: r.name, full: r.full, range: it.coord, nameRange: { from, to: from + r.name.length }, statement, in: "path" });
      }
    } else if (it.kind === "node") nodeRefs(text, it.node, statement, "path", out);
  }
}

/** Every node reference in the picture's modelled code, in source order. */
export function pictureReferences(text: string, pic: PictureSyntax): NameRef[] {
  const out: NameRef[] = [];
  for (const item of pic.items) {
    if (item.kind === "node") {
      const statement = { from: item.node.from, to: item.trailing?.to ?? item.node.to };
      nodeRefs(text, item.node, statement, "node", out);
      if (item.trailing) pathRefs(text, item.trailing, statement, out);
    } else if (item.kind === "path") pathRefs(text, item.path, { from: item.path.from, to: item.path.to }, out);
  }
  return out;
}

/**
 * Ids of \coordinate nodes that nothing in the picture refers to. A name
 * counts as used if it appears anywhere in the picture outside its own
 * statement, so code the editor keeps as-is counts too.
 */
export function unusedCoordinates(text: string, pic: PictureSyntax, layout: PictureLayout): Set<string> {
  const out = new Set<string>();
  const picText = text.slice(pic.from, pic.to);
  // Other pictures may use the names of a "remember picture" one.
  if (/remember picture/.test(picText.slice(0, (pic.options?.to ?? pic.begin.to) - pic.from))) return out;
  const edge = /[A-Za-z0-9_-]/;
  for (const n of layout.nodes) {
    if (n.kind !== "coordinate" || !n.name) continue;
    let used = false;
    for (let i = picText.indexOf(n.name); i >= 0 && !used; i = picText.indexOf(n.name, i + 1)) {
      const at = pic.from + i;
      if (at >= n.statement.from && at < n.statement.to) continue;
      used = !edge.test(picText[i - 1] ?? "") && !edge.test(picText[i + n.name.length] ?? "");
    }
    if (!used) out.add(n.id);
  }
  return out;
}

export interface UnresolvedRef {
  name: string;
  /** "undefined": no such name in the picture; "later": only defined after the reference. */
  kind: "undefined" | "later";
  refs: NameRef[];
}

/**
 * Where each name is first defined in the picture, by source position: names
 * the layout placed, and names written in the code, which covers nodes on a
 * path that stopped drawing early.
 */
function definitions(pic: PictureSyntax, layout: PictureLayout): Map<string, number> {
  const out = new Map<string, number>();
  const add = (name: string | undefined, at: number) => {
    if (name && (out.get(name) ?? Infinity) > at) out.set(name, at);
  };
  for (const n of [...layout.nodes, ...layout.pathNodes]) add(n.name, n.syntax.from);
  const fromSyntax = (n: NodeSyntax) => {
    add(n.name?.text.trim(), n.from);
    for (const list of n.options) for (const i of list.items) if (i.key === "name" && i.value) add(i.value.trim(), n.from);
  };
  const fromPath = (p: PathSyntax) => {
    for (const it of p.items) if (it.kind === "node") fromSyntax(it.node);
  };
  for (const item of pic.items) {
    if (item.kind === "node") {
      fromSyntax(item.node);
      if (item.trailing) fromPath(item.trailing);
    } else if (item.kind === "path") fromPath(item.path);
  }
  return out;
}

/**
 * References that LaTeX would reject too: names the picture never defines, or
 * only defines after the reference. Names that might come from code the
 * editor keeps as-is (a \foreach, a pic) are never reported, and neither is a
 * picture with "remember picture", whose names may live in another picture.
 */
export function unresolvedReferences(text: string, pic: PictureSyntax, layout: PictureLayout): UnresolvedRef[] {
  if (pic.options && /remember picture/.test(text.slice(pic.options.from, pic.options.to))) return [];
  const defs = definitions(pic, layout);
  // Keys like "append after command" can make nodes named after others ("h-rho").
  const madeByKeys = /append after command|late options/.test(text);
  const opaqueText = layout.opaque.map((o) => text.slice(o.range.from, o.range.to)).join("\n");
  const picText = text.slice(pic.from, pic.to);
  const byName = new Map<string, UnresolvedRef>();
  for (const r of pictureReferences(text, pic)) {
    if (BUILTIN.test(r.name) || layout.boxes.has(r.name)) continue;
    if (mayBeOpaqueName(layout, r.name) || opaqueText.includes(r.name)) continue;
    if (/^intersection-\d+$/.test(r.name) && /name intersections/.test(picText)) continue;
    if (madeByKeys && r.name.split("-").some((part) => defs.has(part))) continue;
    // A name with dots in it ("a.b") may be the whole name rather than a.b's anchor.
    const at = r.full !== r.name && defs.has(r.full) ? defs.get(r.full) : defs.get(r.name);
    if (at !== undefined && at < r.range.from) continue;
    const kind = at === undefined ? "undefined" : "later";
    const entry = byName.get(r.name) ?? { name: r.name, kind, refs: [] };
    entry.refs.push(r);
    byName.set(r.name, entry);
  }
  return [...byName.values()];
}
