// TikZ's own keys that a style might be named after by accident (D83 item 3,
// D87). Defining `step/.style={…}` doesn't make a new style beside TikZ's
// `step`: it replaces the key, so everything that uses `step` gets the style
// instead, TikZ's own drawing included. A key that needs a value (`step=5mm`)
// keeps needing one, so using the style on its own stops TeX with an error.

/**
 * Keys that need a value: a style of that name is an error in TeX wherever it is used. What each does.
 * Which keys need one was checked with the engine (test/stylekeys-engine.test.ts).
 */
const VALUE_KEYS: Record<string, string> = {
  step: "the grid's spacing",
  scale: "scaling",
  xscale: "horizontal scaling",
  yscale: "vertical scaling",
  rotate: "rotation",
  shift: "shifting",
  xshift: "horizontal shifting",
  yshift: "vertical shifting",
  anchor: "the anchor a node is placed by",
  "text width": "the width text wraps at",
  "text height": "the height of a node's text",
  "text depth": "the depth of a node's text",
  "node distance": "the distance of relative placements",
  "line width": "the line width",
  font: "the font",
  shape: "a node's shape",
  name: "naming",
  at: "a node's position",
  pos: "where a label sits on a line",
  opacity: "opacity",
  "fill opacity": "fill opacity",
  "draw opacity": "line opacity",
  "text opacity": "text opacity",
  "dash pattern": "dash patterns",
  "shorten <": "shortening a line's start",
  "shorten >": "shortening a line's end",
  in: "the angle an edge comes in at",
  out: "the angle an edge leaves at",
  looseness: "how far a curve swings out",
  "line cap": "line ends",
  "line join": "line corners",
  "double distance": "the gap of double lines",
  "arrows": "arrow tips",
  color: "colors",
  text: "text color",
};

/** Keys that work without a value: a style of that name silently changes everything that uses the key. */
const PLAIN_KEYS: Record<string, string> = {
  "minimum width": "a node's least width",
  "minimum height": "a node's least height",
  "minimum size": "a node's least size",
  "inner sep": "a node's inner padding",
  "outer sep": "a node's outer padding",
  align: "text alignment",
  label: "labels on nodes",
  pin: "pins on nodes",
  fit: "fitting a node around others",
  "rounded corners": "rounded corners",
  "bend left": "bent edges",
  "bend right": "bent edges",
  "inner xsep": "a node's inner padding",
  "inner ysep": "a node's inner padding",
  "x radius": "an ellipse's radius",
  "y radius": "an ellipse's radius",
  radius: "a circle's radius",
  "aspect": "a diamond's proportions",
  draw: "drawing lines",
  fill: "filling",
  grid: "drawing grids",
  node: "nodes",
  coordinate: "coordinates",
  auto: "placing labels beside lines",
  swap: "the side of auto labels",
  sloped: "labels along lines",
  midway: "labels at the middle of a line",
  "near start": "labels near a line's start",
  "near end": "labels near a line's end",
  above: "placing above",
  below: "placing below",
  left: "placing left",
  right: "placing right",
  "above left": "placing above left",
  "above right": "placing above right",
  "below left": "placing below left",
  "below right": "placing below right",
  "on grid": "grid-aligned placement",
  double: "double lines",
  dashed: "dashed lines",
  dotted: "dotted lines",
  solid: "solid lines",
  thick: "thick lines",
  thin: "thin lines",
  "very thick": "very thick lines",
  "very thin": "very thin lines",
  "ultra thick": "ultra thick lines",
  "ultra thin": "ultra thin lines",
  "semithick": "semithick lines",
  loop: "loops",
  clip: "clipping",
  "use as bounding box": "the bounding box",
  "transform shape": "transforming nodes with the picture",
  overlay: "drawing outside the bounding box",
};

// Shape names (`cloud`, `circle`) aren't here: TikZ only falls back to them for keys it doesn't
// know, so a `cloud` style is the classic flowchart idiom and breaks nothing.
const KNOWN = new Map<string, { what: string; needsValue: boolean }>([
  ...Object.entries(PLAIN_KEYS).map(([k, what]) => [k, { what, needsValue: false }] as const),
  ...Object.entries(VALUE_KEYS).map(([k, what]) => [k, { what, needsValue: true }] as const),
]);

/** All the key names above, for checks that only need the names. */
export const TIKZ_KEY_NAMES: ReadonlySet<string> = new Set(KNOWN.keys());

/**
 * TikZ's own key a style named `name` would replace, and whether that key
 * needs a value; null for a name that is free. TikZ's `every …` styles are
 * meant to be redefined, so they don't count.
 */
export function tikzKeyClash(name: string): { what: string; needsValue: boolean } | null {
  const n = name.trim().replace(/\s+/g, " ");
  if (n.startsWith("every ")) return null;
  return KNOWN.get(n) ?? null;
}
