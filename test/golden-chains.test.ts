// Golden tests for dragging a chain node (M4 step 2, D77 item 4): on every
// corpus picture with a chain, the first node each chain places is dragged by
// (5 mm, −3 mm). The chain is written out and the node moved, as one edit that
// changes only statements of nodes on that chain (and a positioning library);
// the node lands where it was dropped and nodes that don't follow it stay put.
// Regenerate with UPDATE_GOLDEN=1 npx vitest run test/golden-chains.test.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyChanges } from "../src/edit/changes.ts";
import { planChainMove } from "../src/edit/chains.ts";
import { movingWith } from "../src/edit/group.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import { encode } from "../src/source/encoding.ts";
import type { LaidOutNode } from "../src/tikz/layout.ts";
import { CM } from "../src/tikz/units.ts";
import { corpusNames, loadCorpusFile } from "./corpus.ts";

const goldenDir = join(import.meta.dirname, "fixtures", "golden", "chains");
const update = process.env.UPDATE_GOLDEN === "1";

const withChains = corpusNames().filter((name) => {
  const doc = analyzeDocument(loadCorpusFile(name).text);
  return doc.syntax.pictures.some((_, pic) => layoutDocumentPicture(doc, pic)!.nodes.some((n) => n.chain?.placed));
});

it("the corpus has chain pictures to test", () => expect(withChains.length).toBeGreaterThanOrEqual(2));

describe.each(withChains)("%s", (name) => {
  const file = loadCorpusFile(name);
  const doc = analyzeDocument(file.text);
  const cases: Array<[string, number, LaidOutNode]> = [];
  doc.syntax.pictures.forEach((_, pic) => {
    const layout = layoutDocumentPicture(doc, pic)!;
    const seen = new Set<number>();
    for (const n of layout.nodes) {
      if (!n.chain?.placed || seen.has(n.chain.serial)) continue;
      seen.add(n.chain.serial);
      cases.push([`picture ${pic}: chain ${seen.size} drag ${n.id}`, pic, n]);
    }
  });

  it.each(cases)("%s", (label, pic, node) => {
    const layout = layoutDocumentPicture(doc, pic)!;
    const to = { x: node.shape.center.x + 0.5 * CM, y: node.shape.center.y - 0.3 * CM };
    const r = planChainMove(file.text, pic, node.id, to);
    if (!r.ok) throw new Error(r.reason);
    expect(applyChanges(file.text, r.changes)).toBe(r.text);

    // 1. Only statements of nodes on this chain (written out, or named so the next can refer to them) and a library.
    const onChain = layout.nodes.filter((n) => n.chain?.serial === node.chain!.serial).map((n) => n.statement);
    for (const c of r.changes) {
      const inside = onChain.some((s) => c.from >= s.from && c.to <= s.to);
      const library = c.from === c.to && /^(,\s*| )?positioning,?$|^\r?\n\\usetikzlibrary\{positioning\}$/.test(c.insert);
      expect(inside || library, `change at ${c.from}: ${JSON.stringify(c.insert)}`).toBe(true);
    }

    // 2. The node lands where it was dropped; 3. what doesn't follow it stays exactly.
    const after = layoutDocumentPicture(analyzeDocument(r.text), pic)!;
    const moved = after.nodes.find((n) => n.id === r.id)!;
    expect(Math.hypot(moved.shape.center.x - to.x, moved.shape.center.y - to.y)).toBeLessThan(2.5);
    const follow = movingWith(layout, [node.id]);
    layout.nodes.forEach((n, i) => {
      if (follow.has(n.id)) return;
      const q = after.nodes[i]!.shape.center;
      expect(Math.hypot(q.x - n.shape.center.x, q.y - n.shape.center.y), `${n.id} moved`).toBeLessThan(1e-6);
    });

    // 4. The golden file.
    const golden = join(goldenDir, `${name.replace(/\.tex$/, "")}.${pic}.${label.replace(/^picture \d+: /, "").replace(/[^A-Za-z0-9-]+/g, "-")}.tex`);
    const bytes = Buffer.from(encode(r.text, file.encoding));
    if (update || !existsSync(golden)) {
      if (!update) throw new Error(`missing golden file ${golden}; run with UPDATE_GOLDEN=1`);
      mkdirSync(goldenDir, { recursive: true });
      writeFileSync(golden, bytes);
    }
    expect(bytes.equals(readFileSync(golden)), `differs from ${golden}`).toBe(true);
  });
});
