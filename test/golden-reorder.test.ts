// Golden tests for "Allow reordering statements" (D81 item 4, D87): every
// corpus picture laid out with the option, both ways. Where it moves
// statements the result is a golden file; elsewhere it is exactly the layout
// without the option. Moves never add syntax errors, never change what is
// drawn where before the relations are written (the planner checks each), and
// leave fewer roundabout placements than the layout without them.
// Regenerate with UPDATE_GOLDEN=1 npx vitest run test/golden-reorder.test.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type LayoutDirection, planAutoLayout } from "../src/edit/autolayout.ts";
import { applyChanges } from "../src/edit/changes.ts";
import { analyzeDocument } from "../src/model/document.ts";
import { encode } from "../src/source/encoding.ts";
import { corpusNames, loadCorpusFile } from "./corpus.ts";

const goldenDir = join(import.meta.dirname, "fixtures", "golden", "reorder");
const update = process.env.UPDATE_GOLDEN === "1";
/** A distance, a diagonal or a shift: what reordering is for. */
const roundabout = (text: string) => /=\s*[\d.]+\s*(cm|mm|pt)|\band\b|shift/.test(text);

describe.each(corpusNames())("%s", (name) => {
  const file = loadCorpusFile(name);
  const doc = analyzeDocument(file.text);
  const cases: Array<[string, number, LayoutDirection]> = [];
  doc.syntax.pictures.forEach((_, pic) => {
    for (const dir of ["down", "right"] as const) cases.push([`picture ${pic} ${dir}`, pic, dir]);
  });

  it.each(cases)("%s", async (_, pic, direction) => {
    const plain = await planAutoLayout(file.text, pic, { direction });
    const r = await planAutoLayout(file.text, pic, { direction, reorder: true });
    expect(r.ok).toBe(plain.ok);
    if (!r.ok || !plain.ok) return;
    expect(applyChanges(file.text, r.changes)).toBe(r.text);
    const golden = join(goldenDir, `${name.replace(/\.tex$/, "")}.${pic}.${direction}.tex`);
    if (!r.reordered.length) {
      expect(r.text).toBe(plain.text);
      expect(existsSync(golden), "a golden file for a layout that moves nothing").toBe(false);
      return;
    }
    expect(analyzeDocument(r.text).errors.length).toBe(doc.errors.length);
    expect(r.written.filter((w) => roundabout(w.text)).length).toBeLessThan(plain.written.filter((w) => roundabout(w.text)).length);
    for (const m of r.reordered) expect(roundabout(r.written.find((w) => w.id === m.id)?.text ?? ""), `${m.name}`).toBe(false);
    const out = encode(r.text, file.encoding);
    if (update || !existsSync(golden)) {
      mkdirSync(goldenDir, { recursive: true });
      writeFileSync(golden, out);
    }
    expect(Buffer.compare(Buffer.from(out), readFileSync(golden)), `differs from ${golden}`).toBe(0);
  });
});
