// Milestone 4 step 5: import from Mermaid and DOT (D84), from the toolbar's Import panel and as Open.
import { expect, type Page, test } from "./base.ts";

async function code(page: Page): Promise<string> {
  return page.evaluate(() => {
    const w = window as unknown as { tikzflow: { store: { editorView: () => { state: { doc: { toString(): string } } } } } };
    return w.tikzflow.store.editorView().state.doc.toString();
  });
}

const MERMAID = ["flowchart TD", "  start([Start]) --> check{In stock?}", "  check -->|yes| ship[Ship it]", "  check -->|no| wait[Back-order]", "  wait --> check"].join("\n");

const DOT = 'digraph pipeline {\n  rankdir=LR;\n  node [shape=box];\n  source -> build -> test;\n  subgraph cluster_ci { label="CI"; build; test; }\n}\n';

const MINE = String.raw`\begin{tikzpicture}
\node[draw] (mine) at (0,0) {Mine};
\end{tikzpicture}
`;

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate((t) => {
    const w = window as unknown as { tikzflow: { store: { replaceDocument: (t: string, n: null, e: string) => void } } };
    w.tikzflow.store.replaceDocument(t, null, "utf-8");
  }, MINE);
  await expect(page.locator('[data-node="mine"]').first()).toBeVisible();
});

test("imports pasted Mermaid: TikZ with relations, drawn, in a new tab", async ({ page }) => {
  await page.getByTestId("import-button").click();
  await expect(page.getByTestId("import-format")).toContainText("format is found");
  await page.getByTestId("import-source").fill(MERMAID);
  await expect(page.getByTestId("import-format")).toContainText("Mermaid");
  await page.getByTestId("import-run").click();
  await expect(page.getByTestId("import-done")).toContainText("4 nodes, 4 edges");
  await page.getByTestId("import-close").click();
  const t = await code(page);
  expect(t).toContain("\\node[terminal] (start) {Start};");
  expect(t).toContain("\\node[decision, below=of start] (check) {In stock?};");
  expect(t).toContain("\\draw[->] (check) -- node[auto] {yes} (ship);");
  expect(t).not.toMatch(/\) at \(/);
  // Drawn on the canvas, and every node can be dragged.
  await expect(page.locator('[data-node="ship"]').first()).toBeVisible();
  await expect(page.getByTestId("status")).toContainText("Imported a Mermaid flowchart in a new tab: 4 nodes, 4 edges");
  // It opened in a new tab (D97); the work that was on screen is in its own.
  await expect(page.getByTestId("tab")).toHaveCount(2);
  await expect(page.getByTestId("file-name")).toHaveText("Mermaid import");
  await page.getByTestId("tab").first().locator(".name").click();
  await expect.poll(() => code(page)).toBe(MINE);
});

test("imports DOT as a group in a row, and says what it left out", async ({ page }) => {
  await page.getByTestId("import-button").click();
  await page.getByTestId("import-source").fill(DOT + "\n");
  await expect(page.getByTestId("import-format")).toContainText("DOT");
  await page.getByTestId("import-run").click();
  await expect(page.getByTestId("import-done")).toContainText("3 nodes, 2 edges, 1 group");
  const t = await code(page);
  expect(t).toContain("right=of source");
  expect(t).toContain("\\node[group, fit=(build) (test), label={[group title]north:CI}] (ci) {};");
});

test("shows what is wrong, with the line, and writes nothing", async ({ page }) => {
  const before = await code(page);
  expect(before).toBe(MINE);
  await page.getByTestId("import-button").click();
  await page.getByTestId("import-source").fill("digraph {\n a -> b;\n c -> ;\n}");
  await page.getByTestId("import-run").click();
  await expect(page.getByTestId("import-error")).toContainText("Line 3");
  expect(await code(page)).toBe(before);
  await page.getByTestId("import-source").fill("sequenceDiagram\nA->>B: hi");
  await page.getByTestId("import-run").click();
  await expect(page.getByTestId("import-error")).toContainText("sequence diagram");
});

test("a file chosen in the panel is imported, and named after the file", async ({ page }) => {
  await page.getByTestId("import-button").click();
  await page.getByTestId("import-file").setInputFiles({ name: "flow.mmd", mimeType: "text/plain", buffer: Buffer.from(MERMAID) });
  await expect(page.getByTestId("import-done")).toContainText("4 nodes");
  await expect(page.getByTestId("file-name")).toContainText("flow.tex");
  await page.getByTestId("import-close").click();
  expect(await code(page)).toContain("\\node[terminal] (start) {Start};");
});

test("a dropped .dot file is imported like an opened one", async ({ page }) => {
  await page.evaluate(async (dot) => {
    const dt = new DataTransfer();
    dt.items.add(new File([dot], "build.dot", { type: "text/plain" }));
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, DOT);
  await expect(page.getByTestId("status")).toContainText("Imported a Graphviz graph in a new tab: 3 nodes, 2 edges, 1 group");
  expect(await code(page)).toContain("\\node[group, fit=(build) (test)");
});
