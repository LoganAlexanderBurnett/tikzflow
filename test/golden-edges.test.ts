// Minimal-diff golden tests for edge edits: scripted edits to one edge of every
// corpus picture that has one. Each edit must change only bytes inside that
// edge's statement (a deleted statement takes its own line), leave every node
// where it was, and match the golden file byte for byte.
// Regenerate with UPDATE_GOLDEN=1 npx vitest run test/golden-edges.test.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyChanges } from "../src/edit/changes.ts";
import { planDelete } from "../src/edit/delete.ts";
import { planEdgeProperty } from "../src/edit/edgeprops.ts";
import { type EditOutcome, findEdge } from "../src/edit/edges.ts";
import { planAddLabel } from "../src/edit/labels.ts";
import { planMakeOrthogonal } from "../src/edit/orthogonal.ts";
import { planMakeCurved } from "../src/edit/curves.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import { type Edge, pictureEdges } from "../src/model/edges.ts";
import { encode } from "../src/source/encoding.ts";
import type { PictureLayout } from "../src/tikz/layout.ts";
import { corpusNames, loadCorpusFile } from "./corpus.ts";

const goldenDir = join(import.meta.dirname, "fixtures", "golden", "edges");
const update = process.env.UPDATE_GOLDEN === "1";

type Plan = (text: string, pic: number, edge: Edge, layout: PictureLayout) => { ok: true; changes: { from: number; to: number; insert: string }[]; text: string } | { ok: false; reason: string };

const mid = (e: Edge) => {
  const s = e.route.segs[e.segs[0]!]!;
  return { x: (s.from.x + s.to.x) / 2, y: (s.from.y + s.to.y) / 2 };
};

const SCRIPTS: Array<{ label: string; /** Which edge: the first one that isn't an edge operation, or any. */ plain: boolean; plan: Plan }> = [
  { label: "dashed", plain: false, plan: (t, p, e) => planEdgeProperty(t, p, e.id, { kind: "edge" }, { kind: "dash", value: "dashed" }) },
  { label: "label", plain: true, plan: (t, p, e) => planAddLabel(t, p, e.id, mid(e), "yes") },
  { label: "orthogonal", plain: true, plan: (t, p, e) => planMakeOrthogonal(t, p, e.id) as EditOutcome },
  { label: "curved", plain: true, plan: (t, p, e) => planMakeCurved(t, p, e.id) as EditOutcome },
  { label: "delete", plain: false, plan: (t, p, e) => planDelete(t, p, { kind: "edge", id: e.id }) },
];

describe.each(corpusNames())("%s", (name) => {
  const file = loadCorpusFile(name);
  const doc = analyzeDocument(file.text);
  const cases: Array<[string, number, (typeof SCRIPTS)[number], string]> = [];
  doc.syntax.pictures.forEach((_, pic) => {
    const layout = layoutDocumentPicture(doc, pic)!;
    for (const script of SCRIPTS) {
      // The first edge the edit works on.
      for (const e of pictureEdges(layout)) {
        if (e.lock || (script.plain && e.path.id.includes("/edge"))) continue;
        const r = script.plan(file.text, pic, e, layout);
        if (!r.ok) continue;
        cases.push([`picture ${pic}: ${script.label} ${e.id}`, pic, script, e.id]);
        break;
      }
    }
  });
  if (!cases.length) {
    it("has no editable edges", () => {
      expect(true).toBe(true);
    });
    return;
  }

  it.each(cases)("%s", (_, pic, script, edgeId) => {
    const layout = layoutDocumentPicture(doc, pic)!;
    const edge = findEdge(layout, edgeId)!;
    const r = script.plan(file.text, pic, edge, layout);
    if (!r.ok) throw new Error(r.reason);
    expect(applyChanges(file.text, r.changes)).toBe(r.text);

    // 1. Only bytes inside the edge's statement change (a deleted statement takes its line break too).
    const syn = edge.path.syntax;
    expect(r.changes.length, "the edit changed nothing").toBeGreaterThan(0);
    const lo = script.label === "delete" ? file.text.lastIndexOf("\n", syn.from - 1) + 1 : syn.from;
    const hi = script.label === "delete" ? file.text.indexOf("\n", syn.to) + 1 || file.text.length : syn.to;
    for (const c of r.changes) {
      expect(c.from).toBeGreaterThanOrEqual(lo);
      expect(c.to).toBeLessThanOrEqual(hi);
    }

    // 2. No node moves.
    const before = layout.nodes.map((n) => n.shape.center);
    const after = layoutDocumentPicture(analyzeDocument(r.text), pic)!;
    expect(after.nodes.length).toBe(before.length);
    after.nodes.forEach((n, i) => {
      expect(Math.hypot(n.shape.center.x - before[i]!.x, n.shape.center.y - before[i]!.y), `node ${i} moved`).toBeLessThan(1e-6);
    });

    // 3. The bytes match the golden file, in the file's own encoding.
    const golden = join(goldenDir, `${name.replace(/\.tex$/, "")}.${pic}.${script.label}.tex`);
    const bytes = Buffer.from(encode(r.text, file.encoding));
    if (update || !existsSync(golden)) {
      if (!update) throw new Error(`missing golden file ${golden}; run with UPDATE_GOLDEN=1`);
      mkdirSync(goldenDir, { recursive: true });
      writeFileSync(golden, bytes);
    }
    expect(bytes.equals(readFileSync(golden)), `differs from ${golden}`).toBe(true);
  });
});
