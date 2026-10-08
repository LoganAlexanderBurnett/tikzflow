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

/**
 * Two edits in a row as one: `first` applies to `base`, `second` to the text
 * that results. The returned changes apply to `base` and give the same text,
 * so both can be undone together. Changes that touch each other are merged
 * into one; the rest stay apart. (Not CodeMirror's ChangeSet: it counts a CRLF
 * line break as one character, which our positions don't.)
 */
export function composeChanges(base: string, first: readonly Change[], second: readonly Change[]): Change[] {
  const afterFirst = applyChanges(base, first);
  const byPos = (x: Change, y: Change) => x.from - y.from || x.to - y.to;
  interface Group {
    aFrom: number; // range in the text after `first`
    aTo: number;
    bFrom: number; // the same range in `base`
    bTo: number;
    seconds: Change[];
  }
  const regions: Group[] = [];
  let shift = 0;
  for (const c of [...first].sort(byPos)) {
    const aFrom = c.from + shift;
    regions.push({ aFrom, aTo: aFrom + c.insert.length, bFrom: c.from, bTo: c.to, seconds: [] });
    shift += c.insert.length - (c.to - c.from);
  }
  /** A position after `first`, in `base`. Inside a region any position of it will do, because the group merges with the region. */
  const toBase = (p: number): number => {
    let delta = 0;
    for (const r of regions) {
      if (r.aTo <= p) delta += r.aTo - r.aFrom - (r.bTo - r.bFrom);
      else if (r.aFrom < p) return r.bFrom;
    }
    return p - delta;
  };
  const groups: Group[] = [
    ...regions,
    ...second.map((c) => ({ aFrom: c.from, aTo: c.to, bFrom: toBase(c.from), bTo: toBase(c.to), seconds: [c] })),
  ].sort((x, y) => x.aFrom - y.aFrom || x.aTo - y.aTo);
  const merged: Group[] = [];
  for (const g of groups) {
    const prev = merged[merged.length - 1];
    if (prev && g.aFrom <= prev.aTo) {
      prev.aTo = Math.max(prev.aTo, g.aTo);
      prev.bFrom = Math.min(prev.bFrom, g.bFrom);
      prev.bTo = Math.max(prev.bTo, g.bTo);
      prev.seconds.push(...g.seconds);
    } else merged.push({ ...g, seconds: [...g.seconds] });
  }
  return merged.map((g) => ({
    from: g.bFrom,
    to: g.bTo,
    insert: applyChanges(
      afterFirst.slice(g.aFrom, g.aTo),
      g.seconds.map((c) => ({ from: c.from - g.aFrom, to: c.to - g.aFrom, insert: c.insert })),
    ),
  }));
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
