// Milestone 6 step 1 (D102, D104): placement links in the properties panel (what a node follows,
// what follows it, Unlink, Detach, Detach from style), and dragging: only the dragged node moves,
// Ctrl (⌘) or the toolbar's "Move followers too" moves its followers along, and a drag shows them
// faintly. Nothing may move that the user didn't drag.
import { expect, type Page, test } from "./base.ts";

async function code(page: Page): Promise<string> {
  return page.evaluate(() => {
    const w = window as unknown as { tikzflow: { store: { editorView: () => { state: { doc: { toString(): string } } } } } };
    return w.tikzflow.store.editorView().state.doc.toString();
  });
}

/** Every node's center in the picture's coordinates (pt, y up). */
async function centers(page: Page): Promise<Record<string, { x: number; y: number }>> {
  return page.evaluate(() => {
    const w = window as unknown as { tikzflow: { store: { baseLayout: { value: { nodes: Array<{ id: string; kind: string; shape: { center: { x: number; y: number } } }> } } } } };
    return Object.fromEntries(w.tikzflow.store.baseLayout.value.nodes.filter((n) => n.kind !== "path").map((n) => [n.id, n.shape.center]));
  });
}

function expectSame(a: Record<string, { x: number; y: number }>, b: Record<string, { x: number; y: number }>, except: string[] = []) {
  for (const [id, p] of Object.entries(a)) {
    if (except.includes(id)) continue;
    const q = b[id]!;
    expect(Math.hypot(q.x - p.x, q.y - p.y), `${id} moved`).toBeLessThan(0.5);
  }
}

async function nodeCenter(page: Page, id: string) {
  const box = await page.locator(`g.tf-node[data-node="${id}"] path`).first().boundingBox();
  if (!box) throw new Error(`node ${id} not drawn`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function selectNode(page: Page, id: string) {
  const p = await nodeCenter(page, id);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId("links")).toBeVisible();
}

const line = (text: string, name: string) => text.split("\n").find((l) => l.includes(`(${name})`)) ?? "";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("summary-headline")).toHaveText("6 nodes and 6 edges editable");
});

test("the panel lists what the node follows and what follows it", async ({ page }) => {
  await selectNode(page, "read");
  await expect(page.getByTestId("link-follows")).toHaveCount(1);
  await expect(page.getByTestId("link-follows")).toContainText("Follows start: below=of start");
  await expect(page.getByTestId("link-follower")).toHaveCount(1);
  await expect(page.getByTestId("link-follower")).toContainText("small: below=of read");
  await expect(page.getByTestId("links")).toContainText("small is placed relative to this");
  await selectNode(page, "start");
  await expect(page.getByTestId("link-none")).toHaveText("Not placed against another node.");
  await expect(page.getByTestId("link-follower")).toHaveCount(1);
});

test("Unlink a follower: it is re-attached where it is, nothing moves, and Undo brings the link back", async ({ page }) => {
  const before = await code(page);
  const c0 = await centers(page);
  await selectNode(page, "read");
  await page.getByTestId("link-follower").getByRole("button", { name: "Unlink" }).click();
  await expect(page.getByTestId("status")).toContainText("small no longer follows read");
  const after = await code(page);
  expect(line(after, "small")).toMatch(/of start\b/);
  expect(line(after, "read")).toBe(line(before, "read"));
  expectSame(c0, await centers(page));
  await expect(page.getByTestId("link-follower")).toHaveCount(0);
  await page.keyboard.press("Control+z");
  expect(await code(page)).toBe(before);
});

test("Unlink what the node follows: with nothing else before it, it is pinned where it is", async ({ page }) => {
  const c0 = await centers(page);
  await selectNode(page, "read");
  await page.getByTestId("link-follows").getByRole("button", { name: "Unlink" }).click();
  await expect(page.getByTestId("status")).toContainText("read no longer follows start: it is pinned with coordinates");
  expect(line(await code(page), "read")).toMatch(/at \(/);
  expectSame(c0, await centers(page));
});

test("Detach: the node gets coordinates, its followers are re-attached, nothing moves", async ({ page }) => {
  const c0 = await centers(page);
  await selectNode(page, "small");
  await page.getByTestId("detach").click();
  await expect(page.getByTestId("status")).toContainText("Detached small");
  await expect(page.getByTestId("status")).toContainText("Re-attached: base");
  const after = await code(page);
  expect(line(after, "small")).toMatch(/at \(/);
  expect(line(after, "base")).not.toContain("of small");
  expect(line(after, "rec")).not.toContain("of small");
  expectSame(c0, await centers(page));
  await expect(page.getByTestId("link-none")).toBeVisible();
  await expect(page.getByTestId("link-no-followers")).toBeVisible();
  await expect(page.getByTestId("detach")).toBeDisabled();
});

test("Detach from style copies the style's options into the node; nothing changes on screen", async ({ page }) => {
  const c0 = await centers(page);
  await selectNode(page, "rec");
  await page.getByTestId("detach-style-process").click();
  await expect(page.getByTestId("status")).toContainText("Copied the process style's options into the node");
  expect(line(await code(page), "rec")).toContain("\\node[draw, thick, minimum width=28mm, minimum height=9mm, align=center, fill=blue!8, below=of small] (rec)");
  expectSame(c0, await centers(page));
});

/** Drags node `id` by (dx, dy) screen px in steps; `mid` runs halfway. */
async function drag(page: Page, id: string, dx: number, dy: number, mid?: () => Promise<void>) {
  const p = await nodeCenter(page, id);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + dx / 2, p.y + dy / 2, { steps: 6 });
  if (mid) await mid();
  await page.mouse.move(p.x + dx, p.y + dy, { steps: 6 });
  await page.mouse.up();
}

test("dragging moves only the dragged node; its followers are rewritten to stay, in one undo step", async ({ page }) => {
  const before = await code(page);
  const c0 = await centers(page);
  await drag(page, "read", 90, 0);
  await expect(page.getByTestId("status")).toContainText("Kept in place: small");
  const c1 = await centers(page);
  expect(c1.read!.x - c0.read!.x).toBeGreaterThan(20);
  expectSame(c0, c1, ["read"]);
  const after = await code(page);
  expect(line(after, "small")).toMatch(/of start\b/);
  await page.keyboard.press("Control+z");
  expect(await code(page)).toBe(before);
});

test("Ctrl while dragging moves the followers too, and shows them; pressed mid-drag it switches at once", async ({ page }) => {
  const c0 = await centers(page);
  await drag(page, "read", 90, 0, async () => {
    await expect(page.getByTestId("follower-marks")).toHaveAttribute("data-along", "no");
    await expect(page.locator("[data-follower]")).toHaveCount(4); // small, base, rec, stop
    await page.keyboard.down("Control");
    await expect(page.getByTestId("follower-marks")).toHaveAttribute("data-along", "yes");
  });
  await page.keyboard.up("Control");
  await expect(page.getByTestId("follower-marks")).toHaveCount(0);
  const c1 = await centers(page);
  for (const id of ["read", "small", "base", "rec", "stop"]) expect(c1[id]!.x - c0[id]!.x, `${id} moved along`).toBeGreaterThan(20);
  expectSame(c0, c1, ["read", "small", "base", "rec", "stop"]);
  expect(line(await code(page), "small")).toContain("below=of read");
});

test("the toolbar's Move followers too switch flips the default, and is remembered", async ({ page }) => {
  const toggle = page.getByTestId("move-followers-toggle");
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  const c0 = await centers(page);
  await drag(page, "read", 90, 0);
  const c1 = await centers(page);
  expect(c1.small!.x - c0.small!.x).toBeGreaterThan(20);
  await page.reload();
  await expect(page.getByTestId("move-followers-toggle")).toBeChecked();
  // With it on, Ctrl moves only the node.
  const c2 = await centers(page);
  await page.keyboard.down("Control");
  await drag(page, "read", -60, 0);
  await page.keyboard.up("Control");
  const c3 = await centers(page);
  expectSame(c2, c3, ["read"]);
  await page.getByTestId("move-followers-toggle").uncheck();
});

test("a group drag moves only the selection; what follows it stays", async ({ page }) => {
  const c0 = await centers(page);
  const read = await nodeCenter(page, "read");
  await page.mouse.click(read.x, read.y);
  const small = await nodeCenter(page, "small");
  await page.keyboard.down("Shift");
  await page.mouse.click(small.x, small.y);
  await page.keyboard.up("Shift");
  await expect(page.locator(".tf-selection")).toHaveCount(2);
  await drag(page, "small", -80, 0);
  await expect(page.getByTestId("status")).toContainText("Moved 2 nodes");
  await expect(page.getByTestId("status")).toContainText("Kept in place");
  const c1 = await centers(page);
  for (const id of ["read", "small"]) expect(c0[id]!.x - c1[id]!.x, `${id}`).toBeGreaterThan(20);
  expectSame(c0, c1, ["read", "small"]);
});

test("the Venn template (D106): a set dragged alone leaves its counts and name; Detach on an overlapped set moves nothing", async ({ page }) => {
  await page.goto("/editor/#template=venn");
  await expect(page.getByTestId("summary-headline")).toHaveText("13 nodes and 0 edges editable");
  const c0 = await centers(page);
  await drag(page, "b", 60, 0);
  await expect(page.getByTestId("status")).toContainText("Kept in place");
  const c1 = await centers(page);
  expect(c1.b!.x - c0.b!.x).toBeGreaterThan(20);
  expectSame(c0, c1, ["b"]);
  const after = await code(page);
  for (const name of ["sport", "only-b", "bc"]) expect(line(after, name), name).not.toMatch(/of b\b/);
  await page.keyboard.press("Control+z");
  // a lies under b and c where they overlap; click it where it is alone.
  const box = (await page.locator('g.tf-node[data-node="a"] path').first().boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.5);
  await expect(page.getByTestId("link-follower")).toHaveCount(7); // b, c, reading, only-a, ab, ac, abc
  await page.getByTestId("detach").click();
  await expect(page.getByTestId("status")).toContainText("Detached a");
  expectSame(c0, await centers(page));
});
