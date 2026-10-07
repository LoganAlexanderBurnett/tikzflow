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
    if (after !== undefined && (next === undefined ? after < list.to - 1 : after < next.from)) {
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
  // Reuse the separator the list already uses, if it is on one line.
  let sep = ", ";
  const firstComma = list.commas[0];
  if (firstComma !== undefined) {
    const nextItem = list.items.find((i) => i.from > firstComma);
    if (nextItem) {
      const s = text.slice(firstComma, nextItem.from);
      if (!s.includes("%")) sep = s;
    }
  }
  return { from: last.to, to: last.to, insert: sep + itemText };
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
