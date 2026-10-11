// Panning the canvas (M4 step 4, the owner's request): a right-button drag
// pans and opens no menu, a right click that doesn't move still opens the edge
// menu, and a middle drag or Space+drag pans from anywhere, even over a node,
// without moving it.
import { expect, type Page, test } from "./base.ts";

type Store = { editorView: () => { state: { doc: { toString(): string } } }; replaceDocument: (t: string, n: null, e: string) => void };

async function code(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as { tikzflow: { store: Store } }).tikzflow.store.editorView().state.doc.toString());
}

const PICTURE = ["\\begin{tikzpicture}", "\\node[draw] (a) at (0,0) {A};", "\\node[draw] (b) at (4,0) {B};", "\\draw[->] (a) -- (b);", "\\end{tikzpicture}", ""].join("\n");

const viewBox = (page: Page) => page.locator("svg.tf-canvas").getAttribute("viewBox");

async function center(page: Page, selector: string) {
  const b = (await page.locator(selector).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

async function onEdge(page: Page) {
  return page.locator("path[data-edge]").first().evaluate((el) => {
    const path = el as SVGPathElement;
    const pt = path.getPointAtLength(path.getTotalLength() * 0.5);
    const s = new DOMPoint(pt.x, pt.y).matrixTransform(path.getScreenCTM()!);
    return { x: s.x, y: s.y };
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("preview-toggle").uncheck();
  await page.evaluate((t) => (window as unknown as { tikzflow: { store: Store } }).tikzflow.store.replaceDocument(t, null, "utf-8"), PICTURE);
  await page.locator('g[data-node="a"]').click();
});

test("a right drag pans, even from an edge, and opens no menu", async ({ page }) => {
  const before = await viewBox(page);
  const p = await onEdge(page);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(p.x + 60, p.y + 30, { steps: 6 });
  // Chromium on Windows asks for the menu here, after the release.
  await page.mouse.up({ button: "right" });
  expect(await viewBox(page)).not.toBe(before);
  await expect(page.getByTestId("edge-menu")).toHaveCount(0);
  // The selection stays.
  await expect(page.getByTestId("inspector")).toContainText("a");
});

test("a right click that doesn't move opens the edge menu as before", async ({ page }) => {
  const before = await viewBox(page);
  const p = await onEdge(page);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(p.x + 2, p.y + 1);
  await page.mouse.up({ button: "right" });
  await expect(page.getByTestId("edge-menu")).toBeVisible();
  expect(await viewBox(page)).toBe(before);
});

test("a menu asked for on press (macOS, Linux) opens on release if the pointer didn't move, and not after a drag", async ({ page }) => {
  const p = await onEdge(page);
  const canvas = page.locator("svg.tf-canvas");
  await page.mouse.move(p.x, p.y);
  await page.mouse.down({ button: "right" });
  await canvas.dispatchEvent("contextmenu", { clientX: p.x, clientY: p.y, button: 2 });
  await expect(page.getByTestId("edge-menu")).toHaveCount(0);
  await page.mouse.up({ button: "right" });
  await expect(page.getByTestId("edge-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.mouse.down({ button: "right" });
  await canvas.dispatchEvent("contextmenu", { clientX: p.x, clientY: p.y, button: 2 });
  await page.mouse.move(p.x + 50, p.y, { steps: 5 });
  await page.mouse.up({ button: "right" });
  await expect(page.getByTestId("edge-menu")).toHaveCount(0);
});

test("a middle drag over a node pans and leaves the node and the selection alone", async ({ page }) => {
  const before = await viewBox(page);
  const text = await code(page);
  const b = await center(page, 'g[data-node="b"]');
  await page.mouse.move(b.x, b.y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(b.x - 80, b.y + 20, { steps: 6 });
  await page.mouse.up({ button: "middle" });
  expect(await viewBox(page)).not.toBe(before);
  expect(await code(page)).toBe(text);
});

test("Space+drag over a node pans instead of moving it", async ({ page }) => {
  const before = await viewBox(page);
  const text = await code(page);
  const b = await center(page, 'g[data-node="b"]');
  await page.locator("svg.tf-canvas").focus();
  await page.keyboard.down(" ");
  await expect(page.locator("svg.tf-canvas")).toHaveClass(/space-pan/);
  await page.mouse.move(b.x, b.y);
  await page.mouse.down();
  await page.mouse.move(b.x + 70, b.y - 40, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up(" ");
  expect(await viewBox(page)).not.toBe(before);
  expect(await code(page)).toBe(text);
  await expect(page.locator("svg.tf-canvas")).not.toHaveClass(/space-pan/);
  // Space still types in the code pane.
  await page.locator(".cm-content").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" x");
  expect(await code(page)).not.toBe(text);
});
