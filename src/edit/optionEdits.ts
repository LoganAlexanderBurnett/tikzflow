// Minimal edits to option lists and node clauses. Edits never remove
// comments or text outside the items they are about.
import type { NodeSyntax, OptionItem, OptionList } from "../model/syntax.ts";
import type { Change } from "./changes.ts";

const isHSpace = (ch: string | undefined) => ch === " " || ch === "\t";

function lineStart(text: string, pos: number): number {
  return text.lastIndexOf("\n", pos - 1) + 1;
}

function lineEnd(text: string, pos: number): number {
  const i = text.indexOf("\n", pos);
  return i < 0 ? text.length : i;
}

/**
 * Removes `remove` from `list`. Each item goes with one neighbouring comma.
 * If an item was alone on its line, the whole line goes. If every item goes,
 * the list's brackets go too.
 */
export function removeItems(text: string, list: OptionList, remove: readonly OptionItem[]): Change[] {
  if (!remove.length) return [];
  const removed = new Set(remove.map((i) => i.from));
  if (list.items.every((i) => removed.has(i.from))) return removeList(text, list);
  const changes: Change[] = [];
  const commaAfter = (item: OptionItem) => list.commas.find((c) => c >= item.to);
  const commaBefore = (item: OptionItem) => [...list.commas].reverse().find((c) => c < item.from);
  const items = list.items;
  for (let k = 0; k < items.length; k++) {
    const item = items[k]!;
    if (!removed.has(item.from)) continue;
    const next = items.slice(k + 1).find((i) => !removed.has(i.from));
    const after = commaAfter(item);
    let from = item.from;
    let to = item.to;
    // With no item kept after it, it's the last item now, so it takes the comma before it.
    if (after !== undefined && next !== undefined && after < next.from) {
      // Take the comma after the item and spaces up to the next item on the same line.
      to = after + 1;
      while (isHSpace(text[to])) to++;
    } else {
      // Last item: take the comma before it instead, and spaces after that comma.
      const before = commaBefore(item);
      if (before !== undefined) {
        // Keep anything between the comma and the item if it holds a comment.
        if (text.slice(before + 1, item.from).includes("%")) changes.push({ from: before, to: before + 1, insert: "" });
        else from = before;
      }
    }
    // A line that only held this item disappears entirely.
    const ls = lineStart(text, item.from);
    const le = lineEnd(text, to);
    if (/^[ \t]*$/.test(text.slice(ls, item.from)) && /^[ \t]*$/.test(text.slice(to, le)) && le < text.length && ls > list.from) {
      from = ls;
      to = le + 1;
    }
    changes.push({ from, to, insert: "" });
  }
  return mergeAdjacent(changes);
}

/**
 * Removes a whole option list, and a space it would leave doubled:
 * "\node [x] (b)" and "\node[x] (b)" both become "\node (b)".
 */
export function removeList(text: string, list: OptionList): Change[] {
  let from = list.from;
  const to = list.to;
  if (isHSpace(text[from - 1]) && (isHSpace(text[to]) || text[to] === "\n")) {
    while (isHSpace(text[from - 1])) from--;
  } else if (!isHSpace(text[from - 1]) && !isHSpace(text[to]) && text[to] !== "\n") {
    // "\node[x](b)": keep the words apart.
    return [{ from, to, insert: " " }];
  }
  return [{ from, to, insert: "" }];
}

function mergeAdjacent(changes: Change[]): Change[] {
  const sorted = changes.sort((a, b) => a.from - b.from);
  const out: Change[] = [];
  for (const c of sorted) {
    const prev = out[out.length - 1];
    if (prev && c.from <= prev.to) {
      prev.to = Math.max(prev.to, c.to);
      prev.insert += c.insert;
    } else out.push({ ...c });
  }
  return out;
}

/** Appends `itemText` to the end of a list, matching its separator style. */
export function appendItem(text: string, list: OptionList, itemText: string): Change {
  const last = list.items[list.items.length - 1];
  if (!last) return { from: list.from + 1, to: list.to - 1, insert: itemText };
  return { from: last.to, to: last.to, insert: separatorOf(text, list) + itemText };
}

/**
 * The separator a list uses between items: the text from its first comma to
 * the next item. A one-item list laid out one item per line ("{\n  a\n}")
 * gets a comma plus the first item's indentation.
 */
function separatorOf(text: string, list: OptionList): string {
  const firstComma = list.commas[0];
  if (firstComma !== undefined) {
    const nextItem = list.items.find((i) => i.from > firstComma);
    if (nextItem) {
      const s = text.slice(firstComma, nextItem.from);
      if (!s.includes("%")) return s;
    }
  }
  const first = list.items[0];
  if (first) {
    const before = text.slice(list.from + 1, first.from);
    const nl = before.lastIndexOf("\n");
    if (nl >= 0 && /^[ \t]*$/.test(before.slice(nl + 1))) {
      const breakAt = before[nl - 1] === "\r" ? nl - 1 : nl;
      return `,${before.slice(breakAt)}`;
    }
  }
  return ", ";
}

/**
 * "key" or "key=value". Values that contain top-level commas, "=" or square
 * brackets get braces so they stay one item.
 */
export function formatOption(key: string, value?: string): string {
  if (value === undefined) return key;
  let depth = 0;
  let needsBraces = /^\s|\s$/.test(value);
  for (let i = 0; i < value.length && !needsBraces; i++) {
    const ch = value[i];
    if (ch === "\\") i++;
    else if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (depth === 0 && (ch === "," || ch === "=" || ch === "[" || ch === "]")) needsBraces = true;
  }
  return `${key}=${needsBraces ? `{${value}}` : value}`;
}

/** Something with option lists that edits can set keys in: a node, a style body, a picture. */
export interface OptionTarget {
  lists: readonly OptionList[];
  /** The change that adds a first list holding `itemText`, for targets that may have none. */
  addList?: (itemText: string) => Change;
  /** Style bodies keep their braces when emptied: "name/.style={}". */
  keepEmpty?: boolean;
}

export function nodeTarget(syn: NodeSyntax): OptionTarget {
  return { lists: syn.options, addList: (t) => addOptionList(syn, t) };
}

/** Items of `target` that `match` accepts, with their lists, in source order. */
export function findItems(target: OptionTarget, match: (item: OptionItem) => boolean): Array<{ list: OptionList; item: OptionItem }> {
  return target.lists.flatMap((list) => list.items.filter(match).map((item) => ({ list, item })));
}

/**
 * Sets an option: the last item `match` accepts is replaced by `itemText`
 * (later keys win in TikZ, so that's the one in effect); with none, `itemText`
 * is appended to the last list. `itemText` null removes every matching item.
 * Returns null when the edit can't be made safely: the item uses a style
 * argument (#1), or there's no list to add to.
 */
export function setOption(text: string, target: OptionTarget, match: (item: OptionItem) => boolean, itemText: string | null): Change[] | null {
  const found = findItems(target, match);
  if (found.some((f) => text.slice(f.item.from, f.item.to).includes("#"))) return null;
  if (itemText === null) {
    const changes: Change[] = [];
    for (const list of target.lists) {
      const items = found.filter((f) => f.list === list).map((f) => f.item);
      if (!items.length) continue;
      if (target.keepEmpty && items.length === list.items.length) {
        changes.push({ from: list.items[0]!.from, to: list.items[list.items.length - 1]!.to, insert: "" });
      } else changes.push(...removeItems(text, list, items));
    }
    return changes;
  }
  const last = found[found.length - 1];
  if (last) return [{ from: last.item.from, to: last.item.to, insert: itemText }];
  const list = target.lists[target.lists.length - 1];
  if (list) return [appendItem(text, list, itemText)];
  return target.addList ? [target.addList(itemText)] : null;
}

/** Inserts "[itemText]" right after the node keyword. */
export function addOptionList(syn: NodeSyntax, itemText: string): Change {
  return { from: syn.keyword.to, to: syn.keyword.to, insert: `[${itemText}]` };
}

/** Removes " at (...)" from a node. */
export function removeAtClause(text: string, syn: NodeSyntax): Change | null {
  if (!syn.at) return null;
  let { from, to } = syn.at.range;
  if (isHSpace(text[from - 1])) {
    while (isHSpace(text[from - 1])) from--;
  } else {
    while (isHSpace(text[to])) to++;
  }
  return { from, to, insert: "" };
}

/** Sets the coordinate of a node's "at" clause, adding the clause if needed. */
export function setAtClause(syn: NodeSyntax, coordText: string): Change {
  if (syn.at) return { from: syn.at.coord.inner.from, to: syn.at.coord.inner.to, insert: coordText };
  if (syn.name) return { from: syn.name.range.to, to: syn.name.range.to, insert: ` at (${coordText})` };
  const lastList = syn.options[syn.options.length - 1];
  if (lastList) return { from: lastList.to, to: lastList.to, insert: ` at (${coordText})` };
  return { from: syn.keyword.to, to: syn.keyword.to, insert: ` at (${coordText})` };
}
