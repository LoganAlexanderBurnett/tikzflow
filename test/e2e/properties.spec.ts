// Milestone 2a step 3: the properties panel, with node-or-style scope, the
// colour picker and multi-select.
import { expect, type Page, test } from "./base.ts";

async function code(page: Page): Promise<string> {
  return page.evaluate(() => {
    const w = window as unknown as { tikzflow: { store: { editorView: () => { state: { doc: { toString(): string } } } } } };
    return w.tikzflow.store.editorView().state.doc.toString();
  });
}

const line = (text: string, part: string) => text.split("\n").find((l) => l.includes(part)) ?? "";

async function clickNode(page: Page, id: string, modifiers: Array<"Shift"> = []) {
  const box = await page.locator(`g[data-node="${id}"] path`).first().boundingBox();
  if (!box) throw new Error(`node ${id} not drawn`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.down();
  await page.mouse.up();
  for (const m of modifiers) await page.keyboard.up(m);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("summary-headline")).toHaveText("6 nodes and 6 edges editable");
});

test("sets a node's fill from the picker, and undo restores it", async ({ page }) => {
  const before = await code(page);
  await clickNode(page, "rec");
  const panel = page.getByTestId("properties");
  await expect(panel.getByRole("radio", { name: "This node" })).toBeChecked();
  await expect(panel.getByRole("radio", { name: "All process nodes (2)" })).not.toBeChecked();
  await expect(page.getByTestId("color-fill")).toContainText("blue!8 (from process)");
  await page.getByTestId("color-fill").click();
  await page.getByTestId("color-picker").getByRole("button", { name: "green!20", exact: true }).click();
  expect(line(await code(page), "(rec)")).toContain("\\node[process, below=of small, fill=green!20] (rec)");
  await expect(page.getByTestId("color-fill")).toContainText("green!20");
  await expect(page.getByTestId("color-picker")).toHaveCount(0);
  await page.keyboard.press("Control+z");
  expect(await code(page)).toBe(before);
});

test("the style scope edits the style for every node using it", async ({ page }) => {
  await clickNode(page, "rec");
  await page.getByRole("radio", { name: "All process nodes (2)" }).check();
  await page.getByRole("button", { name: "B", exact: true }).click();
  const after = await code(page);
  expect(line(after, "process/.style")).toBe("  process/.style  = {base, fill=blue!8, font=\\bfseries},");
  expect(line(after, "(rec)")).toBe("  \\node[process, below=of small] (rec)   {Return\\\\ $n \\cdot f(n-1)$};");
  await expect(page.getByTestId("status")).toContainText("the process style");
  // Selecting another node starts again at "This node".
  await clickNode(page, "base");
  await expect(page.getByRole("radio", { name: "This node" })).toBeChecked();
  await expect(page.getByRole("button", { name: "B", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("multi-select changes every selected node in one step", async ({ page }) => {
  const before = await code(page);
  await clickNode(page, "read");
  await clickNode(page, "stop", ["Shift"]);
  await expect(page.locator(".tf-inspector .tf-title")).toHaveText("2 nodes");
  // read is io, stop is terminal: no shared style, so only "These 2 nodes".
  await expect(page.getByRole("radio")).toHaveCount(1);
  await page.getByTestId("color-draw").click();
  await page.getByTestId("color-picker").getByRole("button", { name: "blue", exact: true }).click();
  const after = await code(page);
  expect(line(after, "(read)")).toContain("\\node[io, below=of start, draw=blue]");
  expect(line(after, "(stop)")).toContain("\\node[terminal, below=of rec, draw=blue]");
  await page.keyboard.press("Control+z");
  expect(await code(page)).toBe(before);
});

test("a custom colour can be named and added as \\definecolor", async ({ page }) => {
  await clickNode(page, "base");
  await page.getByTestId("color-fill").click();
  const picker = page.getByTestId("color-picker");
  await picker.getByLabel("Custom colour").fill("#1f77b4");
  await expect(picker.getByRole("button", { name: "Add named colour" })).toBeDisabled();
  await picker.getByLabel("Colour name").fill("red");
  await expect(picker.getByText('"red" is already a colour.')).toBeVisible();
  await picker.getByLabel("Colour name").fill("Accent");
  await picker.getByRole("button", { name: "Add named colour" }).click();
  const after = await code(page);
  expect(after).toContain("\\usetikzlibrary{positioning, shapes.geometric, arrows.meta}\n\\definecolor{Accent}{HTML}{1F77B4}\n");
  expect(line(after, "(base)")).toContain("\\node[process, right=of small, fill=Accent] (base)");
  // It's offered first from now on.
  await page.getByTestId("color-draw").click();
  await expect(page.getByTestId("color-picker").getByRole("button", { name: "Accent" })).toBeVisible();
});

test("justify sets a text width on a node, and explains why it's off for a style", async ({ page }) => {
  await clickNode(page, "rec");
  await page.getByRole("button", { name: "Justify" }).click();
  expect(line(await code(page), "(rec)")).toMatch(/\\node\[process, below=of small, text width=\d+mm, align=justify\] \(rec\)/);
  await expect(page.getByTestId("status")).toContainText("Justify needs a text width, so text width=");
  await page.getByRole("radio", { name: "All process nodes (2)" }).check();
  const justify = page.getByRole("button", { name: "Justify" });
  await expect(justify).toBeDisabled();
  await expect(justify).toHaveAttribute("title", "Justify needs a text width, and the process style doesn't set one.");
});

test("the properties panel collapses, and stays collapsed after a reload", async ({ page }) => {
  await expect(page.getByTestId("inspector")).toHaveCSS("width", "280px");
  await page.getByTestId("inspector-toggle").click();
  await expect(page.getByTestId("inspector")).toHaveCSS("width", "30px");
  await expect(page.getByTestId("properties")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("summary-headline")).toHaveText("6 nodes and 6 edges editable");
  await expect(page.getByTestId("inspector")).toHaveCSS("width", "30px");
  await page.getByTestId("inspector-toggle").click();
  await expect(page.getByTestId("inspector")).toHaveCSS("width", "280px");
});
