// Text changes: the only way visual edits touch the source. Each change
// replaces one range; a set of changes never overlaps.

export interface Change {
  from: number;
  to: number;
  insert: string;
}

/** Applies non-overlapping changes, given in any order. */
export function applyChanges(text: string, changes: readonly Change[]): string {
  const sorted = [...changes].sort((a, b) => a.from - b.from || a.to - b.to);
  let out = "";
  let pos = 0;
  for (const c of sorted) {
    if (c.from < pos) throw new Error(`overlapping changes at ${c.from}`);
    out += text.slice(pos, c.from) + c.insert;
    pos = c.to;
  }
  return out + text.slice(pos);
}

/** The smallest range [from, to) of `before` that differs from `after`, and its replacement. */
export function diffRange(before: string, after: string): Change | null {
  if (before === after) return null;
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endB = before.length;
  let endA = after.length;
  while (endB > start && endA > start && before[endB - 1] === after[endA - 1]) {
    endB--;
    endA--;
  }
  return { from: start, to: endB, insert: after.slice(start, endA) };
}
