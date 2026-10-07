// Milestone 2a step 4: resizing nodes by dragging their handles.
import { expect, type Page, test } from "@playwright/test";

async function code(page: Page): Promise<string> {
  return page.evaluate(() => {
    const w = window as unknown as { tikzflow: { store: { editorView: () => { state: { doc: { toString(): string } } } } } };
    return w.tikzflow.store.editorView().state.doc.toString();
  });
}

const line = (text: string, part: string) => text.split("\n").find((l) => l.includes(part)) ?? "";

async function select(page: Page, id: string) {
  const box = await page.locator(`g[data-node="${id}"] path`).first().boundingBox();
  if (!box) throw new Error(`node ${id} not drawn`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  return box;
}

async function dragHandle(page: Page, handle: string, dx: number, dy: number) {
  const box = await page.locator(`[data-handle="${handle}"]`).boundingBox();
  if (!box) throw new Error(`no ${handle} handle`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("summary-headline")).toHaveText("6 nodes and 6 edges editable");
});

test("a selected node shows eight handles; nothing selected shows none", async ({ page }) => {
  await expect(page.getByTestId("resize-handle")).toHaveCount(0);
  await select(page, "rec");
  await expect(page.getByTestId("resize-handle")).toHaveCount(8);
  await page.keyboard.press("Escape");
  await page.locator(".tf-canvas").click({ position: { x: 20, y: 200 } });
  await expect(page.getByTestId("resize-handle")).toHaveCount(0);
});

test("dragging the east handle writes a round minimum width on that node, and undo takes it back", async ({ page }) => {
  const before = await code(page);
  await select(page, "rec");
  const w0 = (await page.locator('g[data-node="rec"] path').first().boundingBox())!.width;
  await dragHandle(page, "e", 70, 0);
  const after = await code(page);
  expect(line(after, "(rec)")).toMatch(/\\node\[process, below=of small, minimum width=\d+(\.\d)?(mm|cm)\] \(rec\)/);
  expect(after.split("\n").filter((l) => !l.includes("(rec)"))).toEqual(before.split("\n").filter((l) => !l.includes("(rec)")));
  const w1 = (await page.locator('g[data-node="rec"] path').first().boundingBox())!.width;
  expect(w1).toBeGreaterThan(w0 + 60);
  await expect(page.getByTestId("status")).toContainText("Wrote minimum width=");
  await page.keyboard.press("Control+z");
  expect(await code(page)).toBe(before);
});

test("dragging a corner changes both width and height, and a second drag updates the same items", async ({ page }) => {
  await select(page, "stop");
  await dragHandle(page, "se", 40, 30);
  const first = line(await code(page), "(stop)");
  expect(first).toMatch(/minimum width=.*minimum height=|minimum height=.*minimum width=/);
  await dragHandle(page, "se", 30, 10);
  const second = line(await code(page), "(stop)");
  expect(second.match(/minimum width/g)).toHaveLength(1);
  expect(second.match(/minimum height/g)).toHaveLength(1);
  expect(second).not.toBe(first);
});

test("with a style chosen, the drag changes the style and every node using it", async ({ page }) => {
  await select(page, "rec");
  await page.getByRole("radio", { name: "All process nodes (2)" }).check();
  await dragHandle(page, "e", 60, 0);
  const after = await code(page);
  expect(line(after, "process/.style")).toMatch(/process\/\.style\s*=\s*\{base, fill=blue!8, minimum width=\d+(\.\d)?(mm|cm)\}/);
  expect(line(after, "(rec)")).toContain("\\node[process, below=of small]");
  await expect(page.getByTestId("status")).toContainText("in the process style");
  // Both process nodes grew.
  const widths = await Promise.all(["base", "rec"].map(async (id) => (await page.locator(`g[data-node="${id}"] path`).first().boundingBox())!.width));
  expect(Math.abs(widths[0]! - widths[1]!)).toBeLessThan(2);
});

test("a drag that lines up with another node's width says so", async ({ page }) => {
  // "stop" starts at the same width as "start": make it wider, then drag back to match.
  await select(page, "stop");
  await dragHandle(page, "e", 80, 0);
  const wide = (await page.locator('g[data-node="stop"] path').first().boundingBox())!.width;
  await dragHandle(page, "e", -(wide - (await page.locator('g[data-node="start"] path').first().boundingBox())!.width) / 2 + 1, 0);
  await expect(page.getByTestId("status")).toContainText("Same width as start");
});
