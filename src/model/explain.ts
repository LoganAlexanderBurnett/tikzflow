// Plain-language explanations for locked nodes, and which one-click fixes
// apply (D36).
import type { LaidOutNode, PictureLayout } from "../tikz/layout.ts";

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
        body: "This node sits on a path and moves with it. Editing path labels isn't supported yet.",
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
