// The graphic and node state that TikZ keys modify.
import type { RGB } from "./colors.ts";
import { CM } from "./units.ts";

export interface FontSpec {
  /** Font size in pt. */
  size: number;
  /** Baseline skip in pt. */
  baselineskip: number;
  family: "rm" | "sf" | "tt";
  bold: boolean;
  italic: boolean;
  smallcaps: boolean;
}

export const NORMAL_FONT: FontSpec = { size: 10, baselineskip: 12, family: "rm", bold: false, italic: false, smallcaps: false };

/** LaTeX's size commands: [size, baselineskip] in pt. */
export type SizeTable = Readonly<Record<string, readonly [number, number]>>;

const SIZE_NAMES = ["\\tiny", "\\scriptsize", "\\footnotesize", "\\small", "\\normalsize", "\\large", "\\Large", "\\LARGE", "\\huge", "\\Huge"];

// The standard classes' size{10,11,12}.clo files.
const CLASS_SIZES: Record<number, Array<[number, number]>> = {
  10: [[5, 6], [7, 8], [8, 9.5], [9, 11], [10, 12], [12, 14], [14.4, 18], [17.28, 22], [20.74, 25], [24.88, 30]],
  11: [[6, 7], [8, 9.5], [9, 11], [10, 12], [10.95, 13.6], [12, 14], [14.4, 18], [17.28, 22], [20.74, 25], [24.88, 30]],
  12: [[6, 7], [8, 9.5], [10, 12], [10.95, 13.6], [12, 14.5], [14.4, 18], [17.28, 22], [20.74, 25], [24.88, 30], [24.88, 30]],
};

/** The size commands of a 10pt, 11pt or 12pt document class. */
export function fontSizes(classSize: number): SizeTable {
  const rows = CLASS_SIZES[classSize] ?? CLASS_SIZES[10]!;
  return Object.fromEntries(SIZE_NAMES.map((n, i) => [n, rows[i]!]));
}

/** LaTeX's size commands for a 10pt document class. */
export const FONT_SIZES: SizeTable = fontSizes(10);

export type Matrix = [number, number, number, number, number, number];

/** m * n: applies n first, then m. */
export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Applies only the linear part, for vectors such as shifts. */
export function applyLinear(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y, m[1] * x + m[3] * y];
}

export function invert(m: Matrix): Matrix | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return null;
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

export interface ArrowTip {
  /** Normalized tip name: "to", "stealth", "latex", "triangle", "bar", "circle", "square", "diamond", "kite", "round", "butt". */
  kind: string;
  open: boolean;
  /** Tip length and width in pt. Undefined means the kind's default for the line width. */
  length?: number;
  width?: number;
  /** How many times the tip repeats (">>"). */
  count: number;
  reversed: boolean;
}

/**
 * A positioning distance, vertical and horizontal. `single` when it was
 * written as one length ("2cm", not "2cm and 1cm"): the positioning library
 * then shifts a diagonal ("above left") by the length times √½ on each axis,
 * so the node is that far away along the diagonal (checked against pdfTeX:
 * spike/engines/probes/p13-diagonal-distances.tex).
 */
export interface NodeDistance {
  v: number;
  h: number;
  single?: boolean;
}

export type Placement =
  /** positioning library: "below=of a", "below=1cm of a", "below=2pt", "below". */
  | {
      kind: "relative";
      dir: string;
      shift?: string;
      of?: string;
      /** "on grid" and "node distance" as they were when the key ran: later ones don't apply. */
      onGrid?: boolean;
      distance?: NodeDistance;
    }
  /** pre-positioning syntax: "below of=a". */
  | {
      kind: "old";
      dir: string;
      of: string;
      /** What a positioning key in the same place would see; the old syntax itself reads them at the end. */
      onGrid?: boolean;
      distance?: NodeDistance;
    };

export interface Shading {
  /** Colors from one side to the other. */
  kind: "vertical" | "horizontal" | "radial";
  from: RGB;
  to: RGB;
  middle?: RGB;
}

/** Everything a key can change. Scopes copy it; nodes and paths start from a copy. */
export interface State {
  /** Font sizes of the document class. */
  sizes: SizeTable;
  /** The document's normal font size: what "em" means in lengths. */
  baseFontSize: number;
  // Graphic state, inherited by scopes and nested paths.
  color: RGB;
  drawColor?: RGB | "none";
  fillColor?: RGB | "none";
  textColor?: RGB;
  lineWidth: number;
  dash: number[] | null;
  roundedCorners: number;
  opacity: number;
  drawOpacity?: number;
  fillOpacity?: number;
  textOpacity?: number;
  font: FontSpec;
  /** The document's font, before any "font=" key: a later "font=" replaces an earlier one (checked against pdfTeX, probe p3). */
  docFont: FontSpec;
  /** The tips ">" and "<" stand for. */
  defaultEndTip: ArrowTip;
  defaultStartTip: ArrowTip;
  startTip: ArrowTip | null;
  endTip: ArrowTip | null;
  shortenStart: number;
  shortenEnd: number;
  nodeDistance: NodeDistance;
  onGrid: boolean;
  /**
   * The coordinate transformation, as in PGF: canvas x = a*x + c*y + e,
   * canvas y = b*x + d*y + f, for [a, b, c, d, e, f]. Node anchors are
   * already in canvas coordinates and aren't transformed again.
   */
  matrix: Matrix;
  /** Unit vectors for coordinates without units ("x=1cm, y=1cm"). */
  xUnit: [number, number];
  yUnit: [number, number];
  autoLabels: "left" | "right" | null;
  swap: boolean;
  sloped: boolean;
  shading?: Shading;
  shadow: boolean;
  /** "transform shape": nodes are scaled with the picture. */
  transformShape?: boolean;
  /** -1 on the background layer, 0 on the main one. */
  layer: number;

  // Node keys. They are inherited too (a scope can set "inner sep").
  shape: string;
  innerXSep: number;
  innerYSep: number;
  /**
   * Undefined until set: then it is half the node's own line width, as pgf's ".5\pgflinewidth" is. A
   * length that uses \pgflinewidth is kept as written, since pgf works it out when the node is made.
   */
  outerXSep?: number | string;
  outerYSep?: number | string;
  minWidth: number;
  minHeight: number;
  textWidth?: number;
  textHeight?: number;
  textDepth?: number;
  align?: "left" | "center" | "right" | "justify";
  anchor: string;
  aspect: number;
  trapeziumLeftAngle: number;
  trapeziumRightAngle: number;
  trapeziumStretches: boolean;
  shapeBorderRotate: number;

  // Per node or path: reset when one starts.
  draw: boolean;
  fill: boolean;
  /** Set by node keys. */
  name?: string;
  at?: string;
  /**
   * The `at=` option came after the last positioning key or `on chain`: it replaces only the
   * point, and the positioning's anchor and shift still apply (p14-at-after-positioning.tex).
   */
  atAfterPlacement?: boolean;
  placement?: Placement;
  xshift: number;
  yshift: number;
  fit?: string;
  /** Scopes: "local bounding box=name". */
  localBoundingBox?: string;
  /** chains: the chain new "on chain" nodes join, set by "start chain". */
  chain?: { name: string; dir: string; start: boolean };
  /** "on chain" (true) or "on chain=name". */
  onChain?: string | true;
  /**
   * "on grid" and "node distance" when "on chain" ran, which places the node, and the
   * position keys set before it: the chain's placement replaces those, not ones set after.
   */
  chainAt?: { onGrid: boolean; distance: NodeDistance; placement?: Placement; at?: string };
  /** "join" (true) or "join=by style" / "join=with node". */
  join?: string | true;
  labels: string[];
  /** Path nodes: position along the segment. */
  pos?: number;
  /** "bend angle", which a plain "bend left" uses (30 by default). */
  bendAngle?: number;
  out?: number;
  in?: number;
  /** "relative": out and in are measured from the line between the ends. */
  toRelative?: boolean;
  /** "out looseness" and "in looseness"; "looseness" sets both. */
  outLooseness: number;
  inLooseness: number;
  /** "min distance", "max distance" and their "in" and "out" forms (pt): bounds on a curve's control distances. */
  outMin: number;
  outMax: number;
  inMin: number;
  inMax: number;
  /** "loop" (topaths): the "to" ends where it starts. */
  loop?: boolean;
  /** "double": the color between the two lines; "double distance" (pt) is the gap. */
  double?: RGB;
  doubleDistance: number;
  /** The automata library's "initial by arrow" and "accepting by arrow". */
  initial?: AutomataArrow;
  accepting?: AutomataArrow;
  /** Keys the interpreter didn't understand, as written. */
  unknown: string[];
  /** Keys it understood but can't show natively (decorations, rotation). */
  unrendered: string[];
}

/** An arrow the automata library draws at a node, with its text, side and length. */
export interface AutomataArrow {
  /** "initial by arrow" (or "accepting by arrow") was given: "initial text" and the like only set the details. */
  on: boolean;
  text: string;
  where: "left" | "right" | "above" | "below";
  /** As written ("3ex" by default): ex depends on the node's font. */
  distance: string;
}

export const DEFAULT_TIP: ArrowTip = { kind: "to", open: false, count: 1, reversed: false };

export function initialState(): State {
  return {
    sizes: FONT_SIZES,
    baseFontSize: 10,
    color: [0, 0, 0],
    lineWidth: 0.4,
    dash: null,
    roundedCorners: 0,
    opacity: 1,
    font: { ...NORMAL_FONT },
    docFont: { ...NORMAL_FONT },
    defaultEndTip: DEFAULT_TIP,
    defaultStartTip: DEFAULT_TIP,
    startTip: null,
    endTip: null,
    shortenStart: 0,
    shortenEnd: 0,
    nodeDistance: { v: CM, h: CM },
    onGrid: false,
    matrix: [1, 0, 0, 1, 0, 0],
    xUnit: [CM, 0],
    yUnit: [0, CM],
    autoLabels: null,
    swap: false,
    sloped: false,
    shadow: false,
    layer: 0,
    shape: "rectangle",
    innerXSep: 3.33333,
    innerYSep: 3.33333,
    minWidth: 1,
    minHeight: 1,
    anchor: "center",
    aspect: 1,
    trapeziumLeftAngle: 60,
    trapeziumRightAngle: 60,
    trapeziumStretches: false,
    shapeBorderRotate: 0,
    draw: false,
    fill: false,
    xshift: 0,
    yshift: 0,
    labels: [],
    outLooseness: 1,
    inLooseness: 1,
    outMin: 0,
    outMax: 10000,
    inMin: 0,
    inMax: 10000,
    doubleDistance: 0.6,
    unknown: [],
    unrendered: [],
  };
}

/** A copy for a nested scope: graphic state is kept, per-item fields reset. */
export function scopeCopy(s: State): State {
  return {
    ...s,
    font: { ...s.font },
    matrix: [...s.matrix],
    xUnit: [...s.xUnit],
    yUnit: [...s.yUnit],
    nodeDistance: { ...s.nodeDistance },
    labels: [],
    unknown: [],
    unrendered: [],
  };
}

/** A copy for a new node or path: per-item fields reset. */
export function itemCopy(s: State): State {
  const c = scopeCopy(s);
  c.draw = false;
  c.fill = false;
  c.xshift = 0;
  c.yshift = 0;
  c.outLooseness = 1;
  c.inLooseness = 1;
  c.outMin = 0;
  c.outMax = 10000;
  c.inMin = 0;
  c.inMax = 10000;
  delete c.loop;
  delete c.initial;
  delete c.accepting;
  delete c.name;
  delete c.at;
  delete c.placement;
  delete c.fit;
  delete c.onChain;
  delete c.chainAt;
  delete c.join;
  delete c.pos;
  delete c.out;
  delete c.in;
  delete c.toRelative;
  return c;
}
