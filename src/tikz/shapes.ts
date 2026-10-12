// Node shapes: size from the text box (following PGF's shape definitions),
// anchors, border points, and outlines. Coordinates are canvas pt, y up.

export interface Point {
  x: number;
  y: number;
}

export interface ShapeParams {
  kind: string;
  /** Text box: width, height above the baseline, depth below it. */
  textWidth: number;
  textHeight: number;
  textDepth: number;
  innerXSep: number;
  innerYSep: number;
  outerXSep: number;
  outerYSep: number;
  minWidth: number;
  minHeight: number;
  roundedCorners: number;
  aspect: number;
  trapeziumLeftAngle: number;
  trapeziumRightAngle: number;
  /** "trapezium stretches": a minimum size stretches it instead of enlarging it with its angles kept. */
  trapeziumStretches?: boolean;
  shapeBorderRotate: number;
  /** The node's line width: a cylinder's length depends on it (half of it is added, as pgf does). */
  lineWidth?: number;
}

export interface NodeShape {
  kind: string;
  /** The text's center: the `center` anchor. */
  center: Point;
  /** Half width and half height of the drawn border, without outer sep, about `center` plus `shift`. */
  hw: number;
  hh: number;
  /**
   * Where the drawn shape's own middle is, relative to `center`, when it isn't there: a cylinder's
   * ends are not alike, so pgf puts its text off its middle (D98). Unturned frame, like the rest.
   */
  shift?: Point;
  /** A cylinder's axis: the way its top points, 0 (east), 90, 180 or 270 degrees. */
  axis?: number;
  /** A trapezium's border with outer sep, as pgf works it out (each corner moved out along its miter), relative to the center: top left, top right, bottom right, bottom left. */
  border?: Point[];
  outerX: number;
  outerY: number;
  roundedCorners: number;
  /** Polygon vertices relative to the center, for polygonal shapes. */
  polygon?: Point[];
  /** Baseline of the text, relative to the center. */
  baseline: number;
  /** Height of the text box's x-height above the baseline, for "mid" anchors. */
  midOffset: number;
  /** For tape and cylinder: extra outline detail. */
  detail?: number;
  vertical?: boolean;
  /**
   * Degrees the node is turned counterclockwise about its center (its own rotate, or the picture's
   * with transform shape, D87). Everything else here is in the node's own, unturned frame.
   */
  rotate?: number;
}

/** `p` turned `deg` degrees counterclockwise about the origin. */
export function turn(p: Point, deg: number): Point {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/** The shape unturned, centered on the origin: where the turned shape's geometry is worked out. */
function unturned(sh: NodeShape): NodeShape {
  const { rotate: _, ...rest } = sh;
  return { ...rest, center: { x: 0, y: 0 } };
}

/** A point of the unturned shape at the origin, turned and moved onto the shape's center. */
function placed(sh: NodeShape, p: Point): Point {
  const q = turn(p, sh.rotate!);
  return { x: sh.center.x + q.x, y: sh.center.y + q.y };
}

/** Shapes drawn natively. Others fall back to a rectangle. */
export const DRAWN_SHAPES = new Set(["rectangle", "circle", "ellipse", "diamond", "trapezium", "rounded rectangle", "cylinder", "tape", "coordinate", "circle split", "rectangle split", "document"]);

const SQRT2 = Math.SQRT2;

/** Computes the shape's size around a text box whose center is at `center`. */
export function makeShape(p: ShapeParams, center: Point): NodeShape {
  const kind = DRAWN_SHAPES.has(p.kind) ? p.kind : "rectangle";
  const tw = p.textWidth;
  const th = p.textHeight + p.textDepth;
  // Half sizes of the text box plus inner sep.
  const ix = tw / 2 + p.innerXSep;
  const iy = th / 2 + p.innerYSep;
  const base: Omit<NodeShape, "hw" | "hh"> = {
    kind,
    center,
    outerX: p.outerXSep,
    outerY: p.outerYSep,
    roundedCorners: p.roundedCorners,
    baseline: -th / 2 + p.textDepth,
    midOffset: 0.5 * 4.30554,
  };
  switch (kind) {
    case "coordinate":
      return { ...base, hw: 0, hh: 0, outerX: 0, outerY: 0, baseline: 0 };
    case "circle":
    case "circle split": {
      const r = Math.max(Math.hypot(ix, iy), p.minWidth / 2, p.minHeight / 2);
      return { ...base, kind: "circle", hw: r, hh: r };
    }
    case "ellipse": {
      const a = Math.max(ix * SQRT2, p.minWidth / 2);
      const b = Math.max(iy * SQRT2, p.minHeight / 2);
      return { ...base, hw: a, hh: b };
    }
    case "diamond": {
      // PGF: the diamond through the text box's corners with the given aspect.
      let x = ix + iy * p.aspect;
      let y = iy + ix / p.aspect;
      x = Math.max(x, p.minWidth / 2);
      y = Math.max(y, p.minHeight / 2);
      return { ...base, hw: x, hh: y, polygon: [{ x: 0, y }, { x, y: 0 }, { x: 0, y: -y }, { x: -x, y: 0 }] };
    }
    case "trapezium": {
      // As pgflibraryshapes.geometric does it: the slanted sides add 2y·cot(angle) each. A minimum
      // height or width enlarges the whole trapezium, angles kept, unless "trapezium stretches".
      const turn = borderTurn(p.shapeBorderRotate);
      let [x, y] = turn === 90 || turn === 270 ? [iy, ix] : [ix, iy];
      const cot = (a: number) => {
        const m = ((a % 360) + 360) % 360;
        return m === 0 ? 0 : 1 / Math.tan((m * Math.PI) / 180);
      };
      let xa = 2 * y * cot(p.trapeziumLeftAngle);
      let xb = 2 * y * cot(p.trapeziumRightAngle);
      if (y < p.minHeight / 2) {
        if (!p.trapeziumStretches) {
          const k = p.minHeight / 2 / y;
          x *= k;
          xa *= k;
          xb *= k;
        }
        y = p.minHeight / 2;
      }
      const across = 2 * x + Math.abs(xa) + Math.abs(xb);
      if (across < p.minWidth) {
        const k = p.minWidth / across;
        x *= k;
        xa *= k;
        xb *= k;
        if (!p.trapeziumStretches) y *= k;
      }
      // Interior angles at the bottom: under 90° the bottom side is longer. The text box stays centered.
      const bl = { x: -x - Math.max(0, xa), y: -y };
      const tl = { x: -x + Math.min(0, xa), y };
      const br = { x: x + Math.max(0, xb), y: -y };
      const tr = { x: x - Math.min(0, xb), y };
      // The border pgf finds anchors on: each corner moved out by the outer sep along its miter,
      // (∓o·cot(θ/2), ±o) for the interior angle θ there (the larger of the two outer seps).
      const o = Math.max(p.outerXSep, p.outerYSep);
      const corners = [tl, tr, br, bl];
      const border = corners.map((q, i) => {
        const prev = corners[(i + 3) % 4]!;
        const next = corners[(i + 1) % 4]!;
        const a1 = Math.atan2(prev.y - q.y, prev.x - q.x);
        const a2 = Math.atan2(next.y - q.y, next.x - q.x);
        let theta = Math.abs(a1 - a2);
        if (theta > Math.PI) theta = 2 * Math.PI - theta;
        const run = o / Math.tan(theta / 2);
        const left = i === 0 || i === 3;
        return { x: q.x + (left ? -run : run), y: q.y + (i < 2 ? o : -o) };
      });
      const poly = rotatePolygon(corners, turn);
      const hw = Math.max(...poly.map((q) => Math.abs(q.x)));
      const hh = Math.max(...poly.map((q) => Math.abs(q.y)));
      return { ...base, hw, hh, polygon: poly, border: rotatePolygon(border, turn) };
    }
    case "rounded rectangle": {
      // As pgflibraryshapes.misc does it, with the default arcs (convex, 180°): the arcs' radius is
      // half the height, and the text reaches into them by the chord its half height cuts. A minimum
      // width sets the whole width less twice the inner xsep (pgf's own reckoning, checked: p12).
      const htw = tw / 2;
      const htt = th / 2;
      const r = Math.max(htt + p.innerYSep, p.minHeight / 2);
      const chord = r - Math.sqrt(Math.max(0, r * r - htt * htt));
      let xoffset = p.innerXSep;
      const across = 2 * (htw + p.innerXSep) + 2 * chord;
      if (across < p.minWidth) xoffset = (p.minWidth - across) / 2;
      // Wider when the two arcs would overlap.
      if (r - chord > htw + xoffset) xoffset = r - chord - htw;
      return { ...base, hw: htw + xoffset + chord, hh: r, roundedCorners: r };
    }
    case "cylinder": {
      // As pgflibraryshapes.geometric does it. In the cylinder's own frame its axis runs along x,
      // with the top (the end whose ellipse shows) at +x; shape border rotate turns it by a multiple
      // of 90°. The ends' x radius is aspect × the y radius. The text reaches into the bottom's
      // ellipse but not the top's, so the shape's middle is off the text's center. A minimum height
      // is along the axis, a minimum width across it.
      const axis = borderTurn(p.shapeBorderRotate) % 360;
      const across = axis === 90 || axis === 270;
      let xa = across ? iy : ix;
      let ya = across ? ix : iy;
      const yc = across ? p.innerXSep : p.innerYSep;
      const rx = p.aspect * ya;
      let ry = ya;
      if (ry < p.minWidth / 2) ry = ya = p.minWidth / 2;
      const xb = Math.cos(Math.asin(Math.max(-1, Math.min(1, (ry - yc) / ry)))) * rx;
      const lw = p.lineWidth ?? 0.4;
      const length = 0.5 * lw + 2 * xa + 3 * rx - xb;
      if (length < p.minHeight) xa += (p.minHeight - length) / 2;
      const top = xa + rx + 0.5 * lw;
      const bottom = -xa + xb;
      const mid = (top + bottom) / 2;
      const half = (top - bottom) / 2 + rx;
      const u = AXIS[axis / 90]!;
      return { ...base, hw: across ? ry : half, hh: across ? half : ry, detail: rx, axis, vertical: across, shift: { x: u.x * mid, y: u.y * mid } };
    }
    case "tape":
    case "document": {
      const hw = Math.max(ix, p.minWidth / 2);
      const hh = Math.max(iy + 2, p.minHeight / 2);
      return { ...base, hw, hh, detail: 4 };
    }
    default: {
      const hw = Math.max(ix, p.minWidth / 2);
      const hh = Math.max(iy, p.minHeight / 2);
      return { ...base, kind: kind === "rectangle split" ? "rectangle" : kind, hw, hh };
    }
  }
}

/** shape border rotate as pgf's trapezium and cylinder round it: to a multiple of 90°, from 0 to 360. */
function borderTurn(deg: number): number {
  const m = Math.trunc(deg % 360);
  const c = Math.trunc((m + 45) / 90) * 90;
  return c < 0 ? c + 360 : c;
}

/** Unit vectors along a cylinder's axis, by axis / 90. */
const AXIS: Point[] = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];

/** A point in a cylinder's own frame (axis along x, about its middle) in the shape's frame (about the text's center). */
function fromAxis(sh: NodeShape, p: Point): Point {
  const u = AXIS[(sh.axis ?? 0) / 90]!;
  const s = sh.shift ?? { x: 0, y: 0 };
  return { x: s.x + p.x * u.x - p.y * u.y, y: s.y + p.x * u.y + p.y * u.x };
}

/** The cylinder's ends: the distance from its middle to each end's ellipse center, and the ellipse's radii (drawn, without outer sep). */
function cylinderParts(sh: NodeShape): { lc: number; rx: number; ry: number } {
  const across = sh.axis === 90 || sh.axis === 270;
  const rx = sh.detail ?? 0;
  return { lc: (across ? sh.hh : sh.hw) - rx, rx, ry: across ? sh.hw : sh.hh };
}

/**
 * Where a ray from `o` (relative to the text's center, in the shape's frame) in direction (ux, uy)
 * leaves a cylinder's outer border: the two straight sides and the two ends' half ellipses, with the
 * outer sep added to every radius as pgf does.
 */
function rayCylinder(sh: NodeShape, o: Point, ux: number, uy: number): Point | null {
  const { lc, rx, ry } = cylinderParts(sh);
  const sep = Math.max(sh.outerX, sh.outerY);
  const a = rx + sep;
  const b = ry + sep;
  const u = AXIS[(sh.axis ?? 0) / 90]!;
  const s = sh.shift ?? { x: 0, y: 0 };
  // Into the cylinder's frame: subtract its middle, turn back by the axis.
  const back = (p: Point) => ({ x: p.x * u.x + p.y * u.y, y: -p.x * u.y + p.y * u.x });
  const O = back({ x: o.x - s.x, y: o.y - s.y });
  const d = back({ x: ux, y: uy });
  let best = -Infinity;
  for (const side of [b, -b]) {
    if (Math.abs(d.y) < 1e-12) continue;
    const t = (side - O.y) / d.y;
    const x = O.x + t * d.x;
    if (t > 0 && x >= -lc - 1e-9 && x <= lc + 1e-9) best = Math.max(best, t);
  }
  for (const end of [lc, -lc]) {
    const px = (O.x - end) / a;
    const py = O.y / b;
    const qx = d.x / a;
    const qy = d.y / b;
    const A = qx * qx + qy * qy;
    const B = 2 * (px * qx + py * qy);
    const C = px * px + py * py - 1;
    const disc = B * B - 4 * A * C;
    if (A < 1e-18 || disc < 0) continue;
    for (const t of [(-B + Math.sqrt(disc)) / (2 * A), (-B - Math.sqrt(disc)) / (2 * A)]) {
      const x = O.x + t * d.x;
      if (t > 0 && (end > 0 ? x >= lc - 1e-9 : x <= -lc + 1e-9)) best = Math.max(best, t);
    }
  }
  if (!Number.isFinite(best)) return null;
  return { x: o.x + ux * best, y: o.y + uy * best };
}

/** Where a ray from `o` (relative to the center) leaves a convex polygon given relative to the center. */
function rayPolygonFrom(poly: Point[], o: Point, ux: number, uy: number): Point | null {
  const t = rayPolygon(poly.map((q) => ({ x: q.x - o.x, y: q.y - o.y })), ux, uy);
  return t === null ? null : { x: o.x + ux * t, y: o.y + uy * t };
}

function rotatePolygon(poly: Point[], deg: number): Point[] {
  if (!deg) return poly;
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return poly.map((q) => ({ x: q.x * c - q.y * s, y: q.x * s + q.y * c }));
}

/** The outline as a polygon (with outer sep added), relative to the center. */
function outerPolygon(sh: NodeShape): Point[] {
  if (sh.polygon) {
    // Inflate by outer sep, approximately, by scaling.
    const sx = sh.hw ? (sh.hw + sh.outerX) / sh.hw : 1;
    const sy = sh.hh ? (sh.hh + sh.outerY) / sh.hh : 1;
    return sh.polygon.map((q) => ({ x: q.x * sx, y: q.y * sy }));
  }
  return [];
}

/** Where a ray from the center in direction (dx, dy) meets the outer border. */
export function borderInDirection(sh: NodeShape, dx: number, dy: number): Point {
  if (sh.rotate) {
    const d = turn({ x: dx, y: dy }, -sh.rotate);
    return placed(sh, borderInDirection(unturned(sh), d.x, d.y));
  }
  const c = sh.center;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9 || (sh.hw === 0 && sh.hh === 0)) return { ...c };
  const ux = dx / len;
  const uy = dy / len;
  const a = sh.hw + sh.outerX;
  const b = sh.hh + sh.outerY;
  let t: number;
  switch (sh.kind) {
    case "circle":
      t = a;
      break;
    case "ellipse":
      t = 1 / Math.hypot(ux / a, uy / b);
      break;
    case "diamond":
      t = 1 / (Math.abs(ux) / a + Math.abs(uy) / b);
      break;
    case "cylinder": {
      const p = rayCylinder(sh, { x: 0, y: 0 }, ux, uy);
      if (p) return { x: c.x + p.x, y: c.y + p.y };
      t = Math.min(a / Math.abs(ux || 1e-12), b / Math.abs(uy || 1e-12));
      break;
    }
    default:
      if (sh.border) {
        t = rayPolygon(sh.border, ux, uy) ?? Math.min(a / Math.abs(ux || 1e-12), b / Math.abs(uy || 1e-12));
      } else if (sh.polygon) {
        t = rayPolygon(outerPolygon(sh), ux, uy) ?? Math.min(a / Math.abs(ux || 1e-12), b / Math.abs(uy || 1e-12));
      } else if (sh.kind === "rounded rectangle") {
        t = rayRoundedRect(a, b, ux, uy);
      } else {
        t = Math.min(Math.abs(ux) > 1e-12 ? a / Math.abs(ux) : Infinity, Math.abs(uy) > 1e-12 ? b / Math.abs(uy) : Infinity);
      }
  }
  return { x: c.x + ux * t, y: c.y + uy * t };
}

function rayPolygon(poly: Point[], ux: number, uy: number): number | null {
  let best: number | null = null;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const ex = q.x - p.x;
    const ey = q.y - p.y;
    const den = ux * ey - uy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = (p.x * ey - p.y * ex) / den;
    const s = (p.x * uy - p.y * ux) / den;
    if (t > 0 && s >= -1e-9 && s <= 1 + 1e-9 && (best === null || t < best)) best = t;
  }
  return best;
}

function rayRoundedRect(a: number, b: number, ux: number, uy: number): number {
  // A stadium: straight top and bottom, half circles of radius b at the ends.
  const straight = a - b;
  const tFlat = Math.abs(uy) > 1e-12 ? b / Math.abs(uy) : Infinity;
  if (Math.abs(ux * tFlat) <= straight) return tFlat;
  // Intersect with the circle centered at (±straight, 0).
  const cx = Math.sign(ux) * straight;
  const bq = -2 * ux * cx;
  const cq = cx * cx - b * b;
  const disc = bq * bq - 4 * cq;
  return disc >= 0 ? (-bq + Math.sqrt(disc)) / 2 : tFlat;
}

/** Where the outer border meets the ray from the center toward `p`. */
export function borderToward(sh: NodeShape, p: Point): Point {
  return borderInDirection(sh, p.x - sh.center.x, p.y - sh.center.y);
}

const COMPASS: Record<string, [number, number]> = {
  north: [0, 1],
  south: [0, -1],
  east: [1, 0],
  west: [-1, 0],
  "north east": [1, 1],
  "north west": [-1, 1],
  "south east": [1, -1],
  "south west": [-1, -1],
};

/** A named or numeric anchor, or null if the shape doesn't have it. */
export function anchorPoint(sh: NodeShape, name: string): Point | null {
  if (sh.rotate) {
    const p = anchorPoint(unturned(sh), name);
    return p && placed(sh, p);
  }
  const c = sh.center;
  const a = sh.hw + sh.outerX;
  const b = sh.hh + sh.outerY;
  const n = name.trim();
  if (n === "center" || n === "" || n === "text" && sh.kind === "coordinate") return { ...c };
  if (/^-?\d+(\.\d+)?$/.test(n)) {
    const r = (parseFloat(n) * Math.PI) / 180;
    return borderInDirection(sh, Math.cos(r), Math.sin(r));
  }
  const base = c.y + sh.baseline;
  if (n === "base") return { x: c.x, y: base };
  if (n === "mid") return { x: c.x, y: base + sh.midOffset };
  if (n === "base west" || n === "base east" || n === "mid west" || n === "mid east") {
    const y = n.startsWith("base") ? base : base + sh.midOffset;
    const dir = n.endsWith("west") ? -1 : 1;
    // pgf's trapezium and cylinder cast the ray from the base or mid point itself (D98).
    const from = { x: 0, y: y - c.y };
    const hit = sh.border ? rayPolygonFrom(sh.border, from, dir, 0) : sh.kind === "cylinder" ? rayCylinder(sh, from, dir, 0) : null;
    if (hit) return { x: c.x + hit.x, y };
    const edge = borderInDirection(sh, dir, 0);
    return { x: edge.x, y };
  }
  if (n === "text") return { x: c.x - (sh.hw - 3.33333), y: base };
  const comp = COMPASS[n];
  if (!comp) {
    // Shape-specific anchors.
    if (sh.border) {
      const k = sh.border;
      const at = (p: Point, q: Point = p) => ({ x: c.x + (p.x + q.x) / 2, y: c.y + (p.y + q.y) / 2 });
      const pick: Record<string, number> = { "top left corner": 0, "top right corner": 1, "bottom right corner": 2, "bottom left corner": 3 };
      const i = pick[n];
      if (i !== undefined) return at(k[i]!);
      if (n === "top side") return at(k[0]!, k[1]!);
      if (n === "right side") return at(k[1]!, k[2]!);
      if (n === "bottom side") return at(k[2]!, k[3]!);
      if (n === "left side") return at(k[3]!, k[0]!);
    }
    if (sh.kind === "cylinder") {
      const { lc, rx } = cylinderParts(sh);
      const reach = lc + rx + Math.max(sh.outerX, sh.outerY);
      const p = n === "shape center" ? fromAxis(sh, { x: 0, y: 0 }) : n === "top" ? fromAxis(sh, { x: reach, y: 0 }) : n === "bottom" ? fromAxis(sh, { x: -reach, y: 0 }) : null;
      if (p) return { x: c.x + p.x, y: c.y + p.y };
    }
    return null;
  }
  const [ux, uy] = comp;
  if (ux === 0 || uy === 0) return borderInDirection(sh, ux, uy);
  switch (sh.kind) {
    case "rectangle":
    case "tape":
    case "document":
      return { x: c.x + ux * a, y: c.y + uy * b };
    case "rounded rectangle":
      // Where the arcs meet the straight sides (pgf's convex ends).
      return { x: c.x + ux * Math.max(0, sh.hw - sh.hh), y: c.y + uy * b };
    case "ellipse":
      // The point at 45° of the ellipse's parameter, not on the 45° ray.
      return { x: c.x + ux * a * Math.SQRT1_2, y: c.y + uy * b * Math.SQRT1_2 };
    case "diamond":
      return { x: c.x + (ux * a) / 2, y: c.y + (uy * b) / 2 };
    default:
      // The trapezium and the cylinder: where the 45° ray from the center leaves the border.
      return borderInDirection(sh, ux, uy);
  }
}

/** The outline as SVG path commands in canvas coordinates (y up). */
export function outline(sh: NodeShape): string {
  const { x: cx, y: cy } = sh.center;
  const f = (v: number) => Math.round(v * 1000) / 1000;
  const pt = (x: number, y: number) => `${f(cx + x)} ${f(cy + y)}`;
  const { hw, hh } = sh;
  switch (sh.kind) {
    case "coordinate":
      return "";
    case "circle":
    case "ellipse":
      return `M ${pt(hw, 0)} A ${f(hw)} ${f(hh)} 0 1 0 ${pt(-hw, 0)} A ${f(hw)} ${f(hh)} 0 1 0 ${pt(hw, 0)} Z`;
    case "diamond":
    case "trapezium":
      return roundedPolygon(sh.polygon!.map((q) => ({ x: cx + q.x, y: cy + q.y })), sh.roundedCorners, f);
    case "rounded rectangle": {
      const r = hh;
      return `M ${pt(-hw + r, hh)} L ${pt(hw - r, hh)} A ${f(r)} ${f(r)} 0 0 0 ${pt(hw - r, -hh)} L ${pt(-hw + r, -hh)} A ${f(r)} ${f(r)} 0 0 0 ${pt(-hw + r, hh)} Z`;
    }
    case "cylinder": {
      // In the cylinder's own frame (axis along x, top at +x), then turned onto its axis: the body,
      // then the visible half of the top's ellipse.
      const { lc, rx, ry } = cylinderParts(sh);
      const q = (x: number, y: number) => {
        const p = fromAxis(sh, { x, y });
        return pt(p.x, p.y);
      };
      const r = sh.vertical ? `${f(ry)} ${f(rx)}` : `${f(rx)} ${f(ry)}`;
      return (
        `M ${q(-lc, ry)} L ${q(lc, ry)} A ${r} 0 0 1 ${q(lc, -ry)} L ${q(-lc, -ry)} ` +
        `A ${r} 0 0 1 ${q(-lc, ry)} Z M ${q(lc, ry)} A ${r} 0 0 0 ${q(lc, -ry)}`
      );
    }
    case "tape":
    case "document": {
      const d = sh.detail ?? 4;
      // Wavy bottom edge (and top edge for tape).
      const top =
        sh.kind === "tape"
          ? `M ${pt(-hw, hh - d / 2)} C ${pt(-hw / 2, hh + d / 2)} ${pt(0, hh + d / 2)} ${pt(0, hh - d / 2)} C ${pt(0, hh - 1.5 * d)} ${pt(hw / 2, hh - 1.5 * d)} ${pt(hw, hh - d / 2)}`
          : `M ${pt(-hw, hh)} L ${pt(hw, hh)}`;
      const bottomY = -hh + d / 2;
      return (
        `${top} L ${pt(hw, bottomY)} C ${pt(hw / 2, bottomY - d)} ${pt(0, bottomY - d)} ${pt(0, bottomY)} ` +
        `C ${pt(0, bottomY + d)} ${pt(-hw / 2, bottomY + d)} ${pt(-hw, bottomY)} Z`
      );
    }
    default:
      return roundedPolygon(
        [
          { x: cx - hw, y: cy + hh },
          { x: cx + hw, y: cy + hh },
          { x: cx + hw, y: cy - hh },
          { x: cx - hw, y: cy - hh },
        ],
        sh.roundedCorners,
        f,
      );
  }
}

/** A closed polygon with corners rounded by radius r, as TikZ's "rounded corners" does. */
export function roundedPolygon(pts: Point[], r: number, f: (v: number) => number): string {
  const n = pts.length;
  if (!r || n < 3) return `M ${pts.map((p) => `${f(p.x)} ${f(p.y)}`).join(" L ")} Z`;
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i + n - 1) % n]!;
    const cur = pts[i]!;
    const next = pts[(i + 1) % n]!;
    const d1 = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const d2 = Math.hypot(next.x - cur.x, next.y - cur.y);
    const rr = Math.min(r, d1 / 2, d2 / 2);
    const a = { x: cur.x + ((prev.x - cur.x) / d1) * rr, y: cur.y + ((prev.y - cur.y) / d1) * rr };
    const b = { x: cur.x + ((next.x - cur.x) / d2) * rr, y: cur.y + ((next.y - cur.y) / d2) * rr };
    parts.push(`${i === 0 ? "M" : "L"} ${f(a.x)} ${f(a.y)} Q ${f(cur.x)} ${f(cur.y)} ${f(b.x)} ${f(b.y)}`);
  }
  return `${parts.join(" ")} Z`;
}

/** The axis-aligned bounding box including outer sep. */
export function shapeBounds(sh: NodeShape): { minX: number; minY: number; maxX: number; maxY: number } {
  const s = sh.shift ?? { x: 0, y: 0 };
  if (sh.rotate) {
    const a = sh.hw + sh.outerX;
    const b = sh.hh + sh.outerY;
    // A circle looks the same turned; anything else: the box round its turned corners.
    if (sh.kind === "circle") return { minX: sh.center.x - a, maxX: sh.center.x + a, minY: sh.center.y - a, maxY: sh.center.y + a };
    const pts = [{ x: a, y: b }, { x: -a, y: b }, { x: a, y: -b }, { x: -a, y: -b }].map((p) => placed(sh, { x: p.x + s.x, y: p.y + s.y }));
    return { minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y)) };
  }
  return {
    minX: sh.center.x + s.x - sh.hw - sh.outerX,
    maxX: sh.center.x + s.x + sh.hw + sh.outerX,
    minY: sh.center.y + s.y - sh.hh - sh.outerY,
    maxY: sh.center.y + s.y + sh.hh + sh.outerY,
  };
}

/** The middle of the drawn shape: its center, unless it is drawn off its text (a cylinder). */
export function shapeMiddle(sh: NodeShape): Point {
  if (!sh.shift) return sh.center;
  return sh.rotate ? placed(sh, sh.shift) : { x: sh.center.x + sh.shift.x, y: sh.center.y + sh.shift.y };
}

/** For anchoring: the offset from the center to anchor `name` of a shape placed at the origin. */
export function anchorOffset(sh: NodeShape, name: string): Point | null {
  const at0 = { ...sh, center: { x: 0, y: 0 } };
  return anchorPoint(at0, name);
}
