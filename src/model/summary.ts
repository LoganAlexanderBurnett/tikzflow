// The "what I understood" summary shown after parsing.
import type { PictureLayout } from "../tikz/layout.ts";
import type { DocumentModel } from "./document.ts";

export interface Summary {
  /** One-line headline, e.g. "12 nodes and 14 edges editable; 1 block kept as-is". */
  headline: string;
  nodes: number;
  editableNodes: number;
  edges: number;
  /** Blocks kept verbatim and not shown natively, by kind. */
  kept: Record<string, number>;
  /** Locked nodes with the reason. */
  locked: Array<{ id: string; reason: string }>;
  /** Option keys the native preview ignores, with how often they occur. */
  unknownKeys: Array<{ key: string; count: number }>;
  /** Things drawn approximately or not at all. */
  notes: string[];
  parseErrors: number;
}

const KEPT_LABEL: Record<string, string> = {
  foreach: "\\foreach",
  matrix: "\\matrix",
  command: "other command",
  error: "syntax error",
};

function plural(n: number, word: string, words = `${word}s`) {
  return `${n} ${n === 1 ? word : words}`;
}

export function summarize(doc: DocumentModel, layout: PictureLayout): Summary {
  const real = layout.nodes.filter((n) => n.kind !== "coordinate");
  const editable = real.filter((n) => !n.locked);
  let edges = 0;
  for (const p of layout.paths) edges += p.edges.length;
  const kept: Record<string, number> = {};
  for (const o of layout.opaque) {
    if (o.reason === "environment") continue;
    const label = KEPT_LABEL[o.reason] ?? o.reason;
    kept[label] = (kept[label] ?? 0) + 1;
  }
  const keys = new Map<string, number>();
  for (const item of [...layout.nodes, ...layout.pathNodes, ...layout.paths]) {
    for (const k of item.unknownKeys) {
      const name = k.replace(/=.*$/, "");
      keys.set(name, (keys.get(name) ?? 0) + 1);
    }
  }
  const notes = new Set<string>();
  for (const p of layout.paths) for (const i of p.issues) notes.add(`A path wasn't fully drawn: ${i}.`);
  for (const n of [...layout.nodes, ...layout.pathNodes]) {
    for (const u of n.unrendered) {
      if (u.startsWith("label: ")) notes.add(`Label text shown approximately: ${u.slice(7)}`);
      else notes.add(`Not shown natively: ${u}`);
    }
  }
  for (const p of layout.paths) for (const u of p.unrendered) notes.add(`Not shown natively: ${u}`);
  for (const i of layout.issues) notes.add(i.message);

  const keptTotal = Object.values(kept).reduce((a, b) => a + b, 0);
  const parts = [`${plural(editable.length, "node")}${editable.length < real.length ? ` of ${real.length}` : ""} and ${plural(edges, "edge")} editable`];
  if (keptTotal) parts.push(`${plural(keptTotal, "block")} kept as-is`);
  if (doc.errorCount) parts.push(plural(doc.errorCount, "syntax error"));
  return {
    headline: parts.join("; "),
    nodes: real.length,
    editableNodes: editable.length,
    edges,
    kept,
    locked: real.filter((n) => n.locked).map((n) => ({ id: n.id, reason: n.locked! })),
    unknownKeys: [...keys].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count),
    notes: [...notes],
    parseErrors: doc.errorCount,
  };
}
