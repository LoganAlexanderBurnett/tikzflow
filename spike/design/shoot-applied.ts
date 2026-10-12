// Screenshots of direction A as applied (M5 steps 2 and 3, D92, D93), for the owner's review.
// Needs `npm run dev` on port 5173 (or BASE=…). Writes spike/design/shots/applied/.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";

const base = process.env.BASE ?? "http://localhost:5173";
const out = join(import.meta.dirname, "shots", "applied");
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "msedge" });

async function shot(name: string, path: string, opts: { scheme?: "light" | "dark"; width?: number; height?: number; full?: boolean; then?: (p: Page) => Promise<void> } = {}) {
  const page = await browser.newPage({ viewport: { width: opts.width ?? 1440, height: opts.height ?? 900 }, colorScheme: opts.scheme ?? "light" });
  await page.goto(base + path);
  await page.waitForLoadState("networkidle");
  // Lazy images in a full-page shot: load them all first.
  await page.evaluate(() => document.querySelectorAll("img[loading=lazy]").forEach((i) => ((i as HTMLImageElement).loading = "eager")));
  await page.evaluate(() => document.fonts.ready);
  if (opts.then) await opts.then(page);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, `${name}.png`), fullPage: opts.full ?? false });
  await page.close();
  console.log(name);
}

const selectBase = async (p: Page) => {
  await p.waitForSelector('g[data-node="base"]');
  await p.locator('g[data-node="base"]').first().click();
  await p.mouse.move(5, 5);
};

await shot("home-light", "/", { full: true });
await shot("home-dark", "/", { scheme: "dark" });
await shot("home-phone", "/", { width: 390, height: 844 });
await shot("editor-light", "/editor/", { then: selectBase });
await shot("editor-dark", "/editor/", { scheme: "dark", then: selectBase });
// The dev server answers unknown addresses with an empty 404; Cloudflare and `vite preview` serve this page.
await shot("not-found", "/404.html");
await browser.close();
