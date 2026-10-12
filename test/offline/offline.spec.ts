// Offline use (M3 step 9, D70): after one visit the app and the TeX engine
// work with no network. Runs against a production build (npm run test:offline);
// the TeX parts need the engine (npm run fetch-engines -- engine).
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const root = join(import.meta.dirname, "..", "..");
const tag = (JSON.parse(readFileSync(join(root, "engine", "release.json"), "utf8")) as { tag: string }).tag;
const haveEngine = existsSync(join(root, "vendor", "engine", tag, "index.json"));
// A first visit starts empty (D96); these tests start from the Basic process template, as the editor used to.
const FIRST = "/editor/#template=basic-process";

test.describe("after the first visit", () => {
  test.skip(!haveEngine, `the engine ${tag} isn't in vendor/engine (npm run fetch-engines -- engine)`);

  test("the app and TeX's picture work with the network off, and nothing but this server is asked", async ({ page, context }) => {
    const hosts = new Set<string>();
    const problems: string[] = [];
    page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
    page.on("requestfailed", (r) => problems.push(`${r.url()} ${r.failure()?.errorText}`));
    page.on("request", (r) => hosts.add(new URL(r.url()).host));
    await page.goto(FIRST);
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
    await page.goto(FIRST);
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
    const response = await page.goto(FIRST);
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

// Auto-layout (D80) loads elk.js as a chunk of its own on first use: it must be in the app's
// cache, so it works offline after one visit, and it must run under the production policy.
test("auto-layout works offline, under the production Content-Security-Policy", async ({ page, context }) => {
  const violations: string[] = [];
  page.on("console", (m) => /content security policy|refused to/i.test(m.text()) && violations.push(m.text()));
  page.on("pageerror", (e) => violations.push(String(e)));
  await page.goto(FIRST);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(() => page.evaluate(async () => {
      const shell = (await caches.keys()).find((n) => n.startsWith("tikzflow-shell-"));
      return !!shell && (await (await caches.open(shell)).keys()).some((r) => /elk\.bundled-[^/]*\.js$/.test(r.url));
    }))
    .toBe(true);
  await page.waitForTimeout(900); // autosave: the reload offline opens the work kept in the browser
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId("summary-headline")).toBeVisible();
  await page.getByTestId("layout-button").click();
  await page.getByTestId("layout-right").click();
  await expect(page.getByTestId("status")).toContainText(/Laid out \d+ nodes left to right|already follow this layout/, { timeout: 30_000 });
  expect(violations).toEqual([]);
});

// Import (D84) lays the diagram out with elk.js and the color views (D85) draw through an SVG
// filter: both must work with the network off, under the production policy.
test("import and the color views work offline, under the production Content-Security-Policy", async ({ page, context }) => {
  const violations: string[] = [];
  page.on("console", (m) => /content security policy|refused to/i.test(m.text()) && violations.push(m.text()));
  page.on("pageerror", (e) => violations.push(String(e)));
  await page.goto(FIRST);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(() => page.evaluate(async () => {
      const shell = (await caches.keys()).find((n) => n.startsWith("tikzflow-shell-"));
      return !!shell && (await (await caches.open(shell)).keys()).some((r) => /elk\.bundled-[^/]*\.js$/.test(r.url));
    }))
    .toBe(true);
  await page.waitForTimeout(900); // autosave: the reload offline opens the work kept in the browser
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId("summary-headline")).toBeVisible();
  await page.getByTestId("import-button").click();
  await page.getByTestId("import-source").fill("flowchart TD\n  a([Start]) --> b{Ready?}\n  b -->|yes| c[Go]\n  b -->|no| a\n  subgraph g [Run]\n    c\n  end");
  await page.getByTestId("import-run").click();
  await expect(page.getByTestId("import-done")).toContainText("3 nodes", { timeout: 30_000 });
  await page.getByTestId("import-close").click();
  await expect(page.locator('[data-node="ready"]').first()).toBeVisible();
  await page.getByTestId("vision-select").selectOption("tritanopia");
  await expect(page.getByTestId("drawing")).toHaveAttribute("filter", "url(#tf-vision-tritanopia)");
  expect(violations).toEqual([]);
});

// The site's pages (D92): one visit to the home page keeps every page, without fetching the engine;
// offline, each address gets its own page, and an unknown one the home page. Online, an unknown
// address is a real 404 with the site's 404 page.
test("after one visit to the home page, the home page and the editor work offline, under the policy", async ({ page, context }) => {
  const violations: string[] = [];
  page.on("console", (m) => /content security policy|refused to/i.test(m.text()) && violations.push(m.text()));
  page.on("pageerror", (e) => violations.push(String(e)));
  const engineAsked: string[] = [];
  page.on("request", (r) => r.url().includes("/engine/") && engineAsked.push(r.url()));
  const response = await page.goto("/");
  expect(response!.headers()["content-security-policy"]).toContain("default-src 'self'");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(() => page.evaluate(async () => {
      const shell = (await caches.keys()).find((n) => n.startsWith("tikzflow-shell-"));
      const paths = shell ? (await (await caches.open(shell)).keys()).map((r) => new URL(r.url).pathname) : [];
      return paths.includes("/") && paths.includes("/editor/");
    }))
    .toBe(true);
  expect(engineAsked, "the home page doesn't fetch the engine").toEqual([]);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Draw flowcharts/);
  await page.goto("/editor/");
  // Nothing was kept: the start screen, with the templates' pictures (D96).
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await page.getByTestId("start-template").click();
  await expect(page.locator('[data-testid="start-hierarchy"] img')).toHaveJSProperty("complete", true);
  expect(await page.locator('[data-testid="start-hierarchy"] img').evaluate((i) => (i as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.goto("/no-such-page/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Draw flowcharts/);
  expect(violations).toEqual([]);
});

test("after one visit to a help page, every help page and its search work offline, under the policy (D99)", async ({ page, context }) => {
  const violations: string[] = [];
  page.on("console", (m) => /content security policy|refused to/i.test(m.text()) && violations.push(m.text()));
  page.on("pageerror", (e) => violations.push(String(e)));
  const response = await page.goto("/help/");
  expect(response!.headers()["content-security-policy"]).toContain("default-src 'self'");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(() => page.evaluate(async () => {
      const shell = (await caches.keys()).find((n) => n.startsWith("tikzflow-shell-"));
      const paths = shell ? (await (await caches.open(shell)).keys()).map((r) => new URL(r.url).pathname) : [];
      return paths.includes("/help/saving/") && paths.some((p) => /search-index.*\.json$/.test(p));
    }))
    .toBe(true);
  await context.setOffline(true);
  await page.goto("/help/saving/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Saving, tabs and your work");
  await expect(page.locator("figure img").first()).toHaveJSProperty("complete", true);
  await page.locator("#help-q").fill("swimlanes");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/help\/layout\//);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Layout, groups and swimlanes");
  expect(violations).toEqual([]);
});

test("an unknown address is a 404 with the site's page", async ({ page }) => {
  const response = await page.goto("/no-such-page/");
  expect(response!.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This page isn't here");
});

test("one cache holds the app and one the engine", async ({ page }) => {
  await page.goto(FIRST);
  await page.evaluate(() => navigator.serviceWorker.ready);
  const names = await page.evaluate(async () => (await caches.keys()).sort());
  expect(names.filter((n) => n.startsWith("tikzflow-shell-"))).toHaveLength(1);
  expect(names).toContain("tikzflow-engine");
});
