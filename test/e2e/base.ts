// The end-to-end tests' `test`: the app starts after the work kept in the browser has been read
// (M3 step 12), so a page counts as loaded once the code pane exists. Every spec of the editor imports
// from here. The editor lives at /editor/ (D92): `goto("/")` opens it. Other addresses are taken as
// they are, so `/#tf1=…` goes through the home page's forwarding, as an old share link does.
// The site's own pages (home, 404) are tested in site.spec.ts with Playwright's plain `test`.
import { test as base } from "@playwright/test";

export { expect, type Page } from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, use) => {
    const goto = page.goto.bind(page);
    const reload = page.reload.bind(page);
    page.goto = async (url, ...rest) => {
      const r = await goto(url === "/" ? "/editor/" : url, ...rest);
      await page.waitForSelector(".cm-editor");
      return r;
    };
    page.reload = async (...args) => {
      const r = await reload(...args);
      await page.waitForSelector(".cm-editor");
      return r;
    };
    await use(page);
  },
});
