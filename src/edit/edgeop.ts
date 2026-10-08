// Turning an `edge` operation into a plain `--` (D53). `(a) edge (b)` joins
// its ends directly, so it can't have corners or an orthogonal route. When the
// user explicitly asks for one of those, the edge becomes `(a) -- (b)` first:
// in place when the statement holds only that edge, otherwise in its own
// `\draw` right after the statement. The edge's own options (other than the
// ones that shape the route) move to the statement's options. The result must
// draw the same picture, apart from the route, which the edit that asked for
// the conversion decides.
import { analyzeDocument, layoutDocumentPicture } from "../model/document.ts";
import { type Edge, itemFrom, itemTo, pathEdges } from "../model/edges.ts";
import type { OptionList, PathItemSyntax } from "../model/syntax.ts";
import type { LaidOutPath, PictureLayout } from "../tikz/layout.ts";
import { applyChanges, type Change, composeChanges } from "./changes.ts";
import { type EditOutcome, findEdge } from "./edges.ts";
import { appendItem } from "./optionEdits.ts";
import { styleChain, styleSites } from "./styles.ts";
import { eolNear, indentAt, lineEnd, lineStart } from "./text.ts";
import { CURVE_KEYS, isEdgeOperation, opOptions } from "./vertices.ts";

export type ConvertOutcome = { ok: true; changes: Change[]; text: string; layout: PictureLayout; edgeId: string; moved: boolean } | { ok: false; reason: string };

const near = (a: { x: number; y: number }, b: { x: number; y: number }, eps = 0.05) => Math.hypot(a.x - b.x, a.y - b.y) <= eps;
const isHSpace = (ch: string | undefined) => ch === " " || ch === "\t";

/** How a path looks apart from its route: what a conversion to `--` must keep. */
function lookOf(p: LaidOutPath): string {
  return JSON.stringify([p.stroke, p.fill, p.lineWidth, p.dash, p.opacity, p.fillOpacity, p.tips.length]);
}

/** A path as drawn, for comparing the paths a conversion must not touch. */
function drawnOf(p: LaidOutPath): string {
  return JSON.stringify([p.d, lookOf(p), p.tips.map((t) => [Math.round(t.at.x * 100), Math.round(t.at.y * 100), Math.round(t.angle * 1000)])]);
}

/** The option lists at the start of a statement, and the index of the first item after them. */
function leading(items: readonly PathItemSyntax[]): { lists: OptionList[]; next: number } {
  const lists: OptionList[] = [];
  let k = 0;
  for (; items[k]?.kind === "options"; k++) lists.push((items[k] as { list: OptionList }).list);
  return { lists, next: k };
}

/** The items of `every edge` in the document, which an `edge` operation gets before its own options (leaving out the plain `draw`). */
function everyEdgeItems(text: string, picIndex: number): string[] {
  const doc = analyzeDocument(text);
  const pic = doc.syntax.pictures[picIndex];
  if (!pic) return [];
  const chain = styleChain(styleSites(doc, pic), "every edge");
  return chain.flatMap((d) => (d.body ? d.body.items.filter((i) => i.key !== "draw" || i.value !== undefined).map((i) => text.slice(i.from, i.to)) : []));
}

/** The change that deletes `from`..`to` and the spaces after it, and the whole line if that leaves it empty. */
function removal(text: string, from: number, to: number): Change {
  let end = to;
  while (isHSpace(text[end])) end++;
  const ls = lineStart(text, from);
  const le = lineEnd(text, end);
  if (/^[ \t]*$/.test(text.slice(ls, from)) && /^[ \t]*$/.test(text.slice(end, le)) && le < text.length) {
    return { from: ls, to: text[le] === "\r" ? le + 2 : le + 1, insert: "" };
  }
  // What is left on the line ends here (or at the ";"): don't leave spaces behind.
  if (text[end] === ";" || /^[ \t]*$/.test(text.slice(end, le))) {
    let start = from;
    while (isHSpace(text[start - 1])) start--;
    return { from: start, to: end, insert: "" };
  }
  return { from, to: end, insert: "" };
}

/** Why an edge isn't written as an `edge` operation that can be converted, or null. */
export function edgeOpBlocker(edge: Edge): string | null {
  if (!isEdgeOperation(edge)) return "This edge isn't an \"edge\" operation.";
  if (edge.lock) return `This edge can't be edited: ${edge.lock.message}.`;
  const syn = edge.path.syntax;
  if (syn.command !== "\\draw" && syn.command !== "\\path") return `A ${syn.command} statement can't be changed to a plain line without changing how it looks. Write it with "--" in the code.`;
  const start = edge.route.stops[0];
  const end = edge.route.stops[1];
  if (!start || !end || start.item < 0) return 'This edge starts at a "\\node ... edge" statement, which can\'t be rewritten.';
  if (start.relative || end.relative) return 'This edge uses relative coordinates, so it can\'t be moved to a line of its own. Write it with "--" in the code.';
  return null;
}

/**
 * Converts the `edge` operation `edgeId` into `--` (D53). The edge's curve and
 * route keys go (the edit that asked for the conversion gives it a new route);
 * its other options join the statement's. Returns the new edge's id.
 */
export function planEdgeToLine(text: string, picIndex: number, edgeId: string): ConvertOutcome {
  const doc = analyzeDocument(text);
  const layout = layoutDocumentPicture(doc, picIndex);
  const edge = layout && findEdge(layout, edgeId);
  if (!layout || !edge) return { ok: false, reason: "There is no such edge." };
  const blocked = edgeOpBlocker(edge);
  if (blocked) return { ok: false, reason: blocked };
  const syn = edge.path.syntax;
  const items = syn.items;
  const seg = edge.route.segs[0]!;
  const kw = items[seg.op];
  const start = edge.route.stops[0]!;
  const end = edge.route.stops[1]!;
  if (!kw || kw.kind !== "keyword") return { ok: false, reason: "The edge's code couldn't be found." };
  const opIdx = seg.op;
  const startIdx = start.item;
  const targetIdx = end.item;

  // What sits between "edge" and its target: its options and its labels.
  const optList = opOptions(items, opIdx);
  for (let k = opIdx + 1; k < targetIdx; k++) {
    const it = items[k]!;
    if (!(it.kind === "node" || (k === opIdx + 1 && it.kind === "options"))) return { ok: false, reason: "Part of this edge's code isn't understood, so it can't be converted. Change it in the code." };
  }
  if (optList && text.slice(optList.from, optList.to).includes("%")) return { ok: false, reason: "This edge's options have a comment in them; write it with \"--\" in the code." };
  const afterKw = optList ? optList.to : kw.range.to;
  const geometry = new Set([...CURVE_KEYS, "-|", "|-", "--"]);
  const edgeItems = optList ? optList.items.filter((i) => !geometry.has(i.key)).map((i) => text.slice(i.from, i.to)) : [];
  const between = text.slice(afterKw, itemFrom(items[targetIdx]!));
  const startText = text.slice(start.range.from, start.range.to);
  const targetText = text.slice(end.range.from, end.range.to);

  const { lists, next } = leading(items);
  const solo = startIdx === next && opIdx === startIdx + 1 && targetIdx === items.length - 1;
  // Taking the start coordinate along is only right when nothing else uses it.
  const before = items[startIdx - 1];
  const after = items[targetIdx + 1];
  const startOwned = startIdx === opIdx - 1 && (!before || before.kind === "options" || before.kind === "coord") && (!after || after.kind === "coord");

  const attempt = (every: string[]): ConvertOutcome | string => {
    const extras = [...every, ...edgeItems];
    const changes: Change[] = [];
    let expectFrom: number;
    if (solo) {
      changes.push({ from: itemFrom(kw), to: afterKw, insert: "--" });
      const last = lists[lists.length - 1];
      const cmd = syn.command === "\\path" ? "\\draw" : syn.command;
      if (last) {
        if (extras.length) changes.push(appendItem(text, last, extras.join(", ")));
        if (cmd !== syn.command) changes.push({ from: syn.keyword.from, to: syn.keyword.to, insert: cmd });
      } else changes.push({ from: syn.keyword.from, to: syn.keyword.to, insert: `${cmd}${extras.length ? `[${extras.join(", ")}]` : ""}` });
      expectFrom = syn.from;
    } else {
      changes.push(removal(text, startOwned ? itemFrom(items[startIdx]!) : itemFrom(kw), itemTo(items[targetIdx]!)));
      const opts = [...lists.flatMap((l) => l.items.map((i) => text.slice(i.from, i.to))), ...extras];
      const mid = between.trim() ? ` ${between.trim()} ` : " ";
      const statement = `\\draw${opts.length ? `[${opts.join(", ")}]` : ""} ${startText} --${mid}${targetText};`;
      const eol = eolNear(text, syn.from);
      const indent = indentAt(text, syn.from);
      const at = lineEnd(text, syn.to);
      changes.push({ from: at, to: at, insert: `${eol}${indent}${statement}` });
      const shift = changes[0]!.insert.length - (changes[0]!.to - changes[0]!.from);
      expectFrom = at + shift + eol.length + indent.length;
    }
    const newText = applyChanges(text, changes);
    const refused = "Converting this edge to \"--\" would change how it looks, so it wasn't done. Write it with \"--\" in the code.";
    const doc2 = analyzeDocument(newText);
    const layout2 = layoutDocumentPicture(doc2, picIndex);
    if (doc2.errors.length > doc.errors.length || !layout2) return refused;
    if (layout2.nodes.length !== layout.nodes.length || layout2.nodes.some((n, i) => !near(n.shape.center, layout.nodes[i]!.shape.center))) return refused;
    const np = layout2.paths.find((p) => p.syntax.from === expectFrom && !p.id.includes("/edge") && p.route && p.route.segs.length === 1);
    const ne = np && pathEdges(np, layout2)[0];
    if (!np || !ne || lookOf(np) !== lookOf(edge.path)) return refused;
    if (layout2.pathNodes.length !== layout.pathNodes.length) return refused;
    const others = (l: PictureLayout, skip: LaidOutPath) => l.paths.filter((p) => p !== skip && p.d).map(drawnOf).sort();
    if (JSON.stringify(others(layout, edge.path)) !== JSON.stringify(others(layout2, np))) return refused;
    return { ok: true, changes, text: newText, layout: layout2, edgeId: ne.id, moved: !solo };
  };

  const plain = attempt([]);
  if (typeof plain !== "string") return plain;
  // Style the edge only had from "every edge" (an arrow, a colour): write it out.
  const every = everyEdgeItems(text, picIndex);
  if (every.length) {
    const again = attempt(every);
    if (typeof again !== "string") return again;
  }
  return { ok: false, reason: plain };
}

/**
 * Runs `plan` on the edge as `--`: for an `edge` operation, converts it first
 * (D53) and makes both one edit; any other edge goes straight to `plan`. The
 * outcome says what was converted, and the edge's id afterwards.
 */
export function viaLine(text: string, picIndex: number, edge: Edge, plan: (text: string, edgeId: string) => EditOutcome): EditOutcome {
  if (!isEdgeOperation(edge)) return plan(text, edge.id);
  const c = planEdgeToLine(text, picIndex, edge.id);
  if (!c.ok) return c;
  const r = plan(c.text, c.edgeId);
  if (!r.ok) return r;
  const note = `converted the "edge" operation to "--"${c.moved ? " in a \\draw of its own" : ""}`;
  return { ...r, changes: composeChanges(text, c.changes, r.changes), notes: [note, ...r.notes], edgeId: c.edgeId };
}
