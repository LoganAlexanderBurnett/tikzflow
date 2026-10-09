import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "./base.ts";

const corpus = (name: string) => join(import.meta.dirname, "..", "..", "corpus", name);

/** The code pane's text. */
async function code(page: Page): Promise<string> {
  return page.evaluate(() => {
    const w = window as unknown as { tikzflow: { store: { editorView: () => { state: { doc: { toString(): string } } } } } };
    return w.tikzflow.store.editorView().state.doc.toString();
  });
}

async function nodeBox(page: Page, id: string) {
  const box = await page.locator(`[data-node="${id}"] path`).first().boundingBox();
  if (!box) throw new Error(`node ${id} not drawn`);
  return box;
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("summary-headline")).toHaveText("6 nodes and 6 edges editable");
});

test("shows the sample with KaTeX labels", async ({ page }) => {
  await expect(page.locator("[data-node]").first()).toBeVisible();
  for (const id of ["start", "read", "small", "base", "rec", "stop"]) await expect(page.locator(`g[data-node="${id}"]`)).toHaveCount(1);
  await expect(page.locator(".tf-label .katex").first()).toBeVisible();
});

test("dragging a node below another writes positioning code, and undo/redo work from the canvas", async ({ page }) => {
  const before = await code(page);
  const base = await nodeBox(page, "base");
  const stop = await nodeBox(page, "stop");
  // Put "base" in the same column as "stop", well below it: it snaps to stop's centre line.
  const from = { x: base.x + base.width / 2, y: base.y + base.height / 2 };
  const to = { x: stop.x + stop.width / 2 + 2, y: stop.y + stop.height * 2.6 };
  await drag(page, from, to);
  const after = await code(page);
  expect(after).not.toBe(before);
  // Only base's statement changed, and it is still relational.
  const line = after.split("\n").find((l) => l.includes("(base)"))!;
  expect(line).toMatch(/\\node\[process, (below|above|right|left)[^\]]* of [a-z]+(, [xy]shift=[^\]]+)?\] \(base\)/);
  expect(after.split("\n").filter((l) => !l.includes("(base)"))).toEqual(before.split("\n").filter((l) => !l.includes("(base)")));
  await expect(page.getByTestId("status")).toContainText("Wrote");

  await page.locator(".tf-canvas").click({ position: { x: 20, y: 200 } });
  await page.keyboard.press("Control+z");
  expect(await code(page)).toBe(before);
  await page.keyboard.press("Control+y");
  expect(await code(page)).toBe(after);
});

test("a drop that snaps under another node at node distance writes below=of", async ({ page }) => {
  // Move "stop" back under "rec" from the side: it should become below=of rec again.
  const stop = await nodeBox(page, "stop");
  const rec = await nodeBox(page, "rec");
  const from = { x: stop.x + stop.width / 2, y: stop.y + stop.height / 2 };
  await drag(page, from, { x: from.x + 160, y: from.y });
  expect(await code(page)).not.toContain("below=of rec]  (stop)");
  const moved = await nodeBox(page, "stop");
  await drag(page, { x: moved.x + moved.width / 2, y: moved.y + moved.height / 2 }, { x: rec.x + rec.width / 2 + 3, y: from.y + 2 });
  expect(await code(page)).toContain("\\node[terminal, below=of rec]  (stop)  {Stop};");
});

test("clicking a shape highlights its code; moving the cursor selects the shape", async ({ page }) => {
  const read = await nodeBox(page, "read");
  await page.mouse.click(read.x + read.width / 2, read.y + read.height / 2);
  await expect(page.locator(".cm-tf-selected").first()).toContainText("\\node[io, below=of start]");

  // Click into the code on the "rec" line.
  await page.locator(".cm-line", { hasText: "(rec)" }).first().click();
  await expect(page.locator(".tf-selection")).toHaveCount(1);
  const sel = await page.locator(".tf-selection").boundingBox();
  const rec = await nodeBox(page, "rec");
  expect(Math.abs(sel!.x + sel!.width / 2 - (rec.x + rec.width / 2))).toBeLessThan(3);
});

test("shift-click adds nodes to the selection and takes them out again", async ({ page }) => {
  const centre = async (id: string) => {
    const b = await nodeBox(page, id);
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const read = await centre("read");
  const rec = await centre("rec");
  const stop = await centre("stop");
  await page.mouse.click(read.x, read.y);
  await page.keyboard.down("Shift");
  await page.mouse.click(rec.x, rec.y);
  await page.mouse.click(stop.x, stop.y);
  await expect(page.locator(".tf-selection")).toHaveCount(3);
  // Every selected statement is highlighted in the code.
  await expect(page.locator(".cm-tf-selected", { hasText: "(read)" })).toHaveCount(1);
  await expect(page.locator(".cm-tf-selected", { hasText: "(stop)" })).toHaveCount(1);
  await page.mouse.click(rec.x, rec.y);
  await page.keyboard.up("Shift");
  await expect(page.locator(".tf-selection")).toHaveCount(2);
  await expect(page.locator(".cm-tf-selected", { hasText: "(rec)" })).toHaveCount(0);
  // A plain click selects one node again.
  await page.mouse.click(rec.x, rec.y);
  await expect(page.locator(".tf-selection")).toHaveCount(1);
});

test("typing in the code pane updates the canvas", async ({ page }) => {
  await page.locator(".cm-line", { hasText: "{Stop}" }).first().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("  \\node[process, right=of stop] (extra) {Extra};");
  await expect(page.getByTestId("summary-headline")).toHaveText("7 nodes and 6 edges editable");
  await expect(page.locator('g[data-node="extra"]')).toHaveCount(1);
});

test("opens a Latin-1 file and downloads it byte for byte", async ({ page }) => {
  const file = corpus("self-latin1.tex");
  await page.locator('input[type="file"]').setInputFiles(file);
  await expect(page.getByTestId("summary-headline")).toHaveText("2 nodes and 1 edge editable");
  await expect(page.locator(".tf-label").first()).toContainText("Größe messen");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download" }).click()]);
  const path = await download.path();
  expect(readFileSync(path).equals(readFileSync(file))).toBe(true);
});

test("locked nodes can't be dragged and say why", async ({ page }) => {
  await page.locator('input[type="file"]').setInputFiles(corpus("self-document.tex"));
  await expect(page.getByTestId("summary-headline")).toHaveText("6 nodes of 7 and 6 edges editable");
  const before = await code(page);
  const box = await nodeBox(page, "box");
  await drag(page, { x: box.x + 4, y: box.y + box.height / 2 }, { x: box.x + 60, y: box.y + box.height / 2 + 40 });
  expect(await code(page)).toBe(before);
  await expect(page.getByTestId("status")).toContainText("Locked");
});
