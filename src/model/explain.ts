// Plain-language explanations for locked nodes, and which one-click fixes
// apply (D36).
import type { LaidOutNode, LaidOutPath, PictureLayout } from "../tikz/layout.ts";
import type { Edge, EdgeMode } from "./edges.ts";

export interface LockHelp {
  title: string;
  body: string;
  /** "Pin at current position" applies. */
  canPin: boolean;
  /** "Attach to another node" applies, replacing `ref`. */
  canAttach: boolean;
  ref?: string;
  /** A defined name that looks like a typo fix for `ref`. */
  suggestion?: string;
}

/** What the preview can't draw for a node: options it ignores and shapes it approximates. */
export function undrawable(n: LaidOutNode): string[] {
  const items = [...n.unknownKeys.map((k) => k.replace(/=[\s\S]*$/, "")), ...n.unrendered.filter((u) => !u.startsWith("label: "))];
  return [...new Set(items)];
}

/** Edit distance, for suggesting a name that was probably meant. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length]!;
}

/** The candidate closest to `name`, if it's close enough to be a likely typo or rename ("pkin" → "pkin2"). */
export function closestName(name: string, candidates: readonly string[]): string | undefined {
  let best: { n: string; d: number } | undefined;
  for (const c of candidates) {
    const d = c.startsWith(name) || name.startsWith(c) ? Math.abs(c.length - name.length) * 0.5 : distance(name, c);
    if (d <= Math.max(1, Math.floor(name.length / 3)) && (!best || d < best.d)) best = { n: c, d };
  }
  return best?.n;
}

export function explainLock(layout: PictureLayout, node: LaidOutNode, earlierNames: readonly string[] = []): LockHelp | null {
  const lock = node.lock;
  if (!lock) return null;
  const ref = lock.ref ?? "";
  switch (lock.kind) {
    case "undefined-ref": {
      const later = layout.nodes.some((n) => n.name === ref && layout.nodes.indexOf(n) > layout.nodes.indexOf(node));
      const help: LockHelp = later
        ? {
            title: `"${ref}" comes later in the code`,
            body: `This node is placed relative to "${ref}", which is only defined further down. A node can only refer to nodes defined before it, so LaTeX would stop here too, with "No shape named ${ref} is known". Drag it to where it belongs to pin it there, pin it where it is now, or attach it to a node defined earlier.`,
            canPin: true,
            canAttach: true,
            ref,
          }
        : {
            title: `"${ref}" doesn't exist`,
            body: `This node is placed relative to "${ref}", but no node in the picture has that name. LaTeX would stop here too, with "No shape named ${ref} is known". Perhaps the node was renamed or deleted. Drag it to where it belongs to pin it there, pin it where it is now, or attach it to another node.`,
            canPin: true,
            canAttach: true,
            ref,
          };
      const suggestion = closestName(ref, earlierNames);
      if (suggestion) help.suggestion = suggestion;
      return help;
    }
    case "opaque-ref":
      return {
        title: "Placed relative to code kept as-is",
        body: `This node is placed relative to "${ref}", which is defined inside code the editor keeps as-is, such as a \\foreach or a \\matrix. LaTeX handles that fine, but the editor can't tell where "${ref}" is, so it won't move this node rather than risk misplacing it.`,
        canPin: false,
        canAttach: false,
        ref,
      };
    case "position":
      return {
        title: "Position the editor doesn't understand",
        body: `The editor can't work out this node's position (${lock.message}). LaTeX may well handle it, but the editor leaves the node alone rather than write a wrong position. You can still change it in the code.`,
        canPin: false,
        canAttach: false,
      };
    case "fit":
      return {
        title: "Fits other nodes",
        body: "This node's size and position follow the nodes it fits around. Move those nodes and it follows them.",
        canPin: false,
        canAttach: false,
      };
    case "chain":
      return {
        title: "Placed by a chain",
        body: "The chains library places this node after the previous one on its chain. Dragging chain nodes isn't supported yet; it will convert them to ordinary positioning.",
        canPin: false,
        canAttach: false,
      };
    case "path":
      return {
        title: "Part of a path",
        body: "This node sits on a path and moves with it. Select the edge it belongs to to work on it; double-click it to edit its text.",
        canPin: false,
        canAttach: false,
      };
    case "macro-name":
      return {
        title: "Name contains a macro",
        body: "This node's name contains a macro, so the editor can't safely rewrite the code that refers to it.",
        canPin: false,
        canAttach: false,
      };
  }
}

/** An edge's mode in a few words. */
export function describeMode(mode: EdgeMode): string {
  switch (mode) {
    case "straight":
      return "Straight";
    case "polyline":
      return "Straight pieces through points";
    case "orthogonal":
      return "Orthogonal (|- and -|)";
    case "curved":
      return "Curved";
  }
}

/** Why an edge can't be edited visually, in plain language, or null if it can. */
export function explainEdge(edge: Edge): { title: string; body: string } | null {
  if (!edge.lock) return null;
  if (edge.lock.kind === "shapes") {
    return {
      title: "Part of a shape",
      body: "This path also draws a shape: a rectangle, a circle, an arc or a closed outline (cycle). The editor keeps it exactly as written rather than risk changing the shape. You can still change it in the code.",
    };
  }
  return {
    title: "Code the editor doesn't fully understand",
    body: "Part of this path uses something the editor can't follow, such as a macro, a loop variable, or a coordinate it can't work out. LaTeX may well handle it, but the editor keeps the path exactly as written rather than write a wrong one. You can still change it in the code.",
  };
}

/** What a selected path that isn't an edge is, in plain language. */
export function explainPath(path: LaidOutPath): { title: string; body: string } {
  if (path.syntax.command === "join") {
    return { title: "Drawn by a chain", body: "The chains library draws this line between two nodes on a chain (join). It follows the nodes; it has no code of its own to edit." };
  }
  if (!path.stroke) {
    return { title: "An invisible path", body: "This path draws nothing itself (\\path); it is there to place labels or coordinates. Edit it in the code." };
  }
  if (path.route?.shapes) {
    return { title: "A shape", body: "This path draws a shape (a rectangle, a circle, an arc or a closed outline) rather than a connection. Edit it in the code." };
  }
  return { title: "A path the editor keeps as written", body: "The editor doesn't treat this path as an edge between nodes. Edit it in the code." };
}
