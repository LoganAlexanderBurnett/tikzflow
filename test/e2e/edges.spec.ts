// Milestone 2b: selecting and working on edges.
import { expect, type Page, test } from "@playwright/test";

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

/** A point on the drawn edge `id`, part way along it. */
async function onEdge(page: Page, id: string, t = 0.5) {
  const p = await page.locator(`path[data-edge="${id}"]`).evaluate((el, t) => {
    const path = el as SVGPathElement;
    const pt = path.getPointAtLength(path.getTotalLength() * t);
    const m = path.getScreenCTM()!;
    const s = new DOMPoint(pt.x, pt.y).matrixTransform(m);
    return { x: s.x, y: s.y };
  }, t);
  return p;
}

/** Ids of the edges drawn on the canvas, in order. */
async function edgeIds(page: Page): Promise<string[]> {
  return page.locator("path[data-edge]").evaluateAll((els) => els.map((e) => e.getAttribute("data-edge")!));
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("summary-headline")).toHaveText("6 nodes and 6 edges editable");
});

test("clicking an edge selects it, highlights its code and names it in the panel", async ({ page }) => {
  const ids = await edgeIds(page);
  expect(ids).toHaveLength(6);
  // The fifth edge is rec → stop.
  const p = await onEdge(page, ids[4]!);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId("edge-selection")).toHaveCount(1);
  await expect(page.getByTestId("edge-title")).toHaveText("rec → stop");
  await expect(page.getByTestId("edge-mode")).toContainText("Straight");
  await expect(page.locator(".cm-tf-selected").first()).toContainText("(rec)   -- (stop)");
  await page.screenshot({ path: "test-results/m2b-edge-selected.png" });
});

test("the |- edge is orthogonal, and clicking a label selects its edge", async ({ page }) => {
  const ids = await edgeIds(page);
  await page.mouse.click(...(Object.values(await onEdge(page, ids[5]!, 0.3)) as [number, number]));
  await expect(page.getByTestId("edge-title")).toHaveText("base → stop");
  await expect(page.getByTestId("edge-mode")).toContainText("Orthogonal");
  const yes = page.getByTestId("edge-label").first();
  await yes.click();
  await expect(page.getByTestId("edge-title")).toHaveText("small → base");
});

test("double-clicking an edge label edits it in place, as one undo step", async ({ page }) => {
  const before = await code(page);
  await page.getByTestId("edge-label").first().dblclick();
  const box = page.getByRole("textbox", { name: "Node label, as TeX" });
  await expect(box).toHaveValue("yes");
  await page.keyboard.type("Yes");
  await page.keyboard.press("Enter");
  const after = await code(page);
  expect(after).toBe(before.replace("node[above] {yes}", "node[above] {Yes}"));
  await expect(page.getByTestId("status")).toContainText("Changed the edge label.");
  // The edge stays selected.
  await expect(page.getByTestId("edge-title")).toHaveText("small → base");
  await page.keyboard.press("Control+z");
  expect(await code(page)).toBe(before);
});

test("moving the cursor into an edge's code selects that edge", async ({ page }) => {
  await setCode(page, "\\begin{tikzpicture}\n\\node (a) {A};\n\\node (b) at (2,0) {B};\n\\node (c) at (2,-2) {C};\n\\draw[->] (a) -- (b) -- (c);\n\\end{tikzpicture}\n");
  await expect(page.locator("path[data-edge]")).toHaveCount(2);
  const text = await code(page);
  await page.evaluate((pos) => {
    const w = window as unknown as { tikzflow: { store: { onEditorCursor: (p: number) => void } } };
    w.tikzflow.store.onEditorCursor(pos);
  }, text.lastIndexOf("(c)") + 1);
  await expect(page.getByTestId("edge-title")).toHaveText("b → c");
});

test("a locked edge says why", async ({ page }) => {
  await setCode(page, "\\begin{tikzpicture}\n\\node (a) {A};\n\\node (b) at (2,0) {B};\n\\draw (a) -- (b) -- (2,-1) -- cycle;\n\\end{tikzpicture}\n");
  const ids = await edgeIds(page);
  const p = await onEdge(page, ids[0]!);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId("edge-lock-card")).toContainText("Part of a shape");
});

// ---------------------------------------------------------------- step 3: anchors

/** The screen box of node `id`'s shape. */
async function nodeBox(page: Page, id: string) {
  const box = await page.locator(`g[data-node="${id}"] path`).first().boundingBox();
  if (!box) throw new Error(`node ${id} not drawn`);
  return box;
}

async function selectEdge(page: Page, index: number) {
  const ids = await edgeIds(page);
  const p = await onEdge(page, ids[index]!);
  await page.mouse.click(p.x, p.y);
  return ids[index]!;
}

async function dragTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
}

async function centerOf(page: Page, selector: string) {
  const b = await page.locator(selector).boundingBox();
  if (!b) throw new Error(`${selector} not shown`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

test("dragging an edge's end onto an anchor attaches it there, as one undo step", async ({ page }) => {
  const before = await code(page);
  await selectEdge(page, 4); // rec → stop
  const end = await centerOf(page, '[data-testid="edge-end-to"]');
  const stop = await nodeBox(page, "stop");
  await dragTo(page, end, { x: stop.x + stop.width - 1, y: stop.y + stop.height / 2 });
  await expect(page.getByTestId("edge-drag")).toHaveCount(1);
  await expect(page.getByTestId("status")).toContainText("Release to attach");
  await page.screenshot({ path: "test-results/m2b-end-drag.png" });
  await page.mouse.up();
  const after = await code(page);
  expect(after).toBe(before.replace("\\draw[->] (rec)   -- (stop);", "\\draw[->] (rec)   -- (stop.east);"));
  await expect(page.getByTestId("status")).toContainText("Moved the end to stop.east.");
  await page.keyboard.press("Control+z");
  expect(await code(page)).toBe(before);
});

test("dropping an end on another node's middle reconnects it to that node's border", async ({ page }) => {
  const before = await code(page);
  await selectEdge(page, 1); // read → small
  const end = await centerOf(page, '[data-testid="edge-end-to"]');
  const base = await nodeBox(page, "base");
  await dragTo(page, end, { x: base.x + base.width * 0.35, y: base.y + base.height * 0.4 });
  await page.mouse.up();
  expect(await code(page)).toBe(before.replace("\\draw[->] (read)  -- (small);", "\\draw[->] (read)  -- (base);"));
  await expect(page.getByTestId("status")).toContainText("Reconnected the end to the border of base.");
  await expect(page.getByTestId("edge-title")).toHaveText("read → base");
});

test("dropping an end on empty canvas leaves the code alone", async ({ page }) => {
  const before = await code(page);
  await selectEdge(page, 1);
  const end = await centerOf(page, '[data-testid="edge-end-to"]');
  await dragTo(page, end, { x: end.x + 160, y: end.y + 10 });
  await page.mouse.up();
  expect(await code(page)).toBe(before);
  await expect(page.getByTestId("status")).toContainText("drop it on a node");
});

test("the context menu changes an end's anchor, and the menu key opens it too", async ({ page }) => {
  const before = await code(page);
  const id = await selectEdge(page, 4);
  const p = await onEdge(page, id);
  await page.mouse.click(p.x, p.y, { button: "right" });
  const menu = page.getByTestId("edge-menu");
  await expect(menu).toBeVisible();
  await page.getByTestId("menu-to-anchor").hover();
  await page.screenshot({ path: "test-results/m2b-edge-menu.png" });
  await page.getByTestId("menu-to-anchor").getByRole("button", { name: "north", exact: true }).click();
  await expect(menu).toHaveCount(0);
  expect(await code(page)).toBe(before.replace("\\draw[->] (rec)   -- (stop);", "\\draw[->] (rec)   -- (stop.north);"));
  // Shift+F10 with an edge selected opens the menu; Escape closes it.
  await page.getByTestId("canvas").focus();
  await page.keyboard.press("Shift+F10");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
});

test("dragging a node's connection handle to another node draws a new edge", async ({ page }) => {
  const before = await code(page);
  const base = await nodeBox(page, "base");
  await page.mouse.move(base.x + base.width / 2, base.y + base.height / 2);
  const handles = page.getByTestId("connect-handle");
  await expect(handles).toHaveCount(4);
  const south = await handles.nth(2).boundingBox();
  const rec = await nodeBox(page, "rec");
  await dragTo(page, { x: south!.x + south!.width / 2, y: south!.y + south!.height / 2 }, { x: rec.x + rec.width * 0.6, y: rec.y + rec.height * 0.45 });
  await page.screenshot({ path: "test-results/m2b-connect-drag.png" });
  await page.mouse.up();
  expect(await code(page)).toBe(before.replace("\\draw[->] (base)  |- (stop);", "\\draw[->] (base)  |- (stop);\n  \\draw[->] (base) -- (rec);"));
  await expect(page.getByTestId("edge-title")).toHaveText("base → rec");
  await page.keyboard.press("Control+z");
  expect(await code(page)).toBe(before);
});

test("a new edge dropped on an anchor keeps both anchors", async ({ page }) => {
  const before = await code(page);
  const read = await nodeBox(page, "read");
  await page.mouse.move(read.x + read.width / 2, read.y + read.height / 2);
  const east = await page.getByTestId("connect-handle").nth(1).boundingBox();
  const base = await nodeBox(page, "base");
  await dragTo(page, { x: east!.x + east!.width / 2, y: east!.y + east!.height / 2 }, { x: base.x + base.width / 2, y: base.y + 1 });
  await page.mouse.up();
  expect(await code(page)).toBe(before.replace("\\draw[->] (base)  |- (stop);", "\\draw[->] (base)  |- (stop);\n  \\draw[->] (read.east) -- (base.north);"));
});
