// SPDX-License-Identifier: GPL-3.0-or-later
// The SVG and PNG exports (M3 step 11, D72): TeX's SVG made fit to leave the
// app (the app's own markers taken out, nesting repaired if TeX stopped early,
// a margin added), and drawn to a PNG at a chosen resolution.

import { parseXml, type XmlNode } from "./svg2pdf.ts";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function serialize(n: XmlNode): string {
  const attrs = Object.entries(n.attrs)
    .map(([k, v]) => ` ${k}="${esc(v)}"`)
    .join("");
  return n.children.length ? `<${n.tag}${attrs}>${n.children.map(serialize).join("")}</${n.tag}>` : `<${n.tag}${attrs}/>`;
}

/** Drops the markers the app puts in TeX's output to find locked blocks (`data-tf-*`) and the groups that only hold them. */
function withoutMarkers(n: XmlNode): XmlNode | null {
  if (n.tag === "g" && Object.keys(n.attrs).every((k) => k.startsWith("data-tf-")) && !n.children.length) return null;
  const attrs = Object.fromEntries(Object.entries(n.attrs).filter(([k]) => !k.startsWith("data-tf-")));
  return { tag: n.tag, attrs, children: n.children.flatMap((c) => withoutMarkers(c) ?? []) };
}

export interface TidySvg {
  svg: string;
  /** Page size in bp (the viewBox, margin included). */
  width: number;
  height: number;
  /** What had to be repaired in TeX's output. */
  repairs: string[];
}

/** TeX's SVG ready to save: markers out, tags nested, `margin` bp of space around the picture. */
export function tidySvg(svg: string, margin = 0): TidySvg {
  const repairs: string[] = [];
  const root = parseXml(svg, (m) => repairs.push(m));
  const clean = withoutMarkers(root)!;
  const vb = (clean.attrs.viewBox ?? "").split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || vb.some((v) => !Number.isFinite(v)) || !(vb[2]! > 0) || !(vb[3]! > 0)) throw new Error("TeX's SVG has no usable viewBox.");
  const [x, y, w, h] = vb as [number, number, number, number];
  const m = Math.max(0, margin);
  clean.attrs.viewBox = `${x - m} ${y - m} ${w + 2 * m} ${h + 2 * m}`;
  // CSS pt is bp, the viewBox's unit, so the size in pt is the viewBox's.
  clean.attrs.width = `${w + 2 * m}pt`;
  clean.attrs.height = `${h + 2 * m}pt`;
  clean.attrs.xmlns = "http://www.w3.org/2000/svg";
  clean.attrs["xmlns:xlink"] = "http://www.w3.org/1999/xlink";
  return { svg: `<?xml version="1.0" encoding="UTF-8"?>\n${serialize(clean)}\n`, width: w + 2 * m, height: h + 2 * m, repairs };
}

/** Browsers refuse canvases beyond this on a side, or in total pixels (Chrome and Edge: 16384, 268 million). */
const MAX_SIDE = 16384;
const MAX_PIXELS = 200_000_000;

export interface PngOptions {
  /** Pixels per inch: the picture is `width` bp, 72 bp to the inch. */
  dpi: number;
  /** White behind the picture, or transparent. */
  transparent: boolean;
}

export interface PngResult {
  blob: Blob;
  width: number;
  height: number;
  /** The resolution actually used, lower than asked when the image would be too big for a canvas. */
  dpi: number;
}

/** Draws a tidy SVG to a PNG. Needs a browser. */
export async function svgToPng(svg: string, size: { width: number; height: number }, options: PngOptions): Promise<PngResult> {
  let dpi = options.dpi;
  const px = (d: number) => [Math.max(1, Math.round((size.width * d) / 72)), Math.max(1, Math.round((size.height * d) / 72))] as const;
  let [w, h] = px(dpi);
  while ((w > MAX_SIDE || h > MAX_SIDE || w * h > MAX_PIXELS) && dpi > 1) {
    dpi = Math.floor(dpi * 0.8);
    [w, h] = px(dpi);
  }
  // The image is drawn at its pixel size: set it on the root.
  const sized = svg.replace(/(<svg[^>]*?) width="[^"]*" height="[^"]*"/, `$1 width="${w}" height="${h}"`);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([sized], { type: "image/svg+xml" }));
  try {
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("The browser can't make a canvas this large.");
    if (!options.transparent) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("The browser couldn't write the PNG.");
    return { blob, width: w, height: h, dpi };
  } finally {
    URL.revokeObjectURL(url);
  }
}
