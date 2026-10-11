// Screenshots of the visual directions for the M5 step 1 checkpoint (D89).
// Needs `npm run dev` on port 5173 (or BASE=…). Writes spike/design/shots/<dir>-<view>-<theme>.png.
//   node spike/design/shoot.ts [a b c] [--only=home,editor,board]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const base = process.env.BASE ?? "http://localhost:5173";
const args = process.argv.slice(2);
const dirs = args.filter((a) => /^[abc]$/.test(a));
const only = args.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const out = join(import.meta.dirname, "shots");
mkdirSync(out, { recursive: true });

const shots: { view: string; theme: string; full: boolean }[] = [
  { view: "board", theme: "light", full: true },
  { view: "home", theme: "light", full: true },
  { view: "home", theme: "dark", full: false },
  { view: "editor", theme: "light", full: false },
  { view: "editor", theme: "dark", full: false },
];

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
for (const d of dirs.length ? dirs : ["a", "b", "c"]) {
  for (const s of shots) {
    if (only && !only.includes(s.view)) continue;
    await page.goto(`${base}/spike/design/index.html?d=${d}&view=${s.view}&theme=${s.theme}`);
    await page.waitForSelector("html[data-ready='1']");
    const file = join(out, `${d}-${s.view}-${s.theme}.png`);
    await page.screenshot({ path: file, fullPage: s.full });
    console.log(file);
  }
}
await browser.close();
