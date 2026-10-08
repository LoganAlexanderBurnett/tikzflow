// Which side of its edge a label sits on (D57): new labels are written with
// auto, "Flip side" turns one over, and a left/right/above/below that would
// sit on the line becomes auto when the label is dragged.
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

async function onEdge(page: Page, id: string, t = 0.5) {
  return page.locator(`path[data-edge="${id}"]`).evaluate((el, t) => {
    const path = el as SVGPathElement;
    const pt = path.getPointAtLength(path.getTotalLength() * t);
    const s = new DOMPoint(pt.x, pt.y).matrixTransform(path.getScreenCTM()!);
    return { x: s.x, y: s.y };
  }, t);
}

async function firstEdge(page: Page): Promise<string> {
  await expect(page.locator("path[data-edge]")).toHaveCount(1);
  return (await page.locator("path[data-edge]").first().getAttribute("data-edge"))!;
}

async function dragTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
}

/** The label's box and the edge's drawn path, on screen: does the line pass through the box? */
async function lineCutsLabel(page: Page): Promise<number> {
  return page.evaluate(() => {
    const label = document.querySelector('[data-testid="edge-label"]') as SVGGraphicsElement;
    const path = document.querySelector("path[data-edge]") as SVGPathElement;
    const box = label.getBoundingClientRect();
    const m = path.getScreenCTM()!;
    const len = path.getTotalLength();
    let inside = 0;
    for (let i = 0; i <= 400; i++) {
      const p = path.getPointAtLength((len * i) / 400);
      const s = new DOMPoint(p.x, p.y).matrixTransform(m);
      // Strictly inside, with a pixel of slack for the line's own width.
      if (s.x > box.left + 1.5 && s.x < box.right - 1.5 && s.y > box.top + 1.5 && s.y < box.bottom - 1.5) inside++;
    }
    return inside;
  });
}

const TWO = "\\begin{tikzpicture}\n\\node[draw] (a) {A};\n\\node[draw] (b) at (4,-2) {B};\n";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("summary-headline")).toHaveText("6 nodes and 6 edges editable");
});

test("Add label here on either piece of a |- edge writes auto, and the label sits beside the line", async ({ page }) => {
  for (const t of [0.2, 0.8]) {
    await setCode(page, `${TWO}\\draw[->] (a) |- (b);\n\\end{tikzpicture}\n`);
    const id = await firstEdge(page);
    await expect(async () => {
      const p = await onEdge(page, id, t);
      await page.mouse.click(p.x, p.y, { button: "right" });
      await expect(page.getByTestId("edge-menu")).toBeVisible({ timeout: 700 });
    }).toPass({ timeout: 6000 });
    await page.getByTestId("menu-add-label").click();
    await page.keyboard.type("go");
    await page.keyboard.press("Enter");
    expect(await code(page)).toMatch(/\\draw\[->\] \(a\) \|- node\[pos=0\.\d+, auto(, swap)?\] \{go\} \(b\);/);
    await expect(page.getByTestId("edge-label")).toHaveCount(1);
    expect(await lineCutsLabel(page), `label added at ${t}`).toBe(0);
  }
});

test("Flip side from the menu and the panel turns a label over, one undo step each", async ({ page }) => {
  const start = `${TWO}\\draw[->] (a) -- node[pos=0.3, auto] {x} (b);\n\\end{tikzpicture}\n`;
  await setCode(page, start);
  await firstEdge(page);
  await expect(page.getByTestId("edge-label")).toHaveCount(1);
  const before = (await page.getByTestId("edge-label").boundingBox())!;
  // Click the label to pick it, then flip it from its right-click menu.
  await page.getByTestId("edge-label").click({ button: "right" });
  await expect(page.getByTestId("menu-flip-label")).not.toHaveAttribute("aria-disabled", "true");
  await page.getByTestId("menu-flip-label").click();
  expect(await code(page)).toContain("node[pos=0.3, auto, swap] {x}");
  await expect(page.getByTestId("status")).toContainText("Flipped the label");
  const after = (await page.getByTestId("edge-label").boundingBox())!;
  // The label is now on the other side of the line.
  expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeGreaterThan(15);
  expect(await lineCutsLabel(page)).toBe(0);
  // The panel's button turns it back.
  await page.getByTestId("label-flip").click();
  expect(await code(page)).toBe(start);
  // And undo redoes the flip's inverse as one step.
  await page.keyboard.press("Control+z");
  expect(await code(page)).toContain("auto, swap");
});

test("Flip side says why when the edge has no label, and writes auto for a label on the line", async ({ page }) => {
  await setCode(page, `${TWO}\\draw[->] (a) -- (b);\n\\end{tikzpicture}\n`);
  const id = await firstEdge(page);
  await expect(async () => {
    const p = await onEdge(page, id, 0.5);
    await page.mouse.click(p.x, p.y, { button: "right" });
    await expect(page.getByTestId("edge-menu")).toBeVisible({ timeout: 700 });
  }).toPass({ timeout: 6000 });
  await expect(page.getByTestId("menu-flip-label")).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByTestId("menu-flip-label")).toHaveAttribute("title", "This edge has no labels.");
  await page.keyboard.press("Escape");
  await setCode(page, `${TWO}\\draw[->] (a) -- node[pos=0.3] {x} (b);\n\\end{tikzpicture}\n`);
  await firstEdge(page);
  // A label with no side key sits on the line: Flip side writes auto (D64), one undo step.
  const before = await code(page);
  expect(await lineCutsLabel(page)).toBeGreaterThan(0);
  await page.getByTestId("edge-label").click({ button: "right" });
  await expect(page.getByTestId("menu-flip-label")).not.toHaveAttribute("aria-disabled", "true");
  await page.getByTestId("menu-flip-label").click();
  expect(await code(page)).toBe(before.replace("node[pos=0.3] {x}", "node[pos=0.3, auto] {x}"));
  await expect(page.getByTestId("status")).toContainText("beside it now");
  expect(await lineCutsLabel(page)).toBe(0);
  await page.keyboard.press("Control+z");
  expect(await code(page)).toBe(before);
});

test("dragging a left label from the upright piece of |- onto the level piece turns it into auto", async ({ page }) => {
  await setCode(page, `${TWO}\\draw[->] (a) |- node[pos=0.2, left] {x} (b);\n\\end{tikzpicture}\n`);
  const id = await firstEdge(page);
  await expect(page.getByTestId("edge-label")).toHaveCount(1);
  expect(await lineCutsLabel(page)).toBe(0);
  const start = await onEdge(page, id, 0.2);
  const end = await onEdge(page, id, 0.8);
  const box = (await page.getByTestId("edge-label").boundingBox())!;
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await dragTo(page, from, { x: from.x + (end.x - start.x), y: from.y + (end.y - start.y) });
  await expect(page.getByTestId("status")).toContainText("left → auto");
  await page.mouse.up();
  expect(await code(page)).toMatch(/\\draw\[->\] \(a\) \|- node\[pos=0\.[78]\d?, auto(, swap)?\] \{x\} \(b\);/);
  await expect(page.getByTestId("status")).toContainText("Slid the label");
  expect(await lineCutsLabel(page)).toBe(0);
  // One undo puts the label and its key back.
  await page.keyboard.press("Control+z");
  expect(await code(page)).toContain("node[pos=0.2, left] {x}");
});

test("Make orthogonal turns a label the new line would cut through into auto, in the same undo step", async ({ page }) => {
  const start = "\\begin{tikzpicture}\n\\node[draw] (a) {A};\n\\node[draw] (b) at (4,-3) {B};\n\\draw[->] (a) -- node[pos=0.8, above] {x} (b);\n\\end{tikzpicture}\n";
  await setCode(page, start);
  const id = await firstEdge(page);
  await expect(async () => {
    const p = await onEdge(page, id, 0.5);
    await page.mouse.click(p.x, p.y, { button: "right" });
    await expect(page.getByTestId("edge-menu")).toBeVisible({ timeout: 700 });
  }).toPass({ timeout: 6000 });
  await page.getByTestId("menu-orthogonal").click();
  expect(await code(page)).toContain("\\draw[->] (a) -| node[pos=0.8, auto] {x} (b);");
  await expect(page.getByTestId("status")).toContainText('wrote the label "x" as auto instead of above');
  expect(await lineCutsLabel(page)).toBe(0);
  await page.keyboard.press("Control+z");
  expect(await code(page)).toBe(start);
});
