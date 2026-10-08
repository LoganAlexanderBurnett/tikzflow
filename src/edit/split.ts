// "Split into separate edges" (M2b, owner's decision after steps 1–3): a
// path with several edges, `\draw[->] (a) -- (b) -- (c);`, becomes one
// statement per edge, `\draw (a) -- (b);` and `\draw[->] (b) -- (c);`, so
// each end can be moved on its own. Arrow tips stay where they were: only the
// piece that held a tip keeps it. The picture must draw exactly as before.
import { analyzeDocument, layoutDocumentPicture } from "../model/document.ts";
import { type Edge, itemFrom, itemTo, pathEdges } from "../model/edges.ts";
import type { OptionItem, OptionList, PathItemSyntax } from "../model/syntax.ts";
import { arrowSides, isArrowKey } from "../tikz/keys.ts";
import type { LaidOutPath, PictureLayout, Route, RouteSeg } from "../tikz/layout.ts";
import type { Point } from "../tikz/shapes.ts";
import { applyChanges, type Change } from "./changes.ts";
import { findEdge } from "./edges.ts";
import { appendItem } from "./optionEdits.ts";
import { definedStyleNames, styleSites } from "./styles.ts";
import { eolNear, indentAt } from "./text.ts";

export type SplitOutcome = { ok: true; changes: Change[]; text: string; layout: PictureLayout; edgeIds: string[] } | { ok: false; reason: string };

const near = (p: Point, q: Point, eps = 0.05) => Math.hypot(p.x - q.x, p.y - q.y) <= eps;

/** The first segment of the route's last subpath: arrow tips go on the last subpath, as in TikZ. */
function lastSubpathStart(route: Route): number {
  let start = 0;
  route.segs.forEach((s, k) => {
    if (k > 0 && route.segs[k - 1]!.b !== s.a) start = k;
  });
  return start;
}

/** Which tips a path draws: at the start of its last subpath, and at its end. */
function tipsOf(path: LaidOutPath): { start: boolean; end: boolean } {
  const route = path.route!;
  const first = route.segs[lastSubpathStart(route)];
  const last = route.segs[route.segs.length - 1];
  return {
    start: !!first && path.tips.some((t) => near(t.at, first.from)),
    end: !!last && path.tips.some((t) => near(t.at, last.to)),
  };
}

/** Why a path can't be split, or null. */
export function splitBlocker(edge: Edge, layout: PictureLayout): string | null {
  if (edge.lock) return `This edge can't be edited: ${edge.lock.message}.`;
  if (edge.path.id.includes("/edge") || edge.path.syntax.command === "\\node") return "This edge is its own operation already.";
  if (pathEdges(edge.path, layout).length < 2) return "This \\draw has only one edge.";
  if (edge.path.syntax.items.some((it) => it.kind === "keyword" && it.word === "edge")) return 'This \\draw also has "edge" operations; split it in the code.';
  return null;
}

/** The option items of the leading lists ("\draw[->, thick]") and the index of the first item after them. */
function leading(items: readonly PathItemSyntax[]): { lists: OptionList[]; next: number } {
  const lists: OptionList[] = [];
  let k = 0;
  for (; items[k]?.kind === "options"; k++) lists.push((items[k] as { list: OptionList }).list);
  return { lists, next: k };
}

/**
 * Splits the path holding edge `edgeId` into one statement per edge. Returns
 * the new edges' ids in order.
 */
export function planSplit(text: string, picIndex: number, edgeId: string): SplitOutcome {
  const doc = analyzeDocument(text);
  const layout = layoutDocumentPicture(doc, picIndex);
  const pic = doc.syntax.pictures[picIndex];
  const edge = layout && findEdge(layout, edgeId);
  if (!layout || !pic || !edge) return { ok: false, reason: "There is no such edge." };
  const blocked = splitBlocker(edge, layout);
  if (blocked) return { ok: false, reason: blocked };
  const path = edge.path;
  const syn = path.syntax;
  const items = syn.items;
  const route = path.route!;
  const edges = pathEdges(path, layout);
  const { lists, next } = leading(items);

  // The arrow key, if it is written in the statement's own options. One in
  // the middle of the path can't be given to the right piece.
  const styles = definedStyleNames(styleSites(doc, pic));
  const arrowItem = (list: OptionList): OptionItem | undefined => [...list.items].reverse().find((i) => i.value === undefined && !styles.has(i.key) && isArrowKey(i.key));
  const midArrow = items.slice(next).some((it, k) => {
    const prev = items[next + k - 1];
    return it.kind === "options" && !(prev?.kind === "keyword" && (prev.word === "to" || prev.word === "edge")) && arrowItem(it.list);
  });
  if (midArrow) return { ok: false, reason: "This \\draw sets its arrow tips in the middle of the path; split it in the code." };
  let arrow: { list: OptionList; item: OptionItem } | undefined;
  for (const list of lists) {
    const item = arrowItem(list);
    if (item) arrow = { list, item };
  }
  const has = tipsOf(path);
  const tipStart = lastSubpathStart(route);
  const want = edges.map((e) => ({ start: has.start && e.segs[0] === tipStart, end: has.end && e.segs[e.segs.length - 1] === route.segs.length - 1 }));

  // The statement's head ("\draw[->] "), with the arrow key each piece needs.
  const firstItem = items[next];
  if (!firstItem) return { ok: false, reason: "This \\draw has nothing to split." };
  const headFrom = syn.from;
  const headTo = itemFrom(firstItem);
  const head = text.slice(headFrom, headTo);
  const headFor = (w: { start: boolean; end: boolean }): string | null => {
    if (w.start === has.start && w.end === has.end) return head;
    let change: Change;
    if (arrow) {
      const sides = arrowSides(arrow.item.key)!;
      const spec = `${w.start ? sides[0] : ""}-${w.end ? sides[1] : ""}`;
      change = { from: arrow.item.from, to: arrow.item.to, insert: spec };
    } else if (!w.start && !w.end) {
      // Tips from a style or the picture: "-" turns them off for this piece.
      const list = lists[lists.length - 1];
      change = list ? appendItem(text, list, "-") : { from: syn.keyword.to, to: syn.keyword.to, insert: "[-]" };
    } else return null;
    return applyChanges(head, [{ from: change.from - headFrom, to: change.to - headFrom, insert: change.insert }]);
  };

  // Each edge's code: from its start to its end and the nodes right after the
  // end (they sit on the segment that ends there). A shared start is written again.
  const trailEnd = (item: number): number => {
    let k = item;
    while (items[k + 1]?.kind === "node") k++;
    return k;
  };
  const pieces: string[] = [];
  let cursor = next;
  for (let k = 0; k < edges.length; k++) {
    const e = edges[k]!;
    const startItem = route.stops[e.from]!.item;
    const endItem = route.stops[e.to]!.item;
    const last = k === edges.length - 1;
    const bodyEnd = last ? items.length - 1 : trailEnd(endItem);
    let prefix = "";
    let bodyStart = cursor;
    if (e.sharedStart) {
      const it = items[startItem]!;
      prefix = `${text.slice(itemFrom(it), itemTo(it))} `;
      bodyStart = trailEnd(startItem) + 1;
    }
    const h = headFor(want[k]!);
    if (h === null) return { ok: false, reason: "The arrow tips come from a style, so the pieces can't each keep the right tip. Split it in the code." };
    const body = text.slice(itemFrom(items[bodyStart]!), itemTo(items[bodyEnd]!));
    pieces.push(`${h}${prefix}${body};`);
    cursor = bodyEnd + 1;
  }
  const eol = eolNear(text, syn.from);
  const indent = indentAt(text, syn.from);
  const insert = pieces.join(`${eol}${indent}`);
  const changes: Change[] = [{ from: syn.from, to: syn.to, insert }];
  const next2 = applyChanges(text, changes);

  // The picture must draw exactly as before.
  const refused = { ok: false as const, reason: "Splitting this \\draw would change how it looks, so it wasn't done. Split it in the code." };
  const doc2 = analyzeDocument(next2);
  const layout2 = layoutDocumentPicture(doc2, picIndex);
  if (doc2.errors.length > doc.errors.length || !layout2) return refused;
  if (layout2.nodes.length !== layout.nodes.length || layout2.nodes.some((n, i) => !near(n.shape.center, layout.nodes[i]!.shape.center))) return refused;
  const inside = (p: LaidOutPath, from: number, to: number) => p.syntax.from >= from && p.syntax.to <= to;
  const outsideOld = layout.paths.filter((p) => !inside(p, syn.from, syn.to)).map((p) => p.d);
  const outsideNew = layout2.paths.filter((p) => !inside(p, syn.from, syn.from + insert.length)).map((p) => p.d);
  if (JSON.stringify(outsideOld) !== JSON.stringify(outsideNew)) return refused;
  const newPaths = layout2.paths.filter((p) => inside(p, syn.from, syn.from + insert.length));
  if (newPaths.length !== edges.length) return refused;
  const segsMatch = (a: RouteSeg, b: RouteSeg) => a.kind === b.kind && near(a.from, b.from) && near(a.to, b.to) && (!a.c1 || near(a.c1, b.c1!)) && (!a.c2 || near(a.c2, b.c2!));
  const edgeIds: string[] = [];
  for (let k = 0; k < edges.length; k++) {
    const p = newPaths[k]!;
    const [ne] = pathEdges(p, layout2);
    const old = edges[k]!;
    if (!ne || ne.segs.length !== old.segs.length || old.segs.some((s, i) => !segsMatch(route.segs[s]!, ne.route.segs[ne.segs[i]!]!))) return refused;
    if (p.lineWidth !== path.lineWidth || JSON.stringify(p.stroke) !== JSON.stringify(path.stroke) || JSON.stringify(p.dash) !== JSON.stringify(path.dash) || p.opacity !== path.opacity) return refused;
    edgeIds.push(ne.id);
  }
  const tipsOld = path.tips;
  const tipsNew = newPaths.flatMap((p) => p.tips);
  if (tipsOld.length !== tipsNew.length || tipsOld.some((t) => !tipsNew.some((u) => near(t.at, u.at) && Math.abs(Math.sin(t.angle - u.angle)) < 1e-3 && Math.cos(t.angle - u.angle) > 0))) return refused;
  const labels = (l: PictureLayout, from: number, to: number) => l.pathNodes.filter((n) => n.statement.from >= from && n.statement.to <= to).map((n) => n.shape.center);
  const labelsOld = labels(layout, syn.from, syn.to);
  const labelsNew = labels(layout2, syn.from, syn.from + insert.length);
  if (labelsOld.length !== labelsNew.length || labelsOld.some((p, i) => !near(p, labelsNew[i]!))) return refused;
  return { ok: true, changes, text: next2, layout: layout2, edgeIds };
}
