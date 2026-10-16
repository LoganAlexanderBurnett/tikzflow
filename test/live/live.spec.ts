// Post-deploy checks (D76) against a deployed site: npm run test:live. What `vite preview` can't tell us:
// the headers Cloudflare Pages really sends, how it serves the engine's .gz files, whether the engine is
// downloaded once and then kept, whether the app works offline after one visit, and the exports and share
// links as the production build runs them. Nothing here writes to the site; it only reads.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const root = join(import.meta.dirname, "..", "..");
const tag = (JSON.parse(readFileSync(join(root, "engine", "release.json"), "utf8")) as { tag: string }).tag;
const engine = `/engine/${tag}`;
// A first visit starts empty (D96): the checks that need a picture open the Basic process template, as the editor used to.
const FIRST = "/editor/#template=basic-process";

/** The policy that public/_headers promises for every page. */
const headers = readFileSync(join(root, "public", "_headers"), "utf8");
const csp = /^\s*Content-Security-Policy:\s*(.+)$/m.exec(headers)![1]!.trim();

async function setCode(page: Page, code: string) {
  const content = page.locator(".cm-content");
  await content.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText(code);
}

const FIGURE = ["\\begin{tikzpicture}", "\\node[draw] (a) at (0,0) {LiveCheck};", "\\node[draw] (b) at (3,0) {B};", "\\draw[->] (a) -- (b);", "\\end{tikzpicture}", ""].join("\n");

test.describe("headers", () => {
  test("every page carries the Content-Security-Policy of public/_headers, and the other two headers", async ({ request }) => {
    for (const path of ["/", "/editor/", "/sw.js", `${engine}/index.json`]) {
      const h = (await request.get(path)).headers();
      expect(h["content-security-policy"], path).toBe(csp);
      expect(h["x-content-type-options"], path).toBe("nosniff");
      expect(h["referrer-policy"], path).toBe("no-referrer");
    }
  });

  test("the service worker is checked on every visit, the engine is cached for good", async ({ request }) => {
    expect((await request.get("/sw.js")).headers()["cache-control"]).toContain("no-cache");
    for (const f of ["index.json", "core.dump.gz", "tex.wasm.gz"]) {
      expect((await request.get(`${engine}/${f}`)).headers()["cache-control"], f).toBe("public, max-age=31536000, immutable");
    }
  });

  test("the .gz files arrive as the gzip bytes they are, not inflated or re-encoded", async ({ request }) => {
    for (const f of ["core.dump.gz", "tex.wasm.gz"]) {
      const res = await request.get(`${engine}/${f}`);
      expect(res.status(), f).toBe(200);
      expect(res.headers()["content-encoding"], f).toBeUndefined();
      const body = await res.body();
      expect([body[0], body[1]], `${f} starts with the gzip magic`).toEqual([0x1f, 0x8b]);
      const local = join(root, "vendor", "engine", tag, f);
      if (existsSync(local)) expect(body.length, `${f} is the size of the pinned release's file`).toBe(statSync(local).size);
    }
  });

  test("the engine's index is JSON for the pinned tag", async ({ request }) => {
    const res = await request.get(`${engine}/index.json`);
    expect(res.headers()["content-type"]).toContain("json");
    const index = (await res.json()) as { texFiles: string[]; fonts: string[] };
    expect(index.texFiles.length).toBeGreaterThan(100);
    expect(index.fonts.length).toBeGreaterThan(50);
  });
});

test.describe("the app", () => {
  test("first visit: the engine downloads once, nothing but this site is asked, no policy violation", async ({ page }) => {
    const hosts = new Set<string>();
    const problems: string[] = [];
    const engineBytes = { gz: 0, requests: 0 };
    page.on("console", (m) => (m.type() === "error" || /content security policy|refused to/i.test(m.text())) && problems.push(m.text()));
    page.on("pageerror", (e) => problems.push(String(e)));
    page.on("requestfailed", (r) => problems.push(`${r.url()} ${r.failure()?.errorText}`));
    // A blob: URL (TeX's picture as an image while it is out of date, D108) is made in the page: its host is the
    // one inside it ("blob:https://tikzflow.pages.dev/…"), which URL's own host leaves empty.
    page.on("request", (r) => {
      const u = new URL(r.url());
      hosts.add(u.protocol === "blob:" ? new URL(u.pathname).host : u.host);
    });
    page.on("response", (r) => {
      if (r.url().includes(`${engine}/core.dump.gz`) && !r.fromServiceWorker()) engineBytes.gz++;
      if (r.url().includes(engine) && !r.fromServiceWorker()) engineBytes.requests++;
    });
    await page.goto(FIRST);
    await expect(page.getByTestId("compiled-picture")).toBeAttached({ timeout: 45_000 });
    await expect(page.getByTestId("preview-state")).toHaveText("TeX preview");
    await expect(page.getByTestId("offline-state")).toHaveText("Works offline", { timeout: 100_000 });
    expect([...hosts]).toEqual([new URL(page.url()).host]);
    expect(problems).toEqual([]);
    expect(engineBytes.gz, "core.dump.gz is fetched from the network once").toBe(1);
    // It's Beta, and the way to report a problem is there.
    await expect(page.getByTestId("beta-label")).toBeVisible();
    await expect(page.getByTestId("report-link")).toHaveAttribute("href", "https://github.com/LoganAlexanderBurnett/tikzflow/issues/new?template=problem.yml");
  });

  test("a second visit reads the engine from the service worker's cache, not the network", async ({ page }) => {
    await page.goto(FIRST);
    await expect(page.getByTestId("offline-state")).toHaveText("Works offline", { timeout: 100_000 });
    let network = 0;
    let cached = 0;
    page.on("response", (r) => {
      if (!r.url().includes(engine)) return;
      if (r.fromServiceWorker()) cached++;
      else network++;
    });
    await page.reload();
    await expect(page.getByTestId("compiled-picture")).toBeAttached({ timeout: 30_000 });
    expect(network, "engine requests that reached the network").toBe(0);
    expect(cached).toBeGreaterThan(3);
  });

  test("offline after one visit: the app, TeX's picture and the exports work with the network off", async ({ page, context }) => {
    await page.goto(FIRST);
    await expect(page.getByTestId("offline-state")).toHaveText("Works offline", { timeout: 100_000 });
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByTestId("summary-headline")).toBeVisible();
    await expect(page.getByTestId("compiled-picture")).toBeAttached({ timeout: 30_000 });
    await expect(page.getByTestId("preview-state")).toHaveText("TeX preview");
    // A package this visit never used is in the cache too.
    const cachedPackages = await page.evaluate(async () => {
      const cache = await caches.open("tikzflow-engine");
      return (await cache.keys()).map((r) => new URL(r.url).pathname).filter((p) => /tex_files\/(siunitx|tikz-cd|pgfplots)\.sty\.gz$/.test(p)).length;
    });
    expect(cachedPackages).toBe(3);
    // And an export made offline is a real file.
    await page.getByTestId("export-button").click();
    const [d] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), page.getByTestId("export-svg").click()]);
    expect(readFileSync((await d.path())!, "utf8")).toContain("<svg");
  });

  test("auto-layout loads elk.js from this site under the policy, and works offline after one visit (D80)", async ({ page, context }) => {
    const problems: string[] = [];
    page.on("console", (m) => /content security policy|refused to/i.test(m.text()) && problems.push(m.text()));
    page.on("pageerror", (e) => problems.push(String(e)));
    const layOut = async () => {
      await setCode(page, FIGURE);
      await page.getByTestId("layout-button").click();
      await page.getByTestId("layout-down").click();
      await expect(page.getByTestId("status")).toContainText("Laid out 2 nodes top to bottom", { timeout: 30_000 });
      await expect(page.locator(".cm-content")).toContainText("below=of a");
    };
    await page.goto(FIRST);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await layOut();
    // elk.js is a chunk of its own, cached with the app.
    await expect
      .poll(() => page.evaluate(async () => {
        const shell = (await caches.keys()).find((n) => n.startsWith("tikzflow-shell-"));
        return !!shell && (await (await caches.open(shell)).keys()).some((r) => /elk\.bundled-[^/]*\.js$/.test(r.url));
      }))
      .toBe(true);
    await context.setOffline(true);
    await page.reload();
    await layOut();
    expect(problems).toEqual([]);
  });

  test("import lays a Mermaid and a DOT diagram out under the policy, and the color views draw, also offline (D84, D85)", async ({ page, context }) => {
    const problems: string[] = [];
    page.on("console", (m) => /content security policy|refused to/i.test(m.text()) && problems.push(m.text()));
    page.on("pageerror", (e) => problems.push(String(e)));
    const importBoth = async () => {
      await page.getByTestId("import-button").click();
      await page.getByTestId("import-source").fill("flowchart TD\n  s([Begin]) --> q{Ready?}\n  q -->|yes| g[Go]\n  q -->|no| s");
      await page.getByTestId("import-run").click();
      await expect(page.getByTestId("import-done")).toContainText("3 nodes, 3 edges", { timeout: 30_000 });
      await page.getByTestId("import-another").click();
      await page.getByTestId("import-source").fill("digraph { rankdir=LR; a -> b -> c }");
      await page.getByTestId("import-run").click();
      await expect(page.getByTestId("import-done")).toContainText("a Graphviz graph", { timeout: 30_000 });
      await page.getByTestId("import-close").click();
      await expect(page.locator(".cm-content")).toContainText("right=of a");
    };
    await page.goto(FIRST);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await importBoth();
    await page.getByTestId("vision-select").selectOption("deuteranopia");
    await expect(page.getByTestId("drawing")).toHaveAttribute("filter", "url(#tf-vision-deuteranopia)");
    await page.getByTestId("vision-select").selectOption("normal");
    await expect
      .poll(() => page.evaluate(async () => {
        const shell = (await caches.keys()).find((n) => n.startsWith("tikzflow-shell-"));
        return !!shell && (await (await caches.open(shell)).keys()).some((r) => /elk\.bundled-[^/]*\.js$/.test(r.url));
      }))
      .toBe(true);
    await context.setOffline(true);
    await page.reload();
    await importBoth();
    expect(problems).toEqual([]);
  });

  test("exports are real files: .tex, snippet, SVG, PDF, PNG", async ({ page }) => {
    await page.goto(FIRST);
    await expect(page.getByTestId("compiled-picture")).toBeAttached({ timeout: 45_000 });
    await setCode(page, FIGURE);
    await expect(page.getByTestId("compiled-picture")).toBeAttached();
    await page.getByTestId("export-button").click();
    const download = async (id: string) => {
      const [d] = await Promise.all([page.waitForEvent("download", { timeout: 45_000 }), page.getByTestId(id).click()]);
      return { name: d.suggestedFilename(), bytes: readFileSync((await d.path())!) };
    };
    const standalone = await download("export-standalone-download");
    expect(standalone.name).toMatch(/\.tex$/);
    expect(standalone.bytes.toString("utf8")).toContain("\\documentclass[tikz,border=5pt]{standalone}");
    expect(standalone.bytes.toString("utf8")).toContain("LiveCheck");
    const snippet = await download("export-snippet-download");
    expect(snippet.bytes.toString("utf8")).toContain("\\begin{tikzpicture}");
    const svg = await download("export-svg");
    expect(svg.bytes.toString("utf8")).toMatch(/<svg[\s>]/);
    const pdf = await download("export-pdf");
    expect(pdf.bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.bytes.length).toBeGreaterThan(500);
    const png = await download("export-png");
    expect([...png.bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(png.bytes.length).toBeGreaterThan(500);
  });

  test("a share link opens the same code for a new visitor, and the link holds no server address of ours to call", async ({ page, context }) => {
    await page.goto(FIRST);
    await expect(page.getByTestId("compiled-picture")).toBeAttached({ timeout: 45_000 });
    await setCode(page, FIGURE);
    await page.getByTestId("share-button").click();
    await expect(page.getByTestId("share-link")).toHaveValue(/#tf1=/); // compressed asynchronously
    const url = await page.getByTestId("share-link").inputValue();
    expect(url).toMatch(/^https:\/\/.+#tf1=/);
    expect(new URL(url).host).toBe(new URL(page.url()).host);

    const visitor = await (await context.browser()!.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
    await visitor.goto(url);
    await visitor.waitForSelector(".cm-editor");
    await expect(visitor.locator(".cm-content")).toContainText("LiveCheck", { timeout: 15_000 });
    await expect(visitor.getByTestId("compiled-picture")).toBeAttached({ timeout: 45_000 });
    await expect(visitor.getByText("LiveCheck").first()).toBeVisible();
    // The same link as made before the editor moved (D92): at the home page's address, forwarded.
    const old = await (await context.browser()!.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
    await old.goto(url.replace("/editor/#", "/#"));
    await expect(old).toHaveURL(/\/editor\/#|\/editor\/$/);
    await expect(old.locator(".cm-content")).toContainText("LiveCheck", { timeout: 15_000 });
    await old.context().close();
    await visitor.context().close();
  });
});

// The site around the editor (D89, D92): what Cloudflare Pages does with several pages.
test.describe("the site", () => {
  test("the home page, the editor and the 404 page are served as Cloudflare Pages should", async ({ request, page }) => {
    const home = await request.get("/");
    expect(home.status()).toBe(200);
    expect(await home.text()).toContain('data-page="home"');
    const editor = await request.get("/editor/");
    expect(editor.status()).toBe(200);
    expect(await editor.text()).toContain('data-page="editor"');
    // An unknown address is a real 404 now, with the site's page (was: the app, status 200).
    const missing = await request.get("/no-such-page/");
    expect(missing.status()).toBe(404);
    expect(await missing.text()).toContain("This page isn't here");
    for (const f of ["/robots.txt", "/sitemap.xml", "/favicon.svg", "/boot.js"]) expect((await request.get(f)).status(), f).toBe(200);
    // The home page draws, under the policy, and asks nothing of the engine.
    const problems: string[] = [];
    page.on("console", (m) => /content security policy|refused to/i.test(m.text()) && problems.push(m.text()));
    page.on("pageerror", (e) => problems.push(String(e)));
    const engineAsked: string[] = [];
    page.on("request", (r) => r.url().includes("/engine/") && engineAsked.push(r.url()));
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Draw flowcharts/);
    await page.waitForLoadState("networkidle");
    expect(problems).toEqual([]);
    expect(engineAsked).toEqual([]);
  });

  test("the templates (D95): the gallery's pictures load, a card opens its template in the editor, New lists them all, and a first visit shows the start screen (D96)", async ({ page }) => {
    const problems: string[] = [];
    page.on("console", (m) => /content security policy|refused to/i.test(m.text()) && problems.push(m.text()));
    page.on("pageerror", (e) => problems.push(String(e)));
    await page.goto("/");
    const thumbs = page.locator(".tcard img");
    await expect(thumbs).toHaveCount(13);
    for (const img of await thumbs.all()) {
      await img.scrollIntoViewIfNeeded();
      await expect.poll(() => img.evaluate((i) => (i as HTMLImageElement).naturalWidth), { message: (await img.getAttribute("src")) ?? "" }).toBeGreaterThan(0);
    }
    await page.locator('a.tcard[href="/editor/#template=state-machine"]').click();
    await page.waitForSelector(".cm-editor");
    await expect(page).toHaveURL(/\/editor\/$/);
    await expect(page.locator(".cm-content")).toContainText("\\usetikzlibrary{automata, positioning, arrows.meta}");
    await expect(page.getByTestId("summary-headline")).toHaveText("3 nodes and 6 edges editable");
    await page.getByTestId("new-button").click();
    await expect(page.getByTestId("new-panel").locator(".tf-new-card")).toHaveCount(14);
    await page.getByTestId("new-prisma-2020").click();
    await expect(page.getByTestId("summary-headline")).toHaveText("9 nodes, 3 groups and 8 edges editable");
    // A first visit to the editor shows the start screen (D96), its gallery's pictures under the policy.
    const fresh = await (await page.context().browser()!.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
    fresh.on("console", (m) => /content security policy|refused to/i.test(m.text()) && problems.push(m.text()));
    await fresh.goto("/editor/");
    await expect(fresh.getByTestId("empty-state")).toBeVisible({ timeout: 15_000 });
    await fresh.getByTestId("start-template").click();
    const card = fresh.locator('[data-testid="start-prisma-2020"] img');
    await expect.poll(() => card.evaluate((i) => (i as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await fresh.getByTestId("start-prisma-2020").click();
    await expect(fresh.getByTestId("summary-headline")).toHaveText("9 nodes, 3 groups and 8 edges editable");
    await fresh.context().close();
    expect(problems).toEqual([]);
  });

  test("tabs (D97): kept across a reload; a second window shows the first one's tab read-only and Edit here hands it over", async ({ page, context }) => {
    const problems: string[] = [];
    const watch = (p: Page) => {
      p.on("console", (m) => /content security policy|refused to/i.test(m.text()) && problems.push(m.text()));
      p.on("pageerror", (e) => problems.push(String(e)));
    };
    watch(page);
    await page.goto(FIRST);
    await page.waitForSelector(".cm-editor");
    await setCode(page, FIGURE);
    await page.getByTestId("new-button").click();
    await page.getByTestId("new-hierarchy").click();
    const names = (p: Page) => p.getByTestId("tab").locator(".name");
    await expect(names(page)).toHaveText(["Basic process", "Hierarchy"]);
    await page.waitForTimeout(1000);
    await page.reload();
    await page.waitForSelector(".cm-editor");
    await expect(names(page)).toHaveText(["Basic process", "Hierarchy"]);
    await expect(page.getByTestId("summary-headline")).toHaveText("6 nodes and 5 edges editable");

    // A second window starts on the tab the first isn't showing, then opens the first one's.
    const second = await context.newPage();
    watch(second);
    await second.goto("/editor/");
    await second.waitForSelector(".cm-editor");
    await expect(second.locator(".cm-content")).toContainText("LiveCheck");
    await names(second).nth(1).click();
    await expect(second.getByTestId("lock-banner")).toBeVisible();
    await second.getByTestId("edit-here").click();
    await expect(second.getByTestId("lock-banner")).toHaveCount(0);
    await expect(page.getByTestId("lock-banner")).toBeVisible();
    // The second window goes: the first one, in front again, can edit.
    await second.close();
    await page.bringToFront();
    await expect
      .poll(async () => {
        // The browser lets go of the closed window's lock a moment after it closes.
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        return page.getByTestId("lock-banner").count();
      })
      .toBe(0);
    expect(problems).toEqual([]);
  });
  test("the help pages (D99): every topic served, search works under the policy, and the editor links to them", async ({ request, page }) => {
    for (const path of ["/help/", "/help/saving/", "/help/shortcuts/", "/help/tex-preview/"]) {
      const r = await request.get(path);
      expect(r.status(), path).toBe(200);
      expect(await r.text(), path).toContain('data-page="help"');
    }
    expect(await (await request.get("/sitemap.xml")).text()).toContain("/help/saving/");
    const problems: string[] = [];
    page.on("console", (m) => /content security policy|refused to/i.test(m.text()) && problems.push(m.text()));
    page.on("pageerror", (e) => problems.push(String(e)));
    await page.goto("/help/");
    await expect(page.locator(".help-toc a")).toHaveCount(13);
    await page.locator("#help-q").fill("recently closed");
    await expect(page.locator(".help-results a").first()).toContainText("Saving, tabs and your work");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/help\/saving\/#/);
    await expect(page.locator("figure img").first()).toHaveJSProperty("complete", true);
    await page.goto("/editor/");
    await expect(page.getByTestId("help-link")).toHaveAttribute("href", "/help/");
    expect(problems).toEqual([]);
  });

  test("the TeX preview reports where TeX put each node, and a node placed diagonally from the I/O trapezium matches it (D98)", async ({ page }) => {
    await page.goto(FIRST);
    await page.waitForSelector(".cm-editor");
    const code = await page.locator(".cm-content").innerText();
    await setCode(page, code.replace("\\node[process, right=of small] (base)", "\\node[process, below right=7mm and 1.8cm of read] (base)"));
    await expect(page.locator(".cm-content")).toContainText("below right=7mm and 1.8cm of read");
    await expect(page.locator(".tf-compiled-layer:not([data-stale])")).toBeAttached({ timeout: 60_000 });
    await expect(page.getByTestId("preview-state")).toHaveText("TeX preview", { timeout: 15_000 });
    await expect(page.getByTestId("misplaced-marker")).toHaveCount(0);
  });
});
