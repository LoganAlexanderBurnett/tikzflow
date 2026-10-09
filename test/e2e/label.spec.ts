// Milestone 2a step 5: editing a node's label in place.
import { expect, type Page, test } from "./base.ts";

async function code(page: Page): Promise<string> {
  return page.evaluate(() => {
    const w = window as unknown as { tikzflow: { store: { editorView: () => { state: { doc: { toString(): string } } } } } };
    return w.tikzflow.store.editorView().state.doc.toString();
  });
}

const line = (text: string, part: string) => text.split("\n").find((l) => l.includes(part)) ?? "";

async function center(page: Page, id: string) {
  const box = await page.locator(`g[data-node="${id}"] path`).first().boundingBox();
  if (!box) throw new Error(`node ${id} not drawn`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("summary-headline")).toHaveText("6 nodes and 6 edges editable");
});

test("double-click opens the label as TeX, Enter applies it, and undo takes it back", async ({ page }) => {
  const before = await code(page);
  const c = await center(page, "rec");
  await page.mouse.dblclick(c.x, c.y);
  const box = page.getByRole("textbox", { name: "Node label, as TeX" });
  await expect(box).toBeVisible();
  await expect(box).toHaveValue("Return\\\\ $n \\cdot f(n-1)$");
  await expect(box).toBeFocused();
  await page.keyboard.type("Return\\\\ $(n-1)! \\cdot n$");
  await page.keyboard.press("Enter");
  await expect(box).toHaveCount(0);
  const after = await code(page);
  expect(line(after, "(rec)")).toContain("{Return\\\\ $(n-1)! \\cdot n$};");
  expect(after.split("\n").filter((l) => !l.includes("(rec)"))).toEqual(before.split("\n").filter((l) => !l.includes("(rec)")));
  await expect(page.getByTestId("status")).toContainText("Changed the label of rec.");
  await page.keyboard.press("Control+z");
  expect(await code(page)).toBe(before);
});

test("Escape cancels, and nothing is written", async ({ page }) => {
  const before = await code(page);
  const c = await center(page, "start");
  await page.mouse.dblclick(c.x, c.y);
  await page.keyboard.type("Something else");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("label-editor")).toHaveCount(0);
  expect(await code(page)).toBe(before);
});

test("text that would break the code is refused, and the reason is shown", async ({ page }) => {
  const before = await code(page);
  const c = await center(page, "start");
  await page.mouse.dblclick(c.x, c.y);
  await page.keyboard.type("100% sure");
  await expect(page.getByTestId("label-editor")).toContainText("starts a comment");
  await page.keyboard.press("Enter");
  // Still editing, nothing written.
  await expect(page.getByTestId("label-editor")).toBeVisible();
  expect(await code(page)).toBe(before);
  await page.keyboard.press("Control+a");
  await page.keyboard.type("100\\% sure");
  await expect(page.getByTestId("label-editor")).not.toContainText("starts a comment");
  await page.keyboard.press("Enter");
  expect(line(await code(page), "(start)")).toContain("{100\\% sure};");
});

test("clicking elsewhere applies the label, and F2 starts editing the selected node", async ({ page }) => {
  const c = await center(page, "stop");
  await page.mouse.click(c.x, c.y);
  await page.locator(".tf-canvas").focus();
  await page.keyboard.press("F2");
  await expect(page.getByTestId("label-editor")).toBeVisible();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("Finish");
  await page.locator(".tf-canvas").click({ position: { x: 20, y: 200 } });
  await expect(page.getByTestId("label-editor")).toHaveCount(0);
  expect(line(await code(page), "(stop)")).toContain("{Finish};");
  // The node on the canvas shows the new label.
  await expect(page.locator(".tf-label", { hasText: "Finish" })).toBeVisible();
});

test("Shift+Enter adds a line to the label, and a long label makes the node grow", async ({ page }) => {
  const c = await center(page, "read");
  const w0 = (await page.locator('g[data-node="read"] path').first().boundingBox())!.width;
  await page.mouse.dblclick(c.x, c.y);
  await page.keyboard.press("Control+a");
  await page.keyboard.type("Read the whole input file");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("and check it");
  await page.keyboard.press("Enter");
  expect(await code(page)).toContain("{Read the whole input file\nand check it};");
  const w1 = (await page.locator('g[data-node="read"] path').first().boundingBox())!.width;
  expect(w1).toBeGreaterThan(w0);
});
