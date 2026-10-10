// Milestone 4 step 2: dragging a node a chain places writes the chain out (D77 item 4).
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
  "\\usetikzlibrary{positioning,chains}",
  "\\begin{document}",
  "\\begin{tikzpicture}[start chain=going below, node distance=8mm]",
  "\\node[draw, on chain] (a) {Start};",
  "\\node[draw, on chain, join] {Check input};",
  "\\node[draw, on chain, join] (c) {Stop};",
  "\\end{tikzpicture}",
  "\\end{document}",
  "",
].join("\n");

test("dragging a chain node writes the chain's positions out and moves it, as one undo step", async ({ page }) => {
  await page.goto("/");
  await setCode(page, DOC);
  await expect(page.getByTestId("summary-headline")).toContainText("3 nodes");
  // Select it first: the panel that opens resizes the canvas.
  const c0 = await center(page, "c");
  await page.mouse.click(c0.x, c0.y);
  await expect(page.getByTestId("status")).toContainText("set by a chain");
  // Wait for the canvas to settle at its new size.
  let from = await center(page, "c");
  await expect
    .poll(async () => {
      const now = await center(page, "c");
      const still = Math.hypot(now.x - from.x, now.y - from.y) < 0.5;
      from = now;
      return still;
    })
    .toBe(true);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + 10, { steps: 5 });
  await page.mouse.move(from.x + 90, from.y + 20, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId("status")).toContainText("Wrote out the chain's positions (2 nodes; named checkInput");
  const after = await code(page);
  expect(after).toContain("\\node[draw, on chain, join, below=of a] (checkInput) {Check input};");
  expect(after).toMatch(/\\node\[draw, on chain, join, [^\]]*of checkInput[^\]]*\] \(c\) \{Stop\};/);
  // Every node of the chain can be dragged now.
  await expect(page.getByTestId("summary-headline")).toContainText("3 nodes");
  await page.keyboard.press("Control+z");
  expect(await code(page)).toBe(DOC);
});
