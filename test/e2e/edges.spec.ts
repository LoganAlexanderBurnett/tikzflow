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
  // The view may still be fitting a document just set: click again until the edge is selected.
  await expect(async () => {
    const p = await onEdge(page, ids[index]!);
    await page.mouse.click(p.x, p.y);
    await expect(page.getByTestId("edge-selection")).toHaveCount(1, { timeout: 500 });
  }).toPass({ timeout: 5000 });
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

// ---------------------------------------------------------------- step 4: vertices

test("dragging a ghost handle adds a corner, and double-clicking the corner removes it", async ({ page }) => {
  const before = await code(page);
  await selectEdge(page, 4); // rec → stop
  const ghost = await centerOf(page, '[data-testid="ghost-handle"]');
  await dragTo(page, ghost, { x: ghost.x + 60, y: ghost.y });
  await expect(page.getByTestId("status")).toContainText("Release to add the corner");
  await page.screenshot({ path: "test-results/m2b-ghost-drag.png" });
  await page.mouse.up();
  const after = await code(page);
  expect(after).toMatch(/\\draw\[->\] \(rec\)   -- (\+\+)?\([^)]*\) -- \(stop\);/);
  await expect(page.getByTestId("vertex-handle")).toHaveCount(1);
  await expect(page.getByTestId("edge-mode")).toContainText("Straight pieces through points");
  await page.screenshot({ path: "test-results/m2b-corner-added.png" });
  // Double-click the corner: it goes.
  await page.getByTestId("vertex-handle").dblclick();
  expect(await code(page)).toBe(before);
  await expect(page.getByTestId("status")).toContainText("Removed the corner.");
  await page.keyboard.press("Control+z");
  expect(await code(page)).toBe(after);
});

test("dragging a corner moves it, snapping level with the node before it", async ({ page }) => {
  await setCode(page, "\\begin{tikzpicture}\n\\node[draw] (a) {A};\n\\node[draw] (b) at (4,-2) {B};\n\\draw[->] (a) -- ++(2,0.3) -- (b);\n\\end{tikzpicture}\n");
  await expect(page.locator("path[data-edge]")).toHaveCount(1);
  await selectEdge(page, 0);
  const corner = await centerOf(page, '[data-testid="vertex-handle"]');
  // Near a's centre line and b's: it snaps to both, so it becomes (b |- a).
  const a = await nodeBox(page, "a");
  const b = await nodeBox(page, "b");
  await dragTo(page, corner, { x: b.x + b.width / 2 + 2, y: a.y + a.height / 2 + 2 });
  await page.mouse.up();
  expect(await code(page)).toContain("\\draw[->] (a) -- (b |- a) -- (b);");
  await expect(page.getByTestId("status")).toContainText("Moved the corner: (b |- a).");
});

test("Straighten from the menu turns an orthogonal edge into a plain --", async ({ page }) => {
  const before = await code(page);
  const id = await selectEdge(page, 5); // base |- stop
  const p = await onEdge(page, id, 0.3);
  await page.mouse.click(p.x, p.y, { button: "right" });
  await expect(page.getByTestId("menu-add-vertex")).toHaveAttribute("aria-disabled", "true");
  await page.getByTestId("menu-straighten").click();
  expect(await code(page)).toBe(before.replace("\\draw[->] (base)  |- (stop);", "\\draw[->] (base)  -- (stop);"));
  await expect(page.getByTestId("edge-mode")).toContainText("Straight");
});

test("Add vertex here and Remove vertex from the menu", async ({ page }) => {
  const before = await code(page);
  const id = await selectEdge(page, 4);
  const p = await onEdge(page, id, 0.5);
  await page.mouse.click(p.x, p.y, { button: "right" });
  await page.getByTestId("menu-add-vertex").click();
  expect(await code(page)).toMatch(/\\draw\[->\] \(rec\)   -- (\+\+)?\([^)]*\) -- \(stop\);/);
  await page.getByTestId("vertex-handle").click({ button: "right" });
  await page.getByTestId("menu-remove-vertex").click();
  expect(await code(page)).toBe(before);
});

test("a shared end points to Split into separate edges, which splits the \\draw", async ({ page }) => {
  await setCode(page, "\\begin{tikzpicture}\n\\node[draw] (a) {A};\n\\node[draw] (b) at (3,0) {B};\n\\node[draw] (c) at (3,-2) {C};\n\\draw[->] (a) -- (b) -- (c);\n\\end{tikzpicture}\n");
  await expect(page.locator("path[data-edge]")).toHaveCount(2);
  const id = await selectEdge(page, 0);
  await page.getByTestId("edge-end-to").click();
  await expect(page.getByTestId("status")).toContainText("Split into separate edges");
  const p = await onEdge(page, id, 0.5);
  await page.mouse.click(p.x, p.y, { button: "right" });
  await page.getByTestId("menu-split").click();
  expect(await code(page)).toContain("\\draw[-] (a) -- (b);\n\\draw[->] (b) -- (c);");
  await expect(page.getByTestId("edge-title")).toHaveText("a → b");
  // Now the end moves on its own.
  const end = await centerOf(page, '[data-testid="edge-end-to"]');
  const c = await nodeBox(page, "c");
  await dragTo(page, end, { x: c.x + c.width * 0.4, y: c.y + c.height * 0.5 });
  await page.mouse.up();
  expect(await code(page)).toContain("\\draw[-] (a) -- (c);\n\\draw[->] (b) -- (c);");
});

// ---------------------------------------------------------------- step 5: orthogonal mode

const TWO = "\\begin{tikzpicture}\n\\node[draw] (a) {A};\n\\node[draw] (b) at (4,-2) {B};\n";

test("Make orthogonal writes a single corner", async ({ page }) => {
  await setCode(page, `${TWO}\\draw[->] (a) -- node[above] {x} (b);\n\\end{tikzpicture}\n`);
  await expect(page.locator("path[data-edge]")).toHaveCount(1);
  const id = await selectEdge(page, 0);
  const p = await onEdge(page, id, 0.5);
  await page.mouse.click(p.x, p.y, { button: "right" });
  await page.getByTestId("menu-orthogonal").click();
  expect(await code(page)).toContain("\\draw[->] (a) -| node[above] {x} (b);");
  await expect(page.getByTestId("edge-mode")).toContainText("Orthogonal");
  await expect(page.getByTestId("segment-handle")).toHaveCount(2);
  await expect(page.getByTestId("status")).toContainText("Made the edge orthogonal: \\draw[->] (a) -| node[above] {x} (b);");
});

test("sliding the middle segment of an orthogonal edge moves both its corners", async ({ page }) => {
  await setCode(page, `${TWO}\\draw[->] (a) -- ++(0,-1) -| (b);\n\\end{tikzpicture}\n`);
  await expect(page.locator("path[data-edge]")).toHaveCount(1);
  await selectEdge(page, 0);
  await expect(page.getByTestId("segment-handle")).toHaveCount(3);
  const mid = await centerOf(page, '[data-testid="segment-handle"] >> nth=1');
  await page.keyboard.down("Alt");
  await dragTo(page, mid, { x: mid.x, y: mid.y + 25 });
  await page.screenshot({ path: "test-results/m2b-slide.png" });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  const after = await code(page);
  expect(after).toMatch(/\\draw\[->\] \(a\) -- \+\+\(0,-1\.\d\) -\| \(b\);/);
  await expect(page.getByTestId("status")).toContainText("Slid the segment");
  await page.keyboard.press("Control+z");
  expect(await code(page)).toContain("\\draw[->] (a) -- ++(0,-1) -| (b);");
});

test("sliding the sample's |- edge along stop's side moves where it meets stop", async ({ page }) => {
  const before = await code(page);
  await selectEdge(page, 5); // base |- stop
  const handles = page.getByTestId("segment-handle");
  await expect(handles).toHaveCount(2);
  const h = await centerOf(page, '[data-testid="segment-handle"] >> nth=1');
  await page.keyboard.down("Alt");
  await dragTo(page, h, { x: h.x, y: h.y - 9 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  const after = await code(page);
  expect(after).toMatch(/\\draw\[->\] \(base\)  \|- \(\[yshift=\dmm\]stop\.east\);/);
  expect(after.replace(/\(\[yshift=\dmm\]stop\.east\)/, "(stop)")).toBe(before);
  await page.screenshot({ path: "test-results/m2b-slide-end.png" });
});

// ---------------------------------------------------------------- step 6: curved mode

test("Make curved writes a plain bend left, and dragging a control point changes the bend", async ({ page }) => {
  const before = await code(page);
  const id = await selectEdge(page, 4); // rec → stop
  const p = await onEdge(page, id, 0.5);
  await page.mouse.click(p.x, p.y, { button: "right" });
  await page.getByTestId("menu-curved").click();
  const curved = await code(page);
  expect(curved).toBe(before.replace("\\draw[->] (rec)   -- (stop);", "\\draw[->] (rec)   to[bend left] (stop);"));
  await expect(page.getByTestId("edge-mode")).toContainText("Curved");
  await expect(page.getByTestId("control-handle")).toHaveCount(2);
  const c1 = await centerOf(page, '[data-testid="control-handle"] >> nth=0');
  await dragTo(page, c1, { x: c1.x + 30, y: c1.y + 6 });
  await page.screenshot({ path: "test-results/m2b-curve-drag.png" });
  await page.mouse.up();
  const after = await code(page);
  expect(after).toMatch(/\\draw\[->\] \(rec\)   to\[bend left=\d+(, looseness=[\d.]+)?\] \(stop\);/);
  await expect(page.getByTestId("status")).toContainText("Reshaped the curve");
  await page.keyboard.press("Control+z");
  expect(await code(page)).toBe(curved);
  // Straighten goes back to the start.
  const q = await onEdge(page, id, 0.5);
  await page.mouse.click(q.x, q.y, { button: "right" });
  await page.getByTestId("menu-straighten").click();
  expect(await code(page)).toBe(before);
});

test("Alt-dragging a control point of a bend writes out and in", async ({ page }) => {
  await setCode(page, `${TWO}\\draw[->] (a) to[bend left] (b);\n\\end{tikzpicture}\n`);
  await expect(page.locator("path[data-edge]")).toHaveCount(1);
  await selectEdge(page, 0);
  const c2 = await centerOf(page, '[data-testid="control-handle"] >> nth=1');
  await page.keyboard.down("Alt");
  await dragTo(page, c2, { x: c2.x + 20, y: c2.y - 30 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  expect(await code(page)).toMatch(/\\draw\[->\] \(a\) to\[out=-?\d+, in=-?\d+(, (out |in )?looseness=[\d.]+)*\] \(b\);/);
});
