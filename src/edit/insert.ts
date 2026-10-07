// Inserting new statements into a picture body. New nodes go after the
// picture's existing nodes and new edges after its existing paths, the way
// hand-written flowcharts are laid out, always at the top level (never inside
// a scope or layer, whose options would apply to them). Nothing is inserted
// right after a statement with a syntax error: an unclosed brace there would
// swallow the new code.
import type { DocumentModel } from "../model/document.ts";
import type { BodyItem, PictureSyntax, Range } from "../model/syntax.ts";
import type { Change } from "./changes.ts";
import { eolNear, indentAt, indentUnit, lineEnd, restOfLineBlank } from "./text.ts";

interface TopItem {
  range: Range;
  hasNodes: boolean;
  hasPaths: boolean;
  /** Contains a syntax error, so nothing may go right after it. */
  broken: boolean;
}

/** Positions of syntax errors inside `pic`. */
function errorPositions(doc: DocumentModel, pic: PictureSyntax): number[] {
  const out: number[] = [];
  doc.tree.iterate({
    from: pic.from,
    to: pic.to,
    enter: (n) => {
      if (n.type.isError) out.push(n.from);
    },
  });
  return out;
}

export function itemRange(item: BodyItem): Range {
  return item.kind === "node" ? item.node : item.kind === "path" ? item.path : item.range;
}

/** The picture's top-level items. A scope or environment counts as one item covering its whole content. */
function topLevel(doc: DocumentModel, pic: PictureSyntax): TopItem[] {
  const errors = errorPositions(doc, pic);
  const out: TopItem[] = [];
  let depth = 0;
  let group: TopItem | null = null;
  const add = (range: Range, hasNodes: boolean, hasPaths: boolean) => {
    if (group) {
      group.range = { from: group.range.from, to: range.to };
      group.hasNodes ||= hasNodes;
      group.hasPaths ||= hasPaths;
    } else out.push({ range, hasNodes, hasPaths, broken: false });
  };
  for (const item of pic.items) {
    const opens = item.kind === "scope-begin" || (item.kind === "opaque" && item.reason === "environment" && /^\\begin\b/.test(item.text));
    const closes = item.kind === "scope-end" || (item.kind === "opaque" && item.reason === "environment" && /^\\end\b/.test(item.text));
    if (opens) {
      if (depth++ === 0) group = { range: { ...item.range }, hasNodes: false, hasPaths: false, broken: false };
      else add(item.range, false, false);
      continue;
    }
    if (closes) {
      add(item.range, false, false);
      if (--depth <= 0 && group) {
        out.push(group);
        group = null;
        depth = 0;
      }
      continue;
    }
    switch (item.kind) {
      case "node":
        add(item.node, true, !!item.trailing);
        break;
      case "path":
        add(item.path, false, true);
        break;
      case "opaque":
        add(item.range, item.reason === "matrix" || item.reason === "foreach", item.reason === "foreach");
        break;
      default:
        add(item.range, false, false);
    }
  }
  if (group) out.push(group);
  for (const t of out) t.broken = errors.some((e) => e >= t.range.from && e <= t.range.to);
  return out;
}

/** Where a statement goes: after position `pos`, indented like the line at `indentFrom`. */
export interface Anchor {
  pos: number;
  indentFrom: number | null;
}

function bodyStart(pic: PictureSyntax): Anchor {
  return { pos: pic.options?.to ?? pic.begin.to, indentFrom: null };
}

/**
 * Where a new node goes: after the last top-level item holding nodes, and
 * after position `after` if given. Null if the item it must follow has a
 * syntax error.
 */
export function nodeAnchor(doc: DocumentModel, pic: PictureSyntax, after?: number): Anchor | null {
  const tops = topLevel(doc, pic);
  let anchor = [...tops].reverse().find((t) => t.hasNodes && !t.broken);
  if (after !== undefined) {
    const holder = tops.find((t) => t.range.from < after && after <= t.range.to);
    if (holder?.broken) return null;
    if (holder && (!anchor || anchor.range.to < holder.range.to)) anchor = holder;
  }
  if (!anchor) {
    // Before the first path, or at the start of the body.
    const firstPath = tops.findIndex((t) => t.hasPaths);
    const prev = (firstPath >= 0 ? tops.slice(0, firstPath) : tops).filter((t) => !t.broken).pop();
    if (prev) return { pos: prev.range.to, indentFrom: prev.range.from };
    return firstPath >= 0 ? { ...bodyStart(pic), indentFrom: tops[firstPath]!.range.from } : bodyStart(pic);
  }
  return { pos: anchor.range.to, indentFrom: anchor.range.from };
}

/** Where a new path goes: after the last top-level item holding paths, but never before `after`. */
export function pathAnchor(doc: DocumentModel, pic: PictureSyntax, after: Anchor): Anchor {
  const last = [...topLevel(doc, pic)].reverse().find((t) => t.hasPaths && !t.broken);
  if (!last || last.range.to < after.pos) return after;
  return { pos: last.range.to, indentFrom: last.range.from };
}

/**
 * The change that inserts `statements` at `anchor`, each on its own line
 * with the anchor line's indentation and the file's line ending. If other
 * code follows on the anchor's line, they go on that line instead.
 */
export function insertStatements(text: string, pic: PictureSyntax, anchor: Anchor, statements: readonly string[]): Change {
  const eol = eolNear(text, pic.from);
  let indent: string;
  if (anchor.indentFrom !== null) indent = indentAt(text, anchor.indentFrom);
  else {
    const firstItem = pic.items[0];
    const first = firstItem && itemRange(firstItem);
    const ownLine = first && text.slice(anchor.pos, first.from).includes("\n");
    indent = first && ownLine ? indentAt(text, first.from) : indentAt(text, pic.begin.from) + indentUnit(text);
  }
  if (restOfLineBlank(text, anchor.pos)) {
    const at = lineEnd(text, anchor.pos);
    return { from: at, to: at, insert: statements.map((s) => eol + indent + s).join("") };
  }
  return { from: anchor.pos, to: anchor.pos, insert: statements.map((s) => ` ${s}`).join("") };
}
