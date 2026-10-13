// One distance on a diagonal (D107): `above left=2.4cm of b` puts the node
// 2.4cm away along the diagonal, √½ of it on each axis, and so does a node
// distance written as one length; "x and y" and the default node distance
// shift by each in full. The numbers are pdfTeX's, from
// spike/engines/probes/p13-diagonal-distances.tex (npm run fidelity -- --only=p13).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { positioningText } from "../src/edit/move.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";

const probe = readFileSync(join(import.meta.dirname, "..", "spike", "engines", "probes", "p13-diagonal-distances.tex"), "utf8");

/** TeX's node centers (pt), per picture of the probe. */
const TEX: Record<number, Record<string, [number, number]>> = {
  0: {
    al: [-70.13, 69.72],
    br: [70.98, -69.72],
    ar: [90.7, 54.26],
    bl: [-50.58, -49.88],
    gal: [179.34, 48.29],
    gbr: [275.91, -48.29],
    gar: [295.91, 34.14],
    gbl: [199.17, -28.45],
  },
  1: { b: [68.29, 0], reading: [20, 48.29], onlya: [-2.19, -7.2], nd: [108.52, 40.24], nd2: [28.05, -40.24], two: [-28.45, 28.45] },
  2: { b: [42.52, 42.87], c: [-41.97, -41.55], d: [-22.4, -22.75] },
};

describe("diagonal positioning with one distance", () => {
  const doc = analyzeDocument(probe);
  for (const [pic, nodes] of Object.entries(TEX)) {
    const layout = layoutDocumentPicture(doc, Number(pic))!;
    for (const [name, [x, y]] of Object.entries(nodes)) {
      it(`picture ${pic}: ${name} is where pdfTeX puts it`, () => {
        const n = layout.nodes.find((m) => m.name === name)!;
        expect(Math.hypot(n.shape.center.x - x, n.shape.center.y - y)).toBeLessThan(0.5);
      });
    }
  }

  it("the emitter writes both distances of a diagonal, even when they are equal", () => {
    expect(positioningText({ kind: "positioning", dir: "above left", target: "b", v: 68.2866, h: 68.2866 })).toBe("above left=2.4cm and 2.4cm of b");
    expect(positioningText({ kind: "positioning", dir: "below", target: "b", v: 68.2866 })).toBe("below=2.4cm of b");
  });
});
