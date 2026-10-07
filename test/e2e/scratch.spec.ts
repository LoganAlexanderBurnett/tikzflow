// Milestone 2a, start to finish: build a small flowchart from an empty picture
// with the palette and the keyboard, restyle it, and check the code reads as
// if it was written by hand.
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

test("a flowchart built from an empty picture with the palette and the keyboard", async ({ page }) => {
  await page.goto("/");
  const doc = ["\\documentclass[tikz]{standalone}", "\\usepackage{tikz}", "\\begin{document}", "\\begin{tikzpicture}", "\\end{tikzpicture}", "\\end{document}", ""].join("\n");
  await setCode(page, doc);
  await expect(page.getByTestId("palette")).toBeVisible();

  // The first node comes from the palette, then Tab adds connected ones.
  await page.getByTestId("palette-terminal").click();
  await page.keyboard.type("Start");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Read input");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Valid?");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("label-editor")).toHaveCount(0);

  const built = await code(page);
  // Styles, libraries and names are what a person would have written.
  expect(built).toMatch(/\\usetikzlibrary\{[^}]*positioning/);
  expect(built).toMatch(/terminal\/\.style=\{draw, rounded rectangle/);
  expect(built).toMatch(/\\node\[terminal\] \(start\) at \(0,0\) \{Start\};/);
  expect(built).toMatch(/\\node\[terminal, below=of start\] \(readInput\) \{Read input\};/);
  expect(built).toMatch(/\\node\[terminal, below=of readInput\] \(valid\) \{Valid\?\};/);
  expect(built).toContain("\\draw[->] (start) -- (readInput);");
  expect(built).toContain("\\draw[->] (readInput) -- (valid);");
  await expect(page.locator("g.tf-node")).toHaveCount(3);
  await expect(page.getByTestId("summary-headline")).toHaveText("3 nodes and 2 edges editable");
  expect((built.match(/\\usetikzlibrary/g) ?? []).length).toBe(1);
});
