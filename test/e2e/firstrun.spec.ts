// M5 step 5 (D96): the empty state a first visit shows (Paste TikZ, Start blank, Start from a
// template), and the keyboard shortcut list.
import { expect, type Page, test } from "./base.ts";

async function code(page: Page): Promise<string> {
  return page.evaluate(() => {
    const w = window as unknown as { tikzflow: { store: { editorView: () => { state: { doc: { toString(): string } } } } } };
    return w.tikzflow.store.editorView().state.doc.toString();
  });
}

const PICTURE = "\\begin{tikzpicture}\n\\node[draw] (a) {Pasted};\n\\end{tikzpicture}\n";

test("a first visit starts empty, with three ways to start", async ({ page }) => {
  await page.goto("/editor/");
  const start = page.getByTestId("empty-state");
  await expect(start).toBeVisible();
  await expect(start.getByRole("heading", { name: "Start a diagram" })).toBeVisible();
  await expect(page.getByTestId("summary")).toContainText("Nothing here yet");
  expect(await code(page)).toBe("");
  await expect(page.getByTestId("start-paste")).toContainText("Paste TikZ");
  await expect(page.getByTestId("start-blank")).toContainText("Start blank");
  await expect(page.getByTestId("start-template")).toContainText("Start from a template");
});

test("Start blank opens the blank diagram", async ({ page }) => {
  await page.goto("/editor/");
  await page.getByTestId("start-blank").click();
  await expect(page.getByTestId("empty-state")).toHaveCount(0);
  await expect(page.getByTestId("summary-headline")).toHaveText("0 nodes and 0 edges editable");
  expect(await code(page)).toContain("\\begin{tikzpicture}[node distance=8mm and 14mm]");
  await expect(page.getByTestId("status")).toHaveText("Opened a blank diagram.");
  // Tab adds the first node.
  await page.getByTestId("canvas").focus();
  await page.keyboard.press("Tab");
  await expect(page.locator(".tf-label-editor textarea")).toBeVisible();
});

test("Start from a template shows the gallery, and a card opens its template", async ({ page }) => {
  await page.goto("/editor/");
  await expect(page.getByTestId("start-hierarchy")).toHaveCount(0);
  await page.getByTestId("start-template").click();
  await expect(page.getByTestId("start-template")).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("empty-state").locator(".tf-new-card")).toHaveCount(9);
  await page.getByTestId("start-swimlane-process").click();
  await expect(page.getByTestId("empty-state")).toHaveCount(0);
  await expect(page.getByTestId("summary-headline")).toHaveText("7 nodes, 3 groups and 7 edges editable");
});

test("Paste TikZ takes the clipboard's code, or readies the code pane when it can't read it", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/editor/");
  await page.evaluate((t) => navigator.clipboard.writeText(t), PICTURE);
  await page.getByTestId("start-paste").click();
  await expect.poll(() => code(page)).toBe(PICTURE);
  await expect(page.getByTestId("summary-headline")).toHaveText("1 node and 0 edges editable");
  await expect(page.getByTestId("status")).toHaveText("Pasted 4 lines.");

  // Emptied again, with nothing to read: the code pane gets the focus and the status says how to paste.
  await page.evaluate(() => {
    const w = window as unknown as { tikzflow: { store: { replaceDocument: (t: string, n: null, e: string) => void } } };
    w.tikzflow.store.replaceDocument("", null, "utf-8");
  });
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await page.getByTestId("start-paste").click();
  await expect(page.getByTestId("status")).toContainText("Paste with Ctrl+V: the code pane is ready.");
  await expect(page.locator(".cm-editor")).toHaveClass(/cm-focused/);
});

test("a paste anywhere on the empty state is taken as Paste TikZ; Mermaid is imported", async ({ page }) => {
  await page.goto("/editor/");
  await page.getByTestId("empty-state").click({ position: { x: 5, y: 5 } });
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData("text/plain", "flowchart TD\n  A[Begin] --> B[End]\n");
    document.querySelector('[data-testid="empty-state"]')!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect(page.getByTestId("status")).toContainText("Imported a Mermaid flowchart: 2 nodes, 1 edge");
  await expect.poll(() => code(page)).toContain("\\begin{tikzpicture}");
});

test("deleting all the code brings the empty state back, and Undo the code", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("empty-state")).toHaveCount(0);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await page.keyboard.press("Control+Z");
  await expect(page.getByTestId("empty-state")).toHaveCount(0);
  await expect(page.getByTestId("summary-headline")).toHaveText("6 nodes and 6 edges editable");
});

test("? shows the keyboard shortcuts, except in the code; Escape closes them and the focus comes back", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("canvas").focus();
  await page.keyboard.press("?");
  const list = page.getByTestId("shortcuts");
  await expect(list).toBeVisible();
  await expect(list.getByRole("heading", { name: "Keyboard shortcuts" })).toBeVisible();
  for (const section of ["Anywhere", "Canvas", "Mouse", "Editing a label", "Edge menu", "Code"]) await expect(list.getByRole("heading", { name: section, exact: true })).toBeVisible();
  await expect(list).toContainText("Ctrl");
  await page.keyboard.press("Escape");
  await expect(list).toHaveCount(0);
  await expect(page.getByTestId("canvas")).toBeFocused();
  // In the code pane ? is text.
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("% why?");
  await expect(list).toHaveCount(0);
  expect(await code(page)).toContain("% why?");
  // The app bar's button opens it too, and clicking outside closes it.
  await page.getByTestId("shortcuts-button").click();
  await expect(list).toBeVisible();
  await page.mouse.click(5, 300);
  await expect(list).toHaveCount(0);
});

test("on a Mac the list says Cmd", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "platform", { get: () => "MacIntel" });
    Object.defineProperty(navigator, "userAgentData", { get: () => ({ platform: "macOS" }) });
  });
  await page.goto("/");
  await page.getByTestId("shortcuts-button").click();
  await expect(page.getByTestId("shortcuts")).toContainText("⌘");
  await expect(page.getByTestId("shortcuts")).not.toContainText("Ctrl");
});
