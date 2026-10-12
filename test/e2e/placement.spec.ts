// TeX reports where it put each named node, and the editor flags a node it
// places more than a point away (D98). The owner's case first: the Basic
// process template with its answer dragged below right of the I/O trapezium,
// which used to put the selection's outline 23pt right of TeX's box. Then a
// mismatch, made by moving TeX's reported box, shows the marker, TeX's box for
// the selected node and the note. Needs the engine.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "./base.ts";

const tag = (JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "engine", "release.json"), "utf8")) as { tag: string }).tag;
const haveEngine = existsSync(join(import.meta.dirname, "..", "..", "vendor", "engine", tag, "index.json"));

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** TeX's reported box of a node and the selection outline's box, in the canvas's units. */
async function boxes(page: Page, name: string): Promise<{ tex: Box; selection: Box }> {
  return page.evaluate((name) => {
    type P = { x: number; y: number };
    const w = window as unknown as { tikzflow: { preview: { freshCompiled: { value: { placements: Map<string, { north: P; south: P; east: P; west: P }> } } } } };
    const t = w.tikzflow.preview.freshCompiled.value.placements.get(name)!;
    const b = (document.querySelector("rect.tf-selection") as SVGRectElement).getBBox();
    // The selection is drawn in the y-up overlay, so its box is y-up like TeX's.
    return { tex: { x: t.west.x, y: t.south.y, w: t.east.x - t.west.x, h: t.north.y - t.south.y }, selection: { x: b.x, y: b.y, w: b.width, h: b.height } };
  }, name);
}

test.describe("with the TeX engine", () => {
  test.skip(!haveEngine, `the engine ${tag} isn't in vendor/engine (npm run fetch-engines -- engine)`);

  test("a node placed below right of the I/O trapezium: the outline matches TeX's box, nothing flagged", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      const w = window as unknown as { tikzflow: { store: { text: { value: string }; replaceDocument: (t: string, n: null, e: string) => void } } };
      const t = w.tikzflow.store.text.value;
      w.tikzflow.store.replaceDocument(t.replace("\\node[process, right=of small] (base)", "\\node[process, below right=7mm and 1.8cm of read] (base)"), null, "utf-8");
    });
    await expect(page.locator(".tf-compiled-layer:not([data-stale])")).toBeAttached({ timeout: 15_000 });
    await expect.poll(() => page.evaluate(() => (window as unknown as { tikzflow: { preview: { freshCompiled: { value: { placements?: Map<string, unknown> } | null } } } }).tikzflow.preview.freshCompiled.value?.placements?.size ?? 0)).toBe(6);
    await expect(page.getByTestId("misplaced-marker")).toHaveCount(0);
    await expect(page.getByTestId("preview-state")).toHaveText("TeX preview");
    await page.locator('g.tf-node[data-node="base"]').click();
    const { tex, selection } = await boxes(page, "base");
    // The outline is the node's box with a 3px margin all round: centered on TeX's box, 6px bigger.
    const pad = (selection.w - tex.w) / 2;
    expect(pad).toBeGreaterThan(0);
    expect(Math.abs(selection.h - tex.h - 2 * pad)).toBeLessThan(1);
    expect(Math.abs(selection.x + pad - tex.x)).toBeLessThan(1);
    expect(Math.abs(selection.y + pad - tex.y)).toBeLessThan(1);
  });

  test("a node TeX puts elsewhere gets a marker, TeX's box when selected, and a note", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".tf-compiled-layer:not([data-stale])")).toBeAttached({ timeout: 15_000 });
    await expect(page.getByTestId("misplaced-marker")).toHaveCount(0);
    // As if the quick preview's geometry were 23pt off for read: TeX's reported box moved instead.
    await page.evaluate(() => {
      type P = { x: number; y: number };
      type C = { placements: Map<string, { north: P; south: P; east: P; west: P }> };
      const w = window as unknown as { tikzflow: { preview: { compiled: { value: C } } } };
      const c = w.tikzflow.preview.compiled.value;
      const placements = new Map(c.placements);
      const r = placements.get("read")!;
      const m = (p: P) => ({ x: p.x + 23.2, y: p.y });
      placements.set("read", { north: m(r.north), south: m(r.south), east: m(r.east), west: m(r.west) });
      w.tikzflow.preview.compiled.value = { ...c, placements };
    });
    await expect(page.getByTestId("misplaced-marker")).toHaveCount(1);
    await expect(page.getByTestId("misplaced-tex-box")).toHaveCount(0);
    await expect(page.getByTestId("preview-state")).toHaveText("TeX preview: notes");
    await page.getByTestId("preview-state").click();
    await expect(page.getByTestId("preview-notices")).toContainText("TeX puts read 23.2 pt from where the editor's own drawing does");
    await page.locator('g.tf-node[data-node="read"]').click();
    await expect(page.getByTestId("misplaced-tex-box")).toHaveCount(1);
  });

  test("a node 2pt off is in the notes but gets no marker on the canvas (D101)", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".tf-compiled-layer:not([data-stale])")).toBeAttached({ timeout: 15_000 });
    await page.evaluate(() => {
      type P = { x: number; y: number };
      type C = { placements: Map<string, { north: P; south: P; east: P; west: P }> };
      const w = window as unknown as { tikzflow: { preview: { compiled: { value: C } } } };
      const c = w.tikzflow.preview.compiled.value;
      const placements = new Map(c.placements);
      const r = placements.get("read")!;
      const m = (p: P) => ({ x: p.x + 2, y: p.y });
      placements.set("read", { north: m(r.north), south: m(r.south), east: m(r.east), west: m(r.west) });
      w.tikzflow.preview.compiled.value = { ...c, placements };
    });
    await expect(page.getByTestId("preview-state")).toHaveText("TeX preview: notes");
    await page.getByTestId("preview-state").click();
    const notes = page.getByTestId("preview-notices");
    await expect(notes).toContainText("TeX puts read 2 pt from where the editor's own drawing does");
    await expect(notes).not.toContainText("marked on the canvas");
    await expect(page.getByTestId("misplaced-marker")).toHaveCount(0);
    await page.locator('g.tf-node[data-node="read"]').click();
    await expect(page.getByTestId("misplaced-tex-box")).toHaveCount(0);
  });
});
