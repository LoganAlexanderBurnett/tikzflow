// SPDX-License-Identifier: GPL-3.0-or-later
// Regenerates the site's committed pictures (D89, D92, D95):
// - src/site/thumbs/<id>.svg: each template as TeX draws it, for the home page's gallery and the
//   editor's New menu (the Basic process one is also the home page's large picture);
// - public/favicon-32.png and public/apple-touch-icon.png: the logo (public/favicon.svg) as PNGs, for
//   browsers that don't take an SVG icon.
// Needs the engine (npm run fetch-engines -- engine) and Edge. test/templates.test.ts checks the SVGs are current.
//   npm run site:assets
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { TEMPLATES } from "../src/templates/catalog.ts";
import { engine } from "./lib/compile.ts";

const root = join(import.meta.dirname, "..");
const thumbs = join(root, "src", "site", "thumbs");
mkdirSync(thumbs, { recursive: true });

const tex = await engine();
for (const t of TEMPLATES) {
  const r = await tex.compile(readFileSync(join(root, "src", "templates", `${t.id}.tex`), "utf8"));
  if (!r.svg || r.errors.length) throw new Error(`The ${t.title} template didn't compile cleanly: ${r.errors.map((e) => e.message).join("; ")}`);
  writeFileSync(join(thumbs, `${t.id}.svg`), r.svg);
  console.log(`src/site/thumbs/${t.id}.svg`);
}

// The icons, drawn by the browser from the SVG (light colors: a PNG can't follow the theme).
const svg = readFileSync(join(root, "public", "favicon.svg"), "utf8").replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/, "");
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage();
for (const [file, size, pad, bg] of [["favicon-32.png", 32, 0, "transparent"], ["apple-touch-icon.png", 180, 22, "#f7f3ec"]] as const) {
  await page.setViewportSize({ width: size, height: size });
  const inner = size - 2 * pad;
  await page.setContent(`<body style="margin:0;background:${bg}"><div style="padding:${pad}px">${svg.replace("<svg ", `<svg width="${inner}" height="${inner}" `)}</div></body>`);
  await page.screenshot({ path: join(root, "public", file), omitBackground: bg === "transparent" });
  console.log(`public/${file}`);
}
await browser.close();
