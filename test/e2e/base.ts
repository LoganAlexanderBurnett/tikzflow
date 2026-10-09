// The end-to-end tests' `test`: the app starts after the work kept in the browser has been read
// (M3 step 12), so a page counts as loaded once the code pane exists. Every spec imports from here.
import { test as base } from "@playwright/test";

export { expect, type Page } from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, use) => {
    const goto = page.goto.bind(page);
    const reload = page.reload.bind(page);
    page.goto = async (...args) => {
      const r = await goto(...args);
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
