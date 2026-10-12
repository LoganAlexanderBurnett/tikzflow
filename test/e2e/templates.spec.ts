// The templates (D95): the editor's New menu, the home page's gallery opening them in the editor,
// and the state machine's loops in the edge menu.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test as plain } from "@playwright/test";
import { expect, type Page, test } from "./base.ts";

const template = (id: string) => readFileSync(join(import.meta.dirname, "..", "..", "src", "templates", `${id}.tex`), "utf8");

async function code(page: Page): Promise<string> {
  return page.evaluate(() => {
    const w = window as unknown as { tikzflow: { store: { editorView: () => { state: { doc: { toString(): string } } } } } };
    return w.tikzflow.store.editorView().state.doc.toString();
  });
}

async function setCode(page: Page, text: string) {
  await page.evaluate((t) => {
    const w = window as unknown as { tikzflow: { store: { replaceDocument: (t: string, n: null, e: string) => void } } };
    w.tikzflow.store.replaceDocument(t, null, "utf-8");
  }, text);
}

const MINE = "\\begin{tikzpicture}\n\\node[draw] (mine) at (0,0) {Mine};\n\\end{tikzpicture}\n";

test("the New menu opens a template in a new tab; the work stays in its own (D97)", async ({ page }) => {
  await page.goto("/");
  await setCode(page, MINE);
  await page.getByTestId("new-button").click();
  const panel = page.getByTestId("new-panel");
  await expect(panel.locator(".tf-new-card")).toHaveCount(13);
  // The thumbnails are TeX's pictures, served with the editor.
  await expect(panel.locator('[data-testid="new-hierarchy"] img')).toHaveJSProperty("complete", true);
  expect(await panel.locator('[data-testid="new-hierarchy"] img').evaluate((i) => (i as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await panel.getByTestId("new-hierarchy").click();
  await expect(panel).toBeHidden();
  await expect.poll(() => code(page)).toBe(template("hierarchy"));
  await expect(page.getByTestId("summary-headline")).toHaveText("6 nodes and 5 edges editable");
  await expect(page.getByTestId("status")).toHaveText("Opened the Hierarchy template in a new tab.");
  await page.getByTestId("new-button").click();
  await page.getByTestId("new-blank").click();
  await expect.poll(() => code(page)).toBe(template("blank"));
  await expect(page.getByTestId("status")).toHaveText("Opened a blank diagram in a new tab.");
  await expect(page.getByTestId("tab").locator(".name")).toHaveText(["Basic process", "Hierarchy", "Untitled"]);
  await page.getByTestId("tab").first().locator(".name").click();
  await expect.poll(() => code(page)).toBe(MINE);
});

test("every template opens with all of it editable; group and lane boxes count as groups (D96)", async ({ page }) => {
  await page.goto("/");
  const expected: Record<string, string> = {
    "basic-process": "6 nodes and 6 edges editable",
    "decision-flowchart": "8 nodes and 8 edges editable",
    "algorithm-with-a-loop": "6 nodes and 6 edges editable",
    "swimlane-process": "7 nodes, 3 groups and 7 edges editable",
    "left-to-right-pipeline": "7 nodes, 1 group and 6 edges editable",
    "feedback-block-diagram": "7 nodes and 7 edges editable",
    "prisma-2020": "9 nodes, 3 groups and 8 edges editable",
    "state-machine": "3 nodes and 6 edges editable",
    hierarchy: "6 nodes and 5 edges editable",
    "neural-network": "12 nodes and 20 edges editable",
    "lstm-cell": "15 nodes, 1 group and 17 edges editable",
    "encoder-decoder": "9 nodes and 11 edges editable",
  };
  for (const [id, headline] of Object.entries(expected)) {
    await page.getByTestId("new-button").click();
    await page.getByTestId(`new-${id}`).click();
    await expect(page.getByTestId("summary-headline"), id).toHaveText(headline);
    // Nothing kept as-is, no syntax errors, no warnings about the code.
    await expect(page.locator(".tf-summary"), id).not.toContainText(/kept as-is|syntax error|not drawn|undefined/i);
  }
});

// The home page isn't the editor, so this uses Playwright's own test (base.ts waits for the code pane).
plain("a template link from the home page opens it in the editor, and the address is cleaned", async ({ page }) => {
  await page.goto("/editor/");
  await page.waitForSelector(".cm-editor");
  await setCode(page, MINE);
  await page.waitForTimeout(900); // autosave
  await page.goto("/");
  await page.locator('a.tcard[href="/editor/#template=state-machine"]').click();
  await page.waitForSelector(".cm-editor");
  await expect(page).toHaveURL(/\/editor\/$/);
  await expect.poll(() => code(page)).toBe(template("state-machine"));
  await expect(page.getByTestId("status")).toHaveText("Opened the State machine template in a new tab.");
  await page.getByTestId("tab").first().locator(".name").click();
  await expect.poll(() => code(page)).toBe(MINE);
});

test("a loop's menu offers labels and delete, and says why it can't be reshaped", async ({ page }) => {
  await page.goto("/editor/#template=state-machine");
  await expect(page.getByTestId("summary-headline")).toHaveText("3 nodes and 6 edges editable");
  // The first edge is q0's loop.
  const id = await page.locator("path[data-edge]").first().getAttribute("data-edge");
  const onLoop = () =>
    page.locator(`path[data-edge="${id}"]`).evaluate((el) => {
      const path = el as SVGPathElement;
      const pt = path.getPointAtLength(path.getTotalLength() * 0.3);
      const s = new DOMPoint(pt.x, pt.y).matrixTransform(path.getScreenCTM()!);
      return { x: s.x, y: s.y };
    });
  await expect(async () => {
    const p = await onLoop();
    await page.mouse.click(p.x, p.y, { button: "right" });
    await expect(page.getByTestId("edge-menu")).toBeVisible({ timeout: 700 });
  }).toPass({ timeout: 8000 });
  const menu = page.getByTestId("edge-menu");
  for (const item of ["menu-straighten", "menu-orthogonal", "menu-curved", "menu-add-vertex", "menu-from-anchor"]) {
    await expect(menu.getByTestId(item), item).toHaveAttribute("aria-disabled", "true");
    await expect(menu.getByTestId(item), item).toHaveAttribute("title", /is a loop/);
  }
  await expect(menu.getByTestId("menu-add-label")).not.toHaveAttribute("aria-disabled", "true");
  await expect(menu.getByTestId("menu-delete")).not.toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");
  // Selected, a loop has no handles to drag, and the panel says how to change it.
  const p = await onLoop();
  await page.mouse.click(p.x, p.y);
  await expect(page.getByText("A loop starts and ends at the same node.")).toBeVisible();
  await expect(page.locator(".tf-end-handles, .tf-vertex-handles")).toHaveCount(0);
});
