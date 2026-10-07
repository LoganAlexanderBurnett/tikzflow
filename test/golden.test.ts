// Minimal-diff golden tests: scripted moves on every corpus picture. Each move
// must change only bytes inside the moved node's statement, put the node where
// it was dropped, and leave every node that doesn't depend on it in place.
// Regenerate the golden files with UPDATE_GOLDEN=1 npx vitest run test/golden.test.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyChanges, diffRange } from "../src/edit/changes.ts";
import { dependents, planMove, referenceCandidates } from "../src/edit/move.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import { encode } from "../src/source/encoding.ts";
import type { LaidOutNode, PictureLayout } from "../src/tikz/layout.ts";
import { anchorPoint, type Point } from "../src/tikz/shapes.ts";
import { CM } from "../src/tikz/units.ts";
import { corpusNames, loadCorpusFile } from "./corpus.ts";

const goldenDir = join(import.meta.dirname, "fixtures", "golden");
const update = process.env.UPDATE_GOLDEN === "1";

interface Move {
  label: string;
  node: LaidOutNode;
  to: Point;
}

/** The centre that puts `n` directly below `t` at its node distance. */
function belowOf(n: LaidOutNode, t: LaidOutNode): Point {
  const south = anchorPoint(t.shape, "south")!;
  return { x: t.shape.center.x, y: south.y - n.nodeDistance.v * n.vectorScale - (n.shape.hh + n.shape.outerY) };
}

function scriptedMoves(layout: PictureLayout): Move[] {
  const editable = layout.nodes.filter((n) => !n.locked && n.kind === "statement");
  const moves: Move[] = [];
  // The first node that can be snapped below an earlier node where it isn't already.
  for (const n of editable) {
    const c = n.shape.center;
    const t = referenceCandidates(layout, n)
      .reverse()
      .find((t) => {
        const to = belowOf(n, t);
        return Math.hypot(to.x - c.x, to.y - c.y) > 1;
      });
    if (t) {
      moves.push({ label: "snap-below", node: n, to: belowOf(n, t) });
      break;
    }
  }
  const last = editable.at(-1);
  if (last) {
    const c = last.shape.center;
    moves.push({ label: "nudge", node: last, to: { x: c.x + 0.5 * CM, y: c.y - 0.3 * CM } });
  }
  return moves;
}

function centers(text: string, pic: number): Map<string, Point> {
  const l = layoutDocumentPicture(analyzeDocument(text), pic)!;
  return new Map(l.nodes.map((n) => [n.id, n.shape.center]));
}

describe.each(corpusNames())("%s", (name) => {
  const file = loadCorpusFile(name);
  const doc = analyzeDocument(file.text);
  const cases: Array<[string, number, Move]> = [];
  doc.syntax.pictures.forEach((_, pic) => {
    const layout = layoutDocumentPicture(doc, pic)!;
    for (const m of scriptedMoves(layout)) cases.push([`picture ${pic}: ${m.label} ${m.node.id}`, pic, m]);
  });
  if (!cases.length) {
    it("has no editable nodes", () => {
      expect(true).toBe(true);
    });
    return;
  }

  it.each(cases)("%s", (_, pic, move) => {
    const result = planMove(file.text, pic, move.node.id, move.to);
    expect(result, "the move was refused").not.toBeNull();
    const after = result!.text;

    // 1. Only bytes inside the node's statement change, apart from loading
    //    the positioning library if the new position needs it.
    const nodeOnly = applyChanges(file.text, result!.changes.filter((c) => c !== result!.library));
    const d = diffRange(file.text, nodeOnly)!;
    expect(d, "the move changed nothing").not.toBeNull();
    expect(d.from).toBeGreaterThanOrEqual(move.node.statement.from);
    expect(d.to).toBeLessThanOrEqual(move.node.statement.to);
    if (result!.library) {
      expect(result!.library.insert).toMatch(/^(,\s*| )?positioning,?$|^\r?\n\\usetikzlibrary\{positioning\}$/);
      expect(result!.library.to).toBe(result!.library.from);
    }

    // 2. The node lands where it was dropped (distances are rounded to 1 mm).
    const before = centers(file.text, pic);
    const now = centers(after, pic);
    const c = now.get(move.node.id)!;
    expect(Math.hypot(c.x - move.to.x, c.y - move.to.y)).toBeLessThan(2.5);

    // 3. Nodes that don't depend on it stay exactly where they were.
    const layout = layoutDocumentPicture(doc, pic)!;
    const deps = dependents(layout, move.node.id);
    for (const [id, p] of before) {
      if (id === move.node.id || deps.has(id)) continue;
      const q = now.get(id)!;
      expect(Math.hypot(q.x - p.x, q.y - p.y), `node ${id} moved`).toBeLessThan(1e-6);
    }

    // 4. The bytes match the golden file, in the file's own encoding.
    const golden = join(goldenDir, `${name.replace(/\.tex$/, "")}.${pic}.${move.label}.tex`);
    const bytes = Buffer.from(encode(after, file.encoding));
    if (update || !existsSync(golden)) {
      if (!update) throw new Error(`missing golden file ${golden}; run with UPDATE_GOLDEN=1`);
      mkdirSync(goldenDir, { recursive: true });
      writeFileSync(golden, bytes);
    }
    expect(bytes.equals(readFileSync(golden)), `differs from ${golden}`).toBe(true);
  });
});
