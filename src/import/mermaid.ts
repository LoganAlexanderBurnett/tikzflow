// Mermaid flowcharts (`graph TD`, `flowchart LR`): nodes in their shapes,
// links with labels and tips, `&` lists, chains, subgraphs, `style`,
// `classDef`, `class`, `:::class` and `linkStyle`. Other diagram types are
// refused by name; anything inside a flowchart that isn't understood is left
// out and listed (M4 step 5, D84).
import { type ImportClass, type ImportEdge, type ImportGraph, type ImportGroup, type ImportNode, ImportError, type Look, type NodeShape, parseColor, type Tip } from "./graph.ts";

const OTHER_DIAGRAMS: Array<[RegExp, string]> = [
  [/^sequenceDiagram\b/i, "a sequence diagram"],
  [/^classDiagram\b/i, "a class diagram"],
  [/^stateDiagram(-v2)?\b/i, "a state diagram"],
  [/^erDiagram\b/i, "an entity-relationship diagram"],
  [/^gantt\b/i, "a Gantt chart"],
  [/^pie\b/i, "a pie chart"],
  [/^journey\b/i, "a user journey"],
  [/^gitGraph\b/i, "a git graph"],
  [/^mindmap\b/i, "a mind map"],
  [/^timeline\b/i, "a timeline"],
  [/^quadrantChart\b/i, "a quadrant chart"],
  [/^requirementDiagram\b/i, "a requirement diagram"],
  [/^C4(Context|Container|Component|Dynamic|Deployment)\b/, "a C4 diagram"],
  [/^sankey/i, "a Sankey diagram"],
  [/^xychart/i, "an XY chart"],
  [/^block(-beta)?\b/i, "a block diagram"],
  [/^packet/i, "a packet diagram"],
  [/^architecture/i, "an architecture diagram"],
  [/^kanban\b/i, "a Kanban board"],
];

interface Statement {
  text: string;
  line: number;
}

/** Splits the source into statements: lines, and `;` outside quotes and brackets. Comments (`%%`) and front matter are dropped. */
function statements(src: string): Statement[] {
  const lines = src.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  const out: Statement[] = [];
  let i = 0;
  // Front matter: ---, settings, ---
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, k) => k > 0 && l.trim() === "---");
    if (end > 0) i = end + 1;
  }
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    const t = line.trim();
    if (!t || t.startsWith("%%")) continue;
    let depth = 0;
    let quote = false;
    let start = 0;
    for (let k = 0; k <= line.length; k++) {
      const c = line[k];
      if (c === '"') quote = !quote;
      else if (!quote && (c === "[" || c === "(" || c === "{")) depth++;
      else if (!quote && (c === "]" || c === ")" || c === "}")) depth = Math.max(0, depth - 1);
      if (k === line.length || (c === ";" && !quote && depth === 0)) {
        const piece = line.slice(start, k).trim();
        if (piece) out.push({ text: piece, line: i + 1 });
        start = k + 1;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- text

const ENTITIES: Record<string, string> = { quot: '"', amp: "&", lt: "<", gt: ">", apos: "'", nbsp: " ", num: "#" };

/** A label as Mermaid shows it: quotes, markdown marks, `<br>`, entities and icons resolved. */
function decodeLabel(raw: string, flags: { html: boolean; icons: boolean; markdown: boolean }): string {
  let t = raw.trim();
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) t = t.slice(1, -1);
  if (t.startsWith("`") && t.endsWith("`") && t.length >= 2) {
    flags.markdown = true;
    t = t.slice(1, -1).replace(/\*\*([^*]+)\*\*/g, "$1").replace(/(^|\W)\*([^*]+)\*(?=\W|$)/g, "$1$2").replace(/(^|\W)_([^_]+)_(?=\W|$)/g, "$1$2");
  }
  t = t.replace(/<br\s*\/?>/gi, "\n").replace(/\\n/g, "\n");
  if (/<\/?[a-z][^>]*>/i.test(t)) {
    flags.html = true;
    t = t.replace(/<\/?[a-z][^>]*>/gi, "");
  }
  t = t.replace(/#(\w+|\d+);/g, (m, e: string) => {
    if (/^\d+$/.test(e)) return String.fromCodePoint(+e);
    return ENTITIES[e] ?? m;
  });
  t = t.replace(/&(\w+|#\d+);/g, (m, e: string) => (e.startsWith("#") ? String.fromCodePoint(+e.slice(1)) : (ENTITIES[e] ?? m)));
  if (/\bfa[bsrl]?:fa-[\w-]+/.test(t)) {
    flags.icons = true;
    t = t.replace(/\bfa[bsrl]?:fa-[\w-]+\s*/g, "");
  }
  return t
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .join("\n")
    .trim();
}

// ---------------------------------------------------------------- styles

/** Splits "a:b,c:rgb(1,2,3)" at the commas outside parentheses. */
function splitProps(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    if (i === s.length || (c === "," && depth === 0)) {
      if (s.slice(start, i).trim()) out.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  return out;
}

/** `fill:#f9f,stroke:#333,stroke-width:4px,color:#fff,stroke-dasharray:5 5`. Returns what it couldn't use. */
function parseLook(props: string): { look: Look; ignored: string[] } {
  const look: Look = {};
  const ignored: string[] = [];
  for (const p of splitProps(props)) {
    const m = /^([\w-]+)\s*:\s*(.+)$/.exec(p);
    if (!m) {
      ignored.push(p);
      continue;
    }
    const key = m[1]!.toLowerCase();
    const value = m[2]!.replace(/!important$/i, "").trim();
    if (key === "fill" || key === "stroke" || key === "color") {
      const c = parseColor(value);
      if (c) look[key === "color" ? "text" : key] = c;
      else ignored.push(`${key}:${value}`);
    } else if (key === "stroke-width") {
      const w = /^([\d.]+)(px)?$/.exec(value);
      // 1px is 0.75pt; TikZ's default line is 0.4pt, which Mermaid draws as 1px.
      if (w) look.width = Math.max(0.2, Math.round(+w[1]! * 0.75 * 10) / 10);
      else ignored.push(`${key}:${value}`);
    } else if (key === "stroke-dasharray") {
      if (/^[\d.\s,]+$/.test(value) && value.replace(/[\s,]/g, "") !== "0") look.dashed = true;
    } else ignored.push(key);
  }
  return { look, ignored };
}

// ---------------------------------------------------------------- nodes and links

const ID_CHAR = /[\w -￿]/;

function readId(s: string, i: number): number {
  let j = i;
  while (j < s.length) {
    const c = s[j]!;
    if (ID_CHAR.test(c)) j++;
    else if ((c === "-" || c === ".") && j > i && j + 1 < s.length && ID_CHAR.test(s[j + 1]!)) j++;
    else break;
  }
  return j;
}

const OPENERS: Array<{ open: string; close: string[]; shape: NodeShape }> = [
  { open: "(((", close: [")))"], shape: "doublecircle" },
  { open: "((", close: ["))"], shape: "circle" },
  { open: "([", close: ["])"], shape: "terminal" },
  { open: "(", close: [")"], shape: "rounded" },
  { open: "[[", close: ["]]"], shape: "subroutine" },
  { open: "[(", close: [")]"], shape: "database" },
  { open: "[/", close: ["/]", "\\]"], shape: "io" },
  { open: "[\\", close: ["\\]", "/]"], shape: "io alt" },
  { open: "[", close: ["]"], shape: "process" },
  { open: "{{", close: ["}}"], shape: "hexagon" },
  { open: "{", close: ["}"], shape: "decision" },
  { open: ">", close: ["]"], shape: "flag" },
];

/** `[/text\]` is a trapezium, `[/text/]` a parallelogram. */
function slantShape(open: string, close: string): NodeShape {
  if (open === "[/") return close === "/]" ? "io" : "trapez";
  return close === "\\]" ? "io alt" : "trapez alt";
}

const AT_SHAPES: Record<string, NodeShape> = {
  rect: "process",
  rectangle: "process",
  process: "process",
  proc: "process",
  rounded: "rounded",
  event: "rounded",
  stadium: "terminal",
  terminal: "terminal",
  pill: "terminal",
  "fr-rect": "subroutine",
  subproc: "subroutine",
  subroutine: "subroutine",
  "framed-rectangle": "subroutine",
  cyl: "database",
  cylinder: "database",
  database: "database",
  db: "database",
  "h-cyl": "database",
  "lin-cyl": "database",
  circle: "circle",
  circ: "circle",
  "sm-circ": "circle",
  "small-circle": "circle",
  start: "circle",
  "dbl-circ": "doublecircle",
  "double-circle": "doublecircle",
  "fr-circ": "doublecircle",
  stop: "doublecircle",
  diamond: "decision",
  diam: "decision",
  decision: "decision",
  question: "decision",
  hex: "hexagon",
  hexagon: "hexagon",
  prepare: "hexagon",
  "lean-r": "io",
  "lean-right": "io",
  "in-out": "io",
  "lean-l": "io alt",
  "lean-left": "io alt",
  "out-in": "io alt",
  "trap-b": "trapez",
  "trapezoid-bottom": "trapez",
  priority: "trapez",
  trapezoid: "trapez",
  "trap-t": "trapez alt",
  "trapezoid-top": "trapez alt",
  manual: "trapez alt",
  odd: "flag",
  flag: "flag",
  text: "plain",
};

interface NodeSpec {
  id: string;
  shape?: NodeShape;
  label?: string;
  classes: string[];
  end: number;
}

interface Link {
  line: ImportEdge["line"];
  head: Tip;
  tail: Tip;
  label?: string;
  end: number;
}

const skipSpaces = (s: string, i: number): number => {
  while (i < s.length && /\s/.test(s[i]!)) i++;
  return i;
};

export function parseMermaid(src: string): ImportGraph {
  const stmts = statements(src);
  const notes: string[] = [];
  const header = stmts[0];
  if (!header) throw new ImportError("There is nothing to import: the text is empty.");
  for (const [re, what] of OTHER_DIAGRAMS) {
    if (re.test(header.text)) throw new ImportError(`This is ${what}. TikZFlow imports Mermaid flowcharts (graph and flowchart) and Graphviz DOT.`, header.line);
  }
  const hm = /^(graph|flowchart(?:-elk)?)\b\s*(TB|TD|BT|RL|LR)?\s*$/i.exec(header.text);
  if (!hm) throw new ImportError("This doesn't start like a Mermaid flowchart: the first line should be graph TD, flowchart LR or similar.", header.line);
  const dir = (hm[2] ?? "TB").toUpperCase();
  if (dir === "BT") notes.push("The chart runs bottom to top; it is laid out top to bottom.");
  if (dir === "RL") notes.push("The chart runs right to left; it is laid out left to right.");

  const nodes = new Map<string, ImportNode>();
  const edges: ImportEdge[] = [];
  const groups: ImportGroup[] = [];
  const classes: ImportClass[] = [];
  const stack: number[] = [];
  const styled = new Map<string, Look>();
  const classed = new Map<string, string[]>();
  const flags = { html: false, icons: false, markdown: false };
  const ignoredProps = new Set<string>();
  const skipped: string[] = [];
  let linkStyles: Array<{ which: number[] | "default"; look: Look }> = [];

  const addNode = (spec: NodeSpec, line: number): void => {
    let n = nodes.get(spec.id);
    if (!n) {
      n = { id: spec.id, label: "", shape: "process", classes: [], look: {} };
      nodes.set(spec.id, n);
      void line;
    }
    // A node listed inside a subgraph belongs to it, even if it was first used outside; the first subgraph keeps it.
    if (n.group === undefined && stack.length) n.group = stack[stack.length - 1]!;
    if (spec.shape) n.shape = spec.shape;
    if (spec.label !== undefined) n.label = spec.label;
    for (const c of spec.classes) if (!n.classes.includes(c)) n.classes.push(c);
  };

  const readNode = (s: string, i: number): NodeSpec | null => {
    const idEnd = readId(s, i);
    if (idEnd === i) return null;
    const spec: NodeSpec = { id: s.slice(i, idEnd), classes: [], end: idEnd };
    let j = skipSpaces(s, idEnd);
    if (s.startsWith("@{", j)) {
      let k = j + 2;
      let quote = false;
      while (k < s.length && (quote || s[k] !== "}")) {
        if (s[k] === '"') quote = !quote;
        k++;
      }
      const body = s.slice(j + 2, k);
      for (const part of splitProps(body)) {
        const m = /^(\w+)\s*:\s*(.*)$/.exec(part);
        if (!m) continue;
        if (m[1] === "shape") {
          const shape = AT_SHAPES[m[2]!.trim().replace(/^"|"$/g, "").toLowerCase()];
          if (shape) spec.shape = shape;
          else notes.push(`The shape ${m[2]!.trim()} of ${spec.id} isn't known; it is drawn as a rectangle.`);
        } else if (m[1] === "label") spec.label = decodeLabel(m[2]!, flags);
      }
      spec.end = Math.min(s.length, k + 1);
      j = skipSpaces(s, spec.end);
    } else {
      for (const o of OPENERS) {
        if (!s.startsWith(o.open, j)) continue;
        let k = skipSpaces(s, j + o.open.length);
        let text: string;
        let close: string | undefined;
        if (s[k] === '"') {
          const q = s.indexOf('"', k + 1);
          if (q < 0) break;
          text = s.slice(k, q + 1);
          const after = skipSpaces(s, q + 1);
          close = o.close.find((c) => s.startsWith(c, after));
          if (close === undefined) break;
          k = after;
        } else {
          let best = -1;
          for (const c of o.close) {
            const at = s.indexOf(c, k);
            if (at >= 0 && (best < 0 || at < best)) {
              best = at;
              close = c;
            }
          }
          if (best < 0 || close === undefined) break;
          text = s.slice(k, best);
          k = best;
        }
        spec.shape = o.open === "[/" || o.open === "[\\" ? slantShape(o.open, close) : o.shape;
        spec.label = decodeLabel(text, flags);
        spec.end = k + close.length;
        j = spec.end;
        break;
      }
    }
    while (s.startsWith(":::", j)) {
      const e = readId(s, j + 3);
      if (e === j + 3) break;
      spec.classes.push(s.slice(j + 3, e));
      spec.end = e;
      j = e;
    }
    return spec;
  };

  const readGroup = (s: string, i: number, line: number): { specs: NodeSpec[]; end: number } | null => {
    const specs: NodeSpec[] = [];
    let j = skipSpaces(s, i);
    for (;;) {
      const n = readNode(s, j);
      if (!n) return specs.length ? { specs, end: j } : null;
      specs.push(n);
      j = n.end;
      const k = skipSpaces(s, j);
      if (s[k] === "&") {
        j = skipSpaces(s, k + 1);
        continue;
      }
      void line;
      return { specs, end: j };
    }
  };

  /** A link at `i` (after spaces), with its text and tips. */
  const readLink = (s: string, i: number): Link | null => {
    let p = i;
    if (s.startsWith("~~~", p)) {
      let e = p;
      while (s[e] === "~") e++;
      return { line: "invisible", head: "none", tail: "none", end: e };
    }
    let tail: Tip = "none";
    if (s[p] === "<") {
      tail = "arrow";
      p++;
    } else if ((s[p] === "o" || s[p] === "x") && (s[p + 1] === "-" || s[p + 1] === "=")) {
      tail = s[p] === "o" ? "open circle" : "cross";
      p++;
    }
    const c = s[p];
    if (c !== "-" && c !== "=") return null;
    let line: ImportEdge["line"] = c === "=" ? "thick" : "solid";
    let head: Tip = "none";
    let label: string | undefined;
    let end: number;
    // `--o` and `--x` end in a circle or a cross; after longer runs (`---oB`) the letter is more likely a node's first.
    const headAt = (q: number, short: boolean): { head: Tip; end: number } | null => {
      if (s[q] === ">") return { head: "arrow", end: q + 1 };
      if ((s[q] === "o" || s[q] === "x") && (short || q + 1 >= s.length || /[\s|]/.test(s[q + 1]!))) return { head: s[q] === "o" ? "open circle" : "cross", end: q + 1 };
      return null;
    };
    if (c === "-" && s[p + 1] === ".") {
      // dotted: -.-  -.->  -..->
      let q = p + 2;
      while (s[q] === ".") q++;
      if (s[q] === "-") {
        line = "dotted";
        const h = headAt(q + 1, false);
        head = h?.head ?? "none";
        end = h ? h.end : q + 1;
      } else {
        // "-. text .->"
        const rest = s.slice(p + 2);
        const m = /^(.*?)\s*(\.+-)(>?)/.exec(rest);
        if (!m) return null;
        line = "dotted";
        label = m[1]!.trim();
        head = m[3] ? "arrow" : "none";
        end = p + 2 + m[0].length;
      }
    } else {
      let q = p;
      while (s[q] === c) q++;
      const n = q - p;
      const h = n >= 2 ? headAt(q, n === 2) : null;
      if (h) {
        head = h.head;
        end = h.end;
      } else if (n >= 3) {
        end = q;
      } else if (n === 2) {
        // "-- text -->" and "== text ==>"
        const rest = s.slice(q);
        const re = c === "-" ? /^(.*?)\s*(-{2,}>|-{3,}|--[ox](?=\s|$))/ : /^(.*?)\s*(={2,}>|={3,})/;
        const m = re.exec(rest);
        if (!m || !m[1]!.trim()) return null;
        label = m[1]!.trim();
        const closer = m[2]!;
        head = closer.endsWith(">") ? "arrow" : closer.endsWith("o") ? "open circle" : closer.endsWith("x") ? "cross" : "none";
        end = q + m[0].length;
      } else return null;
    }
    const k = skipSpaces(s, end);
    if (s[k] === "|") {
      const close = s.indexOf("|", k + 1);
      if (close > 0) {
        label = s.slice(k + 1, close);
        end = close + 1;
      }
    }
    const out: Link = { line, head, tail, end };
    if (label !== undefined) out.label = decodeLabel(label, flags);
    return out;
  };

  for (let si = 1; si < stmts.length; si++) {
    const { text: s, line } = stmts[si]!;
    const kw = /^(\w+)\b\s*(.*)$/.exec(s);
    const word = kw?.[1] ?? "";
    const rest = kw?.[2] ?? "";
    if (word === "subgraph" && /^subgraph(\s|$)/.test(s)) {
      let id: string;
      let title: string;
      const bracket = /^([^\s[]+)\s*\[(.*)\]$/.exec(rest);
      if (bracket) {
        id = bracket[1]!;
        title = decodeLabel(bracket[2]!, flags);
      } else {
        title = decodeLabel(rest, flags);
        id = title;
      }
      const g: ImportGroup = { id, title, look: {} };
      if (stack.length) g.parent = stack[stack.length - 1]!;
      groups.push(g);
      stack.push(groups.length - 1);
      continue;
    }
    if (s === "end") {
      if (stack.length) stack.pop();
      else skipped.push(`line ${line}: end without a subgraph`);
      continue;
    }
    if (word === "direction" && /^direction\s+(TB|TD|BT|RL|LR)$/i.test(s)) continue;
    if (/^(accTitle|accDescr)\s*[:{]/.test(s) || /^title\s/.test(s)) continue;
    if (word === "style") {
      const m = /^style\s+(\S+)\s+(.*)$/.exec(s);
      if (m) {
        const { look, ignored } = parseLook(m[2]!);
        for (const id of m[1]!.split(",")) styled.set(id, { ...(styled.get(id) ?? {}), ...look });
        for (const k of ignored) ignoredProps.add(k);
      } else skipped.push(`line ${line}: ${s}`);
      continue;
    }
    if (word === "classDef") {
      const m = /^classDef\s+(\S+)\s+(.*)$/.exec(s);
      if (m) {
        const { look, ignored } = parseLook(m[2]!);
        for (const name of m[1]!.split(",")) classes.push({ name, look });
        for (const k of ignored) ignoredProps.add(k);
      } else skipped.push(`line ${line}: ${s}`);
      continue;
    }
    if (word === "class" && /^class\s+\S+\s+\S+$/.test(s)) {
      const m = /^class\s+(\S+)\s+(\S+)$/.exec(s)!;
      for (const id of m[1]!.split(",")) classed.set(id, [...(classed.get(id) ?? []), m[2]!]);
      continue;
    }
    if (word === "linkStyle") {
      const m = /^linkStyle\s+(default|[\d,\s]+)\s+(.*)$/.exec(s);
      if (m) {
        const { look, ignored } = parseLook(m[2]!);
        for (const k of ignored) ignoredProps.add(k);
        linkStyles.push({ which: m[1] === "default" ? "default" : m[1]!.split(",").map((x) => +x.trim()), look });
      } else skipped.push(`line ${line}: ${s}`);
      continue;
    }
    if (word === "click" || word === "callback" || word === "href") {
      skipped.push(`line ${line}: click handlers`);
      continue;
    }
    // A node, or a chain of nodes and links.
    const first = readGroup(s, 0, line);
    if (!first) {
      skipped.push(`line ${line}: ${s.length > 40 ? `${s.slice(0, 40)}…` : s}`);
      continue;
    }
    // The whole statement is read before anything is kept: half a statement is no statement.
    const chain: Array<{ link?: Link; specs: NodeSpec[] }> = [{ specs: first.specs }];
    let j = first.end;
    let leftover: string | null = null;
    for (;;) {
      j = skipSpaces(s, j);
      if (j >= s.length) break;
      const link = readLink(s, j);
      const next = link ? readGroup(s, link.end, line) : null;
      if (!link || !next) {
        leftover = s.slice(j);
        break;
      }
      chain.push({ link, specs: next.specs });
      j = next.end;
    }
    if (leftover !== null) {
      skipped.push(`line ${line}: ${s.length > 40 ? `${s.slice(0, 40)}…` : s}`);
      continue;
    }
    for (const part of chain) for (const n of part.specs) addNode(n, line);
    for (let k = 1; k < chain.length; k++) {
      const link = chain[k]!.link!;
      for (const a of chain[k - 1]!.specs) {
        for (const b of chain[k]!.specs) {
          const e: ImportEdge = { from: a.id, to: b.id, line: link.line, head: link.head, tail: link.tail, look: {} };
          if (link.label) e.label = link.label;
          edges.push(e);
        }
      }
    }
  }

  // Subgraph ids named in links are the group, not a node.
  const groupIds = new Set(groups.map((g) => g.id));
  for (const id of groupIds) {
    const n = nodes.get(id);
    if (n && !n.label && n.shape === "process" && !n.classes.length) nodes.delete(id);
  }
  for (const [id, look] of styled) {
    const n = nodes.get(id);
    if (n) n.look = look;
    else {
      const g = groups.find((x) => x.id === id);
      if (g) g.look = look;
    }
  }
  for (const [id, names] of classed) {
    const n = nodes.get(id);
    if (n) for (const c of names) if (!n.classes.includes(c)) n.classes.push(c);
  }
  for (const n of nodes.values()) {
    if (!n.label && !(n.shape === "plain")) n.label = n.id;
  }
  // `default` first, so a numbered style wins over it wherever it was written.
  linkStyles.sort((x, y) => Number(y.which === "default") - Number(x.which === "default"));
  for (const ls of linkStyles) {
    const targets = ls.which === "default" ? edges.map((_, i) => i) : ls.which;
    for (const i of targets) if (edges[i]) edges[i]!.look = { ...edges[i]!.look, ...ls.look };
  }
  linkStyles = [];

  // Classes that nothing uses are kept out; `default` applies to every node without a class.
  const defaultClass = classes.find((c) => c.name === "default");
  if (defaultClass) for (const n of nodes.values()) if (!n.classes.length) n.classes.push("default");
  for (const n of nodes.values()) {
    for (const c of n.classes) if (!classes.some((k) => k.name === c)) n.classes = n.classes.filter((x) => x !== c);
  }

  if (flags.html) notes.push("HTML in labels was reduced to its text.");
  if (flags.icons) notes.push("Font Awesome icons in labels were left out.");
  if (flags.markdown) notes.push("Markdown marks in labels were removed.");
  if (ignoredProps.size) notes.push(`Style properties without a TikZ counterpart were ignored: ${[...ignoredProps].slice(0, 6).join(", ")}${ignoredProps.size > 6 ? ", …" : ""}.`);
  if (skipped.length) notes.push(`${skipped.length === 1 ? "One statement wasn't" : `${skipped.length} statements weren't`} understood and ${skipped.length === 1 ? "was" : "were"} left out (${skipped.slice(0, 3).join("; ")}${skipped.length > 3 ? "; …" : ""}).`);

  return {
    format: "mermaid",
    direction: dir === "LR" || dir === "RL" ? "right" : "down",
    nodes: [...nodes.values()],
    edges,
    groups,
    classes,
    notes,
  };
}
