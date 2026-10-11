// Import from Mermaid and Graphviz DOT (M4 step 5, D84): read the source into a
// graph, write it as TikZ, and let the auto-layout (D80) turn the rough places
// into relations. Everything happens in the browser; nothing is sent anywhere.
import { type LayoutDirection, type LayoutProgress, planAutoLayout } from "../edit/autolayout.ts";
import { parseDot } from "./dot.ts";
import { ImportError } from "./graph.ts";
import { parseMermaid } from "./mermaid.ts";
import { routeAroundNodes } from "./route.ts";
import { graphToTikz } from "./tikz.ts";

export type ImportFormat = "mermaid" | "dot";

export interface ImportOptions {
  /** The format; found from the text when absent. */
  format?: ImportFormat;
  /** The direction of the flow; the source's own when absent. */
  direction?: LayoutDirection;
  /** The auto-layout's progress (D83 item 4). */
  onProgress?: (p: LayoutProgress) => void;
}

export type ImportResult =
  | {
      ok: true;
      text: string;
      format: ImportFormat;
      direction: LayoutDirection;
      nodes: number;
      edges: number;
      groups: number;
      /** Auto-layout wrote the positions as relations. */
      laidOut: boolean;
      notes: string[];
    }
  | { ok: false; reason: string; line?: number };

/** Which format a text is, from its first statement; null when it is neither. */
export function detectFormat(src: string): ImportFormat | null {
  const t = src
    .replace(/^﻿/, "")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r\n|\r|\n/)
    .filter((l) => l.trim() && !l.trim().startsWith("//") && !l.trim().startsWith("#") && !l.trim().startsWith("%%"));
  let first = t[0]?.trim() ?? "";
  if (first === "---") {
    const end = t.findIndex((l, k) => k > 0 && l.trim() === "---");
    first = end > 0 ? (t[end + 1]?.trim() ?? "") : first;
  }
  if (/^(strict\s+)?(di)?graph\b[^;]*\{/i.test(first) || /^(strict\s+)?(di)?graph\s*$/i.test(first) && /^\s*\{/.test(t[1] ?? "")) return "dot";
  if (/^(graph|flowchart(-elk)?)\b\s*(TB|TD|BT|RL|LR)?\s*;?\s*$/i.test(first)) return "mermaid";
  // Mermaid's other diagram types are still Mermaid: the reader says which.
  if (/^(sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|journey|gitGraph|mindmap|timeline)\b/.test(first)) return "mermaid";
  // `graph LR; A-->B` on one line.
  if (/^(graph|flowchart)\s+(TB|TD|BT|RL|LR)\b/i.test(first)) return "mermaid";
  return null;
}

/** The file extensions that are imports rather than TikZ. */
export const IMPORT_EXTENSIONS = [".mmd", ".mermaid", ".dot", ".gv"];

export async function importDiagram(src: string, options: ImportOptions = {}): Promise<ImportResult> {
  const format = options.format ?? detectFormat(src);
  if (!format) return { ok: false, reason: "This isn't a Mermaid flowchart or a Graphviz DOT graph: it should start with graph TD, flowchart LR, digraph or graph." };
  try {
    const graph = format === "mermaid" ? parseMermaid(src) : parseDot(src);
    if (!graph.nodes.length) return { ok: false, reason: "The diagram has no nodes." };
    const direction = options.direction ?? graph.direction;
    const out = graphToTikz(graph);
    const notes = [...graph.notes, ...out.notes];
    let text = out.text;
    let laidOut = false;
    if (graph.nodes.length >= 2) {
      const r = await planAutoLayout(text, 0, { direction, groups: true, ...(options.onProgress ? { onProgress: options.onProgress } : {}) });
      if (r.ok) {
        text = r.text;
        laidOut = true;
        const routed = routeAroundNodes(text);
        text = routed.text;
        if (routed.left) notes.push(`${routed.left === 1 ? "One edge still runs" : `${routed.left} edges still run`} through a node.`);
        for (const n of r.notes) notes.push(`${n[0]!.toUpperCase()}${n.slice(1)}.`);
      } else notes.push(`The nodes couldn't be placed automatically (${r.reason}); they are in a loose grid. Layout in the toolbar tries again.`);
    } else laidOut = true;
    return { ok: true, text, format, direction, nodes: out.nodes, edges: out.edges, groups: out.groups, laidOut, notes };
  } catch (e) {
    if (e instanceof ImportError) return e.line === undefined ? { ok: false, reason: e.message } : { ok: false, reason: `Line ${e.line}: ${e.message}`, line: e.line };
    throw e;
  }
}
