// Milestone 4 step 3: auto-layout with elk.js, from the toolbar's Layout panel (D80).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "./base.ts";

async function code(page: Page): Promise<string> {
  return page.evaluate(() => {
    const w = window as unknown as { tikzflow: { store: { editorView: () => { state: { doc: { toString(): string } } } } } };
    return w.tikzflow.store.editorView().state.doc.toString();
  });
}

async function setCode(page: Page, text: string) {
  await page.evaluate((t) => {
    const w = window as unknown as { tikzflow: { store: { replaceDocument: (t: string, n: null, e: string) => void } } };
    w.tikzflow.store.replaceDocument(t, null, "utf-8");
  }, text);
}

async function center(page: Page, id: string) {
  const box = await page.locator(`[data-node="${id}"] path`).first().boundingBox();
  if (!box) throw new Error(`node ${id} not drawn`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const DOC = [
  "\\documentclass{article}",
  "\\usepackage{tikz}",
  "\\usetikzlibrary{positioning}",
  "\\begin{document}",
  "\\begin{tikzpicture}",
  "\\node[draw] (a) at (0,0) {A};",
  "\\node[draw] (b) at (4,1) {B};",
  "\\node[draw] (c) at (-3,-2) {C};",
  "\\node[draw] (d) at (6,-5) {D};",
  "\\draw[->] (a) -- (b);",
  "\\draw[->] (b) -- (3,-3) -- (c);",
  "\\draw[->] (c) -- (d);",
  "\\end{tikzpicture}",
  "\\end{document}",
  "",
].join("\n");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await setCode(page, DOC);
  await expect(page.locator('[data-node="d"]').first()).toBeVisible();
});

test("lays out the whole picture top to bottom as relations, one undo step", async ({ page }) => {
  await page.getByTestId("layout-button").click();
  await expect(page.getByTestId("layout-scope")).toContainText("all 4 nodes");
  await page.getByTestId("layout-down").click();
  await expect(page.getByTestId("layout-panel")).toHaveCount(0);
  const t = await code(page);
  expect(t).toContain("\\node[draw] (a) at (0,0) {A};");
  expect(t).toContain("\\node[draw, below=of a] (b) {B};");
  expect(t).toContain("\\node[draw, below=of b] (c) {C};");
  expect(t).toContain("\\node[draw, below=of c] (d) {D};");
  // The corner written as a fixed coordinate is gone.
  expect(t).toContain("\\draw[->] (b) -- (c);");
  await expect(page.getByTestId("status")).toContainText("Laid out 4 nodes top to bottom");
  await expect(page.getByTestId("status")).toContainText("Removed a corner");
  await page.keyboard.press("Control+z");
  await expect.poll(() => code(page)).toBe(DOC);
});

test("lays out only the selected nodes, left to right", async ({ page }) => {
  const b = await center(page, "b");
  await page.mouse.click(b.x, b.y);
  const c = await center(page, "c");
  await page.keyboard.down("Shift");
  await page.mouse.click(c.x, c.y);
  await page.keyboard.up("Shift");
  await expect(page.locator(".tf-selection")).toHaveCount(2);
  await page.getByTestId("layout-button").click();
  await expect(page.getByTestId("layout-scope")).toContainText("the 2 selected nodes");
  await page.getByTestId("layout-right").click();
  await expect.poll(() => code(page)).toContain("\\node[draw, right=of b] (c) {C};");
  const t = await code(page);
  expect(t).toContain("\\node[draw] (a) at (0,0) {A};");
  expect(t).toContain("\\node[draw] (b) at (4,1) {B};");
  expect(t).toContain("\\node[draw] (d) at (6,-5) {D};");
});

test("with reordering allowed, a node's line moves after the node it follows, and one undo puts it back (D87)", async ({ page }) => {
  await page.goto("/");
  const src = readFileSync(join(import.meta.dirname, "..", "..", "corpus", "se-78697-tikzset-classic.tex"), "utf8");
  await page.evaluate((t) => (window as unknown as { tikzflow: { store: { replaceDocument: (t: string, n: null, e: string) => void } } }).tikzflow.store.replaceDocument(t, null, "utf-8"), src);
  await page.getByTestId("layout-button").click();
  await expect(page.getByTestId("layout-reorder")).not.toBeChecked();
  await page.getByTestId("layout-reorder").check();
  await page.getByTestId("layout-down").click();
  await expect(page.getByTestId("status")).toContainText("Moved update's line after test's");
  const code = () => page.evaluate(() => (window as unknown as { tikzflow: { store: { text: { value: string } } } }).tikzflow.store.text.value);
  const after = await code();
  expect(after.indexOf("(update)")).toBeGreaterThan(after.indexOf("(test)"));
  await page.keyboard.press("Control+z");
  await expect.poll(code).toBe(src);
});
