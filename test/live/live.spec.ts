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
    for (const path of ["/", "/sw.js", `${engine}/index.json`]) {
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

  test("the engine's index is JSON for the pinned tag (an unknown path would answer with the page, not a 404)", async ({ request }) => {
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
    page.on("request", (r) => hosts.add(new URL(r.url()).host));
    page.on("response", (r) => {
      if (r.url().includes(`${engine}/core.dump.gz`) && !r.fromServiceWorker()) engineBytes.gz++;
      if (r.url().includes(engine) && !r.fromServiceWorker()) engineBytes.requests++;
    });
    await page.goto("/");
    await expect(page.getByTestId("compiled-picture")).toBeAttached({ timeout: 45_000 });
    await expect(page.getByTestId("preview-state")).toHaveText("TeX preview");
    await expect(page.getByTestId("offline-state")).toHaveText("Works offline", { timeout: 100_000 });
    expect([...hosts]).toEqual([new URL(page.url()).host]);
    expect(problems).toEqual([]);
    expect(engineBytes.gz, "core.dump.gz is fetched from the network once").toBe(1);
    // It's Beta, and the way to report a problem is there.
    await expect(page.getByTestId("beta-label")).toBeVisible();
    await expect(page.getByTestId("report-link")).toHaveAttribute("href", "https://github.com/LoganAlexanderBurnett/tikzflow/issues");
  });

  test("a second visit reads the engine from the service worker's cache, not the network", async ({ page }) => {
    await page.goto("/");
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
    await page.goto("/");
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

  test("exports are real files: .tex, snippet, SVG, PDF, PNG", async ({ page }) => {
    await page.goto("/");
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
    await page.goto("/");
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
    await visitor.context().close();
  });
});
