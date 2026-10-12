// The help pages' screenshots (M5 step 7, D99): the editor driven in Edge, in the light theme, at
// twice the size they are shown at, saved to src/help/shots/. Needs the engine (the TeX picture).
// Pictures of the interface aren't byte-stable across machines, so unlike the template thumbnails
// they have no staleness test: run this after changing what a screenshot shows, then npm run help:build.
// Usage: npm run help:shots [-- <name>…]

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type BrowserContext, chromium, type Page } from "@playwright/test";
import { createServer } from "vite";

const root = join(import.meta.dirname, "..");
const out = join(root, "src", "help", "shots");
const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const PORT = 5197;
const BASE = `http://localhost:${PORT}`;

mkdirSync(out, { recursive: true });
const server = await createServer({ root, logLevel: "warn", server: { port: PORT, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ channel: "msedge" });

async function context(): Promise<BrowserContext> {
  const c = await browser.newContext({ viewport: { width: 1440, height: 800 }, deviceScaleFactor: 2 });
  await c.addInitScript(() => localStorage.setItem("tikzflow.theme", "light"));
  return c;
}

/** Opens a template in the editor and waits for TeX's picture of it. */
async function openTemplate(page: Page, id = "basic-process") {
  await page.goto(`${BASE}/editor/#template=${id}`);
  await page.waitForSelector(".cm-editor");
  await page.waitForSelector(".tf-compiled-layer:not([data-stale])", { timeout: 60_000 });
  await page.waitForTimeout(300);
}

async function clickNode(page: Page, id: string) {
  await page.locator(`g.tf-node[data-node="${id}"]`).first().click();
}

/** Where along an edge, on screen. */
async function onEdge(page: Page, index: number, t = 0.5) {
  return page.locator("path[data-edge]").nth(index).evaluate((el, t) => {
    const path = el as SVGPathElement;
    const pt = path.getPointAtLength(path.getTotalLength() * t);
    const s = new DOMPoint(pt.x, pt.y).matrixTransform(path.getScreenCTM()!);
    return { x: s.x, y: s.y };
  }, t);
}

/** A screenshot of the boxes of some elements together, with a margin, kept inside the window. */
async function shootAround(page: Page, name: string, selectors: string[], margin = 16) {
  const boxes = (await Promise.all(selectors.map((s) => page.locator(s).first().boundingBox()))).filter((b) => b !== null);
  const x0 = Math.max(0, Math.min(...boxes.map((b) => b.x)) - margin);
  const y0 = Math.max(0, Math.min(...boxes.map((b) => b.y)) - margin);
  const x1 = Math.min(1440, Math.max(...boxes.map((b) => b.x + b.width)) + margin);
  const y1 = Math.min(800, Math.max(...boxes.map((b) => b.y + b.height)) + margin);
  await page.screenshot({ path: join(out, `${name}.png`), clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } });
}

const shots: Record<string, () => Promise<void>> = {
  async editor() {
    const c = await context();
    const page = await c.newPage();
    await openTemplate(page);
    await clickNode(page, "small");
    await page.mouse.move(5, 790);
    await page.screenshot({ path: join(out, "editor.png") });
    await c.close();
  },
  async start() {
    const c = await context();
    const page = await c.newPage();
    await page.goto(`${BASE}/editor/`);
    await page.waitForSelector('[data-testid="empty-state"]');
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(out, "start.png") });
    await c.close();
  },
  async "edge-menu"() {
    const c = await context();
    const page = await c.newPage();
    await openTemplate(page);
    // The third edge: small → base, with its "yes" label.
    const p = await onEdge(page, 2, 0.3);
    await page.mouse.click(p.x, p.y, { button: "right" });
    await page.waitForSelector('[data-testid="edge-menu"]');
    await page.waitForTimeout(200);
    await shootAround(page, "edge-menu", ['[data-testid="edge-menu"]', 'g.tf-node[data-node="small"]', 'g.tf-node[data-node="base"]']);
    await c.close();
  },
  async properties() {
    const c = await context();
    const page = await c.newPage();
    await openTemplate(page);
    await clickNode(page, "read");
    await page.waitForTimeout(200);
    await page.locator(".tf-inspector").first().screenshot({ path: join(out, "properties.png") });
    await c.close();
  },
  async layout() {
    const c = await context();
    const page = await c.newPage();
    await openTemplate(page);
    await page.getByTestId("layout-button").click();
    await page.waitForSelector('[data-testid="layout-panel"]');
    await shootAround(page, "layout", ['[data-testid="layout-panel"]', '[data-testid="layout-button"]'], 10);
    await c.close();
  },
  async "recently-closed"() {
    const c = await context();
    const page = await c.newPage();
    await openTemplate(page);
    // Some work in a second tab, then close it.
    await page.goto(`${BASE}/editor/#template=decision-flowchart`);
    await page.waitForSelector(".tf-compiled-layer:not([data-stale])", { timeout: 60_000 });
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("% my notes\n");
    await page.waitForTimeout(800);
    await page.getByTestId("tab-close").nth(1).click();
    await page.getByTestId("closed-button").click();
    await page.waitForSelector('[data-testid="closed-panel"]');
    await page.waitForTimeout(200);
    await shootAround(page, "recently-closed", ['[data-testid="closed-panel"]', '[data-testid="tab"]'], 12);
    await c.close();
  },
  async "read-only"() {
    const c = await context();
    const first = await c.newPage();
    await openTemplate(first);
    await first.locator(".cm-content").click();
    await first.keyboard.press("Control+Home");
    await first.keyboard.type("% the first window edits this\n");
    await first.waitForTimeout(800);
    const second = await c.newPage();
    await second.goto(`${BASE}/editor/`);
    await second.waitForSelector(".cm-editor");
    await second.locator('[data-testid="tab"]').first().click();
    await second.waitForSelector('[data-testid="lock-banner"]');
    await second.waitForTimeout(1500);
    await second.screenshot({ path: join(out, "read-only.png"), clip: { x: 0, y: 0, width: 1440, height: 460 } });
    await c.close();
  },
  async export() {
    const c = await context();
    const page = await c.newPage();
    await openTemplate(page);
    await page.getByTestId("export-button").click();
    await page.waitForSelector('[data-testid="export-panel"]');
    await page.locator('[data-testid="export-panel"]').screenshot({ path: join(out, "export.png") });
    await c.close();
  },
};

try {
  for (const [name, take] of Object.entries(shots)) {
    if (only.length && !only.includes(name)) continue;
    await take();
    console.log(`src/help/shots/${name}.png`);
  }
} finally {
  await browser.close();
  await server.close();
}
