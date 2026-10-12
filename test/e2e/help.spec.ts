// The help site (M5 step 7, D99): static pages with the site's look, the list of topics, search,
// links from the home page and the editor, phone width, and text contrast in both themes.
import { expect, test } from "@playwright/test";
import { lowContrast } from "./lowcontrast.ts";

test("the help pages: topics, a page, the pager, and links back to the site", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/help/");
  await expect(page).toHaveTitle("TikZFlow help");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("TikZFlow help");
  await expect(page.locator(".help-toc a")).toHaveCount(13);
  await expect(page.locator("blockquote")).toContainText("Your work is kept in this browser only");
  await page.locator(".help-toc").getByRole("link", { name: "Saving, tabs and your work" }).click();
  await expect(page).toHaveURL(/\/help\/saving\/$/);
  await expect(page.getByRole("heading", { name: "Recently closed" })).toBeVisible();
  await expect(page.locator('.help-toc a[aria-current="page"]')).toHaveText("Saving, tabs and your work");
  // Screenshots load, at their size.
  const shot = page.locator("figure img").first();
  await shot.scrollIntoViewIfNeeded();
  await expect.poll(() => shot.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.locator(".help-pager .next").click();
  await expect(page).toHaveURL(/\/help\/export\/$/);
  await page.getByRole("link", { name: "Open the editor" }).click();
  await expect(page).toHaveURL(/\/editor\/$/);
  expect(errors).toEqual([]);
});

test("search finds a topic and goes to it, from the box or with / and Enter", async ({ page }) => {
  await page.goto("/help/getting-started/");
  await page.keyboard.press("/");
  await expect(page.locator("#help-q")).toBeFocused();
  await page.keyboard.type("recently closed");
  const results = page.locator(".help-results a");
  await expect(results.first()).toContainText("Saving, tabs and your work");
  await expect(page.locator("[data-help-count]")).toContainText("result");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/help\/saving\/#/);
  await page.locator("#help-q").fill("zzzqqq");
  await expect(page.locator("[data-help-count]")).toHaveText("Nothing found. Try another word.");
});

test("the home page, the editor and its shortcut list link to the help", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".site-nav").getByRole("link", { name: "Help" })).toHaveAttribute("href", "/help/");
  await page.goto("/editor/");
  await expect(page.getByTestId("help-link")).toHaveAttribute("href", "/help/");
  await page.getByTestId("shortcuts-button").click();
  await expect(page.getByTestId("shortcuts-help")).toHaveAttribute("href", "/help/shortcuts/");
  await page.goto("/help/shortcuts/");
  // The table is the editor's own list: the same seven sections.
  await expect(page.locator("table.keys")).toHaveCount(7);
  await expect(page.locator("table.keys").first()).toContainText("Show or hide the shortcut list");
});

test("at phone width the help has no sideways scroll", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 375, height: 760 } })).newPage();
  for (const path of ["/help/", "/help/shortcuts/", "/help/saving/"]) {
    await page.goto(path);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(wide, path).toBeLessThanOrEqual(0);
  }
});

for (const scheme of ["light", "dark"] as const) {
  test(`text contrast on the help pages, ${scheme} theme`, async ({ browser }) => {
    const page = await (await browser.newContext({ colorScheme: scheme })).newPage();
    for (const path of ["/help/", "/help/saving/", "/help/shortcuts/", "/help/tex-preview/"]) {
      await page.goto(path);
      await page.locator("#help-q").fill("tabs");
      await expect(page.locator(".help-results a").first()).toBeVisible();
      expect(await lowContrast(page), `${path}, ${scheme}`).toEqual([]);
    }
  });
}
