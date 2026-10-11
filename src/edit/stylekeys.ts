// Styles named like one of TikZ's own keys (D83 item 3, D87): `step/.style`
// replaces TikZ's `step`, it doesn't sit beside it. The summary warns about
// each, with where it is defined.
import type { DocumentModel } from "../model/document.ts";
import type { PictureSyntax, Range } from "../model/syntax.ts";
import { tikzKeyClash } from "../tikz/tikzkeys.ts";
import { styleSites } from "./styles.ts";

export interface KeyNamedStyle {
  name: string;
  /** What TikZ's key of that name does ("the grid's spacing"). */
  what: string;
  /** TikZ's key needs a value, so the style on its own is an error in TeX. */
  needsValue: boolean;
  /** Where each definition of it is. */
  ranges: Range[];
}

/** The styles the picture sees that have the name of a TikZ key. */
export function keyNamedStyles(doc: DocumentModel, pic: PictureSyntax): KeyNamedStyle[] {
  const out = new Map<string, KeyNamedStyle>();
  for (const site of styleSites(doc, pic)) {
    for (const d of site.defs) {
      const clash = tikzKeyClash(d.name);
      if (!clash) continue;
      const known = out.get(d.name) ?? { name: d.name, ...clash, ranges: [] };
      known.ranges.push({ from: d.from, to: d.to });
      out.set(d.name, known);
    }
  }
  return [...out.values()];
}

/** What the summary says about one. */
export function keyNamedMessage(s: KeyNamedStyle): string {
  const base = `TikZ's own ${s.name} key (${s.what}) is replaced by this style, so everything that uses ${s.name} gets the style instead`;
  return s.needsValue ? `${base}, and TeX stops with an error wherever it is used without a value. Rename the style, for example to "${s.name} box".` : `${base}. Rename the style, for example to "${s.name} box".`;
}
