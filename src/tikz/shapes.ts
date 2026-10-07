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
  shapeBorderRotate: number;
}

export interface NodeShape {
  kind: string;
  center: Point;
  /** Half width and half height of the drawn border, without outer sep. */
  hw: number;
  hh: number;
  outerX: number;
  outerY: number;
  roundedCorners: number;
  /** Polygon vertices relative to the centre, for polygonal shapes. */
  polygon?: Point[];
  /** Baseline of the text, relative to the centre. */
  baseline: number;
  /** Height of the text box's x-height above the baseline, for "mid" anchors. */
  midOffset: number;
  /** For tape and cylinder: extra outline detail. */
  detail?: number;
  vertical?: boolean;
}

/** Shapes drawn natively. Others fall back to a rectangle. */
export const DRAWN_SHAPES = new Set(["rectangle", "circle", "ellipse", "diamond", "trapezium", "rounded rectangle", "cylinder", "tape", "coordinate", "circle split", "rectangle split", "document"]);

const SQRT2 = Math.SQRT2;

/** Computes the shape's size around a text box whose centre is at `center`. */
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
      const h = Math.max(2 * iy, p.minHeight);
      const cotL = 1 / Math.tan((p.trapeziumLeftAngle * Math.PI) / 180);
      const cotR = 1 / Math.tan((p.trapeziumRightAngle * Math.PI) / 180);
      const slant = h * (Math.abs(cotL) + Math.abs(cotR));
      const w = Math.max(2 * ix, p.minWidth - slant);
      // Interior angles at the bottom: under 90° the bottom side is longer.
      const bl = { x: -w / 2 - Math.max(0, h * cotL), y: -h / 2 };
      const tl = { x: -w / 2 + Math.min(0, h * cotL), y: h / 2 };
      const br = { x: w / 2 + Math.max(0, h * cotR), y: -h / 2 };
      const tr = { x: w / 2 - Math.min(0, h * cotR), y: h / 2 };
      let poly = [tl, tr, br, bl];
      // Centre the outline on the text box.
      const minX = Math.min(...poly.map((q) => q.x));
      const maxX = Math.max(...poly.map((q) => q.x));
      const dx = (minX + maxX) / 2;
      poly = poly.map((q) => ({ x: q.x - dx, y: q.y }));
      poly = rotatePolygon(poly, p.shapeBorderRotate);
      const hw = Math.max(...poly.map((q) => Math.abs(q.x)));
      const hh = Math.max(...poly.map((q) => Math.abs(q.y)));
      return { ...base, hw, hh, polygon: poly };
    }
    case "rounded rectangle": {
      const hh = Math.max(iy, p.minHeight / 2);
      const hw = Math.max(ix + hh * 0.5, p.minWidth / 2);
      return { ...base, hw, hh, roundedCorners: hh };
    }
    case "cylinder": {
      const vertical = Math.round(((p.shapeBorderRotate % 180) + 180) % 180) === 90;
      if (vertical) {
        const hw = Math.max(ix, p.minWidth / 2);
        const ry = hw * 0.25 * p.aspect;
        const hh = Math.max(iy + ry, p.minHeight / 2);
        return { ...base, hw, hh, detail: ry, vertical: true };
      }
      const hh = Math.max(iy, p.minHeight / 2);
      const rx = hh * 0.25 * p.aspect;
      const hw = Math.max(ix + 2 * rx, p.minWidth / 2);
      return { ...base, hw, hh, detail: rx, vertical: false };
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

function rotatePolygon(poly: Point[], deg: number): Point[] {
  if (!deg) return poly;
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return poly.map((q) => ({ x: q.x * c - q.y * s, y: q.x * s + q.y * c }));
}

/** The outline as a polygon (with outer sep added), relative to the centre. */
function outerPolygon(sh: NodeShape): Point[] {
  if (sh.polygon) {
    // Inflate by outer sep, approximately, by scaling.
    const sx = sh.hw ? (sh.hw + sh.outerX) / sh.hw : 1;
    const sy = sh.hh ? (sh.hh + sh.outerY) / sh.hh : 1;
    return sh.polygon.map((q) => ({ x: q.x * sx, y: q.y * sy }));
  }
  return [];
}

/** Where a ray from the centre in direction (dx, dy) meets the outer border. */
export function borderInDirection(sh: NodeShape, dx: number, dy: number): Point {
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
    default:
      if (sh.polygon) {
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
  // Intersect with the circle centred at (±straight, 0).
  const cx = Math.sign(ux) * straight;
  const bq = -2 * ux * cx;
  const cq = cx * cx - b * b;
  const disc = bq * bq - 4 * cq;
  return disc >= 0 ? (-bq + Math.sqrt(disc)) / 2 : tFlat;
}

/** Where the outer border meets the ray from the centre towards `p`. */
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
    const edge = borderInDirection(sh, dir, 0);
    return { x: edge.x, y };
  }
  if (n === "text") return { x: c.x - (sh.hw - 3.33333), y: base };
  const comp = COMPASS[n];
  if (!comp) {
    // Shape-specific anchors.
    if (sh.polygon && sh.kind === "trapezium") {
      const poly = outerPolygon(sh);
      const pick: Record<string, number> = { "top left corner": 0, "top right corner": 1, "bottom right corner": 2, "bottom left corner": 3 };
      const i = pick[n];
      if (i !== undefined) return { x: c.x + poly[i]!.x, y: c.y + poly[i]!.y };
      if (n === "top side") return { x: c.x, y: c.y + b };
      if (n === "bottom side") return { x: c.x, y: c.y - b };
    }
    return null;
  }
  const [ux, uy] = comp;
  if (ux === 0 || uy === 0) {
    if (sh.kind === "trapezium" && sh.polygon && uy === 0) {
      // Midpoints of the slanted sides.
      const poly = outerPolygon(sh);
      const [p, q] = ux > 0 ? [poly[1]!, poly[2]!] : [poly[0]!, poly[3]!];
      return { x: c.x + (p.x + q.x) / 2, y: c.y + (p.y + q.y) / 2 };
    }
    return borderInDirection(sh, ux, uy);
  }
  switch (sh.kind) {
    case "rectangle":
    case "tape":
    case "document":
    case "cylinder":
    case "rounded rectangle":
      return { x: c.x + ux * a, y: c.y + uy * b };
    case "diamond":
      return { x: c.x + (ux * a) / 2, y: c.y + (uy * b) / 2 };
    case "trapezium": {
      const poly = outerPolygon(sh);
      const i = uy > 0 ? (ux < 0 ? 0 : 1) : ux > 0 ? 2 : 3;
      return { x: c.x + poly[i]!.x, y: c.y + poly[i]!.y };
    }
    default:
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
      const d = sh.detail ?? 3;
      if (sh.vertical) {
        // Body plus the visible top ellipse.
        return (
          `M ${pt(-hw, hh - d)} A ${f(hw)} ${f(d)} 0 0 1 ${pt(hw, hh - d)} L ${pt(hw, -hh + d)} ` +
          `A ${f(hw)} ${f(d)} 0 0 1 ${pt(-hw, -hh + d)} Z M ${pt(-hw, hh - d)} A ${f(hw)} ${f(d)} 0 0 0 ${pt(hw, hh - d)}`
        );
      }
      return (
        `M ${pt(-hw + d, hh)} L ${pt(hw - d, hh)} A ${f(d)} ${f(hh)} 0 0 1 ${pt(hw - d, -hh)} L ${pt(-hw + d, -hh)} ` +
        `A ${f(d)} ${f(hh)} 0 0 1 ${pt(-hw + d, hh)} Z M ${pt(hw - d, hh)} A ${f(d)} ${f(hh)} 0 0 0 ${pt(hw - d, -hh)}`
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
  return {
    minX: sh.center.x - sh.hw - sh.outerX,
    maxX: sh.center.x + sh.hw + sh.outerX,
    minY: sh.center.y - sh.hh - sh.outerY,
    maxY: sh.center.y + sh.hh + sh.outerY,
  };
}

/** For anchoring: the offset from the centre to anchor `name` of a shape placed at the origin. */
export function anchorOffset(sh: NodeShape, name: string): Point | null {
  const at0 = { ...sh, center: { x: 0, y: 0 } };
  return anchorPoint(at0, name);
}
