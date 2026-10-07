import { IterMode, type SyntaxNode, type Tree } from "@lezer/common";
import { parser } from "./parser.ts";
import { bodyGroupRole, isScopeSyntax } from "./structure.ts";

export { parser };

export interface Leaf {
  from: number;
  to: number;
  name: string;
  node: SyntaxNode;
}

/**
 * All leaf nodes (nodes without children), in document order.
 *
 * During error recovery Lezer can skip a character that no token valid in the
 * current context matches (a ";" inside a coordinate, say). The skipped
 * character lies inside the error node's range but gets no node of its own.
 * Those bytes are still represented, by the error node, so they are reported
 * as synthetic leaves named "⚠" whose node is the error node. A gap anywhere
 * else is a real coverage failure.
 */
export function leaves(tree: Tree): Leaf[] {
  const out: Leaf[] = [];
  const c = tree.cursor(IterMode.IncludeAnonymous);
  // Error nodes we are inside, with the position covered so far in each.
  const errors: Array<{ node: SyntaxNode; pos: number }> = [];
  const fillErrorGap = (upTo: number) => {
    const e = errors[errors.length - 1];
    if (e && upTo > e.pos) out.push({ from: e.pos, to: upTo, name: "⚠", node: e.node });
  };
  const advance = (to: number) => {
    for (const e of errors) e.pos = Math.max(e.pos, to);
  };
  for (;;) {
    fillErrorGap(c.from);
    advance(c.from);
    if (c.type.isError) errors.push({ node: c.node, pos: c.from });
    if (!c.firstChild()) {
      out.push({ from: c.from, to: c.to, name: c.name, node: c.node });
      advance(c.to);
      for (;;) {
        if (c.type.isError) {
          fillErrorGap(c.to);
          errors.pop();
          advance(c.to);
        }
        if (c.nextSibling()) break;
        if (!c.parent()) return out;
      }
    }
  }
}

export interface Coverage {
  /** True when the non-empty leaves tile the whole input exactly once. */
  ok: boolean;
  /** Byte ranges not covered by any leaf. */
  gaps: Array<[number, number]>;
  /** Byte ranges covered by more than one leaf. */
  overlaps: Array<[number, number]>;
  /** Non-empty leaves whose node type is anonymous (a grammar bug). */
  anonymousLeaves: Leaf[];
  /** Joining the text of every leaf reproduces the input. */
  reconstructs: boolean;
}

export function checkCoverage(tree: Tree, text: string): Coverage {
  const gaps: Array<[number, number]> = [];
  const overlaps: Array<[number, number]> = [];
  const anonymousLeaves: Leaf[] = [];
  let pos = 0;
  let rebuilt = "";
  for (const leaf of leaves(tree)) {
    if (leaf.to === leaf.from) continue; // inserted-token error markers
    if (leaf.node.type.isAnonymous) anonymousLeaves.push(leaf);
    if (leaf.from > pos) gaps.push([pos, leaf.from]);
    if (leaf.from < pos) overlaps.push([leaf.from, Math.min(pos, leaf.to)]);
    rebuilt += text.slice(leaf.from, leaf.to);
    pos = Math.max(pos, leaf.to);
  }
  if (pos < text.length) gaps.push([pos, text.length]);
  const reconstructs = rebuilt === text;
  return {
    ok: gaps.length === 0 && overlaps.length === 0 && anonymousLeaves.length === 0 && reconstructs,
    gaps,
    overlaps,
    anonymousLeaves,
    reconstructs,
  };
}

export type Category = "modelled" | "opaque" | "error" | "document";

const OPAQUE = new Set(["Opaque", "UnknownPathItem", "Foreach", "MatrixStatement"]);
const MODELLED = new Set(["TikzPicture", "Tikzset", "TikzStyle", "UseTikzLibrary"]);

/**
 * Which category a leaf's bytes belong to:
 * - error: inside a parse-error node
 * - opaque: inside a construct kept as generic tokens, \foreach, \matrix, or
 *   a brace group that is an argument of an unknown command
 * - modelled: inside a picture, \tikzset, \tikzstyle, or \usetikzlibrary with
 *   real structure, including scope markers and scope options
 * - document: ordinary document text outside any of those
 */
export function categorize(leaf: Leaf, text: string): Category {
  let category: Category = "document";
  for (let n: SyntaxNode | null = leaf.node; n; n = n.parent) {
    if (n.type.isError) return "error";
    if (category === "opaque") continue;
    const opaque =
      (OPAQUE.has(n.name) || (n.name === "BodyGroup" && bodyGroupRole(n, text) === "argument")) &&
      !isScopeSyntax(n, text);
    if (opaque) category = "opaque";
    else if (category === "document" && MODELLED.has(n.name)) category = "modelled";
  }
  return category;
}

export interface Breakdown {
  bytes: Record<Category, number>;
  /** Number of error nodes, including zero-length "missing token" markers. */
  errorNodes: number;
}

export function breakdown(tree: Tree, text: string): Breakdown {
  const bytes: Record<Category, number> = { modelled: 0, opaque: 0, error: 0, document: 0 };
  for (const leaf of leaves(tree)) bytes[categorize(leaf, text)] += leaf.to - leaf.from;
  let errorNodes = 0;
  tree.iterate({
    mode: IterMode.IncludeAnonymous,
    enter: (n) => {
      if (n.type.isError) errorNodes++;
    },
  });
  return { bytes, errorNodes };
}

/**
 * A position-exact dump of the tree's named nodes, used to compare two
 * parses. Anonymous nodes are left out: every token is named (D9), so the
 * only anonymous nodes are the ones Lezer inserts to balance long repetitions,
 * and their shape legitimately differs between incremental and full parses.
 */
export function dump(tree: Tree): string {
  const parts: string[] = [];
  tree.iterate({
    enter: (n) => {
      parts.push(`${n.name}@${n.from}-${n.to}(`);
    },
    leave: () => {
      parts.push(")");
    },
  });
  return parts.join("");
}

/** Count nodes by type name. */
export function countNodes(tree: Tree, names: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(names.map((n) => [n, 0]));
  tree.iterate({
    enter: (n) => {
      if (n.name in counts) counts[n.name] = (counts[n.name] ?? 0) + 1;
    },
  });
  return counts;
}
