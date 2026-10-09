// Offline use (M3 step 9, D70): after one visit the app and the TeX engine
// work with no network. Runs against a production build (npm run test:offline);
// the TeX parts need the engine (npm run fetch-engines -- engine).
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const root = join(import.meta.dirname, "..", "..");
const tag = (JSON.parse(readFileSync(join(root, "engine", "release.json"), "utf8")) as { tag: string }).tag;
const haveEngine = existsSync(join(root, "vendor", "engine", tag, "index.json"));

test.describe("after the first visit", () => {
  test.skip(!haveEngine, `the engine ${tag} isn't in vendor/engine (npm run fetch-engines -- engine)`);

  test("the app and TeX's picture work with the network off, and nothing but this server is asked", async ({ page, context }) => {
    const hosts = new Set<string>();
    const problems: string[] = [];
    page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
    page.on("requestfailed", (r) => problems.push(`${r.url()} ${r.failure()?.errorText}`));
    page.on("request", (r) => hosts.add(new URL(r.url()).host));
    await page.goto("/");
    // The first picture, then the rest of the engine in the background.
    await expect(page.getByTestId("compiled-picture")).toBeAttached({ timeout: 30_000 });
    await expect(page.getByTestId("offline-state")).toHaveText("Works offline", { timeout: 80_000 });
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByTestId("summary-headline")).toBeVisible();
    // The engine is loaded from the cache and compiles the sample again.
    const shown = await page.getByTestId("compiled-picture").waitFor({ state: "attached", timeout: 30_000 }).then(() => true, () => false);
    if (!shown) throw new Error(`no picture offline; state: ${await page.getByTestId("preview-state").textContent()}; ${problems.join("; ")}`);
    await expect(page.getByTestId("preview-state")).toHaveText("TeX preview");
    expect([...hosts]).toEqual(["localhost:5175"]);
  });

  test("a package the first visit never used is there offline too", async ({ page, context }) => {
    await page.goto("/");
    await expect(page.getByTestId("offline-state")).toHaveText("Works offline", { timeout: 90_000 });
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByTestId("compiled-picture")).toBeAttached({ timeout: 30_000 });
    // The browser's own cache can't have these: ask the service worker's.
    const cached = await page.evaluate(async () => {
      const cache = await caches.open("tikzflow-engine");
      return (await cache.keys()).map((r) => new URL(r.url).pathname).filter((p) => /tex_files\/(siunitx|tikz-cd|pgfplots)\.sty\.gz$/.test(p)).length;
    });
    expect(cached).toBe(3);
  });
});

// The production headers (public/_headers, D75) forbid anything but this site's own files. Nothing
// the app does may break them: the TeX picture, the three picture exports, a share link.
test.describe("under the production Content-Security-Policy", () => {
  test.skip(!haveEngine, `the engine ${tag} isn't in vendor/engine (npm run fetch-engines -- engine)`);

  test("the picture, the exports and a share link raise no violation", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (m) => /content security policy|refused to/i.test(m.text()) && violations.push(m.text()));
    page.on("pageerror", (e) => violations.push(String(e)));
    const response = await page.goto("/");
    expect(response!.headers()["content-security-policy"]).toContain("default-src 'self'");
    await expect(page.getByTestId("compiled-picture")).toBeAttached({ timeout: 30_000 });
    await page.getByTestId("export-button").click();
    for (const id of ["export-svg", "export-pdf", "export-png"]) {
      const [d] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), page.getByTestId(id).click()]);
      expect(d.suggestedFilename(), id).toMatch(/\.(svg|pdf|png)$/);
      expect(statSync((await d.path())!).size, id).toBeGreaterThan(100);
    }
    await page.getByTestId("export-button").click(); // closes the panel
    await page.getByTestId("share-button").click();
    await expect(page.getByTestId("share-link")).toHaveValue(/#tf1=/);
    await page.getByTestId("share-button").click();
    await page.getByTestId("page-button").click();
    await page.getByTestId("typed-text").fill("300pt");
    await expect(page.getByTestId("page-widths")).toContainText("300 pt");
    expect(violations).toEqual([]);
  });
});

test("one cache holds the app and one the engine", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  const names = await page.evaluate(async () => (await caches.keys()).sort());
  expect(names.filter((n) => n.startsWith("tikzflow-shell-"))).toHaveLength(1);
  expect(names).toContain("tikzflow-engine");
});
