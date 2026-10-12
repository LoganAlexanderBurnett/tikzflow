// The site around the editor (D89, D92): the home page at /, the editor at /editor/, share links made
// before the move, "Continue your diagram", the theme switch shared by every page.
import { expect, test } from "@playwright/test";

test("the home page is a static page with the pitch, the templates and the privacy promise, and links to the editor", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Draw flowcharts\.\s*Keep your TikZ\./);
  await expect(page.getByRole("heading", { name: "Start from a template" })).toBeVisible();
  await expect(page.locator(".tcard")).toHaveCount(12);
  await expect(page.getByRole("heading", { name: "Your diagrams never leave your browser" })).toBeVisible();
  await expect(page.getByText("bookmark")).toContainText("tikzflow.pages.dev/editor/");
  // No editor on the home page, and a first visit offers the editor, not "Continue".
  await expect(page.locator(".cm-editor")).toHaveCount(0);
  await expect(page.locator("[data-continue]")).toBeHidden();
  await page.locator("[data-open]").click();
  await expect(page).toHaveURL(/\/editor\/$/);
  await expect(page.locator(".cm-editor")).toBeVisible();
  expect(errors).toEqual([]);
});

test("a share link to the home page, as made before the editor moved, opens in the editor", async ({ page, browser }) => {
  // Make a real link in the editor, then open it at / the way old links point.
  await page.goto("/editor/");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText("\\begin{tikzpicture}\n\\node[draw] (a) {OldLink};\n\\end{tikzpicture}\n");
  await page.getByRole("button", { name: "Share" }).click();
  await expect(page.getByTestId("share-link")).toHaveValue(/\/editor\/#tf1=/);
  const link = await page.getByTestId("share-link").inputValue();
  const old = link.replace("/editor/#", "/#");
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(old);
  await expect(visitor).toHaveURL(/\/editor\//);
  await expect(visitor.locator(".cm-content")).toContainText("OldLink");
});

test("with work saved in this browser, the home page offers to continue it", async ({ page }) => {
  await page.goto("/editor/");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("% my own work\n");
  // Autosave waits half a second after the last change.
  await page.waitForTimeout(900);
  await page.goto("/");
  await expect(page.locator("[data-continue]")).toBeVisible();
  await expect(page.locator("[data-open]")).toBeHidden();
  await expect(page.locator("[data-resume]")).toContainText(/edited/);
  await page.locator("[data-continue]").click();
  await expect(page.locator(".cm-content")).toContainText("% my own work");
});

test("the theme switch cycles system, light and dark, and the choice holds on every page", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-theme", "light");
  const sw = page.locator("[data-theme-switch]");
  await expect(sw).toHaveAttribute("aria-label", /same as system/);
  await sw.click(); // light
  await sw.click(); // dark
  await expect(root).toHaveAttribute("data-theme", "dark");
  await page.goto("/editor/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.goto("/");
  await page.locator("[data-theme-switch]").click(); // back to the system's
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("the editor has the same theme switch, and its logo leads home", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/editor/");
  await expect(page.locator(".cm-editor")).toBeVisible();
  const sw = page.getByTestId("theme-switch");
  await sw.click(); // light
  await sw.click(); // dark
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  // The canvas stays white: the picture as it prints.
  expect(await page.locator("svg.tf-canvas").evaluate((e) => getComputedStyle(e).backgroundColor)).toBe("rgb(255, 255, 255)");
  await sw.click(); // back to the system's
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByTitle("TikZFlow home page").click();
  await expect(page).toHaveURL(/\/$/);
});

test("at phone width the home page has no sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over).toBeLessThanOrEqual(0);
});
