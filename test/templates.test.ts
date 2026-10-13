// The templates (D89 item 4, D95, D100, D106): thirteen hand-written pictures that open with nothing kept as-is, every
// node draggable, every edge editable, and that our engine compiles cleanly into the committed
// thumbnails (regenerate with npm run site:assets). CI also compiles them with pdfLaTeX (test.yml).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Compiler, engine, haveEngine } from "../scripts/lib/compile.ts";
import { planMove } from "../src/edit/move.ts";
import { keyNamedStyles } from "../src/edit/stylekeys.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import { pictureEdges } from "../src/model/edges.ts";
import { summarize } from "../src/model/summary.ts";
import { BLANK_ID, TEMPLATES } from "../src/templates/catalog.ts";
import { isPristine, templateText } from "../src/templates/index.ts";
import { PT_PER_UNIT } from "../src/tikz/units.ts";

const root = join(import.meta.dirname, "..");
const MM = PT_PER_UNIT.mm!;
const read = (id: string) => readFileSync(join(root, "src", "templates", `${id}.tex`), "utf8");

describe("the catalog", () => {
  it("lists thirteen templates, each with its file, and the blank diagram", () => {
    expect(TEMPLATES).toHaveLength(13);
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(13);
    const files = readdirSync(join(root, "src", "templates")).filter((f) => f.endsWith(".tex"));
    expect(files.sort()).toEqual([...ids, BLANK_ID].map((id) => `${id}.tex`).sort());
  });

  it("gives each template's code, and nothing for other names", () => {
    for (const t of TEMPLATES) expect(templateText(t.id)).toBe(read(t.id));
    expect(templateText(BLANK_ID)).toBe(read(BLANK_ID));
    expect(templateText("no-such-template")).toBeUndefined();
    expect(templateText("../catalog")).toBeUndefined();
  });

  it("knows an untouched template from work", () => {
    for (const t of TEMPLATES) expect(isPristine(read(t.id))).toBe(true);
    expect(isPristine(read(BLANK_ID))).toBe(true);
    expect(isPristine(read("hierarchy").replace("Director", "Dean"))).toBe(false);
  });

  it("files have Unix line endings and end with one", () => {
    for (const id of [...TEMPLATES.map((t) => t.id), BLANK_ID]) {
      const t = read(id);
      expect(t.includes("\r"), id).toBe(false);
      expect(t.endsWith("\\end{document}\n"), id).toBe(true);
    }
  });
});

describe.each(TEMPLATES)("$title", ({ id }) => {
  const text = read(id);

  it("opens with everything understood", () => {
    const doc = analyzeDocument(text);
    expect(doc.errorCount).toBe(0);
    expect(doc.syntax.pictures).toHaveLength(1);
    const layout = layoutDocumentPicture(doc, 0)!;
    const s = summarize(doc, layout, 0);
    expect(layout.opaque).toEqual([]);
    // No style named like a TikZ key (D87): TeX would fail on every node using it.
    expect(keyNamedStyles(doc, doc.syntax.pictures[0]!).map((k) => k.name)).toEqual([]);
    expect(s.kept).toEqual({});
    expect(s.unknownKeys).toEqual([]);
    expect(s.notes).toEqual([]);
    expect(s.unresolved).toEqual([]);
    expect(layout.issues).toEqual([]);
    // Only groups and lanes are locked: their boxes follow the nodes they fit. The summary counts them
    // as groups, so every node is editable (D96).
    for (const n of layout.nodes) if (n.lock) expect(n.lock.kind, n.id).toBe("fit");
    expect(s.locked).toEqual([]);
    expect(s.editableNodes).toBe(s.nodes);
    expect(s.groups).toBe(layout.nodes.filter((n) => n.lock?.kind === "fit").length);
    expect(s.main).not.toContain(" of ");
    for (const n of [...layout.nodes, ...layout.pathNodes]) expect(n.unrendered, n.id).toEqual([]);
    for (const p of layout.paths) {
      expect(p.unrendered, p.id).toEqual([]);
      expect(p.unknownKeys, p.id).toEqual([]);
      expect(p.issues, p.id).toEqual([]);
    }
    const edges = pictureEdges(layout);
    // Every template has edges, except the Venn diagram (D106), which is overlapping sets only.
    if (id !== "venn") expect(edges.length).toBeGreaterThan(0);
    for (const e of edges) expect(e.lock, e.id).toBeUndefined();
  });

  it("lets every node be dragged, and the code stays understood", () => {
    const layout = layoutDocumentPicture(analyzeDocument(text), 0)!;
    const movable = layout.nodes.filter((n) => n.kind === "statement" && !n.lock);
    expect(movable.length).toBeGreaterThan(0);
    for (const n of movable) {
      const r = planMove(text, 0, n.id, { x: n.shape.center.x + 5 * MM, y: n.shape.center.y - 3 * MM });
      expect(r, n.id).not.toBeNull();
      const doc = analyzeDocument(r!.text);
      expect(doc.errorCount, n.id).toBe(0);
      const s = summarize(doc, layoutDocumentPicture(doc, 0)!, 0);
      expect([s.unknownKeys, s.unresolved, s.kept], n.id).toEqual([[], [], {}]);
    }
  });
});

describe("the home page's gallery", () => {
  it("shows every template in order, each opening it in the editor", () => {
    const html = readFileSync(join(root, "index.html"), "utf8");
    const cards = [...html.matchAll(/<a class="tcard" href="([^"]*)"><div class="thumb"><img src="([^"]*)"[^>]*\/><\/div><div class="tmeta"><h3>([^<]*)<\/h3><p>(.*?)<\/p><\/div><\/a>/g)];
    expect(cards.map((c) => [c[1], c[2], c[3], c[4]!.replace(/<\/?code>/g, "`")])).toEqual(
      TEMPLATES.map((t) => [`/editor/#template=${t.id}`, `./src/site/thumbs/${t.id}.svg`, t.title, t.blurb]),
    );
  });

  it("puts the catalog's section headings (Neural networks, D101; Other diagrams, D106) before the first card of each", () => {
    const html = readFileSync(join(root, "index.html"), "utf8");
    const seen = [...html.matchAll(/<h3 class="tgroup">([^<]*)<\/h3>\s*<a class="tcard" href="\/editor\/#template=([^"]*)"/g)].map((m) => [m[1], m[2]]);
    expect(seen).toEqual(TEMPLATES.filter((t) => t.section).map((t) => [t.section, t.id]));
    expect(seen).toEqual([
      ["Neural networks", "neural-network"],
      ["Other diagrams", "venn"],
    ]);
    expect(html.match(/class="tgroup"/g)).toHaveLength(2);
  });
});

describe.skipIf(!haveEngine())("compiled by our engine", () => {
  let tex: Promise<Compiler> | null = null;
  const compiler = () => (tex ??= engine());

  it.each(TEMPLATES)(
    "$title: no errors, and the committed thumbnail is what the engine draws now",
    async ({ id }) => {
      const r = await (await compiler()).compile(read(id));
      expect(r.errors).toEqual([]);
      expect(readFileSync(join(root, "src", "site", "thumbs", `${id}.svg`), "utf8"), "run npm run site:assets").toBe(r.svg);
    },
    60_000,
  );

  it("the blank diagram compiles", async () => {
    const r = await (await compiler()).compile(read(BLANK_ID));
    expect(r.errors).toEqual([]);
  }, 60_000);
});
