// What the Page panel holds (M3 steps 10 and 13, D71, D73): the imported
// preamble, the widths the user typed, and named presets of typed widths. All
// are kept per viewer in localStorage and none is part of the code in the code
// pane. Kept apart from page.ts so the store can depend on it without a cycle.

import { computed, signal } from "@preact/signals";
import { setPageSettings } from "../model/document.ts";
import type { PageSettings } from "../tikz/page.ts";
import { evalLength } from "../tikz/units.ts";

const PREAMBLE_KEY = "tikzflow.preamble";
const WIDTHS_KEY = "tikzflow.widths";
const PRESETS_KEY = "tikzflow.widthPresets";

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

/** A named pair of typed widths: the strings as typed ("3.4in"), either may be empty. */
export interface WidthPreset {
  name: string;
  text: string;
  column: string;
}

function readWidths(): { text: string; column: string } {
  try {
    const v = JSON.parse(read(WIDTHS_KEY) ?? "null") as { text?: unknown; column?: unknown } | null;
    return { text: typeof v?.text === "string" ? v.text : "", column: typeof v?.column === "string" ? v.column : "" };
  } catch {
    return { text: "", column: "" };
  }
}
function readPresets(): WidthPreset[] {
  try {
    const v = JSON.parse(read(PRESETS_KEY) ?? "[]") as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter((p): p is WidthPreset => !!p && typeof p.name === "string" && typeof p.text === "string" && typeof p.column === "string");
  } catch {
    return [];
  }
}

const initialWidths = readWidths();
/** The text and column widths as typed. Empty means "what the preamble says". */
export const typedText = signal(initialWidths.text);
export const typedColumn = signal(initialWidths.column);
export const widthPresets = signal<WidthPreset[]>(readPresets());

export function setTypedWidths(patch: { text?: string; column?: string }): void {
  if (patch.text !== undefined) typedText.value = patch.text;
  if (patch.column !== undefined) typedColumn.value = patch.column;
  write(WIDTHS_KEY, typedText.value || typedColumn.value ? JSON.stringify({ text: typedText.value, column: typedColumn.value }) : "");
}

/** Saves the typed widths under `name` (replacing a preset of that name). Returns false when there is nothing to save. */
export function savePreset(name: string): boolean {
  const n = name.trim();
  if (!n || (!typedText.value.trim() && !typedColumn.value.trim())) return false;
  const next = [...widthPresets.value.filter((p) => p.name !== n), { name: n, text: typedText.value.trim(), column: typedColumn.value.trim() }];
  widthPresets.value = next;
  write(PRESETS_KEY, JSON.stringify(next));
  return true;
}
export function applyPreset(name: string): void {
  const p = widthPresets.value.find((x) => x.name === name);
  if (p) setTypedWidths({ text: p.text, column: p.column });
}
export function deletePreset(name: string): void {
  const next = widthPresets.value.filter((p) => p.name !== name);
  widthPresets.value = next;
  write(PRESETS_KEY, next.length ? JSON.stringify(next) : "");
}

/** A typed width in pt, or null when it is empty or not a length. */
export function typedLength(s: string): number | null {
  const w = s.trim() ? evalLength(s) : null;
  return w !== null && w > 0 ? w : null;
}

/**
 * The settings every drawing of the picture reads. Evaluating this also hands them to the model
 * (`setPageSettings`), so whoever reads it, the layout and the planners that follow see the same page.
 */
export const pageSettings = computed<PageSettings>(() => {
  const s: PageSettings = { imported: importedPreamble.value, textWidth: typedLength(typedText.value), columnWidth: typedLength(typedColumn.value) };
  setPageSettings(s);
  return s;
});
