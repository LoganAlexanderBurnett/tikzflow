// Raster diffing shared by the engine comparison pages (compare.ts, dvicheck.ts).
// Moved out of compare.ts unchanged in M3 step 6.

/** Pixels per TeX point. */
export const SCALE = 3;
/**
 * Max per-channel difference, after blurring, still counted as a match. The
 * blur makes antialiasing differences on thin lines negligible, while a
 * missing or extra 0.4pt line (about 1.2px here) still exceeds it.
 */
const TOLERANCE = 40;
/** Alignment search range in px (about ±2pt). */
const MAX_SHIFT = 6;

export interface DiffStats {
  /** Trimmed ink box size in pt: reference vs test. */
  refSizePt: [number, number];
  testSizePt: [number, number];
  /** Best alignment of test relative to reference, in pt. */
  offsetPt: [number, number];
  inkPixels: number;
  missing: number;
  extra: number;
  color: number;
  /** (missing + extra + color) / ink pixels, in percent. */
  mismatchPct: number;
}

// ------------------------------------------------------------- diffing

export interface Trimmed {
  data: Uint8ClampedArray;
  w: number;
  h: number;
}

const isInk = (d: Uint8ClampedArray, i: number) =>
  Math.max(255 - d[i]!, 255 - d[i + 1]!, 255 - d[i + 2]!) > 12;

/** Crops a canvas to the bounding box of its non-white pixels. */
export function trim(canvas: HTMLCanvasElement): Trimmed {
  const ctx = canvas.getContext("2d")!;
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (isInk(data, (y * width + x) * 4)) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return { data: new Uint8ClampedArray(4), w: 1, h: 1 };
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  return { data: ctx.getImageData(x0, y0, w, h).data, w, h };
}

/** A padded RGB float image, blurred with two 3x3 box passes (≈ Gaussian σ≈1px). */
interface Blurred {
  rgb: Float32Array;
  w: number;
  h: number;
}

const PAD = MAX_SHIFT + 2;

function blur(t: Trimmed): Blurred {
  const w = t.w + PAD * 2, h = t.h + PAD * 2;
  let src = new Float32Array(w * h * 3).fill(255);
  for (let y = 0; y < t.h; y++)
    for (let x = 0; x < t.w; x++) {
      const i = (y * t.w + x) * 4, o = ((y + PAD) * w + x + PAD) * 3;
      src[o] = t.data[i]!;
      src[o + 1] = t.data[i + 1]!;
      src[o + 2] = t.data[i + 2]!;
    }
  for (let pass = 0; pass < 2; pass++) {
    const dst = new Float32Array(src.length).fill(255);
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++)
        for (let c = 0; c < 3; c++) {
          let s = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += src[((y + dy) * w + x + dx) * 3 + c]!;
          dst[(y * w + x) * 3 + c] = s / 9;
        }
    src = dst;
  }
  return { rgb: src, w, h };
}

function at(b: Blurred, x: number, y: number, c: number): number {
  if (x < 0 || y < 0 || x >= b.w || y >= b.h) return 255;
  return b.rgb[(y * b.w + x) * 3 + c]!;
}

const inkAt = (b: Blurred, x: number, y: number) =>
  Math.max(255 - at(b, x, y, 0), 255 - at(b, x, y, 1), 255 - at(b, x, y, 2)) > 12;

function mismatchAt(a: Blurred, b: Blurred, x: number, y: number, dx: number, dy: number): boolean {
  for (let c = 0; c < 3; c++) if (Math.abs(at(a, x, y, c) - at(b, x - dx, y - dy, c)) > TOLERANCE) return true;
  return false;
}

/** Diffs two trimmed images at the alignment (within ±MAX_SHIFT) that matches best. */
export function diff(refT: Trimmed, testT: Trimmed): { stats: DiffStats; image: ImageData } {
  const ref = blur(refT), test = blur(testT);
  const w = Math.max(ref.w, test.w), h = Math.max(ref.h, test.h);
  // Coarse alignment search on a sparse grid.
  let best = { dx: 0, dy: 0, n: Infinity };
  for (let dy = -MAX_SHIFT; dy <= MAX_SHIFT; dy++)
    for (let dx = -MAX_SHIFT; dx <= MAX_SHIFT; dx++) {
      let n = 0;
      for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 3) if (mismatchAt(ref, test, x, y, dx, dy)) n++;
      if (n < best.n) best = { dx, dy, n };
    }
  const image = new ImageData(w, h);
  let ink = 0, missing = 0, extra = 0, color = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const aInk = inkAt(ref, x, y), bInk = inkAt(test, x - best.dx, y - best.dy);
      const o = (y * w + x) * 4;
      // Background: a faded copy of the reference.
      const g = aInk ? 200 : 255;
      image.data.set([g, g, g, 255], o);
      if (!aInk && !bInk) continue;
      ink++;
      if (!mismatchAt(ref, test, x, y, best.dx, best.dy)) continue;
      const aDark = 765 - at(ref, x, y, 0) - at(ref, x, y, 1) - at(ref, x, y, 2);
      const bDark = 765 - at(test, x - best.dx, y - best.dy, 0) - at(test, x - best.dx, y - best.dy, 1) - at(test, x - best.dx, y - best.dy, 2);
      if (aDark - bDark > TOLERANCE * 2) {
        missing++;
        image.data.set([230, 30, 30, 255], o);
      } else if (bDark - aDark > TOLERANCE * 2) {
        extra++;
        image.data.set([30, 80, 230, 255], o);
      } else {
        color++;
        image.data.set([240, 150, 0, 255], o);
      }
    }
  const pt = (px: number) => Math.round((px / SCALE) * 10) / 10;
  return {
    stats: {
      refSizePt: [pt(refT.w), pt(refT.h)],
      testSizePt: [pt(testT.w), pt(testT.h)],
      offsetPt: [pt(best.dx), pt(best.dy)],
      inkPixels: ink,
      missing,
      extra,
      color,
      mismatchPct: ink ? Math.round(((missing + extra + color) / ink) * 1000) / 10 : 0,
    },
    image,
  };
}

export function toCanvas(t: Trimmed | ImageData): HTMLCanvasElement {
  const c = document.createElement("canvas");
  const img = t instanceof ImageData ? t : new ImageData(new Uint8ClampedArray(t.data), t.w, t.h);
  c.width = img.width;
  c.height = img.height;
  c.getContext("2d")!.putImageData(img, 0, 0);
  return c;
}

/** Lays panels out side by side with captions. */
export function composite(panels: Array<[string, HTMLCanvasElement]>): HTMLCanvasElement {
  const pad = 16, caption = 22;
  const h = Math.max(...panels.map(([, c]) => c.height)) + caption + pad * 2;
  const w = panels.reduce((s, [, c]) => s + c.width + pad, pad);
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.font = "14px system-ui, sans-serif";
  let x = pad;
  for (const [label, c] of panels) {
    ctx.fillStyle = "#333";
    ctx.fillText(label, x, pad + 12);
    ctx.strokeStyle = "#ccc";
    ctx.strokeRect(x - 0.5, pad + caption - 0.5, c.width + 1, c.height + 1);
    ctx.drawImage(c, x, pad + caption);
    x += c.width + pad;
  }
  return out;
}


// ------------------------------------------------------------- rasterising SVG

const fontCache = new Map<string, string>();
async function fontFace(family: string): Promise<string> {
  if (!fontCache.has(family)) {
    const res = await fetch(`/vendor/tikzjax/package/dist/fonts/${family}.woff2`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    fontCache.set(family, `@font-face{font-family:${family};src:url(data:font/woff2;base64,${btoa(bin)}) format('woff2');}`);
  }
  return fontCache.get(family)!;
}

/**
 * Draws an SVG as an image. TikZJax's needs its web fonts embedded, and its
 * width and height are TeX points labelled as CSS pt, 0.375% too large
 * (`texPoints`); ours draws text as paths and is in bp already.
 */
export async function rasterSvg(svg: string, texPoints = true): Promise<HTMLCanvasElement> {
  const families = [...new Set([...svg.matchAll(/font-family="([^"]+)"/g)].map((m) => m[1]!))];
  const css = (await Promise.all(families.map(fontFace))).join("");
  const k = texPoints ? 72 / 72.27 : 1;
  const w = Number.parseFloat(/width=["']([\d.]+)pt["']/.exec(svg)?.[1] ?? "100") * k;
  const h = Number.parseFloat(/height=["']([\d.]+)pt["']/.exec(svg)?.[1] ?? "100") * k;
  const sized = svg
    .replace(/width=["'][\d.]+pt["']/, `width="${w * SCALE}"`)
    .replace(/height=["'][\d.]+pt["']/, `height="${h * SCALE}"`)
    .replace(/(<svg[^>]*>)/, `$1<style>${css}</style>`);
  const img = new Image();
  img.src = URL.createObjectURL(new Blob([sized], { type: "image/svg+xml" }));
  await img.decode();
  // Give embedded fonts a moment; the first paint can use a fallback.
  if (families.length) await new Promise((r) => setTimeout(r, 50));
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(w * SCALE);
  canvas.height = Math.ceil(h * SCALE);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(img.src);
  return canvas;
}

