// The templates' code, bundled with the page that opens them (D95). See catalog.ts.
import { BLANK_ID, TEMPLATES, type TemplateInfo } from "./catalog.ts";

export { BLANK_ID, TEMPLATES, type TemplateInfo };

const texts = import.meta.glob("./*.tex", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** A template's code (or the blank diagram's, for BLANK_ID), or undefined for an unknown id. */
export function templateText(id: string): string | undefined {
  return /^[a-z0-9-]+$/.test(id) ? texts[`./${id}.tex`] : undefined;
}

/** A template's catalog entry. */
export function templateInfo(id: string): TemplateInfo | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

const pristine = new Set(Object.values(texts));

/** The text is a template (or the blank diagram) exactly as it comes: nothing to keep or continue. */
export function isPristine(text: string): boolean {
  return pristine.has(text);
}
