// What an imported flowchart is, whatever its source: nodes with a shape and a
// label, edges with a line and arrow tips, and groups (Mermaid subgraphs, DOT
// clusters). The Mermaid and DOT readers fill this in; `tikz.ts` writes it as
// TikZ (M4 step 5, D84).

export type NodeShape =
  | "process"
  | "rounded"
  | "terminal"
  | "subroutine"
  | "database"
  | "circle"
  | "doublecircle"
  | "decision"
  | "hexagon"
  | "io"
  | "io alt"
  | "trapez"
  | "trapez alt"
  | "flag"
  | "plain"
  | "dot"
  | "oval";

/** An arrow tip, in the editor's words. */
export type Tip = "none" | "arrow" | "open" | "circle" | "open circle" | "cross" | "bar" | "diamond" | "open diamond" | "square";

/** Colors as the source wrote them, resolved to 0–255 channels; `undefined` for "not set". */
export type Rgb = readonly [number, number, number];

/** A look a node or an edge was given in the source (`style`, `classDef`, DOT attributes). */
export interface Look {
  fill?: Rgb;
  stroke?: Rgb;
  /** Text color. */
  text?: Rgb;
  /** Line width in pt. */
  width?: number;
  dashed?: boolean;
  dotted?: boolean;
}

export interface ImportNode {
  /** The id in the source. */
  id: string;
  /** Plain text; line breaks as "\n". */
  label: string;
  shape: NodeShape;
  /** Mermaid class names, in the order applied. */
  classes: string[];
  look: Look;
  /** Index into `groups` of the innermost group holding it. */
  group?: number;
}

export interface ImportEdge {
  /** Ids of nodes, or of groups (see `ImportGroup.id`) for Mermaid edges to a subgraph. */
  from: string;
  to: string;
  label?: string;
  line: "solid" | "dashed" | "dotted" | "thick" | "invisible";
  /** The tip at the `to` end and at the `from` end. */
  head: Tip;
  tail: Tip;
  look: Look;
}

export interface ImportGroup {
  /** The id in the source (a Mermaid subgraph's id; a DOT cluster's name). */
  id: string;
  title: string;
  /** Index of the group it sits in. */
  parent?: number;
  look: Look;
}

export interface ImportClass {
  name: string;
  look: Look;
}

export interface ImportGraph {
  format: "mermaid" | "dot";
  /** The way the flow runs in the source. */
  direction: "down" | "right";
  nodes: ImportNode[];
  edges: ImportEdge[];
  groups: ImportGroup[];
  classes: ImportClass[];
  /** What was left out or approximated, one sentence each. */
  notes: string[];
}

export class ImportError extends Error {
  /** 1-based line in the source, when known. */
  line: number | undefined;
  constructor(message: string, line?: number) {
    super(message);
    this.line = line;
  }
}

// ---------------------------------------------------------------- colors

const NAMED: Record<string, string> = {
  aliceblue: "f0f8ff",
  aqua: "00ffff",
  aquamarine: "7fffd4",
  azure: "f0ffff",
  beige: "f5f5dc",
  bisque: "ffe4c4",
  black: "000000",
  blue: "0000ff",
  blueviolet: "8a2be2",
  brown: "a52a2a",
  burlywood: "deb887",
  cadetblue: "5f9ea0",
  chartreuse: "7fff00",
  chocolate: "d2691e",
  coral: "ff7f50",
  cornflowerblue: "6495ed",
  cornsilk: "fff8dc",
  crimson: "dc143c",
  cyan: "00ffff",
  darkblue: "00008b",
  darkcyan: "008b8b",
  darkgoldenrod: "b8860b",
  darkgray: "a9a9a9",
  darkgrey: "a9a9a9",
  darkgreen: "006400",
  darkkhaki: "bdb76b",
  darkmagenta: "8b008b",
  darkolivegreen: "556b2f",
  darkorange: "ff8c00",
  darkorchid: "9932cc",
  darkred: "8b0000",
  darksalmon: "e9967a",
  darkseagreen: "8fbc8f",
  darkslateblue: "483d8b",
  darkslategray: "2f4f4f",
  darkslategrey: "2f4f4f",
  darkturquoise: "00ced1",
  darkviolet: "9400d3",
  deeppink: "ff1493",
  deepskyblue: "00bfff",
  dimgray: "696969",
  dimgrey: "696969",
  dodgerblue: "1e90ff",
  firebrick: "b22222",
  floralwhite: "fffaf0",
  forestgreen: "228b22",
  gainsboro: "dcdcdc",
  ghostwhite: "f8f8ff",
  gold: "ffd700",
  goldenrod: "daa520",
  gray: "bebebe",
  grey: "bebebe",
  green: "00ff00",
  greenyellow: "adff2f",
  honeydew: "f0fff0",
  hotpink: "ff69b4",
  indianred: "cd5c5c",
  indigo: "4b0082",
  ivory: "fffff0",
  khaki: "f0e68c",
  lavender: "e6e6fa",
  lavenderblush: "fff0f5",
  lawngreen: "7cfc00",
  lemonchiffon: "fffacd",
  lightblue: "add8e6",
  lightcoral: "f08080",
  lightcyan: "e0ffff",
  lightgoldenrodyellow: "fafad2",
  lightgray: "d3d3d3",
  lightgrey: "d3d3d3",
  lightgreen: "90ee90",
  lightpink: "ffb6c1",
  lightsalmon: "ffa07a",
  lightseagreen: "20b2aa",
  lightskyblue: "87cefa",
  lightslategray: "778899",
  lightslategrey: "778899",
  lightsteelblue: "b0c4de",
  lightyellow: "ffffe0",
  lime: "00ff00",
  limegreen: "32cd32",
  linen: "faf0e6",
  magenta: "ff00ff",
  maroon: "b03060",
  mediumaquamarine: "66cdaa",
  mediumblue: "0000cd",
  mediumorchid: "ba55d3",
  mediumpurple: "9370db",
  mediumseagreen: "3cb371",
  mediumslateblue: "7b68ee",
  mediumspringgreen: "00fa9a",
  mediumturquoise: "48d1cc",
  mediumvioletred: "c71585",
  midnightblue: "191970",
  mintcream: "f5fffa",
  mistyrose: "ffe4e1",
  moccasin: "ffe4b5",
  navajowhite: "ffdead",
  navy: "000080",
  navyblue: "000080",
  oldlace: "fdf5e6",
  olive: "808000",
  olivedrab: "6b8e23",
  orange: "ffa500",
  orangered: "ff4500",
  orchid: "da70d6",
  palegoldenrod: "eee8aa",
  palegreen: "98fb98",
  paleturquoise: "afeeee",
  palevioletred: "db7093",
  papayawhip: "ffefd5",
  peachpuff: "ffdab9",
  peru: "cd853f",
  pink: "ffc0cb",
  plum: "dda0dd",
  powderblue: "b0e0e6",
  purple: "a020f0",
  red: "ff0000",
  rosybrown: "bc8f8f",
  royalblue: "4169e1",
  saddlebrown: "8b4513",
  salmon: "fa8072",
  sandybrown: "f4a460",
  seagreen: "2e8b57",
  seashell: "fff5ee",
  sienna: "a0522d",
  silver: "c0c0c0",
  skyblue: "87ceeb",
  slateblue: "6a5acd",
  slategray: "708090",
  slategrey: "708090",
  snow: "fffafa",
  springgreen: "00ff7f",
  steelblue: "4682b4",
  tan: "d2b48c",
  teal: "008080",
  thistle: "d8bfd8",
  tomato: "ff6347",
  turquoise: "40e0d0",
  violet: "ee82ee",
  wheat: "f5deb3",
  white: "ffffff",
  whitesmoke: "f5f5f5",
  yellow: "ffff00",
  yellowgreen: "9acd32",
};

const hex = (s: string): Rgb => [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];

/**
 * A color as CSS or Graphviz writes it: `#f9f`, `#ff99ff`, `#ff99ffaa`, a name
 * (`lightblue`), Graphviz's `grayNN` and `/scheme/name` forms, `rgb(...)`.
 * Null when it isn't one of these.
 */
export function parseColor(raw: string): Rgb | null {
  let s = raw.trim().toLowerCase();
  if (!s || s === "none" || s === "transparent") return null;
  const hexm = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (hexm) {
    const h = hexm[1]!;
    if (h.length <= 4) return hex(`${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`);
    return hex(h.slice(0, 6));
  }
  const rgb = /^rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)/.exec(s);
  if (rgb) return [Math.min(255, +rgb[1]!), Math.min(255, +rgb[2]!), Math.min(255, +rgb[3]!)];
  // Graphviz color schemes: "/x11/red" is "red"; numbered schemes aren't known.
  const scheme = /^\/x11\/(.+)$/.exec(s);
  if (scheme) s = scheme[1]!;
  const gray = /^gr[ae]y(\d{1,3})$/.exec(s);
  if (gray) {
    const v = Math.round((Math.min(100, +gray[1]!) * 255) / 100);
    return [v, v, v];
  }
  // X11 names with a number (lightblue2) are shades of the name: the plain name is the closest we have.
  const base = /^([a-z]+?)[1-4]?$/.exec(s);
  const name = NAMED[s] ?? (base ? NAMED[base[1]!] : undefined);
  return name ? hex(name) : null;
}

/** Parses an HSV triple as Graphviz writes it ("0.650 0.200 1.000"). */
export function parseHsv(raw: string): Rgb | null {
  const m = /^\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)\s*$/.exec(raw);
  if (!m) return null;
  const [h, s, v] = [+m[1]!, +m[2]!, +m[3]!];
  if (![h, s, v].every((x) => x >= 0 && x <= 1)) return null;
  const k = (n: number) => (n + h * 6) % 6;
  const f = (n: number) => v - v * s * Math.max(0, Math.min(k(n), 4 - k(n), 1));
  return [Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)];
}

/** Whether a Look sets anything. */
export function hasLook(l: Look): boolean {
  return !!(l.fill || l.stroke || l.text || l.width !== undefined || l.dashed || l.dotted);
}

/** Merges looks, later ones winning. */
export function mergeLooks(...looks: Look[]): Look {
  const out: Look = {};
  for (const l of looks) {
    if (l.fill) out.fill = l.fill;
    if (l.stroke) out.stroke = l.stroke;
    if (l.text) out.text = l.text;
    if (l.width !== undefined) out.width = l.width;
    if (l.dashed) out.dashed = true;
    if (l.dotted) out.dotted = true;
  }
  return out;
}
