// Text contrast in the app's own interface (M4 step 4, the owner's report on
// the TeX error banner): every visible piece of text in the panels, banners,
// popovers and menus must reach WCAG AA against what is behind it (4.5:1, or
// 3:1 for large text), in the light and the dark theme. The picture itself
// (user content on the white canvas) and disabled controls are left out, as
// WCAG does.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "./base.ts";

const tag = (JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "engine", "release.json"), "utf8")) as { tag: string }).tag;
const haveEngine = existsSync(join(import.meta.dirname, "..", "..", "vendor", "engine", tag, "index.json"));

async function setCode(page: Page, text: string) {
  await page.evaluate((t) => {
    const w = window as unknown as { tikzflow: { store: { replaceDocument: (t: string, n: null, e: string) => void } } };
    w.tikzflow.store.replaceDocument(t, null, "utf-8");
  }, text);
}

interface Failure {
  text: string;
  ratio: number;
  need: number;
  fg: string;
  bg: string;
  where: string;
}

/** Every visible text that falls short of AA, worked out in the page. */
async function lowContrast(page: Page): Promise<Failure[]> {
  return page.evaluate(() => {
    type RGBA = [number, number, number, number];
    const parse = (c: string): RGBA => {
      const m = /rgba?\(([^)]+)\)/.exec(c);
      if (!m) return [0, 0, 0, 0];
      const p = m[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
      return [p[0]!, p[1]!, p[2]!, p[3] ?? 1];
    };
    const over = (top: RGBA, under: RGBA): RGBA => {
      const a = top[3];
      return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1];
    };
    const lum = (c: RGBA) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const background = (el: Element): RGBA => {
      const chain: Element[] = [];
      for (let e: Element | null = el; e; e = e.parentElement) chain.push(e);
      let bg: RGBA = [255, 255, 255, 1];
      for (const e of chain.reverse()) {
        const c = parse(getComputedStyle(e).backgroundColor);
        if (c[3] > 0) bg = over(c, bg);
      }
      return bg;
    };
    const out: Array<{ text: string; ratio: number; need: number; fg: string; bg: string; where: string }> = [];
    const all = document.querySelectorAll("body *");
    for (const el of all) {
      if (el.closest("svg.tf-canvas, .tf-compiled")) continue;
      if (el.closest(":disabled, [aria-disabled='true']")) continue;
      const own = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim()).map((n) => n.textContent!.trim()).join(" ");
      if (!own) continue;
      const style = getComputedStyle(el);
      if (style.visibility !== "visible" || style.display === "none" || !el.getClientRects().length) continue;
      let hidden = false;
      for (let e: Element | null = el; e; e = e.parentElement) if (Number(getComputedStyle(e).opacity) < 0.99) hidden = true;
      if (hidden) continue;
      const bg = background(el);
      const fg = over(parse(style.color), bg);
      const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
      const ratio = (a! + 0.05) / (b! + 0.05);
      const size = parseFloat(style.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
      const need = large ? 3 : 4.5;
      if (ratio + 1e-3 < need) {
        const id = el.closest("[data-testid]")?.getAttribute("data-testid") ?? el.className.toString();
        out.push({ text: own.slice(0, 40), ratio: Math.round(ratio * 100) / 100, need, fg: style.color, bg: `rgb(${bg.slice(0, 3).map(Math.round).join(", ")})`, where: id });
      }
    }
    return out;
  });
}

const WARNED = [
  "\\begin{tikzpicture}",
  "\\node[draw] (a) at (0,0) {A};",
  "\\node[draw] (b) at (0,-3) {B};",
  "\\draw[->] (a) -- node[above] {x} (b);",
  "\\end{tikzpicture}",
  "",
].join("\n");

for (const scheme of ["light", "dark"] as const) {
  test.describe(`text contrast, ${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test("panels, menus and popovers reach WCAG AA", async ({ page }) => {
      await page.goto("/");
      await page.getByTestId("preview-toggle").uncheck();
      await setCode(page, WARNED);
      const failures: Array<Failure & { state: string }> = [];
      const check = async (state: string) => failures.push(...(await lowContrast(page)).map((f) => ({ ...f, state })));
      await check("start");
      // A node selected: the properties panel and its groups section.
      await page.locator('g[data-node="a"]').click();
      await check("node selected");
      // The marker on a label its line runs through, and its fixes.
      await page.locator("[data-label-warning]").first().click();
      await check("label fixes");
      await page.keyboard.press("Escape");
      // The edge menu.
      const p = await page.locator("path[data-edge]").first().evaluate((el) => {
        const path = el as SVGPathElement;
        const pt = path.getPointAtLength(path.getTotalLength() * 0.3);
        const s = new DOMPoint(pt.x, pt.y).matrixTransform(path.getScreenCTM()!);
        return { x: s.x, y: s.y };
      });
      await page.mouse.click(p.x, p.y, { button: "right" });
      await expect(page.getByTestId("edge-menu")).toBeVisible();
      await check("edge menu");
      await page.keyboard.press("Escape");
      for (const panel of ["layout", "page", "share", "export", "import"]) {
        await page.getByTestId(`${panel}-button`).click();
        await expect(page.getByTestId(`${panel}-panel`)).toBeVisible();
        await check(`${panel} panel`);
        if (panel === "import") {
          // The panel with something to say: an error, then the result with its notes (M4 step 5).
          await page.getByTestId("import-source").fill("digraph {\n a -> ;\n}");
          await page.getByTestId("import-run").click();
          await expect(page.getByTestId("import-error")).toBeVisible();
          await check("import error");
          await page.getByTestId("import-source").fill("digraph { a [shape=weirdo]; a -> b [label=<x>] }");
          await page.getByTestId("import-run").click();
          await expect(page.getByTestId("import-notes")).toBeVisible();
          await check("import result");
          await page.getByTestId("import-close").click();
          await setCode(page, WARNED);
          continue;
        }
        await page.getByTestId(`${panel}-button`).click();
      }
      // A colorblind view: its note over the canvas (M4 step 6).
      await page.getByTestId("vision-select").selectOption("deuteranopia");
      await expect(page.getByTestId("vision-badge")).toBeVisible();
      await check("colorblind view");
      await page.getByTestId("vision-normal").click();
      // Text that is hard to read: the summary's list, and the note in the properties panel.
      await setCode(page, "\\begin{tikzpicture}\n\\node[draw, fill=yellow, text=white] (pale) at (0,0) {Pale};\n\\end{tikzpicture}\n");
      await expect(page.getByTestId("contrast-count")).toBeVisible();
      await page.getByTestId("contrast-count").click();
      await expect(page.getByTestId("contrast-list")).toBeVisible();
      await check("low contrast list");
      await page.locator('g[data-node="pale"]').click();
      await expect(page.getByTestId("contrast-note")).toBeVisible();
      await check("low contrast note");
      // A style named like a TikZ key: the summary's button and list (M4 step 7, D87).
      await setCode(page, "\\tikzset{step/.style={draw}}\n\\begin{tikzpicture}\n\\node[step] (a) at (0,0) {A};\n\\end{tikzpicture}\n");
      await expect(page.getByTestId("key-style-count")).toBeVisible();
      await page.getByTestId("key-style-count").click();
      await expect(page.getByTestId("key-style-list")).toBeVisible();
      await check("style named like a key");
      await setCode(page, WARNED);
      // A lane selected: its card, and the groups section for a node in it (D81).
      await setCode(page, readFileSync(join(import.meta.dirname, "..", "..", "corpus", "self-swimlanes.tex"), "utf8"));
      await page.locator('g[data-node="manager"]').click({ position: { x: 8, y: 8 } });
      await expect(page.getByTestId("box-card")).toBeVisible();
      await check("lane selected");
      await page.locator('g[data-node="query"]').click();
      await expect(page.getByTestId("group-actions")).toBeVisible();
      await check("node in a lane");
      expect(failures).toEqual([]);
    });

    test("the TeX error banner and its details reach WCAG AA", async ({ page }) => {
      test.skip(!haveEngine, "needs the engine: npm run fetch-engines -- engine");
      await page.goto("/");
      await setCode(page, WARNED.replace("{B}", "{\\oops B}"));
      await expect(page.getByTestId("tex-banner")).toBeVisible({ timeout: 15_000 });
      const failures = await lowContrast(page);
      await page.getByTestId("preview-state").click();
      await expect(page.getByTestId("preview-details")).toBeVisible();
      failures.push(...(await lowContrast(page)));
      expect(failures).toEqual([]);
    });
  });
}
