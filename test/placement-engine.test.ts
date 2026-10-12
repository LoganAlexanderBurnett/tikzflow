// TeX reports where it put each named node, and the editor compares that with
// its own layout (D98). With our engine: the report parses, it draws nothing,
// every template and corpus picture the quick preview lays out within 1pt has no
// node flagged, and the owner's case (a node placed below right of a trapezium)
// would have been flagged before the fix. Skipped without the engine.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Compiler, engine, haveEngine } from "../scripts/lib/compile.ts";
import { parsePlacements } from "../src/engine/log.ts";
import { misplaced, reportNames } from "../src/engine/placement.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import { decode } from "../src/source/encoding.ts";
import { TEMPLATES } from "../src/templates/catalog.ts";
import { templateText } from "../src/templates/index.ts";

const root = join(import.meta.dirname, "..");

describe.skipIf(!haveEngine())("TeX's placements against the quick preview", () => {
  let tex: Promise<Compiler> | undefined;
  const compiler = () => (tex ??= engine());
  const check = async (text: string) => {
    const layout = layoutDocumentPicture(analyzeDocument(text), 0)!;
    const names = reportNames(layout);
    const r = await (await compiler()).compile(text, 0, 2, names);
    const placements = parsePlacements(r.log);
    return { layout, names, placements, r, misplaced: misplaced(layout, placements) };
  };

  it.each(TEMPLATES.map((t) => [t.id]))("%s: every named node reported, none misplaced", async (id) => {
    const { names, placements, misplaced: off, r } = await check(templateText(id)!);
    expect(r.errors).toEqual([]);
    expect(names.length).toBeGreaterThan(0);
    expect([...placements.keys()].sort()).toEqual([...names].sort());
    expect(off).toEqual([]);
  });

  it("the report draws nothing: the picture is the same with and without it", async () => {
    const text = templateText("basic-process")!;
    const c = await compiler();
    const plain = await c.compile(text);
    const reported = await c.compile(text, 0, 2, reportNames(layoutDocumentPicture(analyzeDocument(text), 0)!));
    expect(reported.svg).toBe(plain.svg);
  });

  it("the owner's case is clean now, and a wrong anchor would be flagged", async () => {
    const text = templateText("basic-process")!.replace("\\node[process, right=of small] (base)", "\\node[process, below right=7mm and 1.8cm of read] (base)");
    const now = await check(text);
    expect(now.misplaced).toEqual([]);
    // Pretend the quick preview still used the trapezium's corner: TeX's base is then 23pt away.
    const corner = now.layout.nodes.find((n) => n.name === "base")!;
    const shifted = { ...now.layout, nodes: now.layout.nodes.map((n) => (n === corner ? { ...n, shape: { ...n.shape, center: { x: n.shape.center.x + 23.2, y: n.shape.center.y } } } : n)) };
    const flagged = misplaced(shifted, now.placements);
    expect(flagged.map((m) => m.name)).toEqual(["base"]);
    expect(flagged[0]!.off).toBeCloseTo(23.2, 0);
  });

  it("names with spaces, and a name TeX doesn't know, are handled", async () => {
    const text = "\\usetikzlibrary{positioning}\n\\begin{tikzpicture}\n\\node[draw] (lanes top) {A};\n\\node[draw, right=of lanes top] (b) {B};\n\\end{tikzpicture}\n";
    const { placements, misplaced: off, r } = await check(text);
    expect(r.errors).toEqual([]);
    expect(placements.has("lanes top")).toBe(true);
    expect(off).toEqual([]);
    const c = await compiler();
    const unknown = await c.compile(text, 0, 2, ["nowhere"]);
    expect(unknown.errors).toEqual(r.errors);
    expect(parsePlacements(unknown.log).size).toBe(0);
  });

  it("corpus pictures: the report never adds an error", async () => {
    const c = await compiler();
    for (const file of readdirSync(join(root, "corpus")).filter((f) => f.endsWith(".tex")).slice(0, 12)) {
      const text = decode(new Uint8Array(readFileSync(join(root, "corpus", file)))).text;
      const doc = analyzeDocument(text);
      if (!doc.syntax.pictures.length) continue;
      const layout = layoutDocumentPicture(doc, 0);
      if (!layout) continue;
      const plain = await c.compile(text);
      const reported = await c.compile(text, 0, 2, reportNames(layout));
      expect(reported.errors.map((e) => e.message), file).toEqual(plain.errors.map((e) => e.message));
      expect(reported.svg, file).toBe(plain.svg);
    }
  });
});
