// Graphviz DOT: `digraph` and `graph`, node and edge statements and chains,
// `node [...]` and `edge [...]` defaults with their scoping, subgraphs
// (`cluster...` ones become groups), ports (dropped), and the attributes that
// have a TikZ counterpart: label, shape, style, colors, pen width, arrow
// tips, direction and `rankdir` (M4 step 5, D84).
import { type ImportClass, type ImportEdge, type ImportGraph, type ImportGroup, type ImportNode, ImportError, type Look, type NodeShape, parseColor, parseHsv, type Rgb, type Tip } from "./graph.ts";

type Attrs = Map<string, string>;

interface Tok {
  kind: "id" | "html" | "punct";
  value: string;
  quoted: boolean;
  line: number;
}

function tokenize(src: string): Tok[] {
  const s = src.replace(/^\uFEFF/, "");
  const out: Tok[] = [];
  let i = 0;
  let line = 1;
  const n = s.length;
  const atLineStart = () => {
    for (let k = i - 1; k >= 0 && s[k] !== "\n"; k--) if (!/[ \t\r]/.test(s[k]!)) return false;
    return true;
  };
  while (i < n) {
    const c = s[i]!;
    if (c === "\n") {
      line++;
      i++;
    } else if (/\s/.test(c)) i++;
    else if (c === "/" && s[i + 1] === "/") {
      while (i < n && s[i] !== "\n") i++;
    } else if (c === "/" && s[i + 1] === "*") {
      const end = s.indexOf("*/", i + 2);
      const stop = end < 0 ? n : end + 2;
      for (let k = i; k < stop; k++) if (s[k] === "\n") line++;
      i = stop;
    } else if (c === "#" && atLineStart()) {
      while (i < n && s[i] !== "\n") i++;
    } else if (c === '"') {
      let v = "";
      const startLine = line;
      i++;
      while (i < n && s[i] !== '"') {
        if (s[i] === "\\" && s[i + 1] === '"') {
          v += '"';
          i += 2;
        } else if (s[i] === "\\" && s[i + 1] === "\n") {
          // A backslash before a line break continues the string.
          i += 2;
          line++;
        } else {
          if (s[i] === "\n") line++;
          v += s[i];
          i++;
        }
      }
      if (i >= n) throw new ImportError("A quoted string isn't closed.", startLine);
      i++;
      out.push({ kind: "id", value: v, quoted: true, line: startLine });
    } else if (c === "<") {
      // HTML string: balanced angle brackets.
      let depth = 0;
      const start = i;
      const startLine = line;
      while (i < n) {
        if (s[i] === "<") depth++;
        else if (s[i] === ">") {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        } else if (s[i] === "\n") line++;
        i++;
      }
      if (depth !== 0) throw new ImportError("An HTML label isn't closed.", startLine);
      out.push({ kind: "html", value: s.slice(start + 1, i - 1), quoted: false, line: startLine });
    } else if (c === "-" && (s[i + 1] === ">" || s[i + 1] === "-")) {
      out.push({ kind: "punct", value: s.slice(i, i + 2), quoted: false, line });
      i += 2;
    } else if (/[A-Za-z_\u0080-\uFFFF]/.test(c)) {
      let k = i + 1;
      while (k < n && /[\w\u0080-\uFFFF]/.test(s[k]!)) k++;
      out.push({ kind: "id", value: s.slice(i, k), quoted: false, line });
      i = k;
    } else if (/[0-9.]/.test(c) || (c === "-" && /[0-9.]/.test(s[i + 1] ?? ""))) {
      const m = /^-?(\.\d+|\d+(\.\d*)?)/.exec(s.slice(i));
      if (!m) throw new ImportError(`Unexpected "${c}".`, line);
      out.push({ kind: "id", value: m[0], quoted: false, line });
      i += m[0].length;
    } else if ("{}[];,=:+".includes(c)) {
      out.push({ kind: "punct", value: c, quoted: false, line });
      i++;
    } else throw new ImportError(`Unexpected "${c}".`, line);
  }
  return out;
}

// ---------------------------------------------------------------- text

/** A label as Graphviz shows it: `\N`, `\n`, `\l`, `\r`, `\\` resolved. */
function labelText(raw: string, id: string): string {
  return raw
    .replace(/\\([nlr])/g, "\n")
    .replace(/\\N/g, id)
    .replace(/\\G/g, "")
    .replace(/\\(["\\])/g, "$1")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n+$/, "");
}

/** An HTML-like label reduced to its text: rows and `<br/>` become lines. */
function htmlText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(tr|p|div)>/gi, "\n")
    .replace(/<\/td>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(\w+|#\d+);/g, (m, e: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', nbsp: " " })[e] ?? (e.startsWith("#") ? String.fromCodePoint(+e.slice(1)) : m))
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------- attributes to a look

function colorOf(v: string | undefined): Rgb | null {
  if (!v) return null;
  // A color list ("red:blue") or weighted list ("red;0.3:blue"): the first color.
  const first = v.split(":")[0]!.split(";")[0]!.trim();
  return parseColor(first) ?? parseHsv(first);
}

const SHAPES: Record<string, NodeShape | undefined> = {
  box: "process",
  rect: "process",
  rectangle: "process",
  square: "process",
  oval: "oval",
  ellipse: "oval",
  egg: "oval",
  circle: "circle",
  mcircle: "circle",
  doublecircle: "doublecircle",
  diamond: "decision",
  mdiamond: "decision",
  point: "dot",
  hexagon: "hexagon",
  octagon: "hexagon",
  parallelogram: "io",
  trapezium: "trapez",
  invtrapezium: "trapez alt",
  cylinder: "database",
  plaintext: "plain",
  plain: "plain",
  none: "plain",
  underline: "plain",
  record: "process",
  mrecord: "rounded",
  note: "process",
  tab: "process",
  folder: "process",
  box3d: "process",
  component: "process",
  msquare: "process",
  house: "process",
  invhouse: "process",
  triangle: "process",
  invtriangle: "process",
  star: "process",
  pentagon: "hexagon",
  septagon: "hexagon",
  larrow: "process",
  rarrow: "process",
};

/**
 * The tip a Graphviz arrow name stands for. Names are a shape (normal, vee, dot,
 * diamond, box, tee, empty, crow…) with modifiers (o for open, l and r for
 * half); several in a row are drawn side by side, and the first stands for all.
 */
function tipOf(name: string | undefined, fallback: Tip): Tip {
  if (name === undefined) return fallback;
  const n = name.trim().toLowerCase();
  if (!n || n === "none") return "none";
  if (n.includes("diamond")) return /^(o|e)/.test(n) ? "open diamond" : "diamond";
  if (/^(inv)?o?dot/.test(n)) return /^(inv)?odot/.test(n) ? "open circle" : "circle";
  if (n.includes("box")) return "square";
  if (n.includes("tee")) return "bar";
  if (/empty|^onormal|^oinv|^open/.test(n)) return "open";
  return "arrow";
}

interface Scope {
  node: Attrs;
  edge: Attrs;
}

export function parseDot(src: string): ImportGraph {
  const toks = tokenize(src);
  let p = 0;
  const notes: string[] = [];
  const peek = (k = 0): Tok | undefined => toks[p + k];
  const isP = (v: string, k = 0): boolean => {
    const t = peek(k);
    return !!t && t.kind === "punct" && t.value === v;
  };
  const isKw = (v: string, k = 0): boolean => {
    const t = peek(k);
    return !!t && t.kind === "id" && !t.quoted && t.value.toLowerCase() === v;
  };
  const fail = (msg: string): never => {
    const t = peek() ?? toks[toks.length - 1];
    throw new ImportError(msg, t?.line);
  };
  const expect = (v: string): void => {
    if (!isP(v)) fail(`Expected "${v}"${peek() ? ` but found "${peek()!.value}"` : " but the text ended"}.`);
    p++;
  };

  // [strict] (graph | digraph) [ID] {
  let strict = false;
  if (isKw("strict")) {
    strict = true;
    p++;
  }
  let directed: boolean;
  if (isKw("digraph")) directed = true;
  else if (isKw("graph")) directed = false;
  else return fail("This doesn't start like a DOT graph: it should begin with digraph or graph.");
  p++;
  if (peek() && peek()!.kind !== "punct") p++;
  expect("{");

  const nodes = new Map<string, ImportNode & { attrs: Attrs }>();
  const groupList: Array<ImportGroup & { attrs: Attrs }> = [];
  const edgeList: Array<{ from: string; to: string; attrs: Attrs }> = [];
  const rootGraph: Attrs = new Map();
  const unknownShapes = new Set<string>();
  const dropped = new Set<string>();
  let htmlLabels = false;
  let ports = false;
  let anyRecord = false;

  const readValue = (): string => {
    const t = peek();
    if (!t || t.kind === "punct") return fail("Expected a value.");
    p++;
    let v = t.kind === "html" ? `\u0000html:${t.value}` : t.value;
    // Quoted strings joined with +.
    while (t.quoted && isP("+")) {
      p++;
      const next = peek();
      if (!next || !next.quoted) return fail("Expected a quoted string after +.");
      v += next.value;
      p++;
    }
    return v;
  };
  const readAttrList = (into: Attrs): void => {
    while (isP("[")) {
      p++;
      while (!isP("]")) {
        const k = peek();
        if (!k) return fail("An attribute list isn't closed.");
        if (k.kind === "punct" && (k.value === "," || k.value === ";")) {
          p++;
          continue;
        }
        if (k.kind !== "id") return fail(`Unexpected "${k.value}" in an attribute list.`);
        p++;
        if (isP("=")) {
          p++;
          into.set(k.value.toLowerCase(), readValue());
        } else into.set(k.value.toLowerCase(), "true");
      }
      p++;
    }
  };

  const touch = (id: string, scope: Scope, cluster: number | undefined): void => {
    const known = nodes.get(id);
    if (known) {
      // Listed inside a cluster, it belongs to it, even if it was first used outside; the first cluster keeps it.
      if (known.group === undefined && cluster !== undefined) known.group = cluster;
      return;
    }
    const n: ImportNode & { attrs: Attrs } = { id, label: "", shape: "oval", classes: [], look: {}, attrs: new Map(scope.node) };
    if (cluster !== undefined) n.group = cluster;
    nodes.set(id, n);
  };

  /** A subgraph or node operand of an edge statement: the node ids it stands for. */
  type Operand = { ids: string[] };

  const readNodeId = (): string => {
    const t = peek();
    if (!t || t.kind !== "id") return fail(`Expected a node name${t ? ` but found "${t.value}"` : ""}.`);
    p++;
    let id = t.value;
    // Joined quoted strings.
    while (t.quoted && isP("+")) {
      p++;
      const next = peek();
      if (!next || !next.quoted) return fail("Expected a quoted string after +.");
      id += next.value;
      p++;
    }
    // Ports: a:port:compass
    while (isP(":")) {
      ports = true;
      p++;
      if (peek()?.kind === "id") p++;
    }
    return id;
  };

  const parseStatements = (scope: Scope, cluster: number | undefined, graphAttrs: Attrs): string[] => {
    const seen: string[] = [];
    const note = (id: string) => {
      if (!seen.includes(id)) seen.push(id);
    };
    const subgraphOperand = (parent: Scope): Operand => {
      let name = "";
      if (isKw("subgraph")) {
        p++;
        if (peek() && peek()!.kind === "id") {
          name = peek()!.value;
          p++;
        }
      }
      expect("{");
      const inner: Scope = { node: new Map(parent.node), edge: new Map(parent.edge) };
      const own: Attrs = new Map();
      let idx: number | undefined = cluster;
      let group: (ImportGroup & { attrs: Attrs }) | undefined;
      if (name.startsWith("cluster")) {
        const parentGroup = cluster;
        group = { id: name, title: "", look: {}, attrs: own };
        if (parentGroup !== undefined) group.parent = parentGroup;
        groupList.push(group);
        idx = groupList.length - 1;
      }
      const ids = parseStatements(inner, idx, group ? own : new Map());
      expect("}");
      for (const id of ids) note(id);
      return { ids };
    };
    while (!isP("}")) {
      const t = peek();
      if (!t) return fail("The graph isn't closed: a } is missing.");
      if (isP(";") || isP(",")) {
        p++;
        continue;
      }
      // graph / node / edge defaults.
      if ((isKw("graph") || isKw("node") || isKw("edge")) && isP("[", 1)) {
        const which = t.value.toLowerCase();
        p++;
        const a: Attrs = new Map();
        readAttrList(a);
        const target = which === "node" ? scope.node : which === "edge" ? scope.edge : graphAttrs;
        for (const [k, v] of a) target.set(k, v);
        if (which === "graph" && graphAttrs === rootGraph) for (const [k, v] of a) rootGraph.set(k, v);
        continue;
      }
      // ID = ID
      if (t.kind === "id" && isP("=", 1)) {
        p += 2;
        graphAttrs.set(t.value.toLowerCase(), readValue());
        continue;
      }
      // An operand: a node or a subgraph.
      let first: Operand;
      if (isKw("subgraph") || isP("{")) first = subgraphOperand(scope);
      else {
        const id = readNodeId();
        touch(id, scope, cluster);
        note(id);
        first = { ids: [id] };
      }
      if (isP("->") || isP("--")) {
        const operands: Operand[] = [first];
        while (isP("->") || isP("--")) {
          if (isP("->") !== directed) fail(directed ? "This is a digraph, so edges are written ->, not --." : "This is an undirected graph, so edges are written --, not ->.");
          p++;
          if (isKw("subgraph") || isP("{")) operands.push(subgraphOperand(scope));
          else {
            const id = readNodeId();
            touch(id, scope, cluster);
            note(id);
            operands.push({ ids: [id] });
          }
        }
        const attrs: Attrs = new Map(scope.edge);
        readAttrList(attrs);
        for (let k = 0; k + 1 < operands.length; k++) {
          for (const a of operands[k]!.ids) for (const b of operands[k + 1]!.ids) edgeList.push({ from: a, to: b, attrs: new Map(attrs) });
        }
      } else if (first.ids.length === 1 && !isKw("subgraph")) {
        // A node statement, possibly with attributes.
        const n = nodes.get(first.ids[0]!)!;
        const a: Attrs = new Map();
        readAttrList(a);
        for (const [k, v] of a) n.attrs.set(k, v);
      } else {
        readAttrList(new Map());
      }
    }
    return seen;
  };

  const rootScope: Scope = { node: new Map(), edge: new Map() };
  parseStatements(rootScope, undefined, rootGraph);
  expect("}");

  // ---- attributes to looks
  const lookOf = (a: Attrs, isNode: boolean): Look => {
    const look: Look = {};
    const style = (a.get("style") ?? "").split(/[,\s]+/).map((x) => x.toLowerCase());
    const stroke = colorOf(a.get("color"));
    if (stroke) look.stroke = stroke;
    const fontcolor = colorOf(a.get("fontcolor"));
    if (fontcolor) look.text = fontcolor;
    if (isNode && style.includes("filled")) look.fill = colorOf(a.get("fillcolor")) ?? stroke ?? [211, 211, 211];
    else if (isNode && a.has("fillcolor") && a.get("style") === undefined) {
      /* fillcolor without style=filled doesn't fill */
    }
    const pen = a.get("penwidth");
    if (pen && Number.isFinite(+pen) && +pen > 0 && +pen !== 1) look.width = Math.round(+pen * 0.8 * 10) / 10;
    if (isNode && style.includes("bold") && look.width === undefined) look.width = 1.2;
    if (isNode && style.includes("dashed")) look.dashed = true;
    if (isNode && style.includes("dotted")) look.dotted = true;
    return look;
  };

  const outNodes: ImportNode[] = [];
  for (const n of nodes.values()) {
    const a = n.attrs;
    const style = (a.get("style") ?? "").split(/[,\s]+/).map((x) => x.toLowerCase());
    let shapeName = (a.get("shape") ?? "ellipse").toLowerCase();
    let shape: NodeShape | undefined = SHAPES[shapeName];
    if (shape === undefined) {
      unknownShapes.add(shapeName);
      shape = "process";
    }
    if (shapeName === "record" || shapeName === "mrecord") anyRecord = true;
    if ((shape === "process" || shape === "oval") && style.includes("rounded") && shapeName !== "ellipse" && shapeName !== "oval") shape = "rounded";
    if (shape === "circle" && a.get("peripheries") === "2") shape = "doublecircle";
    shapeName = "";
    let label: string;
    const raw = a.get("label");
    if (raw === undefined) label = n.id;
    else if (raw.startsWith("\u0000html:")) {
      htmlLabels = true;
      label = htmlText(raw.slice(6));
    } else {
      label = labelText(raw, n.id);
      if (a.get("shape")?.toLowerCase().endsWith("record")) label = label.replace(/[{}]/g, "").split("|").map((x) => x.trim()).join("\n");
    }
    if (shape === "dot") label = "";
    if (style.includes("invis")) {
      shape = "plain";
      label = "";
    }
    const look = lookOf(a, true);
    const out: ImportNode = { id: n.id, label, shape, classes: [], look };
    if (n.group !== undefined) out.group = n.group;
    outNodes.push(out);
  }
  if (unknownShapes.size) notes.push(`Shapes without a TikZ counterpart are drawn as rectangles: ${[...unknownShapes].slice(0, 5).join(", ")}.`);
  if (anyRecord) notes.push("Record labels are shown as lines of text, one per field.");
  if (htmlLabels) notes.push("HTML-like labels were reduced to their text.");
  if (ports) notes.push("Ports on edge ends (a:port) were dropped: edges go to the node.");

  const groups: ImportGroup[] = groupList.map((g) => {
    const raw = g.attrs.get("label");
    const out: ImportGroup = { id: g.id, title: raw === undefined ? "" : raw.startsWith("\u0000html:") ? htmlText(raw.slice(6)) : labelText(raw, g.id), look: {} };
    const style = (g.attrs.get("style") ?? "").split(/[,\s]+/).map((x) => x.toLowerCase());
    const fill = colorOf(g.attrs.get("fillcolor")) ?? colorOf(g.attrs.get("bgcolor")) ?? (style.includes("filled") ? colorOf(g.attrs.get("color")) : null);
    if (fill) out.look.fill = fill;
    const stroke = colorOf(g.attrs.get("color")) ?? colorOf(g.attrs.get("pencolor"));
    if (stroke) out.look.stroke = stroke;
    if (style.includes("dashed")) out.look.dashed = true;
    if (g.parent !== undefined) out.parent = g.parent;
    return out;
  });

  const outEdges: ImportEdge[] = [];
  const seenEdges = new Set<string>();
  let edgeLabelsDropped = 0;
  for (const e of edgeList) {
    const a = e.attrs;
    const style = (a.get("style") ?? "").split(/[,\s]+/).map((x) => x.toLowerCase());
    if (strict) {
      const key = `${e.from}\u0000${e.to}`;
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
    }
    const dir = (a.get("dir") ?? (directed ? "forward" : "none")).toLowerCase();
    const line: ImportEdge["line"] = style.includes("invis") ? "invisible" : style.includes("dashed") ? "dashed" : style.includes("dotted") ? "dotted" : style.includes("bold") ? "thick" : "solid";
    const head = dir === "forward" || dir === "both" ? tipOf(a.get("arrowhead"), "arrow") : "none";
    const tail = dir === "back" || dir === "both" ? tipOf(a.get("arrowtail"), "arrow") : "none";
    const look = lookOf(a, false);
    delete look.fill;
    const edge: ImportEdge = { from: e.from, to: e.to, line, head, tail, look };
    const raw = a.get("label") ?? a.get("xlabel");
    if (raw !== undefined) {
      const text = raw.startsWith("\u0000html:") ? htmlText(raw.slice(6)) : labelText(raw, "");
      if (text) edge.label = text;
    }
    if (a.has("headlabel") || a.has("taillabel")) edgeLabelsDropped++;
    outEdges.push(edge);
  }
  if (edgeLabelsDropped) notes.push(`${edgeLabelsDropped === 1 ? "A head or tail label was" : `${edgeLabelsDropped} head or tail labels were`} left out.`);

  const rank = (rootGraph.get("rankdir") ?? "TB").toUpperCase();
  if (rank === "BT") notes.push("The graph runs bottom to top; it is laid out top to bottom.");
  if (rank === "RL") notes.push("The graph runs right to left; it is laid out left to right.");
  void dropped;
  const classes: ImportClass[] = [];
  return {
    format: "dot",
    direction: rank === "LR" || rank === "RL" ? "right" : "down",
    nodes: outNodes,
    edges: outEdges,
    groups,
    classes,
    notes,
  };
}
