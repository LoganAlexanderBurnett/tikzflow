// M3 step 6 (D66): TFM metrics and Type 1 outlines for the DVI converter.
// Uses the CTAN fonts in vendor/texmf (npm run fetch-engines); skipped without them.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildFontData } from "../src/engine/fontdata.ts";
import { parseTfm, scaleFixWord } from "../src/engine/tfm.ts";
import { parseType1 } from "../src/engine/type1.ts";

const texmf = join(import.meta.dirname, "..", "vendor", "texmf", "fonts");
const tfmPath = (n: string) => join(texmf, "tfm", "public", "cm", `${n}.tfm`);
const pfbPath = (n: string) => join(texmf, "type1", "public", "amsfonts", "cm", `${n}.pfb`);
const have = existsSync(tfmPath("cmr10")) && existsSync(pfbPath("cmr10"));

describe("TFM scaling", () => {
  it("scales a fix_word by the font size as TeX does", () => {
    // 0.5 at 10pt is 5pt; -0.25 at 10pt is -2.5pt.
    expect(scaleFixWord(0.5 * 2 ** 20, 10 * 65536)).toBe(5 * 65536);
    expect(scaleFixWord(-0.25 * 2 ** 20, 10 * 65536)).toBe(-2.5 * 65536);
  });
});

describe.skipIf(!have)("Computer Modern from CTAN", () => {
  it("reads cmr10's metrics", () => {
    const tfm = parseTfm(readFileSync(tfmPath("cmr10")));
    expect(tfm.designSize).toBe(10 * 2 ** 20);
    // "A" is 7.5pt wide at 10pt (cmr10.pl: CHARWD R 0.750002).
    const a = tfm.chars.get(65)!;
    expect(scaleFixWord(a.width, 10 * 65536) / 65536).toBeCloseTo(7.50002, 4);
    expect(tfm.chars.size).toBe(128);
  });

  it("reads cmr10's outlines, with TeX's encoding", () => {
    const font = parseType1(readFileSync(pfbPath("cmr10")));
    expect(font.unitsPerEm).toBe(1000);
    expect(font.encoding.get(65)).toBe("A");
    expect(font.encoding.get(11)).toBe("ff");
    expect(font.skipped).toEqual([]);
    const a = font.glyphs.get("A")!;
    expect(a).toMatch(/^M[\d. -]+/);
    // The outline stays inside the glyph's box: A is 750 units wide, 683 tall (its apex overshoots to 716).
    const nums = [...a.matchAll(/-?[\d.]+/g)].map((m) => Number(m[0]));
    const xs = nums.filter((_, i) => i % 2 === 0);
    const ys = nums.filter((_, i) => i % 2 === 1);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(760);
    expect(Math.max(...ys)).toBeLessThanOrEqual(720);
  });

  it("draws every glyph of the fonts a picture typically uses", () => {
    for (const n of ["cmr10", "cmmi10", "cmsy10", "cmex10", "cmbx10", "cmtt10", "cmr7", "cmmi7"]) {
      const { font, missing } = buildFontData(n, readFileSync(tfmPath(n)), readFileSync(pfbPath(n)));
      expect(missing, n).toEqual([]);
      expect(Object.keys(font.chars).length, n).toBeGreaterThan(100);
    }
  });
});
