// Golden tests for auto-layout (M4 step 3, D80): every corpus picture laid
// out top to bottom and left to right. Each layout may change only the
// statements of the nodes it lays out, paths (corners written as fixed
// coordinates), and a positioning library; the laid-out nodes don't overlap;
// a second run changes nothing; nodes outside the layout stay put (checked by
// the planner itself).
// Regenerate with UPDATE_GOLDEN=1 npx vitest run test/golden-autolayout.test.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type LayoutDirection, layoutScope, planAutoLayout } from "../src/edit/autolayout.ts";
import { applyChanges } from "../src/edit/changes.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import { encode } from "../src/source/encoding.ts";
import { shapeBounds } from "../src/tikz/shapes.ts";
import { corpusNames, loadCorpusFile } from "./corpus.ts";

const goldenDir = join(import.meta.dirname, "fixtures", "golden", "autolayout");
const update = process.env.UPDATE_GOLDEN === "1";

/**
 * Pictures where a second run may write again: writing a chain out (D79)
 * adds `on grid=false` to its nodes, which changes the picture's node
 * distance and so the gaps ELK is given.
 */
const NOT_STABLE = new Set(["se-382997-chains-indented.tex"]);

describe.each(corpusNames())("%s", (name) => {
  const file = loadCorpusFile(name);
  const doc = analyzeDocument(file.text);
  const cases: Array<[string, number, LayoutDirection]> = [];
  doc.syntax.pictures.forEach((_, pic) => {
    for (const dir of ["down", "right"] as const) cases.push([`picture ${pic} ${dir}`, pic, dir]);
  });

  it.each(cases)("%s", async (_, pic, direction) => {
    const layout = layoutDocumentPicture(doc, pic)!;
    const { members } = layoutScope(layout);
    const r = await planAutoLayout(file.text, pic, { direction });
    if (!r.ok) {
      expect(members.length, r.reason).toBeLessThan(2);
      return;
    }
    expect(applyChanges(file.text, r.changes)).toBe(r.text);

    // 1. Only the laid-out nodes' statements, paths and a positioning library change.
    const statements = members.map((n) => n.statement);
    const paths = layout.paths.map((p) => p.syntax);
    for (const c of r.changes) {
      const inside = (s: { from: number; to: number }) => c.from >= s.from && c.to <= s.to;
      const library = c.from === c.to && /^(,\s*| )?positioning,?$|^\r?\n\\usetikzlibrary\{positioning\}$/.test(c.insert);
      expect(statements.some(inside) || paths.some(inside) || library, `change at ${c.from}: ${JSON.stringify(c.insert)}`).toBe(true);
    }

    // 2. No new syntax errors.
    const after = analyzeDocument(r.text);
    expect(after.errors.length).toBe(doc.errors.length);

    // 3. The laid-out nodes don't overlap one another.
    const placed = layoutDocumentPicture(after, pic)!;
    const ids = new Set(layoutScope(placed).members.map((n) => n.id));
    const boxes = placed.nodes.filter((n) => ids.has(n.id)).map((n) => ({ id: n.id, b: shapeBounds(n.shape) }));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const p = boxes[i]!.b;
        const q = boxes[j]!.b;
        const overlap = Math.min(p.maxX, q.maxX) - Math.max(p.minX, q.minX) > 0.5 && Math.min(p.maxY, q.maxY) - Math.max(p.minY, q.minY) > 0.5;
        expect(overlap, `${boxes[i]!.id} overlaps ${boxes[j]!.id}`).toBe(false);
      }
    }

    // 4. A second run changes nothing.
    if (!NOT_STABLE.has(name)) {
      const again = await planAutoLayout(r.text, pic, { direction });
      expect(again.ok && again.changes, again.ok ? again.written.map((w) => `${w.name}: ${w.text}`).join("; ") : again.reason).toEqual([]);
    }

    // 5. The golden file, in the file's own encoding.
    const golden = join(goldenDir, `${name.replace(/\.tex$/, "")}.${pic}.${direction}.tex`);
    const bytes = Buffer.from(encode(r.text, file.encoding));
    if (update || !existsSync(golden)) {
      if (!update) throw new Error(`missing golden file ${golden}; run with UPDATE_GOLDEN=1`);
      mkdirSync(goldenDir, { recursive: true });
      writeFileSync(golden, bytes);
    }
    expect(bytes.equals(readFileSync(golden)), `differs from ${golden}`).toBe(true);
  });
});
