// Keeping TeX's picture on the canvas while the next compile runs (D69 item 4, D96).
//
// After an edit (or during a drag) TeX's last picture is of older code. Instead of
// swapping it for the native drawing until TeX catches up, the canvas keeps it and
// patches only what changed: the places where something was drawn differently
// before or is drawn differently now are cut out of TeX's picture and drawn
// natively there. Everything else stays TeX's, which is still right, because it
// didn't change.
//
// What changed is found by comparing what each node and path draws (its
// geometry, colors, text), not by id: path ids are offsets in the code, which
// most edits move. A change that touches nearly all of the picture (another
// document, a style used everywhere) isn't patched: the native drawing is
// shown, as before.

import { defaultTipLength, defaultTipWidth } from "../tikz/keys.ts";
import type { LaidOutNode, LaidOutPath, PictureLayout, Tip } from "../tikz/layout.ts";
import { outline } from "../tikz/shapes.ts";

/** A box in TikZ points, y up. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A region cut out of TeX's picture: a box, or a path's line widened (filled too when the path is). */
export type Mark = { kind: "box"; box: Box } | { kind: "line"; d: string; width: number; fill: boolean };

export interface Patch {
  /** Where TeX's picture is out of date: hidden there, and the native drawing shown instead. */
  marks: Mark[];
  /** The nodes and paths (by id, of the current layout) the native drawing needs to draw inside the marks. */
  draw: Set<string>;
}

/**
 * Beyond this share of changed items, the native drawing is shown instead of a patch: another document, or a
 * style used everywhere. Below it, whatever didn't change stays TeX's, even when an edit moves most of a picture
 * placed by relations (a longer label pushes every node placed after it).
 */
const MAX_CHANGED = 0.9;
/** Room around a cut-out, in pt: outer seps, line ends, and TeX's and the preview's small differences. */
const PAD = 2;

const json = (v: unknown) => (v === undefined ? "" : JSON.stringify(v));

/** Signatures worked out once per object: a drag frame keeps the objects of what it didn't change (D108). */
const sigCache = new WeakMap<object, string>();

/** What a node draws. Its id and code position don't matter: two layouts that draw the same thing match. */
export function nodeSig(n: LaidOutNode): string {
  const known = sigCache.get(n);
  if (known !== undefined) return known;
  const sig = nodeSigOf(n);
  sigCache.set(n, sig);
  return sig;
}

function nodeSigOf(n: LaidOutNode): string {
  return [
    outline(n.shape),
    n.shape.rotate ?? 0,
    json(n.fill),
    json(n.stroke),
    n.lineWidth,
    json(n.dash),
    n.opacity,
    n.fillOpacity,
    json(n.double),
    json(n.shading),
    n.shadow ? 1 : 0,
    json(n.text),
    `${n.textOrigin.x},${n.textOrigin.y}`,
    json(n.textColor),
    n.rotate ?? 0,
    n.layer,
  ].join("|");
}

/** What a path draws. */
export function pathSig(p: LaidOutPath): string {
  const known = sigCache.get(p);
  if (known !== undefined) return known;
  const sig = [p.d, json(p.stroke), json(p.fill), p.lineWidth, json(p.dash), p.opacity, p.fillOpacity, json(p.shading), json(p.double), json(p.tips), p.layer].join("|");
  sigCache.set(p, sig);
  return sig;
}

const union = (a: Box, b: Box): Box => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
const grow = (b: Box, by: number): Box => ({ x0: b.x0 - by, y0: b.y0 - by, x1: b.x1 + by, y1: b.y1 + by });
const meets = (a: Box, b: Box) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;

/** The box of a node's text, or null when it has none. */
function textBox(n: LaidOutNode): Box | null {
  if (!n.text) return null;
  const w = Math.max(n.text.width, 1);
  const h = n.text.height + n.text.depth;
  if (n.rotate) {
    const s = Math.hypot(w, h);
    return { x0: n.shape.center.x - s, y0: n.shape.center.y - s, x1: n.shape.center.x + s, y1: n.shape.center.y + s };
  }
  return { x0: n.textOrigin.x, y0: n.textOrigin.y - h, x1: n.textOrigin.x + w, y1: n.textOrigin.y };
}

/** A node's box with its text, in pt, y up. */
export function nodeBox(n: LaidOutNode): Box {
  const { center, hw, hh } = n.shape;
  // A turned node: the circle around its box holds it at any angle.
  const r = n.shape.rotate ? Math.hypot(hw, hh) : 0;
  let b: Box = r ? { x0: center.x - r, y0: center.y - r, x1: center.x + r, y1: center.y + r } : { x0: center.x - hw, y0: center.y - hh, x1: center.x + hw, y1: center.y + hh };
  const t = textBox(n);
  if (t) b = union(b, t);
  return grow(b, n.lineWidth / 2 + (n.shadow ? 3 : 0) + (n.double ? n.lineWidth + n.double.distance : 0));
}

/** The box around an SVG path's points, control points and arcs included (absolute commands, as the layout writes them). */
export function dBox(d: string): Box | null {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  let b: Box | null = null;
  const add = (x: number, y: number, r = 0) => {
    const p = { x0: x - r, y0: y - r, x1: x + r, y1: y + r };
    b = b ? union(b, p) : p;
  };
  let cmd = "";
  for (let i = 0; i < tokens.length; ) {
    const t = tokens[i]!;
    if (/[A-Za-z]/.test(t)) {
      cmd = t.toUpperCase();
      i++;
      if (cmd === "Z") continue;
    }
    const num = (k: number) => Number(tokens[i + k]);
    if (cmd === "A") {
      // An arc stays within twice its larger radius of where it ends.
      add(num(5), num(6), 2 * Math.max(Math.abs(num(0)), Math.abs(num(1))));
      i += 7;
    } else if (cmd === "H" || cmd === "V") {
      i += 1; // not written by the layout; skipped rather than misread
    } else if (/[MLCQST]/.test(cmd)) {
      add(num(0), num(1));
      i += 2;
    } else i++;
  }
  return b;
}

/**
 * A tip's box: around its point and the two back corners, as it is drawn (not a square around it,
 * which would bite into the node the arrow meets and leave a seam there).
 */
function tipBox(t: Tip): Box {
  const len = (t.tip.length ?? defaultTipLength(t.tip.kind, t.lineWidth)) * Math.max(1, t.tip.count);
  const half = (t.tip.width ?? defaultTipWidth(t.tip.kind, t.lineWidth)) / 2;
  const ux = Math.cos(t.angle);
  const uy = Math.sin(t.angle);
  const xs = [t.at.x, t.at.x - ux * len - uy * half, t.at.x - ux * len + uy * half];
  const ys = [t.at.y, t.at.y - uy * len + ux * half, t.at.y - uy * len - ux * half];
  return grow({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }, t.lineWidth);
}

export function pathBox(p: LaidOutPath): Box | null {
  let b = p.d ? dBox(p.d) : null;
  for (const t of p.tips) b = b ? union(b, tipBox(t)) : tipBox(t);
  return b ? grow(b, p.lineWidth / 2 + (p.double ? p.lineWidth + p.double.distance : 0)) : null;
}

function pathMarks(p: LaidOutPath): Mark[] {
  const marks: Mark[] = [];
  const w = p.double ? 2 * p.lineWidth + p.double.distance : p.lineWidth;
  if (p.d) marks.push({ kind: "line", d: p.d, width: w + 2 * PAD, fill: !!(p.fill || p.shading) });
  for (const t of p.tips) marks.push({ kind: "box", box: grow(tipBox(t), PAD) });
  return marks;
}

type Drawn = { kind: "node"; n: LaidOutNode; sig: string } | { kind: "path"; p: LaidOutPath; sig: string };

/** Each layout's items, worked out once: the old layout is compared again on every frame of a drag. */
const drawnCache = new WeakMap<PictureLayout, Drawn[]>();

function drawn(l: PictureLayout): Drawn[] {
  const known = drawnCache.get(l);
  if (known) return known;
  const out: Drawn[] = [];
  drawnCache.set(l, out);
  for (const n of [...l.nodes, ...l.pathNodes]) {
    if (n.kind === "coordinate") continue;
    for (const x of [n, ...n.extras]) out.push({ kind: "node", n: x, sig: nodeSig(x) });
  }
  for (const p of l.paths) out.push({ kind: "path", p, sig: pathSig(p) });
  return out;
}

/** Items of `a` that `b` doesn't draw the same (as many times). */
function unmatched(a: readonly Drawn[], b: readonly Drawn[]): Drawn[] {
  const left = new Map<string, number>();
  for (const x of b) left.set(x.sig, (left.get(x.sig) ?? 0) + 1);
  const out: Drawn[] = [];
  for (const x of a) {
    const k = left.get(x.sig) ?? 0;
    if (k) left.set(x.sig, k - 1);
    else out.push(x);
  }
  return out;
}

const boxOf = (x: Drawn): Box | null => (x.kind === "node" ? nodeBox(x.n) : pathBox(x.p));
const idOf = (x: Drawn): string => (x.kind === "node" ? x.n.id : x.p.id);

/**
 * What to patch over TeX's picture of `old` so that it shows `now`: nothing when nothing drawn changed
 * (an edit outside the picture, a comment), null when too much changed to patch.
 */
export function stalePatch(old: PictureLayout, now: PictureLayout): Patch | null {
  const before = drawn(old);
  const after = drawn(now);
  const gone = unmatched(before, after);
  const come = unmatched(after, before);
  if (!gone.length && !come.length) return { marks: [], draw: new Set() };
  if (gone.length + come.length > MAX_CHANGED * (before.length + after.length)) return null;

  const marks: Mark[] = [];
  const boxes: Box[] = [];
  const draw = new Set<string>();
  const cut = (x: Drawn) => {
    const b = boxOf(x);
    if (!b) return;
    boxes.push(b);
    if (x.kind === "node") marks.push({ kind: "box", box: grow(b, PAD) });
    else marks.push(...pathMarks(x.p));
  };
  for (const x of gone) cut(x);
  for (const x of come) {
    cut(x);
    draw.add(idOf(x));
  }
  // What else shows through the cut-outs is drawn natively there too, but only there: the end of a
  // changed edge cuts a sliver out of the node it meets, not the whole node. A node whose text a
  // cut-out reaches is cut out whole, so no label is drawn half in TeX's glyphs and half in KaTeX's.
  const region = boxes.map((b) => grow(b, PAD));
  for (const x of after) {
    if (draw.has(idOf(x))) continue;
    const b = boxOf(x);
    if (!b || !region.some((r) => meets(r, b))) continue;
    draw.add(idOf(x));
    const t = x.kind === "node" ? textBox(x.n) : null;
    if (t && region.some((r) => meets(r, t))) marks.push({ kind: "box", box: grow(b, PAD) });
  }
  return { marks, draw };
}
