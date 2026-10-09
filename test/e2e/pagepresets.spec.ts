// Typed widths and saved presets in the Page panel, and a class the preview doesn't have (D73).
import { expect, type Page, test } from "./base.ts";

type Store = { replaceDocument: (t: string, n: string | null, e: string) => void; baseLayout: { value: { nodes: Array<{ id: string; shape: { hw: number } }> } | null } };

async function setCode(page: Page, text: string) {
  await page.evaluate((t) => (window as unknown as { tikzflow: { store: Store } }).tikzflow.store.replaceDocument(t, null, "utf-8"), text);
}
const nodeWidth = (page: Page, id: string) =>
  page.evaluate((i) => {
    const l = (window as unknown as { tikzflow: { store: Store } }).tikzflow.store.baseLayout.value!;
    return l.nodes.find((n) => n.id === i)!.shape.hw * 2;
  }, id);

const FIGURE = ["\\begin{tikzpicture}", "\\node[draw, text width=0.5\\columnwidth] (a) at (0,0) {A wide box};", "\\end{tikzpicture}", ""].join("\n");

test("typed widths change the quick preview's \\columnwidth and the guide, and can be saved under a name", async ({ page }) => {
  await page.goto("/");
  await setCode(page, FIGURE);
  expect(await nodeWidth(page, "a")).toBeCloseTo(0.5 * 345 + 6.67, 0);

  await page.getByTestId("page-button").click();
  await page.getByTestId("page-preamble").fill("\\documentclass[11pt]{ans}\n\\newcommand{\\state}[1]{\\mathbf{#1}}\n");
  await expect(page.getByTestId("page-notes")).toContainText("ans class's page isn't known");
  await page.getByTestId("typed-text").fill("5.2in");
  await page.getByTestId("typed-column").fill("250pt");
  await expect(page.getByTestId("page-widths")).toContainText("250 pt");
  // The quick preview's \columnwidth is the typed one.
  await expect.poll(() => nodeWidth(page, "a")).toBeCloseTo(0.5 * 250 + 6.67, 0);

  // A bad length is said to be bad and ignored.
  await page.getByTestId("typed-column").fill("wide");
  await expect(page.getByTestId("page-typed")).toContainText("isn't a length");
  await page.getByTestId("typed-column").fill("250pt");

  await page.getByTestId("preset-name").fill("ANS");
  await page.getByTestId("preset-save-button").click();
  await expect(page.getByTestId("preset-select")).toContainText("ANS: text 5.2in, column 250pt");

  // Cleared, then chosen again from the list; and it is still there after a reload.
  await page.getByTestId("typed-text").fill("");
  await page.getByTestId("typed-column").fill("");
  await expect.poll(() => nodeWidth(page, "a")).toBeCloseTo(0.5 * 345 + 6.67, 0);
  await page.reload();
  await setCode(page, FIGURE);
  await page.getByTestId("page-button").click();
  await page.getByTestId("preset-select").selectOption("ANS");
  await expect(page.getByTestId("typed-column")).toHaveValue("250pt");
  await expect.poll(() => nodeWidth(page, "a")).toBeCloseTo(0.5 * 250 + 6.67, 0);

  await page.getByTestId("preset-delete").click();
  await expect(page.getByTestId("preset-select")).toHaveCount(0);
});

test("a known journal class gives its widths with no typing", async ({ page }) => {
  await page.goto("/");
  await setCode(page, FIGURE);
  await page.getByTestId("page-button").click();
  await page.getByTestId("page-preamble").fill("\\documentclass[5p]{elsarticle}\n");
  await expect(page.getByTestId("page-widths")).toContainText("252 pt");
  await expect(page.getByTestId("page-widths")).toContainText("522 pt");
  await expect.poll(() => nodeWidth(page, "a")).toBeCloseTo(0.5 * 252 + 6.67, 0);
});
