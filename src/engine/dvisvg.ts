// SPDX-License-Identifier: GPL-3.0-or-later
// DVI to SVG for the accurate preview (D66). TeX writes a DVI file with pgf's
// SVG driver (our pgfsys-tikzflow.def, built on pgfsys-dvisvgm.def), so the
// picture itself arrives as SVG fragments in `dvisvgm:raw` specials; this
// file follows dvisvgm's rules for those specials and draws the characters
// and rules TeX set around them. Characters are drawn as paths from the fonts'
// Type 1 outlines, so the SVG needs no web fonts and can be exported as it is.
//
// Coordinates are in bp (1/72 in) with y pointing down, as dvisvgm's; the
// driver scales pgf's TeX points by 72/72.27 itself.

import type { FontData } from "./fontdata.ts";
import { scaleFixWord } from "./tfm.ts";

/** A font the DVI file uses: its name and size, from its font definition. */
export interface DviFont {
  name: string;
  /** Scaled size and design size in DVI units. */
  scale: number;
  design: number;
  checksum: number;
}

/** Where the outermost TikZ picture sits in the SVG (from the driver's `tikzflow:picture` special). */
export interface PicturePlacement {
  /** The picture's bounding box in SVG units (bp, y down). */
  box: { x: number; y: number; width: number; height: number };
  /** The SVG point of TikZ's origin (0,0). */
  origin: { x: number; y: number };
  /** SVG units per TeX point (72/72.27); TikZ's y axis points the other way. */
  scale: number;
  /** The same box in TikZ's own points: [minx, miny, maxx, maxy]. */
  tikz: [number, number, number, number];
}

export interface DviSvg {
  /** A complete SVG document. */
  svg: string;
  /** Its viewBox, in bp. */
  viewBox: { x: number; y: number; width: number; height: number };
  picture: PicturePlacement | null;
  /** Fonts the page used that have no outlines here: their characters aren't drawn. */
  missingFonts: string[];
  /** Specials that aren't for the SVG driver (`papersize=…`, `ps: …`), by prefix and count. */
  ignoredSpecials: Record<string, number>;
  /** Characters drawn. */
  glyphs: number;
}

export interface DviSvgOptions {
  /** Prefix for element ids, so several SVGs can share a page. */
  idPrefix?: string;
  /** Extra space around the picture's bounding box, in bp (strokes on the box's edge reach outside it). */
  pad?: number;
}

const BP_PER_PT = 72 / 72.27;

class Reader {
  pos = 0;
  readonly data: Uint8Array;
  constructor(data: Uint8Array) {
    this.data = data;
  }
  u(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 256 + this.data[this.pos++]!;
    return v;
  }
  s(n: number): number {
    const v = this.u(n);
    const top = 2 ** (8 * n - 1);
    return v >= top ? v - 2 * top : v;
  }
  bytes(n: number): Uint8Array {
    const b = this.data.subarray(this.pos, this.pos + n);
    this.pos += n;
    return b;
  }
}

function readFontDef(r: Reader, k: number): DviFont & { id: number } {
  const id = r.u(k);
  const checksum = r.u(4);
  const scale = r.s(4);
  const design = r.s(4);
  const a = r.u(1);
  const l = r.u(1);
  const name = new TextDecoder("latin1").decode(r.bytes(a + l)).slice(a);
  return { id, name, scale, design, checksum };
}

/** The fonts a DVI file defines, read from its postamble (or, for a file cut short, its pages). */
export function dviFonts(dvi: Uint8Array): DviFont[] {
  const fonts = new Map<number, DviFont>();
  const r = new Reader(dvi);
  // Walk every command; font definitions may sit on pages and in the postamble.
  try {
    while (r.pos < dvi.length) {
      const op = r.u(1);
      if (op >= 243 && op <= 246) {
        const f = readFontDef(r, op - 242);
        if (!fonts.has(f.id)) fonts.set(f.id, { name: f.name, scale: f.scale, design: f.design, checksum: f.checksum });
      } else if (!skipCommand(r, op)) break;
    }
  } catch {
    // A truncated file: keep what was read.
  }
  return [...fonts.values()];
}

/** Skips the parameters of command `op`. False at the end of the file's commands. */
function skipCommand(r: Reader, op: number): boolean {
  if (op < 128 || (op >= 171 && op <= 234) || op === 138 || op === 140 || op === 141 || op === 142) return true;
  if (op >= 128 && op <= 131) r.pos += op - 127;
  else if (op >= 133 && op <= 136) r.pos += op - 132;
  else if (op === 132 || op === 137) r.pos += 8;
  else if (op === 139) r.pos += 44;
  else if (op >= 143 && op <= 146) r.pos += op - 142;
  else if (op === 147 || op === 152 || op === 161 || op === 166) return true;
  else if (op >= 148 && op <= 151) r.pos += op - 147;
  else if (op >= 153 && op <= 156) r.pos += op - 152;
  else if (op >= 157 && op <= 160) r.pos += op - 156;
  else if (op >= 162 && op <= 165) r.pos += op - 161;
  else if (op >= 167 && op <= 170) r.pos += op - 166;
  else if (op >= 235 && op <= 238) r.pos += op - 234;
  else if (op >= 239 && op <= 242) r.pos += r.u(op - 238);
  else if (op === 247) {
    r.pos += 13;
    r.pos += r.u(1);
  } else if (op === 248) r.pos += 28;
  else return false; // post_post, padding or junk
  return true;
}

/** An SVG colour for a dvips colour special's value: `rgb 1 0 0`, `gray 0.5`, `cmyk …`, `hsb …` or a dvips name. */
export function specialColor(spec: string): string {
  const parts = spec.trim().split(/\s+/);
  const n = parts.slice(1).map(Number);
  const hex = (r: number, g: number, b: number) =>
    "#" + [r, g, b].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("");
  if (parts[0] === "tikzflow" && parts[1] === INHERIT) return INHERIT;
  switch (parts[0]?.toLowerCase()) {
    case "rgb":
      return hex(n[0] ?? 0, n[1] ?? 0, n[2] ?? 0);
    case "gray":
      return hex(n[0] ?? 0, n[0] ?? 0, n[0] ?? 0);
    case "cmyk": {
      const [c = 0, m = 0, y = 0, k = 0] = n;
      return hex((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k));
    }
    case "hsb": {
      const [h = 0, s = 0, v = 0] = n;
      const i = Math.floor(h * 6) % 6;
      const f = h * 6 - Math.floor(h * 6);
      const p = v * (1 - s);
      const q = v * (1 - f * s);
      const t = v * (1 - (1 - f) * s);
      const rgb = [
        [v, t, p],
        [q, v, p],
        [p, v, t],
        [p, q, v],
        [t, p, v],
        [v, p, q],
      ][i]!;
      return hex(rgb[0]!, rgb[1]!, rgb[2]!);
    }
    default:
      return DVIPS_NAMES[parts[0] ?? ""] ?? "#000000";
  }
}

const DVIPS_NAMES: Record<string, string> = {
  Black: "#000000",
  White: "#ffffff",
  Red: "#ff0000",
  Green: "#00ff00",
  Blue: "#0000ff",
  Cyan: "#00ffff",
  Magenta: "#ff00ff",
  Yellow: "#ffff00",
};

/**
 * The colour of text that takes the colour of the SVG groups around it: the
 * bottom of the colour stack, and what our driver pushes at the start of a
 * picture (`color push tikzflow inherit`). Any colour a special sets, black
 * included, is written on the text (dvisvgm writes black as nothing, D66).
 */
const INHERIT = "inherit";

/**
 * Converts the first page of a DVI file to SVG. `fonts` gives the converter
 * data of each font by name (see dviFonts for the names a file needs); fonts
 * it doesn't have are listed in `missingFonts` and their characters skipped.
 */
export function dviToSvg(dvi: Uint8Array, fonts: (name: string) => FontData | undefined, options: DviSvgOptions = {}): DviSvg {
  const prefix = options.idPrefix ?? "tf";
  const pad = options.pad ?? 2;
  const r = new Reader(dvi);
  if (r.u(1) !== 247) throw new Error("not a DVI file");
  r.u(1); // version
  const num = r.u(4);
  const den = r.u(4);
  const mag = r.u(4);
  r.pos += r.u(1);
  // DVI units (num/den × 10^-7 m) to bp.
  const unit = (((num / den) * (mag / 1000)) / 254000) * 72;
  const fmt = (v: number) => {
    const s = (Math.round(v * 1000) / 1000).toString();
    return s === "-0" ? "0" : s;
  };

  interface LoadedFont {
    index: number;
    data: FontData | undefined;
    def: DviFont;
    /** Character advances in DVI units. */
    widths: Map<number, number>;
  }
  const defined = new Map<number, LoadedFont>();
  const missing = new Set<string>();
  const usedGlyphs = new Map<string, string>(); // id → path data
  let fontCount = 0;
  const define = (f: DviFont & { id: number }) => {
    if (defined.has(f.id)) return;
    const data = fonts(f.name);
    const widths = new Map<number, number>();
    if (data) for (const [code, m] of Object.entries(data.chars)) widths.set(Number(code), scaleFixWord(m[0], f.scale));
    defined.set(f.id, { index: fontCount++, data, def: f, widths });
  };

  const body: string[] = [];
  const defs: string[] = [];
  const rawSets = new Map<string, Array<{ kind: "raw" | "rawdef"; text: string }>>();
  let rawSet: { name: string; items: Array<{ kind: "raw" | "rawdef"; text: string }> } | null = null;
  const putDefs = new Set<string>();
  const colors: string[] = [INHERIT];
  const ignored: Record<string, number> = {};
  let picture: PicturePlacement | null = null;
  let glyphs = 0;

  let h = 0;
  let v = 0;
  let w = 0;
  let x = 0;
  let y = 0;
  let z = 0;
  const stack: Array<[number, number, number, number, number, number]> = [];
  let font: LoadedFont | undefined;
  let page = 0;

  const color = () => colors[colors.length - 1]!;
  const fillAttr = () => (color() === INHERIT ? "" : ` fill="${color()}"`);

  const setChar = (c: number, advance: boolean) => {
    if (!font) return;
    const m = font.data?.chars[c];
    const d = m?.[3];
    if (d !== undefined) {
      const id = `${prefix}g${font.index}-${c}`;
      if (!usedGlyphs.has(id)) usedGlyphs.set(id, d);
      const k = (font.def.scale * unit) / font.data!.upem;
      body.push(`<use xlink:href="#${id}" transform="matrix(${fmt(k)} 0 0 ${fmt(-k)} ${fmt(h * unit)} ${fmt(v * unit)})"${fillAttr()}/>`);
      glyphs++;
    } else if (!font.data) missing.add(font.def.name);
    if (advance) h += font.widths.get(c) ?? 0;
  };
  const setRule = (a: number, b: number, advance: boolean) => {
    if (a > 0 && b > 0) {
      body.push(`<rect x="${fmt(h * unit)}" y="${fmt((v - a) * unit)}" width="${fmt(b * unit)}" height="${fmt(a * unit)}"${fillAttr()} stroke="none"/>`);
    }
    if (advance) h += b;
  };
  const expand = (text: string) =>
    text.replace(/\{\?(x|y|nl|color|matrix)\}/g, (_, k: string) =>
      k === "x" ? fmt(h * unit) : k === "y" ? fmt(v * unit) : k === "nl" ? "\n" : k === "color" ? (color() === INHERIT ? "#000000" : color()) : "1 0 0 1 0 0",
    );
  const raw = (kind: "raw" | "rawdef", text: string) => {
    const t = expand(text);
    if (rawSet) rawSet.items.push({ kind, text: t });
    else if (kind === "raw") body.push(t);
    else defs.push(t);
  };
  const special = (s: string) => {
    if (s.startsWith("dvisvgm:")) {
      // graphics' dvisvgm.def writes `dvisvgm: raw` for images, with a space.
      const m = /^dvisvgm:\s*(\w+)\s?([\s\S]*)$/.exec(s);
      const cmd = m?.[1] ?? "";
      const arg = m?.[2] ?? "";
      if (cmd === "raw" || cmd === "rawdef") raw(cmd, arg);
      else if (cmd === "rawset") rawSet = { name: arg.trim(), items: [] };
      else if (cmd === "endrawset") {
        if (rawSet) rawSets.set(rawSet.name, rawSet.items);
        rawSet = null;
      } else if (cmd === "rawput") {
        for (const item of rawSets.get(arg.trim()) ?? []) {
          if (item.kind === "raw") body.push(item.text);
          else if (!putDefs.has(item.text)) {
            putDefs.add(item.text);
            defs.push(item.text);
          }
        }
      } else if (cmd !== "bbox") ignored[`dvisvgm:${cmd}`] = (ignored[`dvisvgm:${cmd}`] ?? 0) + 1;
      return;
    }
    if (s.startsWith("color ")) {
      const rest = s.slice(6).trim();
      if (rest.startsWith("push")) colors.push(specialColor(rest.slice(4)));
      else if (rest === "pop") {
        if (colors.length > 1) colors.pop();
      } else colors[colors.length - 1] = specialColor(rest);
      return;
    }
    if (s.startsWith("tikzflow:")) {
      const [cmd, ...args] = s.slice(9).trim().split(/\s+/);
      if (cmd === "picture" && !picture) {
        // At the picture box's lower left corner: its box in TikZ points.
        const [minx = 0, miny = 0, width = 0, height = 0] = args.map(Number);
        const llx = h * unit;
        const lly = v * unit;
        picture = {
          box: { x: llx, y: lly - height * BP_PER_PT, width: width * BP_PER_PT, height: height * BP_PER_PT },
          origin: { x: llx - minx * BP_PER_PT, y: lly + miny * BP_PER_PT },
          scale: BP_PER_PT,
          tikz: [minx, miny, minx + width, miny + height],
        };
      } else if (cmd === "begin" || cmd === "end") {
        body.push(`<g data-tf-${cmd}="${(args[0] ?? "").replace(/[^\w-]/g, "")}"/>`);
      }
      return;
    }
    const key = /^[\w-]+:?/.exec(s)?.[0] ?? s.slice(0, 12);
    ignored[key] = (ignored[key] ?? 0) + 1;
  };

  // Lay out the first page.
  loop: while (r.pos < dvi.length) {
    const op = r.u(1);
    if (op < 128) {
      if (page) setChar(op, true);
      continue;
    }
    switch (true) {
      case op >= 128 && op <= 131:
        setChar(r.u(op - 127), true);
        break;
      case op === 132: {
        const a = r.s(4);
        setRule(a, r.s(4), true);
        break;
      }
      case op >= 133 && op <= 136:
        setChar(r.u(op - 132), false);
        break;
      case op === 137: {
        const a = r.s(4);
        setRule(a, r.s(4), false);
        break;
      }
      case op === 138:
        break;
      case op === 139:
        r.pos += 44;
        page++;
        h = v = w = x = y = z = 0;
        stack.length = 0;
        break;
      case op === 140:
        break loop; // end of the first page
      case op === 141:
        stack.push([h, v, w, x, y, z]);
        break;
      case op === 142:
        [h, v, w, x, y, z] = stack.pop() ?? [h, v, w, x, y, z];
        break;
      case op >= 143 && op <= 146:
        h += r.s(op - 142);
        break;
      case op === 147:
        h += w;
        break;
      case op >= 148 && op <= 151:
        w = r.s(op - 147);
        h += w;
        break;
      case op === 152:
        h += x;
        break;
      case op >= 153 && op <= 156:
        x = r.s(op - 152);
        h += x;
        break;
      case op >= 157 && op <= 160:
        v += r.s(op - 156);
        break;
      case op === 161:
        v += y;
        break;
      case op >= 162 && op <= 165:
        y = r.s(op - 161);
        v += y;
        break;
      case op === 166:
        v += z;
        break;
      case op >= 167 && op <= 170:
        z = r.s(op - 166);
        v += z;
        break;
      case op >= 171 && op <= 234:
        font = defined.get(op - 171);
        break;
      case op >= 235 && op <= 238:
        font = defined.get(r.u(op - 234));
        break;
      case op >= 239 && op <= 242: {
        const k = r.u(op - 238);
        special(new TextDecoder("latin1").decode(r.bytes(k)));
        break;
      }
      case op >= 243 && op <= 246:
        define(readFontDef(r, op - 242));
        break;
      default:
        break loop; // the postamble, or a file cut short
    }
  }

  for (const [id, d] of usedGlyphs) defs.unshift(`<path id="${id}" d="${d}" stroke="none"/>`);
  const box = (picture as PicturePlacement | null)?.box ?? { x: 0, y: 0, width: 0, height: 0 };
  const viewBox = { x: box.x - pad, y: box.y - pad, width: box.width + 2 * pad, height: box.height + 2 * pad };
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" ` +
    `width="${fmt(viewBox.width)}pt" height="${fmt(viewBox.height)}pt" ` +
    `viewBox="${fmt(viewBox.x)} ${fmt(viewBox.y)} ${fmt(viewBox.width)} ${fmt(viewBox.height)}" overflow="visible">` +
    `<defs>${defs.join("")}</defs>${body.join("")}</svg>`;
  return { svg, viewBox, picture, missingFonts: [...missing], ignoredSpecials: ignored, glyphs };
}
