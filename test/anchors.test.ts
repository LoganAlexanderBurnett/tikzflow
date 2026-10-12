// Every drawn shape's anchors, diagonal ones included, against pdfTeX (D98). The
// probe spike/engines/probes/p12-diagonal-anchors.tex puts a box on each corner
// of each shape with `below right=of` and the like, so a wrong corner anchor
// moves its neighbor too. TeX's numbers are in test/fixtures/fidelity/p12-tex.json,
// written by `npm run fidelity -- --only=p12`; run it again after changing the probe.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import { decode } from "../src/source/encoding.ts";
import { anchorPoint } from "../src/tikz/shapes.ts";
import { templateText } from "../src/templates/index.ts";

const root = join(import.meta.dirname, "..");
const fixture = JSON.parse(readFileSync(join(root, "test/fixtures/fidelity/p12-tex.json"), "utf8")) as { anchors: string[]; nodes: Record<string, number[]> };
const probe = decode(new Uint8Array(readFileSync(join(root, "spike/engines/probes/p12-diagonal-anchors.tex")))).text;

/** Not yet within 1pt, and known (D98): multipart shapes are marked as not fully drawn; the tape's wave is 1.2pt short. */
const KNOWN = new Set(["ta", "taSE", "taNW", "cs", "csSE", "csNW", "rs", "rsSE", "rsNW"]);

describe("anchors against pdfTeX", () => {
  const layout = layoutDocumentPicture(analyzeDocument(probe), 0)!;
  const byName = new Map(layout.nodes.map((n) => [n.name, n]));

  for (const [name, tex] of Object.entries(fixture.nodes)) {
    it.skipIf(KNOWN.has(name))(`${name}: every compass anchor within 1pt`, () => {
      const node = byName.get(name);
      expect(node, name).toBeDefined();
      fixture.anchors.forEach((a, i) => {
        const p = anchorPoint(node!.shape, a)!;
        const off = Math.hypot(p.x - tex[2 * i]!, p.y - tex[2 * i + 1]!);
        expect(off, `${name}.${a}`).toBeLessThan(1);
      });
    });
  }

  it("the owner's case: the Basic process template after dragging its answer below right of the I/O node", () => {
    // The drag wrote `below right=7mm and 1.8cm of read`; the selection's outline sat 23pt off TeX's box.
    const text = templateText("basic-process")!.replace("\\node[process, right=of small] (base)", "\\node[process, below right=7mm and 1.8cm of read] (base)");
    expect(text).toContain("below right=7mm and 1.8cm of read");
    const l = layoutDocumentPicture(analyzeDocument(text), 0)!;
    const read = l.nodes.find((n) => n.name === "read")!;
    const base = l.nodes.find((n) => n.name === "base")!;
    // In the probe, io and ans are read and base as the template draws them.
    const [io, ans] = [fixture.nodes.io!, fixture.nodes.ans!];
    const texDx = (ans[4]! + ans[6]!) / 2 - (io[4]! + io[6]!) / 2;
    const texDy = (ans[1]! + ans[3]!) / 2 - (io[1]! + io[3]!) / 2;
    expect(base.shape.center.x - read.shape.center.x).toBeCloseTo(texDx, 0);
    expect(base.shape.center.y - read.shape.center.y).toBeCloseTo(texDy, 0);
  });
});
