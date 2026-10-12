// The WCAG AA check of every visible text against what is behind it (M4 step 4, D82), shared by
// contrast.spec.ts (the editor) and help.spec.ts (the help pages, D99).
import type { Page } from "@playwright/test";

export interface Failure {
  text: string;
  ratio: number;
  need: number;
  fg: string;
  bg: string;
  where: string;
}

/** Every visible text that falls short of AA, worked out in the page. */
export async function lowContrast(page: Page): Promise<Failure[]> {
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
