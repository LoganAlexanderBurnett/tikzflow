// SPDX-License-Identifier: GPL-3.0-or-later
// The per-font file the DVI converter reads (D66): a TFM's metrics and the
// Type 1 outlines of the same font, by character code. Built in CI by
// engine/build/fonts.ts and served gzipped as fonts/<name>.json.gz.

import { parseTfm } from "./tfm.ts";
import { parseType1 } from "./type1.ts";

export interface FontData {
  name: string;
  checksum: number;
  /** Design size as a fix_word (pt × 2^20). */
  design: number;
  /** Font units per em of the outlines. */
  upem: number;
  /** Character code → [width, height, depth] as fix_words, and the outline in font units (y up), if the font has one. */
  chars: Record<string, [number, number, number, string?]>;
}

/** Combines a TFM file and, when there is one, the Type 1 font with the same name. */
export function buildFontData(name: string, tfm: Uint8Array, pfb?: Uint8Array): { font: FontData; missing: number[] } {
  const metrics = parseTfm(tfm);
  const outlines = pfb ? parseType1(pfb) : null;
  const chars: FontData["chars"] = {};
  const missing: number[] = [];
  for (const [code, m] of metrics.chars) {
    const glyph = outlines?.encoding.get(code);
    const d = glyph !== undefined ? outlines!.glyphs.get(glyph) : undefined;
    if (outlines && d === undefined) missing.push(code);
    chars[code] = d === undefined ? [m.width, m.height, m.depth] : [m.width, m.height, m.depth, d];
  }
  return {
    font: { name, checksum: metrics.checksum, design: metrics.designSize, upem: outlines?.unitsPerEm ?? 1000, chars },
    missing,
  };
}
