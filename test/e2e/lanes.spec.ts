// Groups and swimlanes in the app (M4 step 4, D81): make lanes from the
// selection, drop a node into another lane, title a lane, group nodes, and
// undo it all one step at a time.
import { expect, type Page, test } from "./base.ts";

type Store = { editorView: () => { state: { doc: { toString(): string } } }; replaceDocument: (t: string, n: null, e: string) => void };

async function code(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as { tikzflow: { store: Store } }).tikzflow.store.editorView().state.doc.toString());
}

async function setCode(page: Page, text: string) {
  await page.evaluate((t) => (window as unknown as { tikzflow: { store: Store } }).tikzflow.store.replaceDocument(t, null, "utf-8"), text);
}

const FLOW = [
  "\\documentclass{article}",
  "\\usepackage{tikz}",
  "\\usetikzlibrary{positioning}",
  "\\begin{document}",
  "\\begin{tikzpicture}[node distance=8mm and 14mm]",
  "  \\node[draw, minimum width=24mm] (a) {A};",
  "  \\node[draw, minimum width=24mm, below=of a] (b) {B};",
  "  \\node[draw, minimum width=24mm, right=of a] (c) {C};",
  "  \\node[draw, minimum width=24mm, below=of c] (d) {D};",
  "  \\draw[->] (a) -- (b);",
  "  \\draw[->] (c) -- (d);",
  "\\end{tikzpicture}",
  "\\end{document}",
  "",
].join("\n");

async function centre(page: Page, selector: string) {
  const b = (await page.locator(selector).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

async function select(page: Page, names: string[]) {
  await page.locator(`g[data-node="${names[0]}"]`).click();
  for (const n of names.slice(1)) await page.locator(`g[data-node="${n}"]`).click({ modifiers: ["Shift"] });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("preview-toggle").uncheck();
  await setCode(page, FLOW);
});

test("lanes from the selection, a node dropped into another lane, a title, one undo step each", async ({ page }) => {
  await select(page, ["a", "b"]);
  await page.getByTestId("group-title").fill("Customer");
  await page.getByTestId("lane-make").click();
  await expect(page.getByTestId("status")).toContainText("Made a lane, customer");
  await select(page, ["c", "d"]);
  await page.getByTestId("group-title").fill("Shop");
  await page.getByTestId("lane-make").click();
  let text = await code(page);
  expect(text).toContain("\\usetikzlibrary{positioning, fit, backgrounds}");
  expect(text).toContain("    \\coordinate (lanes top) at (a.north);");
  expect(text).toContain("    \\node[lane, fit=(a) (b) (a |- lanes top) (a |- lanes bottom), label={[lane title]north:Customer}] (customer) {};");
  expect(text).toContain("    \\node[lane, fit=(c) (d) (c |- lanes top) (c |- lanes bottom), label={[lane title]north:Shop}] (shop) {};");
  await expect(page.locator('g[data-node="shop"]')).toBeAttached();

  // Drag b into the Shop lane, under d.
  const from = await centre(page, 'g[data-node="b"]');
  const d = await centre(page, 'g[data-node="d"]');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 10, { steps: 3 });
  await page.mouse.move(d.x, d.y + 70, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId("status")).toContainText('Moved b to "Shop"');
  text = await code(page);
  expect(text).toContain("fit=(a) (a |- lanes top) (a |- lanes bottom), label={[lane title]north:Customer}");
  expect(text).toContain("fit=(c) (d) (b) (c |- lanes top)");
  // The shared bottom follows the lowest member.
  expect(text).toContain("\\coordinate (lanes bottom) at (b.south);");

  // Select the Shop lane and rename it.
  await page.locator('g[data-node="shop"]').click({ position: { x: 6, y: 6 } });
  await expect(page.getByTestId("box-card")).toContainText("Lane 2 of 2");
  await page.getByTestId("box-title").fill("Store");
  await page.getByTestId("box-title").press("Enter");
  expect(await code(page)).toContain("label={[lane title]north:Store}] (shop)");

  // One undo step each: the title, then the drop (move and lane change together).
  await page.locator("svg.tf-canvas").focus();
  await page.keyboard.press("Control+z");
  expect(await code(page)).toContain("north:Shop}] (shop)");
  await page.keyboard.press("Control+z");
  expect(await code(page)).toContain("fit=(a) (b) (a |- lanes top)");
});

test("grouping nodes draws a titled box behind them; taking one out shrinks it", async ({ page }) => {
  await select(page, ["c", "d"]);
  await page.getByTestId("group-title").fill("Checks");
  await page.getByTestId("group-make").click();
  let text = await code(page);
  expect(text).toContain("  \\begin{scope}[on background layer]\n    \\node[group, fit=(c) (d), label={[group title]north:Checks}] (checks) {};\n  \\end{scope}");
  expect(text).toContain("group/.style={draw=gray!70, dashed, rounded corners=3pt, inner sep=3mm}");
  await select(page, ["d"]);
  await page.getByTestId("box-leave").click();
  text = await code(page);
  expect(text).toContain("\\node[group, fit=(c), label={[group title]north:Checks}] (checks) {};");
});
