// The drag layout (M6 step 2, D102): while a node or a group is dragged, only what the drag changes
// is laid out again (the moved nodes, what follows them rigidly, and the paths that reach them).
// On every corpus picture and template, for each draggable node, moved alone (its followers held
// where they are, as a drag does by default) and with its followers, the result must equal a full
// layout with the same overrides. And it must do little work: on the 200-node bench picture a node
// drag lays out a handful of paths, not 250 (timings aren't stable in CI; work counts are).
import { describe, expect, it } from "vitest";
import { followsByDesign } from "../src/edit/links.ts";
import { movingWith } from "../src/edit/group.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import { dragLayout, dragStats, startDrag } from "../src/model/drag.ts";
import { TEMPLATES } from "../src/templates/catalog.ts";
import { templateText } from "../src/templates/index.ts";
import type { LaidOutNode, PictureLayout } from "../src/tikz/layout.ts";
import type { Point } from "../src/tikz/shapes.ts";
import { BENCH_200, DENSE_4_16_16_4 } from "../scripts/lib/benchpictures.ts";
import { corpusNames, loadCorpusFile } from "./corpus.ts";

const sources = [
  ...corpusNames().map((n) => ({ name: n, text: loadCorpusFile(n).text })),
  ...TEMPLATES.map((t) => ({ name: `template-${t.id}`, text: templateText(t.id)! })),
];

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const pt = (p: Point) => `${r3(p.x)},${r3(p.y)}`;
/** What a layout draws and where, to compare two layouts. */
function picture(l: PictureLayout): unknown {
  const node = (n: LaidOutNode): unknown => ({
    id: n.id,
    c: pt(n.shape.center),
    s: `${r3(n.shape.hw)},${r3(n.shape.hh)}`,
    t: pt(n.textOrigin),
    p: n.pathPos ? pt(n.pathPos.point) : null,
    x: n.extras.map(node),
    locked: n.locked ?? null,
  });
  return {
    nodes: l.nodes.map(node),
    pathNodes: l.pathNodes.map(node),
    paths: l.paths.map((p) => ({ id: p.id, d: p.d, tips: p.tips.map((t) => `${pt(t.at)}@${r3(t.angle)}`), stops: (p.route?.stops ?? []).map((s) => pt(s.point)) })),
    bounds: [r3(l.bounds.minX), r3(l.bounds.minY), r3(l.bounds.maxX), r3(l.bounds.maxY)],
  };
}

const D = { x: 13.7, y: -7.3 };
const moved = (n: LaidOutNode) => ({ x: n.shape.center.x + D.x, y: n.shape.center.y + D.y });

describe.each(sources.map((s) => [s.name, s] as const))("%s", (_, src) => {
  const doc = analyzeDocument(src.text);
  doc.syntax.pictures.forEach((__, pic) => {
    it(`picture ${pic}: every node dragged, alone and with its followers, lays out as a full layout does`, () => {
      const base = layoutDocumentPicture(doc, pic);
      if (!base) return;
      const design = followsByDesign(src.text, base);
      const session = startDrag(doc, pic, base);
      const nodes = base.nodes.filter((n) => n.kind === "statement" && (!n.locked || n.lock?.kind === "chain" || n.lock?.kind === "undefined-ref"));
      for (const n of nodes) {
        const followers = [...movingWith(base, [n.id])].filter((id) => id !== n.id && !design.has(id) && base.nodes.some((m) => m.id === id));
        const held = followers.flatMap((id) => {
          const m = base.nodes.find((x) => x.id === id)!;
          return [[id, m.shape.center] as const];
        });
        for (const overrides of [new Map([[n.id, moved(n)], ...held]), new Map([[n.id, moved(n)]])]) {
          const full = layoutDocumentPicture(doc, pic, overrides)!;
          const fast = dragLayout(session, overrides);
          expect(picture(fast), `${n.id} (${overrides.size > 1 ? "alone" : "with followers"})`).toEqual(picture(full));
        }
      }
      // A group: every other draggable node, moved together.
      const group = new Map(nodes.filter((_, i) => i % 2 === 0).map((n) => [n.id, moved(n)] as const));
      if (group.size) expect(picture(dragLayout(session, group)), "a group").toEqual(picture(layoutDocumentPicture(doc, pic, group)!));
    });
  });
});

describe("work done per frame", () => {
  it("dragging n100 of the 200-node picture alone lays out only the paths that reach it", () => {
    const doc = analyzeDocument(BENCH_200);
    const base = layoutDocumentPicture(doc, 0)!;
    const n = base.nodes.find((x) => x.name === "n100")!;
    const after = base.nodes.find((x) => x.name === "n101")!;
    const session = startDrag(doc, 0, base);
    dragLayout(session, new Map([[n.id, moved(n)], [after.id, after.shape.center]]));
    const s = dragStats(session);
    expect(s.full).toBe(0);
    // n100 is an end of 3 of the 250 edges (a = i mod 200, b = 7i + 3 mod 200), and 1 path places n101's neighbors.
    expect(s.paths).toBeLessThanOrEqual(6);
    expect(s.nodes).toBeLessThanOrEqual(2);
  });

  it("a neuron of the dense network lays out its 32 weights, not all 384", () => {
    const doc = analyzeDocument(DENSE_4_16_16_4);
    const base = layoutDocumentPicture(doc, 0)!;
    const n = base.nodes.find((x) => x.name === "l1n7")!;
    const session = startDrag(doc, 0, base);
    // Its followers held, as a drag does by default.
    const held = [...movingWith(base, [n.id])].filter((id) => id !== n.id).map((id) => [id, base.nodes.find((x) => x.id === id)!.shape.center] as const);
    dragLayout(session, new Map([[n.id, moved(n)], ...held]));
    const s = dragStats(session);
    expect(s.full).toBe(0);
    expect(s.paths).toBeLessThanOrEqual(40);
  });
});
