// The syntax layer: turns the Lezer tree into plain objects with exact source
// ranges. It only describes what is written; src/tikz interprets it.
import type { SyntaxNode, Tree } from "@lezer/common";
import {
  bodyGroupRole,
  children,
  environmentMarker,
  groupContent,
  isScopeSyntax,
  nextSibling,
  opaqueCs,
} from "../parser/structure.ts";
import { stripBraces } from "../tikz/options.ts";

export interface Range {
  from: number;
  to: number;
}

/** One "key=value" entry of an option list. */
export interface OptionItem extends Range {
  /** The key with comments removed and whitespace collapsed, e.g. "below of". */
  key: string;
  keyRange: Range;
  /** The value with comments removed and whitespace collapsed. Undefined when there is no "=". */
  value?: string;
  valueRange?: Range;
  /** The value's tree node, for values that are option lists themselves. */
  valueNode?: SyntaxNode;
}

/** An option list in "[...]" or "{...}", including the delimiters. */
export interface OptionList extends Range {
  items: OptionItem[];
  /** Positions of the separating commas, in order. */
  commas: number[];
}

export interface NodeSyntax extends Range {
  /** "statement" for \node, "path" for "node" inside a path, "coordinate" for \coordinate and path "coordinate". */
  kind: "statement" | "path" | "coordinate";
  keyword: Range;
  /** Option lists before the label, in order. */
  options: OptionList[];
  name?: { range: Range; inner: Range; text: string };
  at?: { range: Range; coord: CoordSyntax };
  /** The label including its braces. Coordinates have none. */
  label?: { range: Range; inner: Range; text: string };
}

export interface CoordSyntax extends Range {
  /** Text between the parentheses, with comments removed. */
  text: string;
  inner: Range;
  /** "++" or "+" when relative. */
  relative?: "+" | "++";
}

export type PathItemSyntax =
  | { kind: "coord"; coord: CoordSyntax }
  | { kind: "op"; op: "--" | "-|" | "|-" | ".."; range: Range }
  | { kind: "options"; list: OptionList }
  | { kind: "node"; node: NodeSyntax }
  | { kind: "keyword"; word: string; range: Range }
  | { kind: "unknown"; text: string; range: Range };

export interface PathSyntax extends Range {
  /** "\draw", "\path", "\fill", "\filldraw", or "\node" for a node statement's trailing path. */
  command: string;
  keyword: Range;
  items: PathItemSyntax[];
}

export type BodyItem =
  | { kind: "node"; node: NodeSyntax; trailing?: PathSyntax }
  | { kind: "path"; path: PathSyntax }
  | { kind: "styles"; range: Range; defs: StyleDef[]; settings: OptionList[] }
  | { kind: "library"; range: Range; names: string[]; list?: OptionList }
  | { kind: "scope-begin"; range: Range; options?: OptionList }
  | { kind: "scope-end"; range: Range }
  | { kind: "opaque"; range: Range; reason: OpaqueReason; names: string[]; text: string }
  | { kind: "definition"; range: Range; def: Definition };

/** Why a block is kept as-is. "environment" is a \begin/\end marker (pgfonlayer, ...) whose content is still modelled. */
export type OpaqueReason = "foreach" | "matrix" | "command" | "environment" | "error";

/** A style definition: "name/.style={...}", "\tikzstyle{name}=[...]", and so on. */
export interface StyleDef extends Range {
  name: string;
  /** "set" replaces the style, "append" adds to it. */
  mode: "set" | "append";
  /** The style body. Undefined for forms the editor doesn't understand. */
  body?: OptionList;
  /** The body as text, for styles with arguments (#1). */
  bodyText: string;
  /** Default argument from "name/.default=...". */
  defaultArg?: string;
}

export type Definition =
  | { kind: "color"; name: string; model: string; spec: string }
  | { kind: "colorlet"; name: string; expr: string }
  | { kind: "macro"; name: string; params: number; defaultArg?: string; body: string };

export interface PictureSyntax extends Range {
  begin: Range;
  end: Range;
  options?: OptionList;
  items: BodyItem[];
}

export interface DocumentSyntax {
  pictures: PictureSyntax[];
  /** Definitions outside pictures, in document order. */
  preamble: Array<
    | { kind: "styles"; range: Range; defs: StyleDef[]; settings: OptionList[] }
    | { kind: "library"; range: Range; names: string[]; list?: OptionList }
    | { kind: "definition"; range: Range; def: Definition }
  >;
}

const SKIP = new Set(["Whitespace", "Comment"]);

/** The text of a node with comments removed and whitespace runs collapsed to one space. */
export function cleanText(node: SyntaxNode, text: string): string {
  let out = "";
  const walk = (n: SyntaxNode) => {
    if (n.name === "Comment") return;
    if (n.name === "Whitespace") {
      if (!out.endsWith(" ")) out += " ";
      return;
    }
    let c = n.firstChild;
    if (!c) {
      out += text.slice(n.from, n.to);
      return;
    }
    let pos = n.from;
    for (; c; c = c.nextSibling) {
      // Bytes an error node skipped without a child (see D18).
      if (c.from > pos) out += text.slice(pos, c.from);
      walk(c);
      pos = c.to;
    }
    if (n.to > pos) out += text.slice(pos, n.to);
  };
  walk(node);
  return out.trim();
}

/** Like cleanText but for a range of sibling nodes. */
function cleanTextOfRange(first: SyntaxNode, last: SyntaxNode, text: string): string {
  const parts: string[] = [];
  for (let n: SyntaxNode | null = first; n; n = n.nextSibling) {
    if (n.name === "Whitespace") parts.push(" ");
    else if (n.name !== "Comment") parts.push(cleanText(n, text));
    if (n.from === last.from && n.to === last.to) break;
  }
  return parts.join("").replace(/\s+/g, " ").trim();
}

export function optionList(node: SyntaxNode, text: string): OptionList {
  const items: OptionItem[] = [];
  const commas: number[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.name === ",") commas.push(c.from);
    if (c.name !== "Option") continue;
    const keyNode = c.getChild("OptionKey");
    const valueNode = c.getChild("OptionValue");
    if (!keyNode) continue;
    const item: OptionItem = {
      from: c.from,
      to: c.to,
      key: cleanText(keyNode, text),
      keyRange: { from: keyNode.from, to: keyNode.to },
    };
    if (c.getChild("=")) {
      item.value = valueNode ? cleanText(valueNode, text) : "";
      if (valueNode) {
        item.valueRange = { from: valueNode.from, to: valueNode.to };
        const only = children(valueNode);
        if (only.length === 1 && (only[0]!.name === "OptionBlock" || only[0]!.name === "Options")) item.valueNode = only[0]!;
      }
    }
    items.push(item);
  }
  return { from: node.from, to: node.to, items, commas };
}

function coordSyntax(node: SyntaxNode, text: string, relative?: "+" | "++", outer?: SyntaxNode): CoordSyntax {
  const open = node.firstChild;
  const close = node.lastChild?.name === ")" ? node.lastChild : null;
  const inner = { from: open ? open.to : node.from, to: close ? close.from : node.to };
  const first = open?.nextSibling;
  const last = close ? close.prevSibling : node.lastChild;
  const t = first && last && first !== close && first.from <= last.from ? cleanTextOfRange(first, last, text) : "";
  const range = outer ?? node;
  const out: CoordSyntax = { from: range.from, to: range.to, text: t, inner };
  if (relative) out.relative = relative;
  return out;
}

function nodeSyntax(node: SyntaxNode, text: string, kind: NodeSyntax["kind"]): NodeSyntax {
  const kw = node.firstChild!;
  const out: NodeSyntax = { from: node.from, to: node.to, kind, keyword: { from: kw.from, to: kw.to }, options: [] };
  for (const c of children(node)) {
    if (c.name === "Options") out.options.push(optionList(c, text));
    else if (c.name === "NodeName") {
      const inner = { from: c.from + 1, to: c.lastChild?.name === ")" ? c.to - 1 : c.to };
      out.name = { range: { from: c.from, to: c.to }, inner, text: cleanText(c, text).replace(/^\(\s*|\s*\)$/g, "") };
    } else if (c.name === "AtClause") {
      const coord = c.getChild("Coordinate");
      if (coord) out.at = { range: { from: c.from, to: c.to }, coord: coordSyntax(coord, text) };
    } else if (c.name === "Label") {
      const inner = { from: c.from + 1, to: c.lastChild?.name === "}" ? c.to - 1 : c.to };
      out.label = { range: { from: c.from, to: c.to }, inner, text: text.slice(inner.from, inner.to) };
      break;
    }
  }
  return out;
}

function pathItems(nodes: SyntaxNode[], text: string): PathItemSyntax[] {
  const items: PathItemSyntax[] = [];
  for (const c of nodes) {
    switch (c.name) {
      case "Coordinate":
        items.push({ kind: "coord", coord: coordSyntax(c, text) });
        break;
      case "RelativeCoordinate": {
        const sign = c.firstChild!.name as "+" | "++";
        const coord = c.getChild("Coordinate");
        if (coord) items.push({ kind: "coord", coord: coordSyntax(coord, text, sign, c) });
        break;
      }
      case "PathOperator":
        items.push({ kind: "op", op: text.slice(c.from, c.to) as "--", range: { from: c.from, to: c.to } });
        break;
      case "Options":
        items.push({ kind: "options", list: optionList(c, text) });
        break;
      case "PathNode":
        items.push({ kind: "node", node: nodeSyntax(c, text, "path") });
        break;
      case "PathCoordinate":
        items.push({ kind: "node", node: nodeSyntax(c, text, "coordinate") });
        break;
      case "PathKeyword":
        items.push({ kind: "keyword", word: text.slice(c.from, c.to), range: { from: c.from, to: c.to } });
        break;
      case ";":
        break;
      default:
        items.push({ kind: "unknown", text: text.slice(c.from, c.to), range: { from: c.from, to: c.to } });
    }
  }
  return items;
}

/** Parses "name/.style={...}" and friends out of a \tikzset option list. */
function styleDefs(list: OptionList, text: string): { defs: StyleDef[]; settings: OptionItem[] } {
  const defs: StyleDef[] = [];
  const settings: OptionItem[] = [];
  for (const item of list.items) {
    const m = /^(.*?)\s*\/\.(style|append style|prefix style|default|code|style 2 args|estyle)$/.exec(item.key);
    if (!m) {
      settings.push(item);
      continue;
    }
    const [, name, handler] = m as unknown as [string, string, string];
    const valueText = item.value ?? "";
    const def: StyleDef = { from: item.from, to: item.to, name: name.trim(), mode: "set", bodyText: stripBraces(valueText) };
    if (handler === "default") {
      def.defaultArg = stripBraces(valueText);
      def.mode = "append";
      def.bodyText = "";
    } else {
      if (handler === "append style" || handler === "prefix style") def.mode = "append";
      if (item.valueNode && item.valueNode.name === "OptionBlock") def.body = optionList(item.valueNode, text);
      else if (item.valueRange) def.body = { from: item.valueRange.from, to: item.valueRange.to, items: [], commas: [] };
      if (handler === "code") delete def.body;
    }
    defs.push(def);
  }
  return { defs, settings };
}


function tikzsetItem(node: SyntaxNode, text: string): BodyItem & { kind: "styles" } {
  const block = node.getChild("OptionBlock");
  const range = { from: node.from, to: node.to };
  if (!block) return { kind: "styles", range, defs: [], settings: [] };
  const list = optionList(block, text);
  const { defs, settings } = styleDefs(list, text);
  const settingsList: OptionList[] = settings.length ? [{ ...list, items: settings }] : [];
  return { kind: "styles", range, defs, settings: settingsList };
}

function tikzstyleItem(node: SyntaxNode, text: string): BodyItem & { kind: "styles" } {
  const range = { from: node.from, to: node.to };
  const nameNode = node.getChild("StyleName");
  const opts = node.getChild("Options");
  let name = nameNode ? stripBraces(cleanText(nameNode, text)) : "";
  let mode: StyleDef["mode"] = node.getChild("+=") ? "append" : "set";
  // "\tikzstyle arrow+=[...]" tokenises as name "arrow+" then "=".
  if (name.endsWith("+")) {
    name = name.slice(0, -1).trim();
    mode = "append";
  }
  const body = opts ? optionList(opts, text) : undefined;
  const def: StyleDef = { from: node.from, to: node.to, name, mode, bodyText: opts ? cleanText(opts, text).slice(1, -1) : "" };
  if (body) def.body = body;
  return { kind: "styles", range, defs: name ? [def] : [], settings: [] };
}

function libraryItem(node: SyntaxNode, text: string): BodyItem & { kind: "library" } {
  const block = node.getChild("OptionBlock");
  if (!block) return { kind: "library", range: { from: node.from, to: node.to }, names: [] };
  const list = optionList(block, text);
  return { kind: "library", range: { from: node.from, to: node.to }, names: list.items.map((i) => i.key).filter(Boolean), list };
}

/** Reads a "\cs{arg}{arg}..." definition out of a run of siblings. Returns the definition and the last node consumed. */
function readDefinition(
  first: SyntaxNode,
  text: string,
  isGroup: (n: SyntaxNode) => boolean,
): { def: Definition; last: SyntaxNode } | null {
  const cs = text.slice(first.from, first.to);
  const args: SyntaxNode[] = [];
  let last = first;
  const take = (n: number) => {
    for (let s = nextSibling(last); s && args.length < n && isGroup(s); s = nextSibling(last)) {
      args.push(s);
      last = s;
    }
    return args.length === n;
  };
  const content = (n: SyntaxNode) => groupContent(n, text);
  if (cs === "\\definecolor" || cs === "\\providecolor") {
    if (!take(3)) return null;
    return { def: { kind: "color", name: content(args[0]!), model: content(args[1]!), spec: content(args[2]!) }, last };
  }
  if (cs === "\\colorlet") {
    if (!take(2)) return null;
    return { def: { kind: "colorlet", name: content(args[0]!), expr: content(args[1]!) }, last };
  }
  if (cs === "\\newcommand" || cs === "\\renewcommand" || cs === "\\providecommand" || cs === "\\def") {
    // Name: {\foo} or \foo.
    const n1 = nextSibling(first);
    if (!n1) return null;
    let name: string;
    if (n1.name === "ControlSequence" || opaqueCs(n1, text)) name = text.slice(n1.from, n1.to);
    else if (isGroup(n1)) name = content(n1);
    else return null;
    if (!/^\\[a-zA-Z@]+$/.test(name)) return null;
    last = n1;
    let params = 0;
    let defaultArg: string | undefined;
    // Optional [n] and [default] (\newcommand), or #1#2 (\def). They tokenise as plain text.
    for (let s = nextSibling(last); s && !isGroup(s); s = nextSibling(last)) {
      const t = text.slice(s.from, s.to);
      const count = /^\[(\d)\]$/.exec(t);
      const dflt = /^\[(.*)\]$/.exec(t);
      const hashes = /^(#\d)+$/.exec(t);
      if (count && cs !== "\\def") params = +count[1]!;
      else if (dflt && cs !== "\\def") defaultArg = dflt[1]!;
      else if (hashes && cs === "\\def") params = t.length / 2;
      else return null;
      last = s;
    }
    const body = nextSibling(last);
    if (!body || !isGroup(body)) return null;
    last = body;
    const def: Definition = { kind: "macro", name, params, body: text.slice(body.from + 1, body.to - 1) };
    if (defaultArg !== undefined) def.defaultArg = defaultArg;
    return { def, last };
  }
  return null;
}

// Delimiters of the picture or scope group itself, not body items.
const FRAME = new Set(["BeginTikz", "EndTikz", "PictureOptions", "{", "}"]);

/**
 * Collects the items of a picture body (or a scope group inside one).
 * `skip` is a node to leave out, used for a brace scope's options.
 */
function bodyItems(parent: SyntaxNode, text: string, out: BodyItem[], skip?: SyntaxNode): void {
  const kids = children(parent).filter((n) => !FRAME.has(n.name) && !(skip && n.from === skip.from && n.to === skip.to));
  let i = 0;
  // Consecutive opaque items merge into one block.
  const pushOpaque = (range: Range, reason: OpaqueReason, names: string[] = []) => {
    const prev = out[out.length - 1];
    if (prev && prev.kind === "opaque" && prev.reason === reason && reason === "command" && /^\s*$/.test(text.slice(prev.range.to, range.from))) {
      prev.range = { from: prev.range.from, to: range.to };
      prev.text = text.slice(prev.range.from, prev.range.to);
      return;
    }
    out.push({ kind: "opaque", range, reason, names, text: text.slice(range.from, range.to) });
  };
  for (; i < kids.length; i++) {
    const c = kids[i]!;
    const range = { from: c.from, to: c.to };
    if (c.type.isError) {
      pushOpaque(range, "error");
      continue;
    }
    switch (c.name) {
      case "NodeStatement": {
        const node = nodeSyntax(c, text, "statement");
        const label = c.getChild("Label");
        const after: SyntaxNode[] = [];
        for (let s = label?.nextSibling; s; s = s.nextSibling) if (!SKIP.has(s.name)) after.push(s);
        const items = pathItems(after, text);
        if (items.length) {
          out.push({ kind: "node", node, trailing: { ...range, command: "\\node", keyword: node.keyword, items } });
        } else out.push({ kind: "node", node });
        break;
      }
      case "CoordinateStatement": {
        const node = nodeSyntax(c, text, "coordinate");
        const tailStart = children(c).find((n) => !["CoordinateKw", "Options", "NodeName", "AtClause", ";"].includes(n.name));
        if (tailStart) {
          const tail = children(c).filter((n) => n.from >= tailStart.from);
          out.push({
            kind: "node",
            node,
            trailing: { ...range, command: "\\path", keyword: node.keyword, items: pathItems(tail, text) },
          });
        } else out.push({ kind: "node", node });
        break;
      }
      case "PathStatement": {
        const kw = c.firstChild!;
        const rest = children(c).slice(1);
        out.push({
          kind: "path",
          path: { ...range, command: text.slice(kw.from, kw.to), keyword: { from: kw.from, to: kw.to }, items: pathItems(rest, text) },
        });
        break;
      }
      case "Tikzset":
        out.push(tikzsetItem(c, text));
        break;
      case "TikzStyle":
        out.push(tikzstyleItem(c, text));
        break;
      case "UseTikzLibrary":
        out.push(libraryItem(c, text));
        break;
      case "Foreach":
        pushOpaque(range, "foreach");
        break;
      case "MatrixStatement": {
        const name = c.getChild("NodeName");
        pushOpaque(range, "matrix", name ? [cleanText(name, text).replace(/^\(\s*|\s*\)$/g, "")] : []);
        break;
      }
      case "BodyGroup": {
        if (bodyGroupRole(c, text) === "scope") {
          const first = children(c).find((n) => n.name !== "{");
          const hasOptions = first?.name === "Opaque" && first.firstChild?.name === "Options";
          const begin: BodyItem = { kind: "scope-begin", range: { from: c.from, to: hasOptions ? first.to : c.from + 1 } };
          if (hasOptions) begin.options = optionList(first.firstChild!, text);
          out.push(begin);
          bodyItems(c, text, out, hasOptions ? first : undefined);
          out.push({ kind: "scope-end", range: { from: c.to - 1, to: c.to } });
        } else pushOpaque(range, "command");
        break;
      }
      case "Opaque": {
        const env = environmentMarker(c, text);
        if (env && env.name === "scope") {
          const end = env.group;
          let to = end.to;
          let options: OptionList | undefined;
          const next = kids[i + 2];
          if (env.kind === "begin" && next && next.name === "Opaque" && next.firstChild?.name === "Options" && isScopeSyntax(next, text)) {
            options = optionList(next.firstChild, text);
            to = next.to;
            i++;
          }
          i++; // the {scope} group
          if (env.kind === "begin") {
            const item: BodyItem = { kind: "scope-begin", range: { from: c.from, to } };
            if (options) item.options = options;
            out.push(item);
          } else out.push({ kind: "scope-end", range: { from: c.from, to } });
          break;
        }
        if (env) {
          // Other environments (pgfonlayer, ...) are transparent: keep the
          // marker and its arguments as one opaque block.
          let last: SyntaxNode = env.group;
          i++;
          while (env.kind === "begin" && kids[i + 1]?.name === "BodyGroup" && bodyGroupRole(kids[i + 1]!, text) === "argument") {
            last = kids[++i]!;
          }
          pushOpaque({ from: c.from, to: last.to }, "environment");
          break;
        }
        const cs = opaqueCs(c, text);
        if (cs) {
          const def = readDefinition(c, text, (n) => n.name === "BodyGroup");
          if (def) {
            out.push({ kind: "definition", range: { from: c.from, to: def.last.to }, def: def.def });
            while (kids[i] && kids[i]!.to < def.last.to) i++;
            break;
          }
        }
        pushOpaque(range, "command");
        break;
      }
      default:
        pushOpaque(range, "command");
    }
  }
}

function pictureSyntax(node: SyntaxNode, text: string): PictureSyntax {
  const begin = node.getChild("BeginTikz")!;
  const end = node.getChild("EndTikz");
  const opts = node.getChild("PictureOptions")?.getChild("Options");
  const pic: PictureSyntax = {
    from: node.from,
    to: node.to,
    begin: { from: begin.from, to: begin.to },
    end: end ? { from: end.from, to: end.to } : { from: node.to, to: node.to },
    items: [],
  };
  if (opts) pic.options = optionList(opts, text);
  bodyItems(node, text, pic.items);
  return pic;
}

/** Extracts every picture and the definitions around them. */
export function documentSyntax(tree: Tree, text: string): DocumentSyntax {
  const doc: DocumentSyntax = { pictures: [], preamble: [] };
  const top = children(tree.topNode);
  const isGroup = (n: SyntaxNode) => n.name === "Group";
  for (let i = 0; i < top.length; i++) {
    const c = top[i]!;
    switch (c.name) {
      case "Tikzset":
        doc.preamble.push(tikzsetItem(c, text));
        break;
      case "TikzStyle":
        doc.preamble.push(tikzstyleItem(c, text));
        break;
      case "UseTikzLibrary":
        doc.preamble.push(libraryItem(c, text));
        break;
      case "ControlSequence": {
        const def = readDefinition(c, text, isGroup);
        if (def) {
          doc.preamble.push({ kind: "definition", range: { from: c.from, to: def.last.to }, def: def.def });
          while (top[i + 1] && top[i + 1]!.to <= def.last.to) i++;
        }
        break;
      }
    }
  }
  // Pictures anywhere in the document, except inside other pictures.
  tree.iterate({
    enter: (n) => {
      if (n.name === "TikzPicture") {
        doc.pictures.push(pictureSyntax(n.node, text));
        return false;
      }
      return undefined;
    },
  });
  return doc;
}
