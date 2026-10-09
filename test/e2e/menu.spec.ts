// The edge context menu (D57): the same items in the same order on every edge,
// the current form ticked, a reason on every disabled item, and the menu kept
// inside the window.
import { expect, type Page, test } from "./base.ts";

async function setCode(page: Page, text: string) {
  await page.evaluate((t) => {
    const w = window as unknown as { tikzflow: { store: { replaceDocument: (t: string, n: null, e: string) => void } } };
    w.tikzflow.store.replaceDocument(t, null, "utf-8");
  }, text);
}

async function onEdge(page: Page, id: string, t = 0.5) {
  return page.locator(`path[data-edge="${id}"]`).evaluate((el, t) => {
    const path = el as SVGPathElement;
    const pt = path.getPointAtLength(path.getTotalLength() * t);
    const s = new DOMPoint(pt.x, pt.y).matrixTransform(path.getScreenCTM()!);
    return { x: s.x, y: s.y };
  }, t);
}

async function edgeIds(page: Page): Promise<string[]> {
  return page.locator("path[data-edge]").evaluateAll((els) => els.map((e) => e.getAttribute("data-edge")!));
}

/** Right-clicks edge `index` part way along it and returns the ids of the menu's items, in order. */
async function openMenu(page: Page, index: number, t = 0.5): Promise<string[]> {
  // The view may still be fitting a document just set: try again until the menu opens.
  await expect(async () => {
    const ids = await edgeIds(page);
    const p = await onEdge(page, ids[index]!, t);
    await page.mouse.click(p.x, p.y, { button: "right" });
    await expect(page.getByTestId("edge-menu")).toBeVisible({ timeout: 700 });
  }).toPass({ timeout: 8000 });
  return page.locator('[data-testid="edge-menu"] [role^=menuitem]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")!));
}

const ITEMS = [
  "menu-add-vertex",
  "menu-remove-vertex",
  "menu-straighten",
  "menu-orthogonal",
  "menu-curved",
  "menu-add-label",
  "menu-flip-label",
  "menu-from-anchor",
  "menu-to-anchor",
  "menu-split",
  "menu-delete",
];

const TWO = "\\begin{tikzpicture}\n\\node[draw] (a) {A};\n\\node[draw] (b) at (4,-2) {B};\n\\node[draw] (c) at (4,-4) {C};\n";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("summary-headline")).toHaveText("6 nodes and 6 edges editable");
});

test("every edge's menu has the same items in the same order, and each disabled one says why", async ({ page }) => {
  // The sample: a straight edge (rec → stop) and an orthogonal one (base |- stop).
  for (const [index, t] of [[4, 0.5], [5, 0.3]] as const) {
    expect(await openMenu(page, index, t)).toEqual(ITEMS);
    const disabled = page.locator('[data-testid="edge-menu"] [aria-disabled=true]');
    for (const el of await disabled.all()) await expect(el).toHaveAttribute("title", /\S/);
    await page.keyboard.press("Escape");
  }
  // A \draw with two edges and a curved edge.
  await setCode(page, `${TWO}\\draw[->] (a) -- (b) -- (c);\n\\draw (a) to[bend left] (c);\n\\end{tikzpicture}\n`);
  await expect(page.locator("path[data-edge]")).toHaveCount(3);
  for (const index of [0, 2]) {
    expect(await openMenu(page, index)).toEqual(ITEMS);
    for (const el of await page.locator('[data-testid="edge-menu"] [aria-disabled=true]').all()) await expect(el).toHaveAttribute("title", /\S/);
    await page.keyboard.press("Escape");
  }
});

test("Split is listed on a single edge too, disabled with the reason", async ({ page }) => {
  await openMenu(page, 4);
  const split = page.getByTestId("menu-split");
  await expect(split).toHaveAttribute("aria-disabled", "true");
  await expect(split).toHaveAttribute("title", "This \\draw has only one edge.");
});

test("the edge's current form is ticked and is not offered as an action", async ({ page }) => {
  await openMenu(page, 4); // rec → stop: straight
  await expect(page.getByTestId("menu-straighten")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("menu-orthogonal")).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("menu-curved")).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("menu-straighten").locator(".tf-menu-check")).toHaveText("✓");
  // Choosing the ticked form changes nothing.
  const before = await page.evaluate(() => (window as unknown as { tikzflow: { store: { editorView: () => { state: { doc: { toString(): string } } } } } }).tikzflow.store.editorView().state.doc.toString());
  await page.getByTestId("menu-straighten").click();
  await expect(page.getByTestId("edge-menu")).toHaveCount(0);
  const after = await page.evaluate(() => (window as unknown as { tikzflow: { store: { editorView: () => { state: { doc: { toString(): string } } } } } }).tikzflow.store.editorView().state.doc.toString());
  expect(after).toBe(before);

  await page.keyboard.press("Escape");
  await openMenu(page, 5, 0.3); // base |- stop: orthogonal
  await expect(page.getByTestId("menu-orthogonal")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("menu-straighten")).toHaveAttribute("aria-checked", "false");
  // Why Add vertex isn't available here.
  await expect(page.getByTestId("menu-add-vertex")).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByTestId("menu-add-vertex")).toHaveAttribute("title", /Orthogonal edges have no free corners/);
});

test("the menu stays inside the window, opening upward and leftward when it has to", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 560 });
  await page.getByRole("button", { name: "Fit" }).click();
  await expect(page.locator("path[data-edge]")).toHaveCount(6);
  const vw = 1100;
  const vh = 560;
  // Right-click edges at a few places, including the lowest and the right-most ones. (Near a node, its connection handles are in the way of the click.)
  for (const [index, ts] of [[0, [0.5]], [2, [0.2, 0.8]], [4, [0.5]], [5, [0.2, 0.8]]] as const) {
    for (const t of ts) {
      await openMenu(page, index, t);
      const box = (await page.getByTestId("edge-menu").boundingBox())!;
      expect(box.x, `menu left, edge ${index}`).toBeGreaterThanOrEqual(0);
      expect(box.y, `menu top, edge ${index}`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `menu right, edge ${index}`).toBeLessThanOrEqual(vw);
      expect(box.y + box.height, `menu bottom, edge ${index}`).toBeLessThanOrEqual(vh);
      // Its last item is reachable.
      await expect(page.getByTestId("menu-delete")).toBeInViewport();
      await page.keyboard.press("Escape");
    }
  }
});

test("a very short window still shows every item, by scrolling the menu", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 330 });
  await page.getByRole("button", { name: "Fit" }).click();
  await openMenu(page, 4);
  const box = (await page.getByTestId("edge-menu").boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(330);
  await page.getByTestId("menu-delete").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("menu-delete")).toBeInViewport();
});

test("the anchor picker opens inside the window too", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 560 });
  await page.getByRole("button", { name: "Fit" }).click();
  await openMenu(page, 5, 0.8);
  await page.getByTestId("menu-to-anchor").hover();
  const box = (await page.locator('[data-testid="menu-to-anchor"] .tf-submenu').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(1100);
  expect(box.y + box.height).toBeLessThanOrEqual(560);
});
