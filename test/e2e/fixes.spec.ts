// Milestone 2a step 2: errors, undefined references, locked-node fixes,
// coordinate markers and the undrawable-option marker, in the browser.
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

const corpus = (name: string) => join(import.meta.dirname, "..", "..", "corpus", name);

async function code(page: Page): Promise<string> {
  return page.evaluate(() => {
    const w = window as unknown as { tikzflow: { store: { editorView: () => { state: { doc: { toString(): string } } } } } };
    return w.tikzflow.store.editorView().state.doc.toString();
  });
}

async function openHybrid(page: Page) {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(corpus("self-hybrid-surrogate.tex"));
  await expect(page.getByTestId("summary-headline")).toHaveText("33 nodes of 34 and 10 edges editable; 2 blocks kept as-is");
}

test("the syntax-error count jumps to each error in turn", async ({ page }) => {
  await openHybrid(page);
  const errors = page.getByTestId("error-count");
  await expect(errors).toHaveText("2 syntax errors");
  await errors.click();
  await expect(page.getByTestId("status")).toContainText("Syntax error 1 of 2, line 91");
  await expect(page.locator(".cm-activeLine")).toContainText("Spatial State Decoder");
  await errors.click();
  await expect(page.getByTestId("status")).toContainText("Syntax error 2 of 2, line 256");
  await errors.click();
  await expect(page.getByTestId("status")).toContainText("Syntax error 1 of 2");
});

test("undefined references are listed, including those in paths", async ({ page }) => {
  await openHybrid(page);
  await page.getByRole("button", { name: "4 undefined names" }).click();
  const list = page.getByTestId("undefined-list");
  await expect(list.locator("li")).toHaveCount(4);
  for (const name of ["model", "prevkinleft", "pkin", "outkin"]) await expect(list.getByRole("button", { name, exact: true })).toBeVisible();
  await list.getByRole("button", { name: "outkin", exact: true }).click();
  await expect(page.locator(".cm-activeLine")).toContainText("(outkin.west)");
});

test("a locked node explains itself and can be pinned or attached", async ({ page }) => {
  await openHybrid(page);
  await page.getByRole("button", { name: "Details" }).click();
  await page.getByRole("button", { name: "#2", exact: true }).click();
  const card = page.getByTestId("lock-card");
  await expect(card).toContainText('"model" doesn\'t exist');
  await expect(card).toContainText("LaTeX would stop here too");

  const before = await code(page);
  await card.getByRole("button", { name: "Pin at current position" }).click();
  await expect(page.getByTestId("summary-headline")).toHaveText("34 nodes and 10 edges editable; 2 blocks kept as-is");
  expect(await code(page)).toContain("\\node[lab, anchor=north west] at (0,0)");
  await expect(page.getByTestId("lock-card")).toHaveCount(0);

  await page.keyboard.press("Control+z");
  expect(await code(page)).toBe(before);
  await page.getByRole("button", { name: "#2", exact: true }).click();
  await card.getByRole("combobox").selectOption("v1");
  await card.getByRole("button", { name: "Attach to" }).click();
  expect(await code(page)).toContain("at ([xshift=2mm,yshift=-1mm]v1.north west)");
  await expect(page.getByTestId("summary-headline")).toHaveText("34 nodes and 10 edges editable; 2 blocks kept as-is");
});

test("coordinates show their name on hover, and unused ones look different", async ({ page }) => {
  await openHybrid(page);
  const v1 = page.locator('[data-testid="coordinate"][data-node="v1"]');
  const v4 = page.locator('[data-testid="coordinate"][data-node="v4"]');
  await expect(v1).toHaveClass(/unused/);
  await expect(v4).not.toHaveClass(/unused/);
  await expect(v4.locator(".name")).toBeHidden();
  await v4.locator(".hit").hover({ force: true });
  await expect(v4.locator(".name")).toBeVisible();
  await expect(v4.locator(".name")).toHaveText("v4");
  await expect(v1.locator(".name")).toHaveText("v1 (unused)");
});

test("nodes with options the preview can't draw get a marker", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("undrawn-marker")).toHaveCount(0);
  await page.locator(".cm-line", { hasText: "{Stop}" }).first().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("  \\node[process, double, right=of stop] (extra) {Extra};");
  const marker = page.getByTestId("undrawn-marker");
  await expect(marker).toHaveCount(1);
  await expect(marker.locator("title")).toHaveText(/The preview doesn't draw: double\./);
});
