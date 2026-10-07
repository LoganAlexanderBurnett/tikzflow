// Structural helpers shared by the analysis tools and the semantic layer.
// They answer questions the grammar can't settle by itself, such as whether a
// brace group in a picture body is a scope or an argument of some command.
import type { SyntaxNode } from "@lezer/common";

const SKIP = new Set(["Whitespace", "Comment"]);

/** The previous sibling that isn't whitespace or a comment. */
export function prevSibling(node: SyntaxNode): SyntaxNode | null {
  let n = node.prevSibling;
  while (n && SKIP.has(n.name)) n = n.prevSibling;
  return n;
}

/** The next sibling that isn't whitespace or a comment. */
export function nextSibling(node: SyntaxNode): SyntaxNode | null {
  let n = node.nextSibling;
  while (n && SKIP.has(n.name)) n = n.nextSibling;
  return n;
}

/** Child nodes that aren't whitespace or comments. */
export function children(node: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling) if (!SKIP.has(c.name)) out.push(c);
  return out;
}

/** The control sequence an Opaque item consists of, e.g. "\\begin", or null. */
export function opaqueCs(node: SyntaxNode, text: string): string | null {
  if (node.name !== "Opaque") return null;
  const c = node.firstChild;
  return c && c.name === "ControlSequence" ? text.slice(c.from, c.to) : null;
}

/** The text between a group's braces, trimmed. */
export function groupContent(node: SyntaxNode, text: string): string {
  return text.slice(node.from + 1, node.to - 1).trim();
}

/**
 * Whether a brace group in a picture body is a scope ("{[red] \draw...;}") or
 * the argument of a command the editor doesn't model (\begin{scope},
 * \pgfonlayer{...}, \pic ... {name}).
 *
 * It's an argument when, walking back over other arguments and options, the
 * first thing reached is a control sequence. "\end" takes exactly one
 * argument. A body text item ending in ";" ends a statement, so a group after
 * it is a scope.
 */
export function bodyGroupRole(node: SyntaxNode, text: string): "scope" | "argument" {
  let argsSeen = 0;
  for (let p = prevSibling(node); p; p = prevSibling(p)) {
    if (p.name === "BodyGroup") {
      argsSeen++;
      continue;
    }
    if (p.name !== "Opaque") return "scope";
    const inner = p.firstChild;
    if (!inner) return "scope";
    if (inner.name === "Options") continue;
    if (inner.name === "BodyText") {
      if (text.slice(inner.from, inner.to).endsWith(";")) return "scope";
      continue;
    }
    if (inner.name === "ControlSequence") {
      const cs = text.slice(inner.from, inner.to);
      if (cs === "\\end" && argsSeen >= 1) return "scope";
      return "argument";
    }
    return "scope";
  }
  return "scope";
}

/**
 * For an Opaque control sequence that opens or closes an environment
 * ("\begin{scope}", "\end{pgfonlayer}"), the environment name and whether it
 * begins or ends. Returns null for anything else.
 */
export function environmentMarker(
  node: SyntaxNode,
  text: string,
): { kind: "begin" | "end"; name: string; group: SyntaxNode } | null {
  const cs = opaqueCs(node, text);
  if (cs !== "\\begin" && cs !== "\\end") return null;
  const g = nextSibling(node);
  if (!g || g.name !== "BodyGroup") return null;
  return { kind: cs === "\\begin" ? "begin" : "end", name: groupContent(g, text), group: g };
}

/**
 * Whether an Opaque item or argument group is part of scope syntax the
 * semantic layer understands: the "\begin{scope}" and "\end{scope}" markers,
 * the options after "\begin{scope}", and the options that open a brace scope.
 */
export function isScopeSyntax(node: SyntaxNode, text: string): boolean {
  if (node.name === "BodyGroup") {
    const p = prevSibling(node);
    const env = p && environmentMarker(p, text);
    return !!env && env.group.from === node.from && env.name === "scope";
  }
  if (node.name !== "Opaque") return false;
  const env = environmentMarker(node, text);
  if (env) return env.name === "scope";
  if (node.firstChild?.name !== "Options") return false;
  const p = prevSibling(node);
  if (!p) return node.parent?.name === "BodyGroup" && bodyGroupRole(node.parent, text) === "scope";
  if (p.name !== "BodyGroup") return false;
  const pp = prevSibling(p);
  const env2 = pp && environmentMarker(pp, text);
  return !!env2 && env2.kind === "begin" && env2.name === "scope";
}
