// The page the figure goes on (M3 step 10, D71): the preamble of the user's
// paper, imported for the TeX preview, and the guide on the canvas that shows
// a column's width. Both are kept per viewer in localStorage; neither is part
// of the code in the code pane.

import { computed, signal } from "@preact/signals";
import { type PageGeometry, pageGeometry } from "../tikz/page.ts";
import { evalLength } from "../tikz/units.ts";
import { baseLayout, currentPicture, doc, text } from "./store.ts";

const PREAMBLE_KEY = "tikzflow.preamble";
const GUIDE_KEY = "tikzflow.guide";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Private windows may refuse; the choice then lasts for this visit.
  }
}

/** The preamble of the paper, as pasted. Used when the code has no preamble of its own. */
export const importedPreamble = signal(read(PREAMBLE_KEY) ?? "");
export function setImportedPreamble(t: string): void {
  importedPreamble.value = t;
  write(PREAMBLE_KEY, t);
}

export type GuideWidth = "column" | "text" | "custom";
interface GuideSettings {
  on: boolean;
  width: GuideWidth;
  custom: string;
}
function readGuide(): GuideSettings {
  try {
    const v = JSON.parse(read(GUIDE_KEY) ?? "null") as Partial<GuideSettings> | null;
    return { on: v?.on !== false, width: v?.width === "text" || v?.width === "custom" ? v.width : "column", custom: typeof v?.custom === "string" ? v.custom : "" };
  } catch {
    return { on: true, width: "column", custom: "" };
  }
}
const initial = readGuide();
export const guideOn = signal(initial.on);
export const guideWidth = signal<GuideWidth>(initial.width);
export const customWidth = signal(initial.custom);
export function setGuide(patch: Partial<GuideSettings>): void {
  if (patch.on !== undefined) guideOn.value = patch.on;
  if (patch.width !== undefined) guideWidth.value = patch.width;
  if (patch.custom !== undefined) customWidth.value = patch.custom;
  write(GUIDE_KEY, JSON.stringify({ on: guideOn.value, width: guideWidth.value, custom: customWidth.value }));
}

/** The preamble the page widths and the TeX preview use: the code's own when it has one, else the imported one. */
export const pagePreamble = computed<{ text: string; from: "code" | "imported" } | null>(() => {
  const t = text.value;
  const pic = doc.value.syntax.pictures[currentPicture.value];
  const cls = /\\documentclass/.exec(t);
  const begin = cls ? t.indexOf("\\begin{document}", cls.index) : -1;
  if (cls && begin > cls.index && (!pic || begin < pic.from)) return { text: t.slice(0, begin), from: "code" };
  const imported = importedPreamble.value;
  return imported.trim() ? { text: imported, from: "imported" } : null;
});

export const pageInfo = computed<PageGeometry | null>(() => {
  const p = pagePreamble.value;
  return p ? pageGeometry(p.text) : null;
});

/** The width the guide shows, pt, and what it is called; null when there is none or it is off. */
export const guide = computed<{ width: number; name: string } | null>(() => {
  if (!guideOn.value) return null;
  const mode = guideWidth.value;
  if (mode === "custom") {
    const w = evalLength(customWidth.value);
    return w !== null && w > 0 ? { width: w, name: "custom width" } : null;
  }
  const g = pageInfo.value;
  const w = mode === "column" ? g?.columnWidth : g?.textWidth;
  return w ? { width: w, name: mode === "column" ? "\\columnwidth" : "\\textwidth" } : null;
});

/** The figure's width on the page, pt (the native layout's box). */
export const figureWidth = computed<number | null>(() => {
  const b = baseLayout.value?.bounds;
  return b && Number.isFinite(b.maxX - b.minX) && b.maxX > b.minX ? b.maxX - b.minX : null;
});
