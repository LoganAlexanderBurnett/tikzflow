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
