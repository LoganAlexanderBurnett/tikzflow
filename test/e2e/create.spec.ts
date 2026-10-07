// Milestone 2a step 6: the palette and keyboard-driven creation.
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
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("summary-headline")).toHaveText("6 nodes and 6 edges editable");
});

test("the palette has the six flowchart shapes", async ({ page }) => {
  for (const id of ["process", "decision", "terminal", "io", "connector", "document"]) await expect(page.getByTestId(`palette-${id}`)).toBeVisible();
});

test("Tab adds a connected node: type its label, Enter writes it, and one undo takes it all back", async ({ page }) => {
  const before = await code(page);
  await select(page, "stop");
  await page.keyboard.press("Tab");
  const editor = page.getByTestId("label-editor");
  await expect(editor).toBeVisible();
  // Nothing is written until the label is applied.
  expect(await code(page)).toBe(before);
  // The placeholder is selected, so typing replaces it.
  await page.keyboard.type("Archive result");
  await page.keyboard.press("Enter");
  const after = await code(page);
  expect(line(after, "(archiveResult)")).toMatch(/\\node\[process, below=of stop\] \(archiveResult\) \{Archive result\};/);
  expect(after).toContain("\\draw[->] (stop) -- (archiveResult);");
  await expect(page.locator('g[data-node="archiveResult"]')).toBeVisible();
  await expect(page.getByTestId("status")).toContainText("Added archiveResult");
  // The new node is selected, so Tab can go on from it.
  await page.keyboard.press("Control+z");
  expect(await code(page)).toBe(before);
});

test("Escape cancels: nothing is written", async ({ page }) => {
  const before = await code(page);
  await select(page, "stop");
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("label-editor")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("label-editor")).toHaveCount(0);
  expect(await code(page)).toBe(before);
  await expect(page.locator("g[data-node]")).toHaveCount(6);
});

test("Tab inside the label box applies it and starts the next connected node", async ({ page }) => {
  await select(page, "stop");
  await page.keyboard.press("Tab");
  await page.keyboard.type("First");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Second");
  await page.keyboard.press("Enter");
  const after = await code(page);
  expect(after).toContain("\\node[process, below=of stop] (first) {First};");
  expect(after).toContain("\\node[process, below=of first] (second) {Second};");
  expect(after).toContain("\\draw[->] (first) -- (second);");
});

test("Enter adds a sibling beside the node, with an edge from the node that leads to it", async ({ page }) => {
  await select(page, "rec");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Retry");
  await page.keyboard.press("Enter");
  const after = await code(page);
  expect(line(after, "(retry)")).toMatch(/\\node\[process, (right|left)=of rec\] \(retry\) \{Retry\};/);
  expect(after).toContain("\\draw[->] (small) -- (retry);");
});

test("a palette button adds that shape after the selected node, connected, and adds the style it needs", async ({ page }) => {
  await select(page, "stop");
  await page.getByTestId("palette-document").click();
  await page.keyboard.type("Report");
  await page.keyboard.press("Enter");
  const after = await code(page);
  expect(line(after, "(report)")).toContain("\\node[document, below=of stop] (report) {Report};");
  expect(after).toMatch(/document\/\.style\s*=\s*\{draw, tape/);
  expect(after).toMatch(/\\usetikzlibrary\{[^}]*shapes\.symbols/);
  await expect(page.getByTestId("palette-document")).toHaveClass(/active/);
});

test("a palette shape dragged onto the canvas lands where it is dropped, snapped to the others", async ({ page }) => {
  const before = await code(page);
  const stop = (await page.locator('g[data-node="stop"] path').first().boundingBox())!;
  const canvas = (await page.getByTestId("canvas").boundingBox())!;
  await page.getByTestId("palette-terminal").dragTo(page.getByTestId("canvas"), {
    targetPosition: { x: stop.x + stop.width / 2 + 2 - canvas.x, y: stop.y + stop.height * 2 + 14 - canvas.y },
  });
  await expect(page.getByTestId("label-editor")).toBeVisible();
  await page.keyboard.type("End");
  await page.keyboard.press("Enter");
  const after = await code(page);
  expect(after).not.toBe(before);
  expect(line(after, "(end)")).toMatch(/\\node\[terminal, below=of stop\] \(end\) \{End\};/);
  // A drop makes no edge.
  expect(after).not.toContain("-- (end)");
});

test("a label that would break the code is refused and the box stays open", async ({ page }) => {
  const before = await code(page);
  await select(page, "stop");
  await page.keyboard.press("Tab");
  await page.keyboard.type("50% done");
  await expect(page.getByTestId("label-editor")).toContainText("comment");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("label-editor")).toBeVisible();
  expect(await code(page)).toBe(before);
});

test("the properties panel names an unnamed node by its label", async ({ page }) => {
  const text = (await code(page)).replace("\\end{tikzpicture}", "  \\node[process, right=of stop] {Unnamed one};\n\\end{tikzpicture}");
  const id = await page.evaluate((t) => {
    const w = window as unknown as {
      tikzflow: { store: { editorView: () => { dispatch(s: unknown): void; state: { doc: { length: number } } }; baseLayout: { value: { nodes: Array<{ id: string; name?: string }> } } } };
    };
    const { store } = w.tikzflow;
    const v = store.editorView();
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: t } });
    return store.baseLayout.value.nodes.find((n) => !n.name)!.id;
  }, text);
  await select(page, id);
  await expect(page.getByTestId("inspector").locator("h2")).toHaveText('"Unnamed one"');
});
