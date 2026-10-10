// Minimal-diff golden tests for group moves (M4 step 1): on every corpus
// picture, two neighbouring editable nodes moved together, and the first fit
// node dragged (which moves what it fits). Each move may change only the
// members' statements, corners of paths between members, and a positioning
// library it needs; every member lands where it was dropped; nodes outside
// the group that don't depend on it stay exactly in place.
// Regenerate with UPDATE_GOLDEN=1 npx vitest run test/golden-group.test.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyChanges } from "../src/edit/changes.ts";
import { groupBlocker, groupMembers, movingWith, planGroupMove } from "../src/edit/group.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import { encode } from "../src/source/encoding.ts";
import type { PictureLayout } from "../src/tikz/layout.ts";
import type { Point } from "../src/tikz/shapes.ts";
import { CM } from "../src/tikz/units.ts";
import { corpusNames, loadCorpusFile } from "./corpus.ts";

const goldenDir = join(import.meta.dirname, "fixtures", "golden", "group");
const update = process.env.UPDATE_GOLDEN === "1";

interface GroupCase {
  label: string;
  ids: string[];
  delta: Point;
}

function scriptedGroups(layout: PictureLayout): GroupCase[] {
  const out: GroupCase[] = [];
  const editable = layout.nodes.filter((n) => !n.locked && n.kind === "statement");
  // Two neighbours in the code, past the first node (so there is something outside the group to relate to).
  const pair = editable.length >= 3 ? editable.slice(1, 3) : editable.slice(0, 2);
  if (pair.length === 2 && !groupBlocker(layout, pair.map((n) => n.id))) out.push({ label: "pair", ids: pair.map((n) => n.id), delta: { x: 0.5 * CM, y: -0.3 * CM } });
  const fit = layout.nodes.find((n) => n.position.kind === "fit" && !groupBlocker(layout, [n.id]));
  if (fit) out.push({ label: "fit", ids: [fit.id], delta: { x: -0.4 * CM, y: 0.4 * CM } });
  return out;
}

function centers(text: string, pic: number): Map<string, Point> {
  const l = layoutDocumentPicture(analyzeDocument(text), pic)!;
  return new Map(l.nodes.map((n) => [n.id, n.shape.center]));
}

describe.each(corpusNames())("%s", (name) => {
  const file = loadCorpusFile(name);
  const doc = analyzeDocument(file.text);
  const cases: Array<[string, number, GroupCase]> = [];
  doc.syntax.pictures.forEach((_, pic) => {
    const layout = layoutDocumentPicture(doc, pic)!;
    for (const g of scriptedGroups(layout)) cases.push([`picture ${pic}: ${g.label} ${g.ids.join("+")}`, pic, g]);
  });
  if (!cases.length) {
    it("has no group to move", () => expect(true).toBe(true));
    return;
  }

  it.each(cases)("%s", (_, pic, g) => {
    const layout = layoutDocumentPicture(doc, pic)!;
    const r = planGroupMove(file.text, pic, g.ids, g.delta);
    if (!r.ok) throw new Error(r.reason);
    expect(applyChanges(file.text, r.changes)).toBe(r.text);
    const { members } = groupMembers(layout, g.ids);
    const moving = movingWith(layout, members);

    // 1. Only the members' statements, paths (corners) and a positioning library change.
    const statements = members.map((id) => layout.nodes.find((n) => n.id === id)!.statement);
    const paths = layout.paths.map((p) => p.syntax);
    for (const c of r.changes) {
      const inside = (s: { from: number; to: number }) => c.from >= s.from && c.to <= s.to;
      const library = c.from === c.to && /^(,\s*| )?positioning,?$|^\r?\n\\usetikzlibrary\{positioning\}$/.test(c.insert);
      expect(statements.some(inside) || paths.some(inside) || library, `change at ${c.from}: ${JSON.stringify(c.insert)}`).toBe(true);
    }

    // 2. Members land where they were dropped (each rounded to 1 mm); 3. the rest stays.
    const before = centers(file.text, pic);
    const now = centers(r.text, pic);
    for (const [id, p] of before) {
      const q = now.get(id)!;
      if (members.includes(id)) expect(Math.hypot(q.x - p.x - g.delta.x, q.y - p.y - g.delta.y), `member ${id}`).toBeLessThan(2.2);
      else if (!moving.has(id) && layout.nodes.find((n) => n.id === id)!.position.kind !== "fit") expect(Math.hypot(q.x - p.x, q.y - p.y), `node ${id} moved`).toBeLessThan(1e-6);
    }

    // 4. The golden file, in the file's own encoding.
    const golden = join(goldenDir, `${name.replace(/\.tex$/, "")}.${pic}.${g.label}.tex`);
    const bytes = Buffer.from(encode(r.text, file.encoding));
    if (update || !existsSync(golden)) {
      if (!update) throw new Error(`missing golden file ${golden}; run with UPDATE_GOLDEN=1`);
      mkdirSync(goldenDir, { recursive: true });
      writeFileSync(golden, bytes);
    }
    expect(bytes.equals(readFileSync(golden)), `differs from ${golden}`).toBe(true);
  });
});
