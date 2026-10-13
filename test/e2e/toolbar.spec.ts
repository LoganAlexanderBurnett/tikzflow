// The toolbar and the top row at the window widths laptops have (D101): nothing is cut off, in either theme.
// The toolbar wraps its second group (the picture's view, Export, Share) onto its own row when the first
// group takes the width, and the two panels at its right end stay on screen.
import { expect, type Page, test } from "./base.ts";

// Two pictures, so the toolbar also has its Picture picker: the widest it gets.
const TWO_PICTURES = "\\begin{tikzpicture}\n\\node[draw] (a) {A};\n\\end{tikzpicture}\n\\begin{tikzpicture}\n\\node[draw] (b) {B};\n\\end{tikzpicture}\n";

async function setCode(page: Page, text: string) {
  await page.evaluate((t) => {
    const w = window as unknown as { tikzflow: { store: { replaceDocument: (t: string, n: null, e: string) => void } } };
    w.tikzflow.store.replaceDocument(t, null, "utf-8");
  }, text);
}

/** What lies outside the window (or is clipped by the row that holds it) in the top row and the toolbar. */
async function cutOff(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const W = innerWidth;
    const bad: string[] = [];
    for (const sel of [".tf-appbar", ".tf-toolbar"]) {
      const root = document.querySelector(sel) as HTMLElement;
      for (const e of root.querySelectorAll<HTMLElement>("*")) {
        // The tabs scroll sideways on purpose.
        if (e.closest(".tf-tabs .list")) continue;
        const r = e.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.left < -0.5 || r.right > W + 0.5) bad.push(`${sel} ${e.dataset.testid ?? e.className ?? e.tagName} ${Math.round(r.left)}..${Math.round(r.right)}`);
      }
      if (root.scrollWidth > root.clientWidth + 1) bad.push(`${sel} scrolls: ${root.scrollWidth} > ${root.clientWidth}`);
    }
    if (document.documentElement.scrollWidth > W) bad.push(`the page scrolls sideways: ${document.documentElement.scrollWidth} > ${W}`);
    return bad;
  });
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });
    for (const width of [1100, 1280, 1366, 1440]) {
      test(`nothing is cut off at ${width} px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.goto("/");
        await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);
        expect(await cutOff(page)).toEqual([]);
        await setCode(page, TWO_PICTURES);
        await expect(page.locator(".tf-toolbar .picker select").first()).toBeVisible();
        expect(await cutOff(page)).toEqual([]);
        // Share and Export, the last two buttons, are on screen and clickable, and so are their panels.
        for (const [button, panel] of [["export-button", "export-panel"], ["share-button", "share-panel"]] as const) {
          await page.getByTestId(button).click();
          const r = await page.getByTestId(panel).boundingBox();
          expect(r, panel).not.toBeNull();
          expect(r!.x, panel).toBeGreaterThanOrEqual(0);
          expect(r!.x + r!.width, panel).toBeLessThanOrEqual(width + 0.5);
          await page.getByTestId(button).click();
          await expect(page.getByTestId(panel)).toBeHidden();
        }
      });
    }
  });
}

// Was 1366 px until the "Move followers too" switch (D104, D105): with its label the toolbar needs about 1,470 px.
test("with one picture the toolbar is one row from 1500 px up", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 800 });
  await page.goto("/");
  const rows = await page.locator(".tf-toolbar .tools").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(rows).size).toBe(1);
});
