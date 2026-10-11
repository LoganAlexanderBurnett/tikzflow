// An imported graph as TikZ that reads as hand-written (M4 step 5, D84): a
// standalone document with the libraries it uses, named styles in \tikzset
// (one per shape used, one per Mermaid class), meaningful node names, one
// \node per node and one \draw per edge, and groups as `fit` nodes on the
// background layer. Nodes are written in an order that lets each follow a node
// before it, and each gets a rough place; the auto-layout then rewrites those
// places as relations (`index.ts`).
import { GROUP_STYLES } from "../edit/lanes.ts";
import { baseName, nameStyle, newNodeName } from "../edit/names.ts";
import { type ImportGraph, type ImportNode, type Look, type NodeShape, type Rgb, type Tip } from "./graph.ts";
import { TIKZ_KEY_NAMES } from "../tikz/tikzkeys.ts";

/** Style bodies per shape; `fill` is the pastel fill Mermaid-style charts get (Graphviz draws white nodes). */
const SHAPE_STYLES: Record<NodeShape, { body: (fill: boolean) => string; libraries: string[] }> = {
  process: { body: (f) => `base${f ? ", fill=blue!8" : ""}`, libraries: [] },
  rounded: { body: (f) => `base, rounded corners=2mm${f ? ", fill=blue!8" : ""}`, libraries: [] },
  terminal: { body: (f) => `base, rounded corners=4.5mm${f ? ", fill=teal!15" : ""}`, libraries: [] },
  subroutine: { body: (f) => `base, double, double distance=1pt${f ? ", fill=blue!8" : ""}`, libraries: [] },
  database: { body: (f) => `base, cylinder, shape border rotate=90, aspect=0.25${f ? ", fill=gray!12" : ""}`, libraries: ["shapes.geometric"] },
  circle: { body: (f) => `draw, thick, circle, inner sep=2pt, minimum size=9mm, align=center${f ? ", fill=blue!8" : ""}`, libraries: [] },
  doublecircle: { body: (f) => `draw, thick, circle, double, double distance=1pt, inner sep=2pt, minimum size=9mm, align=center${f ? ", fill=blue!8" : ""}`, libraries: [] },
  decision: { body: (f) => `base, diamond, aspect=2.2, inner sep=1pt${f ? ", fill=orange!15" : ""}`, libraries: ["shapes.geometric"] },
  hexagon: { body: (f) => `draw, thick, regular polygon, regular polygon sides=6, inner sep=2pt, align=center${f ? ", fill=blue!8" : ""}`, libraries: ["shapes.geometric"] },
  io: { body: (f) => `base, trapezium, trapezium left angle=70, trapezium right angle=110${f ? ", fill=gray!12" : ""}`, libraries: ["shapes.geometric"] },
  "io alt": { body: (f) => `base, trapezium, trapezium left angle=110, trapezium right angle=70${f ? ", fill=gray!12" : ""}`, libraries: ["shapes.geometric"] },
  trapez: { body: (f) => `base, trapezium${f ? ", fill=gray!12" : ""}`, libraries: ["shapes.geometric"] },
  "trapez alt": { body: (f) => `base, trapezium, trapezium left angle=120, trapezium right angle=120${f ? ", fill=gray!12" : ""}`, libraries: ["shapes.geometric"] },
  flag: { body: (f) => `base, signal, signal from=west, signal to=nothing${f ? ", fill=blue!8" : ""}`, libraries: ["shapes.symbols"] },
  plain: { body: () => "align=center", libraries: [] },
  dot: { body: () => "circle, fill, inner sep=0pt, minimum size=2mm", libraries: [] },
  oval: { body: (f) => `base, ellipse${f ? ", fill=blue!8" : ""}`, libraries: ["shapes.geometric"] },
};

/** Order the styles are written in. */
const SHAPE_ORDER: NodeShape[] = ["process", "rounded", "terminal", "subroutine", "decision", "io", "io alt", "trapez", "trapez alt", "database", "hexagon", "flag", "circle", "doublecircle", "oval", "dot", "plain"];

/** The style name for a shape: the shape's own word, except where a TikZ key already has it. */
const STYLE_NAME: Record<NodeShape, string> = {
  process: "process",
  rounded: "rounded box",
  terminal: "terminal",
  subroutine: "subroutine",
  database: "database",
  circle: "connector",
  doublecircle: "connector double",
  decision: "decision",
  hexagon: "hexagon",
  io: "io",
  "io alt": "io alt",
  trapez: "trapez",
  "trapez alt": "trapez alt",
  flag: "flag",
  plain: "plain",
  dot: "dot",
  oval: "oval",
};

/** Words that are TikZ keys (or colors): a style of this name would replace the key (D83 item 3). */
const RESERVED = new Set([
  ...TIKZ_KEY_NAMES,
  "red", "green", "blue", "cyan", "magenta", "yellow", "black", "white", "gray", "darkgray", "lightgray", "brown", "lime", "olive", "orange", "pink", "purple", "teal", "violet",
  "dashed", "dotted", "solid", "thick", "thin", "ultra thick", "very thick", "very thin", "ultra thin", "fill", "draw", "color", "text", "step", "grid", "shift", "scale", "rotate", "node", "label", "pin", "text width", "font", "bend left", "bend right", "loop", "help lines", "double", "rounded corners", "shadow", "circle", "ellipse", "rectangle", "diamond", "opacity", "anchor", "name", "pos", "near start", "near end", "auto", "swap", "above", "below", "left", "right", "base", "start", "end", "every node", "every path", "dot", "main", "default", "highlight", "dim", "box",
]);

/**
 * The vertical node distance: a group's box reaches 3mm past its nodes and its title stands above that, so the
 * gap between layers has to hold both (D84); a group inside a group needs room for the inner title too.
 */
const distanceFor = (depth: number): string => `${depth === 0 ? 8 : depth === 1 ? 12 : 16}mm and 16mm`;
/** Node names that TikZ reads as something else. */
const BAD_NAMES = new Set(["current bounding box", "current page", "current subpath start", "current subpath end"]);

export interface Generated {
  text: string;
  /** TikZ name of each node id. */
  names: Map<string, string>;
  /** Number of nodes, edges and groups written. */
  nodes: number;
  edges: number;
  groups: number;
  notes: string[];
}

const f1 = (v: number): string => String(Math.round(v * 10) / 10);

/** An xcolor expression for a colour. */
export function colorExpr(c: Rgb): string {
  if (c[0] === 0 && c[1] === 0 && c[2] === 0) return "black";
  if (c[0] === 255 && c[1] === 255 && c[2] === 255) return "white";
  return `{rgb,255:red,${c[0]};green,${c[1]};blue,${c[2]}}`;
}

/** The options a Look stands for. */
function lookItems(l: Look): string[] {
  const out: string[] = [];
  if (l.fill) out.push(`fill=${colorExpr(l.fill)}`);
  if (l.stroke) out.push(`draw=${colorExpr(l.stroke)}`);
  if (l.text) out.push(`text=${colorExpr(l.text)}`);
  if (l.width !== undefined) out.push(`line width=${f1(l.width)}pt`);
  if (l.dashed) out.push("dashed");
  else if (l.dotted) out.push("dotted");
  return out;
}

// ---------------------------------------------------------------- text

/** Text as TeX shows it: special characters escaped, line breaks as `\\`. */
export function texText(s: string): string {
  return s
    .split("\n")
    .map((line) =>
      line
        .replace(/\\/g, "\u0001")
        .replace(/[{}$&%#_]/g, (c) => `\\${c}`)
        .replace(/\^/g, "\\^{}")
        .replace(/~/g, "\\textasciitilde{}")
        .replace(/</g, "\\textless{}")
        .replace(/>/g, "\\textgreater{}")
        .replace(/\|/g, "\\textbar{}")
        .replace(/\u0001/g, "\\textbackslash{}"),
    )
    .join("\\\\ ");
}

// ---------------------------------------------------------------- order and names

/**
 * Node ids in the order they are written: component by component in the order they first appear, and within one by
 * how far a node is from the start of its flow (the longest path from a source, loops back ignored), so each
 * node comes after the nodes it follows and its relation can be to one of them.
 */
export function writingOrder(g: ImportGraph): string[] {
  const ids = g.nodes.map((n) => n.id);
  const known = new Set(ids);
  const index = new Map(ids.map((id, i) => [id, i]));
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  const neighbours = new Map<string, string[]>(ids.map((id) => [id, []]));
  const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const e of g.edges) {
    if (!known.has(e.from) || !known.has(e.to) || e.from === e.to) continue;
    out.get(e.from)!.push(e.to);
    neighbours.get(e.from)!.push(e.to);
    neighbours.get(e.to)!.push(e.from);
    indeg.set(e.to, indeg.get(e.to)! + 1);
  }
  // Depth first from the sources, then from what is left: edges back to a node still being visited are loops.
  const state = new Map<string, 1 | 2>();
  const back = new Set<string>();
  const post: string[] = [];
  const visit = (u: string) => {
    state.set(u, 1);
    for (const v of out.get(u)!) {
      if (state.get(v) === 1) back.add(`${u}\u0000${v}`);
      else if (!state.has(v)) visit(v);
    }
    state.set(u, 2);
    post.push(u);
  };
  for (const id of ids) if (indeg.get(id) === 0 && !state.has(id)) visit(id);
  for (const id of ids) if (!state.has(id)) visit(id);
  const layer = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const u of [...post].reverse()) {
    for (const v of out.get(u)!) if (!back.has(`${u}\u0000${v}`)) layer.set(v, Math.max(layer.get(v)!, layer.get(u)! + 1));
  }
  const order: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    const component = new Set<string>([id]);
    for (const c of component) for (const n of neighbours.get(c)!) component.add(n);
    for (const m of component) seen.add(m);
    order.push(...[...component].sort((x, y) => layer.get(x)! - layer.get(y)! || index.get(x)! - index.get(y)!));
  }
  return order;
}

/** A TikZ node name from the id when it is a word, else from the label. */
function assignNames(g: ImportGraph, order: readonly string[]): Map<string, string> {
  const valid = (id: string) => /^[A-Za-z][A-Za-z0-9_-]{2,}$/.test(id) && !BAD_NAMES.has(id);
  const kept = g.nodes.filter((n) => valid(n.id)).map((n) => n.id);
  const style = nameStyle(kept);
  const taken = new Set<string>(BAD_NAMES);
  const names = new Map<string, string>();
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  for (const id of order) {
    const n = byId.get(id)!;
    let name: string;
    if (valid(id)) {
      name = id;
      for (let i = 2; taken.has(name); i++) name = `${id}${i}`;
    } else name = newNodeName(n.label, taken, STYLE_NAME[n.shape], style);
    taken.add(name);
    names.set(id, name);
  }
  for (const grp of g.groups) {
    let name: string;
    const own = grp.id.replace(/^cluster[_-]?/, "");
    if (/^[A-Za-z][A-Za-z0-9_-]+$/.test(own) && !taken.has(own) && !BAD_NAMES.has(own)) name = own;
    else if (valid(grp.id) && !taken.has(grp.id)) name = grp.id;
    else name = newNodeName(grp.title, taken, "group", style);
    taken.add(name);
    names.set(`group:${grp.id}`, name);
  }
  return names;
}

// ---------------------------------------------------------------- tips

const TIP_SPEC: Record<Exclude<Tip, "none" | "arrow">, string> = {
  open: "Stealth[length=2.5mm, open]",
  circle: "Circle[length=2mm]",
  "open circle": "Circle[length=2mm, open]",
  cross: "Rays[n=4]",
  bar: "Bar",
  diamond: "Diamond[length=3mm]",
  "open diamond": "Diamond[length=3mm, open]",
  square: "Square[length=2mm]",
};

/** The arrow option for tips at the two ends: `->`, `<->`, `-{Circle[open]}`, `{Stealth}-{Circle}`. */
export function arrowOption(tail: Tip, head: Tip): string | null {
  if (tail === "none" && head === "none") return null;
  const side = (t: Tip, end: "<" | ">"): string => (t === "none" ? "" : t === "arrow" ? end : `{${TIP_SPEC[t]}}`);
  const a = side(tail, "<");
  const b = side(head, ">");
  // Mixed tips are written with every tip in braces, so the shorthand can't be misread.
  if ((a && a !== "<" && a !== "") || (b && b !== ">" && b !== "")) {
    const wrap = (t: Tip, end: string) => (t === "none" ? "" : t === "arrow" ? `{${end}}` : `{${TIP_SPEC[t]}}`);
    return `${wrap(tail, "<")}-${wrap(head, ">")}`;
  }
  return `${a}-${b}`;
}

// ---------------------------------------------------------------- the document

/** Places nodes in a loose grid: only a starting point for the auto-layout. */
function roughPlace(i: number): string {
  return `(${f1((i % 5) * 4)},${f1(-Math.floor(i / 5) * 2)})`;
}

export function graphToTikz(g: ImportGraph): Generated {
  const notes: string[] = [];
  const order = writingOrder(g);
  const names = assignNames(g, order);
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const groupName = (idx: number) => names.get(`group:${g.groups[idx]!.id}`)!;
  const groupById = new Map(g.groups.map((grp, i) => [grp.id, i]));
  const fill = g.format === "mermaid";

  const libs = new Set<string>(["positioning", "arrows.meta"]);
  const used = new Set<NodeShape>(g.nodes.map((n) => n.shape));
  for (const s of used) for (const l of SHAPE_STYLES[s].libraries) libs.add(l);

  // Groups that hold something.
  const children = new Map<number, number[]>();
  const nodesIn = new Map<number, string[]>();
  g.groups.forEach((grp, i) => {
    if (grp.parent !== undefined) children.set(grp.parent, [...(children.get(grp.parent) ?? []), i]);
  });
  for (const id of order) {
    const grp = byId.get(id)!.group;
    if (grp !== undefined) nodesIn.set(grp, [...(nodesIn.get(grp) ?? []), id]);
  }
  const holds = (i: number): boolean => (nodesIn.get(i)?.length ?? 0) > 0 || (children.get(i) ?? []).some(holds);
  const kept = g.groups.map((_, i) => holds(i));
  const emptyGroups = kept.filter((k) => !k).length;
  if (emptyGroups) notes.push(`${emptyGroups === 1 ? "One empty group was" : `${emptyGroups} empty groups were`} left out.`);
  const anyGroup = kept.some(Boolean);
  const depthOf = (i: number): number => 1 + (g.groups[i]!.parent === undefined ? 0 : depthOf(g.groups[i]!.parent!));
  const depth = Math.max(0, ...g.groups.map((_, i) => (kept[i] ? depthOf(i) : 0)));
  if (anyGroup) {
    libs.add("fit");
    libs.add("backgrounds");
  }

  // Classes the nodes use.
  const classNames = new Map<string, string>();
  const usedClasses = g.classes.filter((c, i) => g.nodes.some((n) => n.classes.includes(c.name)) && g.classes.findIndex((k) => k.name === c.name) === i);
  const styleNames = new Set<string>(["base", ...SHAPE_ORDER.map((s) => STYLE_NAME[s]), "group", "group title"]);
  for (const c of usedClasses) {
    const words = baseName(c.name, "camel") || "class";
    let name = c.name.replace(/[^A-Za-z0-9 _-]/g, "-") || words;
    if (RESERVED.has(name.toLowerCase()) || styleNames.has(name)) name = `${name} class`;
    styleNames.add(name);
    classNames.set(c.name, name);
  }

  // A look shared by several edges (a Graphviz `edge [color=...]`, a Mermaid `linkStyle default`) is a named style.
  const edgeLook = (e: ImportGraph["edges"][number]): string => lookItems({ ...e.look, dashed: false, dotted: false }).join(", ");
  const looks = new Map<string, number>();
  for (const e of g.edges) if (e.line !== "invisible" && edgeLook(e)) looks.set(edgeLook(e), (looks.get(edgeLook(e)) ?? 0) + 1);
  const linkStyles = new Map<string, string>();
  for (const [key, count] of [...looks].sort((a, b) => b[1] - a[1])) if (count >= 2) linkStyles.set(key, linkStyles.size ? `link ${linkStyles.size + 1}` : "link");

  // ---- preamble
  const lines: string[] = [];
  lines.push("\\documentclass[tikz,border=4pt]{standalone}");
  const libOrder = ["positioning", "fit", "backgrounds", "shapes.geometric", "shapes.symbols", "arrows.meta"];
  lines.push(`\\usetikzlibrary{${libOrder.filter((l) => libs.has(l)).join(", ")}}`);
  lines.push("");
  lines.push("\\tikzset{");
  lines.push("  base/.style = {draw, thick, minimum width=28mm, minimum height=9mm, align=center},");
  for (const s of SHAPE_ORDER) if (used.has(s)) lines.push(`  ${STYLE_NAME[s]}/.style = {${SHAPE_STYLES[s].body(fill)}},`);
  for (const c of usedClasses) {
    const body = lookItems(c.look).join(", ");
    if (body) lines.push(`  ${classNames.get(c.name)}/.style = {${body}},`);
  }
  for (const [key, name] of linkStyles) lines.push(`  ${name}/.style = {${key}},`);
  if (anyGroup) for (const s of GROUP_STYLES) lines.push(`  ${s.name}/.style = {${s.body}},`);
  lines.push("  >={Stealth[length=2.5mm]},");
  lines.push("}");
  lines.push("");
  lines.push("\\begin{document}");
  lines.push(`\\begin{tikzpicture}[node distance=${distanceFor(depth)}]`);

  // ---- nodes
  const nodeStatement = (n: ImportNode, i: number): string => {
    const items = [STYLE_NAME[n.shape]];
    for (const c of n.classes) if (classNames.has(c)) items.push(classNames.get(c)!);
    items.push(...lookItems(n.look));
    const at = i === 0 ? "" : ` at ${roughPlace(i)}`;
    return `  \\node[${items.join(", ")}] (${names.get(n.id)!})${at} {${texText(n.label)}};`;
  };
  order.forEach((id, i) => lines.push(nodeStatement(byId.get(id)!, i)));
  lines.push("");

  // ---- edges
  const endName = (id: string): string | null => {
    if (byId.has(id)) return names.get(id)!;
    const gi = groupById.get(id);
    return gi !== undefined && kept[gi] ? groupName(gi) : null;
  };
  const touchesGroup = (id: string) => !byId.has(id) && groupById.has(id);
  const pairCount = new Map<string, number>();
  const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
  for (const e of g.edges) {
    if (e.line === "invisible") continue;
    pairCount.set(pairKey(e.from, e.to), (pairCount.get(pairKey(e.from, e.to)) ?? 0) + 1);
  }
  const seenPair = new Map<string, number>();
  let written = 0;
  let invisible = 0;
  let dropped = 0;
  const early: string[] = [];
  const late: string[] = [];
  for (const e of g.edges) {
    if (e.line === "invisible") {
      invisible++;
      continue;
    }
    const a = endName(e.from);
    const b = endName(e.to);
    if (!a || !b) {
      dropped++;
      continue;
    }
    const items: string[] = [];
    const arrow = arrowOption(e.tail, e.head);
    if (arrow) items.push(arrow);
    if (e.line === "dashed") items.push("dashed");
    else if (e.line === "dotted") items.push("dotted");
    else if (e.line === "thick") items.push("very thick");
    const own = edgeLook(e);
    if (own) items.push(linkStyles.get(own) ?? own);
    const key = pairKey(e.from, e.to);
    let path = "--";
    if (e.from === e.to) path = "to[loop above]";
    else if ((pairCount.get(key) ?? 0) > 1) {
      // Edges between the same two nodes would lie on one another: bend them apart.
      const k = seenPair.get(key) ?? 0;
      seenPair.set(key, k + 1);
      const sameWay = e.from < e.to;
      path = `to[bend ${(k % 2 === 0) === sameWay ? "left" : "right"}=${15 + 10 * Math.floor(k / 2)}]`;
    }
    const label = e.label ? ` node[auto${e.label.includes("\n") ? ", align=center" : ""}] {${texText(e.label)}}` : "";
    const opts = items.length ? `[${items.join(", ")}]` : "";
    const stmt = `  \\draw${opts} (${a}) ${path}${label} (${b});`;
    (touchesGroup(e.from) || touchesGroup(e.to) ? late : early).push(stmt);
    written++;
  }
  lines.push(...early);

  // ---- groups
  const groupLines: string[] = [];
  const emit = (i: number): void => {
    if (!kept[i]) return;
    for (const c of children.get(i) ?? []) emit(c);
    const grp = g.groups[i]!;
    const members = [...(nodesIn.get(i) ?? []).map((id) => names.get(id)!), ...(children.get(i) ?? []).filter((c) => kept[c]).map(groupName)];
    const items = ["group", `fit=${members.map((m) => `(${m})`).join(" ")}`];
    if ((children.get(i) ?? []).some((c) => kept[c])) items.splice(1, 0, "inner sep=6mm");
    items.push(...lookItems(grp.look).filter((x) => x !== "dashed"));
    if (grp.title) items.push(`label={[group title]north:${texText(grp.title)}}`);
    groupLines.push(`    \\node[${items.join(", ")}] (${groupName(i)}) {};`);
  };
  g.groups.forEach((grp, i) => {
    if (grp.parent === undefined) emit(i);
  });
  if (groupLines.length) {
    lines.push("");
    lines.push("  \\begin{scope}[on background layer]");
    lines.push(...groupLines);
    lines.push("  \\end{scope}");
  }
  if (late.length) {
    lines.push("");
    lines.push(...late);
  }
  lines.push("\\end{tikzpicture}");
  lines.push("\\end{document}");
  lines.push("");

  if (invisible) notes.push(`${invisible === 1 ? "One invisible link was" : `${invisible} invisible links were`} left out; it only shaped the layout in the source.`);
  if (dropped) notes.push(`${dropped === 1 ? "One edge" : `${dropped} edges`} to an empty group ${dropped === 1 ? "was" : "were"} left out.`);

  return { text: lines.join("\n"), names, nodes: order.length, edges: written, groups: kept.filter(Boolean).length, notes };
}
