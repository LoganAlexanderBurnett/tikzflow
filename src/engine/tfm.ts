// SPDX-License-Identifier: GPL-3.0-or-later
// TeX font metric (TFM) files: the widths TeX typeset with, which the DVI
// converter needs to advance along a line exactly as TeX did (D66).

export interface TfmMetrics {
  checksum: number;
  /** The design size as a fix_word (pt × 2^20). */
  designSize: number;
  /** Per character code: width, height and depth as fix_words (multiples of the design size × 2^20). */
  chars: Map<number, { width: number; height: number; depth: number }>;
}

/** Reads a TFM file. Throws on a file that isn't one. */
export function parseTfm(data: Uint8Array): TfmMetrics {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const half = (i: number) => view.getUint16(i * 2);
  const [lf, lh, bc, ec, nw, nh, nd, ni, nl, nk, ne, np] = Array.from({ length: 12 }, (_, i) => half(i)) as [number, number, number, number, number, number, number, number, number, number, number, number];
  if (lf * 4 > data.length || lf !== 6 + lh + (ec - bc + 1) + nw + nh + nd + ni + nl + nk + ne + np || lh < 2) {
    throw new Error("not a TFM file");
  }
  const word = (i: number) => view.getInt32(i * 4);
  const header = 6;
  const charInfo = header + lh;
  const widths = charInfo + (ec - bc + 1);
  const heights = widths + nw;
  const depths = heights + nh;
  const chars = new Map<number, { width: number; height: number; depth: number }>();
  for (let c = bc; c <= ec; c++) {
    const at = (charInfo + c - bc) * 4;
    const wi = data[at]!;
    if (wi === 0) continue; // no such character
    const hi = data[at + 1]! >> 4;
    const di = data[at + 1]! & 15;
    chars.set(c, { width: word(widths + wi), height: word(heights + hi), depth: word(depths + di) });
  }
  return { checksum: view.getUint32(header * 4), designSize: word(header + 1), chars };
}

/**
 * Scales fix_word `fw` by the font's size `s` (in DVI units), with TeX's own
 * integer arithmetic (dvitype §571, TeX §572), so a run of characters adds up
 * to exactly the width TeX gave it.
 */
export function scaleFixWord(fw: number, s: number): number {
  let z = s;
  let alpha = 16;
  while (z >= 0o40000000) {
    z = Math.trunc(z / 2);
    alpha += alpha;
  }
  const beta = Math.trunc(256 / alpha);
  alpha *= z;
  const b0 = (fw >>> 24) & 255;
  const b1 = (fw >>> 16) & 255;
  const b2 = (fw >>> 8) & 255;
  const b3 = fw & 255;
  let w = Math.trunc((Math.trunc((Math.trunc((b3 * z) / 256) + b2 * z) / 256) + b1 * z) / beta);
  if (b0 === 255) w -= alpha;
  return w;
}
