// Saves the mockup's hand-drawn template thumbnails as SVG files for the home page until step 4
// compiles the real templates (D92). Needs `npm run dev` on port 5173.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const out = join(import.meta.dirname, "..", "..", "src", "site", "thumbs");
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage();
await page.goto(`${process.env.BASE ?? "http://localhost:5173"}/spike/design/index.html?d=a&view=home`);
await page.waitForSelector("html[data-ready='1']");
const thumbs = await page.$$eval(".tcard", (cards) =>
  cards.map((c) => ({ title: c.querySelector("strong")!.textContent!, svg: c.querySelector(".thumb svg")!.outerHTML })),
);
for (const t of thumbs) {
  const slug = t.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  writeFileSync(join(out, `${slug}.svg`), t.svg.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="150" ') + "\n");
  console.log(slug);
}
await browser.close();
