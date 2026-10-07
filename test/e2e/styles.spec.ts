// Milestone 2a step 7: the style panel, factoring repeated options, and matching sizes.
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

const line = (text: string, part: string) => text.split("\n").find((l) => l.includes(part)) ?? "";

async function click(page: Page, id: string, shift = false) {
  const box = await page.locator(`g[data-node="${id}"] path`).first().boundingBox();
  if (!box) throw new Error(`node ${id} not drawn`);
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  if (shift) await page.keyboard.up("Shift");
}

const width = async (page: Page, id: string) => (await page.locator(`g[data-node="${id}"] path`).first().boundingBox())!.width;

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("summary-headline")).toHaveText("6 nodes and 6 edges editable");
});

test("the style panel lists the figure's styles and how many nodes use each", async ({ page }) => {
  await expect(page.getByTestId("style-panel")).toBeVisible();
  await expect(page.getByTestId("style-process")).toContainText("2 nodes");
  await expect(page.getByTestId("style-terminal")).toContainText("2 nodes");
  await page.getByTestId("style-process").getByRole("button", { name: "Select" }).click();
  await expect(page.locator("g.tf-node.selected")).toHaveCount(2);
});

test("editing a style rewrites its definition in place and every node using it changes", async ({ page }) => {
  const before = await code(page);
  const w0 = await width(page, "rec");
  await page.getByTestId("style-process").getByRole("button", { name: "Edit" }).click();
  const box = page.getByLabel("Options of the process style");
  await expect(box).toHaveValue("base, fill=blue!8");
  await box.fill("base, fill=red!10, minimum width=40mm");
  await page.getByRole("button", { name: /Apply to 2 nodes/ }).click();
  const after = await code(page);
  expect(line(after, "process/.style")).toContain("{base, fill=red!10, minimum width=40mm}");
  expect(after.split("\n").filter((l) => !l.includes("process/.style"))).toEqual(before.split("\n").filter((l) => !l.includes("process/.style")));
  expect(await width(page, "rec")).toBeGreaterThan(w0 + 20);
  expect(Math.abs((await width(page, "rec")) - (await width(page, "base")))).toBeLessThan(2);
  await expect(page.getByTestId("status")).toContainText("Changed the process style. 2 nodes use it.");
  await page.keyboard.press("Control+z");
  expect(await code(page)).toBe(before);
});

test("text that would break the code can't be applied", async ({ page }) => {
  await page.getByTestId("style-process").getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Options of the process style").fill("base, fill={red");
  await expect(page.getByTestId("style-process").locator(".tf-problem")).toContainText("{");
  await expect(page.getByRole("button", { name: /Apply to/ })).toBeDisabled();
});

test("repeated options are offered as a style, and factoring them leaves everything looking the same", async ({ page }) => {
  const text = [
    "\\usetikzlibrary{positioning}",
    "\\begin{tikzpicture}",
    "  \\node[draw, fill=blue!10, rounded corners] (a) at (0,0) {A};",
    "  \\node[draw, fill=blue!10, rounded corners, below=of a] (b) {B};",
    "  \\node[draw, fill=blue!10, rounded corners, below=of b] (c) {C};",
    "\\end{tikzpicture}",
    "",
  ].join("\n");
  await setCode(page, text);
  const rep = page.getByTestId("repeat");
  await expect(rep).toHaveCount(1);
  await expect(rep).toContainText("3 nodes each write draw, fill=blue!10, rounded corners");
  const w = [await width(page, "a"), await width(page, "b")];
  await expect(rep.getByLabel("Name for the new style")).toHaveValue("blueBox");
  await rep.getByRole("button", { name: "Factor out" }).click();
  const after = await code(page);
  expect(after).toContain("\\node[blueBox] (a) at (0,0) {A};");
  expect(after).toContain("\\node[blueBox, below=of b] (c) {C};");
  expect(after).toMatch(/blueBox\/\.style=\{draw, fill=blue!10, rounded corners\}/);
  expect([await width(page, "a"), await width(page, "b")]).toEqual(w);
  await expect(page.getByTestId("repeat")).toHaveCount(0);
  await expect(page.getByTestId("status")).toContainText("Added the blueBox style");
  // One undo takes it all back.
  await page.keyboard.press("Control+z");
  expect(await code(page)).toBe(text);
});

test("a name that is already taken is refused", async ({ page }) => {
  await setCode(
    page,
    "\\begin{tikzpicture}\n\\node[draw, thick, fill=red!10] (a) at (0,0) {A};\n\\node[draw, thick, fill=red!10] (b) at (3,0) {B};\n\\node[draw, thick, fill=red!10] (c) at (6,0) {C};\n\\end{tikzpicture}\n",
  );
  const rep = page.getByTestId("repeat");
  await rep.getByLabel("Name for the new style").fill("draw");
  await expect(rep).toContainText("shadow");
  await expect(rep.getByRole("button", { name: "Factor out" })).toBeDisabled();
});

const DIFFERENT = [
  "\\tikzset{box/.style={draw}}",
  "\\begin{tikzpicture}",
  "  \\node[box, minimum width=30mm, minimum height=14mm] (a) at (0,0) {A};",
  "  \\node[box] (b) at (4,0) {Longer text here};",
  "  \\node[box, minimum width=50mm] (c) at (0,-2) {C};",
  "\\end{tikzpicture}",
  "",
].join("\n");

test("Match width gives the other nodes the first selected node's width, and one undo takes it back", async ({ page }) => {
  await setCode(page, DIFFERENT);
  await click(page, "a");
  await click(page, "b", true);
  await click(page, "c", true);
  await expect(page.getByTestId("match-width")).toBeVisible();
  const target = await width(page, "a");
  expect(Math.abs((await width(page, "c")) - target)).toBeGreaterThan(10);
  await page.getByTestId("match-width").click();
  for (const id of ["b", "c"]) expect(Math.abs((await width(page, id)) - target)).toBeLessThan(2.5);
  expect(line(await code(page), "(c)")).toContain("minimum width=3cm");
  await expect(page.getByTestId("status")).toContainText("Matched the width to a");
  await page.keyboard.press("Control+z");
  expect(await code(page)).toBe(DIFFERENT);
});

test("Match height follows the scope: with a style chosen, the style takes the height", async ({ page }) => {
  await setCode(page, DIFFERENT);
  await click(page, "a");
  await click(page, "c", true);
  await page.getByRole("radio", { name: /All box nodes/ }).check();
  const target = await (async () => (await page.locator('g[data-node="a"] path').first().boundingBox())!.height)();
  await page.getByTestId("match-height").click();
  const after = await code(page);
  expect(line(after, "box/.style")).toMatch(/box\/\.style=\{draw, minimum height=1.4cm\}/);
  const h = async (id: string) => (await page.locator(`g[data-node="${id}"] path`).first().boundingBox())!.height;
  expect(Math.abs((await h("b")) - target)).toBeLessThan(2.5);
  expect(Math.abs((await h("c")) - target)).toBeLessThan(2.5);
  await expect(page.getByTestId("status")).toContainText("in the box style");
});

test("taking the last diamond out of a style removes the shapes library it no longer needs", async ({ page }) => {
  const text = [
    "\\usetikzlibrary{shapes.geometric}",
    "\\tikzset{choice/.style={draw, diamond}}",
    "\\begin{tikzpicture}",
    "  \\node[choice] (a) at (0,0) {A};",
    "\\end{tikzpicture}",
    "",
  ].join("\n");
  await setCode(page, text);
  await page.getByTestId("style-choice").getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Options of the choice style").fill("draw");
  await page.getByRole("button", { name: /Apply to 1 node/ }).click();
  const after = await code(page);
  expect(after).not.toContain("usetikzlibrary");
  expect(after).toContain("choice/.style={draw}");
  await expect(page.getByTestId("status")).toContainText("Removed the unused shapes.geometric library");
  await page.keyboard.press("Control+z");
  expect(await code(page)).toBe(text);
});
