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
  // The west edge is held, so the node gets a shift to stay put; the relation stays as written.
  expect(line(after, "(rec)")).toMatch(/\\node\[process, below=of small, xshift=\d+mm, minimum width=\d+(\.\d)?(mm|cm)\] \(rec\)/);
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
  // The dragged node holds its west edge, so it gets a shift; the relation stays.
  expect(line(after, "(rec)")).toMatch(/\\node\[process, below=of small, xshift=\d+mm\]/);
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
  await dragHandle(page, "e", -(wide - (await page.locator('g[data-node="start"] path').first().boundingBox())!.width) + 1, 0);
  await expect(page.getByTestId("status")).toContainText("Same width as start");
});

const edges = async (page: Page, id: string) => {
  const b = (await page.locator(`g[data-node="${id}"] path`).first().boundingBox())!;
  return { l: b.x, r: b.x + b.width, t: b.y, b: b.y + b.height };
};

test("the edge opposite the handle stays where it is, and the dragged edge follows the pointer", async ({ page }) => {
  await select(page, "rec");
  const e0 = await edges(page, "rec");
  await dragHandle(page, "se", 60, 24);
  const e1 = await edges(page, "rec");
  // The north-west corner is held; the south-east corner moved by what the pointer moved (to the millimetre).
  // A shift is written in whole millimetres, so the held edge is within 0.5 mm (about 3.3 px here).
  expect(Math.abs(e1.l - e0.l)).toBeLessThan(4.5);
  expect(Math.abs(e1.t - e0.t)).toBeLessThan(1.5);
  expect(Math.abs(e1.r - e0.r - 60)).toBeLessThan(6);
  expect(Math.abs(e1.b - e0.b - 24)).toBeLessThan(6);
  await expect(page.getByTestId("status")).toContainText("to keep the opposite edge in place");
  // One undo step undoes the size and the position together.
  const before = await code(page);
  await page.keyboard.press("Control+z");
  expect(await code(page)).not.toBe(before);
  const back = await edges(page, "rec");
  expect(Math.abs(back.r - e0.r)).toBeLessThan(1.5);
  expect(Math.abs(back.l - e0.l)).toBeLessThan(1.5);
});

test("a side whose edge the anchor already holds only changes the size", async ({ page }) => {
  // "rec" is placed below=of small, so its top edge sits at the anchor: dragging the south side holds it.
  await select(page, "rec");
  const before = await code(page);
  await dragHandle(page, "s", 0, 30);
  const after = await code(page);
  expect(line(after, "(rec)")).toMatch(/\\node\[process, below=of small, minimum height=\d+(\.\d)?(mm|cm)\] \(rec\)/);
  expect(line(after, "(rec)")).not.toContain("shift");
  expect(after.split("\n").filter((l) => !l.includes("(rec)"))).toEqual(before.split("\n").filter((l) => !l.includes("(rec)")));
});

test("holding Ctrl resizes from the centre", async ({ page }) => {
  await select(page, "stop");
  const e0 = await edges(page, "stop");
  await page.keyboard.down("Control");
  await dragHandle(page, "e", 30, 0);
  await page.keyboard.up("Control");
  const e1 = await edges(page, "stop");
  expect((e1.l + e1.r) / 2).toBeCloseTo((e0.l + e0.r) / 2, 0);
  // The pointer moved the east edge 30 px, so the width grew by about twice that.
  expect(Math.abs(e1.r - e0.r - 30)).toBeLessThan(6);
  expect(Math.abs(e0.l - e1.l - 30)).toBeLessThan(6);
});
