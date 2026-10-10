// Milestone 4 step 1: dragging a multi-selection, or a fit node, as a group.
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

/** A node's centre in the picture's coordinates (pt, y up): the canvas may be resized or panned in between. */
async function modelCenter(page: Page, id: string) {
  return page.evaluate((id) => {
    const w = window as unknown as { tikzflow: { store: { baseLayout: { value: { nodes: Array<{ id: string; shape: { center: { x: number; y: number } } }> } } } } };
    return w.tikzflow.store.baseLayout.value.nodes.find((n) => n.id === id)!.shape.center;
  }, id);
}

/** Clicks the first node and Shift-clicks the others, measuring each one when it is clicked (the panel opening resizes the canvas). */
async function select(page: Page, ids: string[]) {
  for (const [k, id] of ids.entries()) {
    const p = await center(page, id);
    if (k) await page.keyboard.down("Shift");
    await page.mouse.click(p.x, p.y);
    if (k) await page.keyboard.up("Shift");
    await expect(page.locator(".tf-selection")).toHaveCount(k + 1);
  }
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
}

const DOC = [
  "\\documentclass{article}",
  "\\usepackage{tikz}",
  "\\usetikzlibrary{positioning,fit}",
  "\\begin{document}",
  "\\begin{tikzpicture}",
  "\\node[draw] (a) {A};",
  "\\node[draw, below=of a] (b) {B};",
  "\\node[draw, below=of b] (c) {C};",
  "\\node[draw, right=4cm of a] (d) {D};",
  "\\node[draw, dashed, fit=(d)] (box) {};",
  "\\end{tikzpicture}",
  "\\end{document}",
  "",
].join("\n");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await setCode(page, DOC);
  await expect(page.getByTestId("summary-headline")).toContainText("4 nodes");
});

test("a Shift-selected pair moves together; only the node placed outside the group is rewritten; one undo step", async ({ page }) => {
  await select(page, ["b", "c"]);
  const b0 = await modelCenter(page, "b");
  const c0 = await modelCenter(page, "c");
  const from = await center(page, "b");
  await drag(page, from, { x: from.x + 90, y: from.y + 7 });
  await expect(page.getByTestId("status")).toContainText("Moved 2 nodes");
  const after = await code(page);
  expect(after).toContain("\\node[draw, below=of b] (c) {C};");
  expect(after).not.toContain("\\node[draw, below=of a] (b) {B};");
  const b1 = await modelCenter(page, "b");
  const c1 = await modelCenter(page, "c");
  // Both moved by the same amount (to the millimetre the code is written in).
  expect(Math.abs(b1.x - b0.x - (c1.x - c0.x))).toBeLessThan(2.2);
  expect(Math.abs(b1.y - b0.y - (c1.y - c0.y))).toBeLessThan(2.2);
  expect(b1.x - b0.x).toBeGreaterThan(10);
  await expect(page.locator(".tf-selection")).toHaveCount(2);
  // One undo takes the whole move back.
  await page.keyboard.press("Control+z");
  expect(await code(page)).toBe(DOC);
});

test("a click without a drag on a node of the selection selects just that node", async ({ page }) => {
  await select(page, ["b", "c"]);
  await expect(page.locator(".tf-selection")).toHaveCount(2);
  const b = await center(page, "b");
  await page.mouse.click(b.x, b.y);
  await expect(page.locator(".tf-selection")).toHaveCount(1);
  expect(await code(page)).toBe(DOC);
});

test("dragging a fit node moves what it fits, and the box follows", async ({ page }) => {
  const d0 = await modelCenter(page, "d");
  // Select it first: the panel that opens resizes the canvas.
  const b0 = (await page.locator('[data-node="box"] path').first().boundingBox())!;
  await page.mouse.click(b0.x + 2, b0.y + b0.height / 2);
  const box = await page.locator('[data-node="box"] path').first().boundingBox();
  // Grab the box's border, away from D itself.
  const grab = { x: box!.x + 2, y: box!.y + box!.height / 2 };
  await drag(page, grab, { x: grab.x + 50, y: grab.y + 40 });
  await expect(page.getByTestId("status")).toContainText("Moved 1 node");
  const d1 = await modelCenter(page, "d");
  // Screen y down is picture y up.
  expect(d0.y - d1.y).toBeGreaterThan(10);
  expect(await code(page)).toContain("\\node[draw, dashed, fit=(d)] (box) {};");
});
