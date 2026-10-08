// Milestone 2b, start to finish: a flowchart with a decision built from an empty
// picture, its branches labelled, one edge restyled and its label slid
// from the edge panel, and a node deleted, with the code reading as if it was
// written by hand at every step.
import { expect, type Page, test } from "@playwright/test";

type Store = { editorView: () => { dispatch(s: unknown): void; state: { doc: { length: number; toString(): string } } } };

async function code(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as { tikzflow: { store: Store } }).tikzflow.store.editorView().state.doc.toString());
}

async function setCode(page: Page, text: string) {
  await page.evaluate((t) => {
    const v = (window as unknown as { tikzflow: { store: Store } }).tikzflow.store.editorView();
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: t } });
  }, text);
}

async function onEdge(page: Page, index: number, t = 0.5) {
  const el = page.locator("path[data-edge]").nth(index);
  return el.evaluate((node, t) => {
    const path = node as SVGPathElement;
    const pt = path.getPointAtLength(path.getTotalLength() * t);
    const s = new DOMPoint(pt.x, pt.y).matrixTransform(path.getScreenCTM()!);
    return { x: s.x, y: s.y };
  }, t);
}

test("a decision with labelled branches, an edge restyled and its label slid, and a node deleted", async ({ page }) => {
  await page.goto("/");
  const doc = ["\\documentclass[tikz]{standalone}", "\\usepackage{tikz}", "\\begin{document}", "\\begin{tikzpicture}", "\\end{tikzpicture}", "\\end{document}", ""].join("\n");
  await setCode(page, doc);

  // Start, a step, a decision: each connected to the one before.
  await page.getByTestId("palette-terminal").click();
  await page.keyboard.type("Start");
  await page.keyboard.press("Enter");
  await page.getByTestId("palette-process").click();
  await page.keyboard.type("Check input");
  await page.keyboard.press("Enter");
  await page.getByTestId("palette-decision").click();
  await page.keyboard.type("Valid?");
  await page.keyboard.press("Enter");
  // Two branches out of the decision: Yes, then No.
  await page.keyboard.press("Tab");
  await page.keyboard.type("Save");
  await page.keyboard.press("Enter");
  await page.locator("[data-node='valid']").first().click();
  await page.keyboard.press("Tab");
  await page.keyboard.type("Report error");
  await page.keyboard.press("Enter");

  let built = await code(page);
  expect(built).toMatch(/\\draw\[->\] \(valid\) -- node\[near start, auto\] \{Yes\} \(save\);/);
  expect(built).toMatch(/\\draw\[->\] \(valid\) -- node\[near start, auto\] \{No\} \(reportError\);/);
  await expect(page.getByTestId("summary-headline")).toHaveText("5 nodes and 4 edges editable");
  await page.screenshot({ path: "test-results/m2b-flowchart-built.png" });

  // The No edge: select it and restyle it in the panel.
  const noEdge = (await page.locator("path[data-edge]").count()) - 1;
  const p = await onEdge(page, noEdge, 0.6);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId("edge-title")).toHaveText("valid → reportError");
  await page.getByTestId("edge-dash-dashed").click();
  await page.getByTestId("edge-width").selectOption("thick");
  built = await code(page);
  expect(built).toMatch(/\\draw\[->, dashed, thick\] \(valid\) -- node\[near start, auto\] \{No\} \(reportError\);/);

  // Slide its label.
  const label = page.getByTestId("edge-label").last();
  const box = (await label.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 25, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  expect(await code(page)).toMatch(/node\[(near start|pos=0\.\d+), auto\] \{No\}|node\[auto, pos=0\.\d+\] \{No\}/);

  // Delete the error node: its edge goes with it, and nothing else moves.
  const before = await code(page);
  await page.locator("[data-node='reportError']").first().click();
  await page.keyboard.press("Delete");
  const after = await code(page);
  expect(after).not.toContain("reportError");
  expect(after).toContain("\\draw[->] (valid) -- node[near start, auto] {Yes} (save);");
  await expect(page.getByTestId("summary-headline")).toHaveText("4 nodes and 3 edges editable");
  await page.keyboard.press("Control+z");
  expect(await code(page)).toBe(before);
  expect(before).toBeTruthy();
});
