// Lays out one picture: evaluates its items in order, the way TikZ does, and
// produces node shapes, path geometry, and arrow tips in canvas pt (y up).
import type { BodyItem, NodeSyntax, OptionList, PathItemSyntax, PathSyntax, PictureSyntax, Range } from "../model/syntax.ts";
import { layoutLabel, type LabelEnv, type Macro, type TextLayout } from "../text/label.ts";
import { ColorTable, type RGB } from "./colors.ts";
import { type CoordEnv, type CoordResult, evalCoordText, type NameEntry } from "./coords.ts";
import { applyKeys, applyStyle, defaultTipLength, defaultTipWidth, KNOWN_SHAPES, parseNodeDistance, StyleTable } from "./keys.ts";
import { type KeyValue, parseOptionString } from "./options.ts";
import { anchorOffset, anchorPoint, borderToward, makeShape, type NodeShape, outline, type Point, shapeBounds } from "./shapes.ts";
import { applyLinear, applyMatrix, type ArrowTip, initialState, itemCopy, type Matrix, multiply, scopeCopy, type Shading, type State } from "./state.ts";
import { CM, evalQuantity } from "./units.ts";

export interface LayoutEnv {
  styles: StyleTable;
  colors: ColorTable;
  macros: ReadonlyMap<string, Macro>;
  /** Non-style keys from \tikzset in the preamble, applied to every picture. */
  settings: KeyValue[];
}

/** How a node's position is written, for the editor. */
export type PositionKind = "default" | "at" | "positioning" | "old-positioning" | "fit" | "path" | "unknown";

export interface LaidOutNode {
  id: string;
  name?: string;
  kind: NodeSyntax["kind"];
  syntax: NodeSyntax;
  /** The statement the node belongs to (for selection and highlighting). */
  statement: Range;
  shape: NodeShape;
  text?: TextLayout;
  /** Top-left corner of the text box. */
  textOrigin: Point;
  stroke?: RGB;
  fill?: RGB;
  shading?: Shading;
  shadow: boolean;
  textColor: RGB;
  lineWidth: number;
  dash: number[] | null;
  opacity: number;
  fillOpacity: number;
  /** Extra "label=" nodes drawn around this one. */
  extras: LaidOutNode[];
  position: { kind: PositionKind; refs: string[]; anchor: string };
  /** The frame the node's own coordinates are written in. */
  frame: Matrix;
  /** Lengths of the x and y unit vectors: what a plain number in a coordinate means. */
  units: { x: number; y: number };
  nodeDistance: { v: number; h: number };
  onGrid: boolean;
  /** Why the node can't be dragged, or undefined if it can. */
  locked?: string;
  unknownKeys: string[];
  unrendered: string[];
  /** Rotation of the label in degrees (sloped path labels). */
  rotate?: number;
  /** -1 for the background layer. */
  layer: number;
}

export interface Tip {
  at: Point;
  /** Direction the tip points, in radians. */
  angle: number;
  tip: ArrowTip;
  color: RGB;
  lineWidth: number;
}

export interface LaidOutPath {
  id: string;
  syntax: PathSyntax;
  /** The range to highlight for this path (the edge operation for "edge"). */
  range: Range;
  d: string;
  stroke?: RGB;
  fill?: RGB;
  shading?: Shading;
  lineWidth: number;
  dash: number[] | null;
  opacity: number;
  fillOpacity: number;
  tips: Tip[];
  /** Node ids this path touches, in order. */
  connects: string[];
  /** Node-to-node connections drawn by this path, waypoints skipped. */
  edges: Array<[string, string]>;
  issues: string[];
  unknownKeys: string[];
  unrendered: string[];
  layer: number;
}

export interface OpaqueLayout {
  range: Range;
  reason: string;
  names: string[];
}

export interface PictureLayout {
  nodes: LaidOutNode[];
  /** Path nodes (edge labels), drawn on top of paths. */
  pathNodes: LaidOutNode[];
  paths: LaidOutPath[];
  opaque: OpaqueLayout[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** Names defined inside kept-as-is blocks: references to them can't be drawn. */
  opaqueNames: Set<string>;
  /** "local bounding box" names and the ids of the nodes each one covers. */
  boxes: Map<string, string[]>;
  issues: Array<{ range: Range; message: string }>;
}

interface Scope {
  state: State;
  styles: StyleTable;
  /** "local bounding box=name": the name, and where this scope's nodes and paths start. */
  box?: { name: string; nodes: number; paths: number };
}

interface Ctx {
  env: LayoutEnv;
  names: Map<string, NameEntry>;
  ids: Map<string, number>;
  unnamed: number;
  overrides: ReadonlyMap<string, Point>;
  out: PictureLayout;
  labelEnv: LabelEnv;
}

const POSITIONING_ANCHOR: Record<string, string> = {
  above: "south",
  below: "north",
  left: "east",
  right: "west",
  "above left": "south east",
  "above right": "south west",
  "below left": "north east",
  "below right": "north west",
  "base left": "base east",
  "base right": "base west",
  "mid left": "mid east",
  "mid right": "mid west",
};

/** Unit direction of a positioning key, in canvas coordinates. */
const POSITIONING_DIR: Record<string, [number, number]> = {
  above: [0, 1],
  below: [0, -1],
  left: [-1, 0],
  right: [1, 0],
  "above left": [-1, 1],
  "above right": [1, 1],
  "below left": [-1, -1],
  "below right": [1, -1],
  "base left": [-1, 0],
  "base right": [1, 0],
  "mid left": [-1, 0],
  "mid right": [1, 0],
};

/** The anchor of the target a positioning key measures from: below=of a uses a.south. */
const OPPOSITE: Record<string, string> = {
  north: "south",
  south: "north",
  east: "west",
  west: "east",
  "north east": "south west",
  "north west": "south east",
  "south east": "north west",
  "south west": "north east",
  "base east": "base west",
  "base west": "base east",
  "mid east": "mid west",
  "mid west": "mid east",
};

export function positioningAnchor(dir: string): string {
  return POSITIONING_ANCHOR[dir] ?? "center";
}

export function positioningDirection(dir: string): [number, number] {
  return POSITIONING_DIR[dir] ?? [0, 0];
}

function keysOf(list: OptionList): KeyValue[] {
  return list.items.map((i) => (i.value === undefined ? { key: i.key } : { key: i.key, value: i.value }));
}

function keyCtx(ctx: Ctx, styles: StyleTable) {
  return { styles, colors: ctx.env.colors, shapes: KNOWN_SHAPES };
}

/** Lays out a picture. `overrides` pins node centres (by id) while dragging. */
export function layoutPicture(pic: PictureSyntax, env: LayoutEnv, overrides: ReadonlyMap<string, Point> = new Map()): PictureLayout {
  const out: PictureLayout = {
    nodes: [],
    pathNodes: [],
    paths: [],
    opaque: [],
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    opaqueNames: new Set(),
    boxes: new Map(),
    issues: [],
  };
  const ctx: Ctx = {
    env,
    names: new Map(),
    ids: new Map(),
    unnamed: 0,
    overrides,
    out,
    labelEnv: { macros: env.macros, color: (e) => env.colors.parse(e) },
  };
  const root = initialState();
  const rootStyles = env.styles.child();
  const kc = keyCtx(ctx, rootStyles);
  applyKeys(root, env.settings, kc);
  applyStyle(root, "every picture", kc);
  if (pic.options) applyKeys(root, keysOf(pic.options), kc);
  foldShift(root);
  const scopes: Scope[] = [{ state: root, styles: rootStyles }];

  for (const item of pic.items) {
    const scope = scopes[scopes.length - 1]!;
    switch (item.kind) {
      case "scope-begin": {
        const st = scopeCopy(scope.state);
        const styles = scope.styles.child();
        const skc = keyCtx(ctx, styles);
        applyStyle(st, "every scope", skc);
        if (item.options) applyKeys(st, keysOf(item.options), skc);
        foldShift(st);
        const inner: Scope = { state: st, styles };
        if (st.localBoundingBox) inner.box = { name: st.localBoundingBox, nodes: out.nodes.length, paths: out.paths.length };
        delete st.localBoundingBox;
        scopes.push(inner);
        break;
      }
      case "scope-end":
        if (scopes.length > 1) {
          const done = scopes.pop()!;
          if (done.box) registerBox(done.box, ctx);
        }
        break;
      case "styles":
        for (const d of item.defs) {
          if (d.defaultArg !== undefined) scope.styles.setDefault(d.name, d.defaultArg);
          else if (d.mode === "append") scope.styles.append(d.name, d.bodyText);
          else scope.styles.set(d.name, d.bodyText);
        }
        for (const s of item.settings) applyKeys(scope.state, keysOf(s), keyCtx(ctx, scope.styles));
        break;
      case "definition":
        if (item.def.kind === "color") env.colors.define(item.def.name, item.def.model, item.def.spec);
        else if (item.def.kind === "colorlet") {
          const c = env.colors.parse(item.def.expr);
          if (c) env.colors.set(item.def.name, c);
        }
        break;
      case "library":
        break;
      case "opaque":
        out.opaque.push({ range: item.range, reason: item.reason, names: item.names });
        for (const n of item.names) out.opaqueNames.add(n);
        break;
      case "node": {
        const node = layoutNode(item.node, scope, ctx, item.node.kind === "coordinate" ? "coordinate" : "statement", undefined, item.node);
        if (node && item.trailing) {
          // "\node (a) {A} edge (b);" continues as a path from the node.
          layoutPath(item.trailing, scope, ctx, { point: node.shape.center, node: { shape: node.shape, nodeId: node.id }, ref: node.id });
        }
        break;
      }
      case "path":
        layoutPath(item.path, scope, ctx);
        break;
    }
  }
  out.bounds = computeBounds(out);
  return out;
}

/** Makes a scope's bounding box available as a rectangular node. */
function registerBox(box: { name: string; nodes: number; paths: number }, ctx: Ctx) {
  const part: PictureLayout = { ...ctx.out, nodes: ctx.out.nodes.slice(box.nodes), pathNodes: [], paths: ctx.out.paths.slice(box.paths) };
  const b = computeBounds(part);
  const shape = makeShape(
    { kind: "rectangle", textWidth: 0, textHeight: 0, textDepth: 0, innerXSep: 0, innerYSep: 0, outerXSep: 0, outerYSep: 0, minWidth: b.maxX - b.minX, minHeight: b.maxY - b.minY, roundedCorners: 0, aspect: 1, trapeziumLeftAngle: 60, trapeziumRightAngle: 60, shapeBorderRotate: 0 },
    { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 },
  );
  ctx.names.set(box.name, { shape });
  ctx.out.boxes.set(box.name, part.nodes.map((n) => n.id));
}

/** Moves accumulated xshift/yshift of a scope into its matrix. */
function foldShift(st: State) {
  if (st.xshift || st.yshift) st.matrix = multiply(st.matrix, [1, 0, 0, 1, st.xshift, st.yshift]);
  st.xshift = 0;
  st.yshift = 0;
}

function nextId(ctx: Ctx, name: string | undefined): string {
  if (!name) return `#${++ctx.unnamed}`;
  const n = (ctx.ids.get(name) ?? 0) + 1;
  ctx.ids.set(name, n);
  return n === 1 ? name : `${name}#${n}`;
}

function coordEnv(ctx: Ctx, st: State): CoordEnv {
  return { names: ctx.names, state: st };
}

/** Evaluates a coordinate written in node options ("at=(...)"), without parentheses or with. */
function evalLoose(text: string, ctx: Ctx, st: State): CoordResult {
  let t = text.trim();
  if (t.startsWith("{") && t.endsWith("}")) t = t.slice(1, -1).trim();
  if (t.startsWith("(") && t.endsWith(")")) t = t.slice(1, -1);
  return evalCoordText(t, coordEnv(ctx, st));
}

function layoutNode(
  syn: NodeSyntax,
  scope: Scope,
  ctx: Ctx,
  kind: "statement" | "coordinate" | "path",
  pathState?: State,
  statement?: Range,
  pathPos?: { point: Point; angle: number },
): LaidOutNode | null {
  const st = itemCopy(pathState ?? scope.state);
  const styles = scope.styles.child();
  const kc = keyCtx(ctx, styles);
  if (kind === "coordinate") st.shape = "coordinate";
  else applyStyle(st, "every node", kc);
  // Path state options like "draw" don't carry over to nodes on the path.
  st.draw = false;
  st.fill = false;
  delete st.shading;
  st.shadow = false;
  // Positioning keys set the anchor as they are applied, so a later "anchor=" wins.
  for (const list of syn.options) {
    for (const kv of keysOf(list)) {
      const before = st.placement;
      applyKeys(st, [kv], kc);
      if (st.placement && st.placement !== before && st.placement.kind === "relative") st.anchor = positioningAnchor(st.placement.dir);
      else if (st.placement && st.placement !== before && st.placement.kind === "old") st.anchor = "center";
    }
  }
  if (kind === "coordinate") st.shape = "coordinate";
  const name = syn.name?.text ?? st.name;
  const id = nextId(ctx, name);

  // Text.
  let text: TextLayout | undefined;
  if (syn.label && st.shape !== "coordinate") {
    const opts: Parameters<typeof layoutLabel>[1] = { font: st.font, color: st.textColor ?? st.color };
    if (st.textWidth !== undefined) opts.textWidth = st.textWidth;
    if (st.align !== undefined) opts.align = st.align;
    text = layoutLabel(syn.label.text, opts, ctx.labelEnv);
  }
  const tw = text?.width ?? 0;
  const th = st.textHeight ?? text?.height ?? 0;
  const td = st.textDepth ?? text?.depth ?? 0;

  const locked: string[] = [];
  const refs: string[] = [];
  let posKind: PositionKind = "default";

  // Fit: the node covers the listed coordinates.
  let minWidth = st.minWidth;
  let minHeight = st.minHeight;
  let fitCenter: Point | null = null;
  if (st.fit) {
    posKind = "fit";
    const box = fitBox(st.fit, ctx, st, refs);
    if (box) {
      minWidth = Math.max(minWidth, box.maxX - box.minX + 2 * st.innerXSep);
      minHeight = Math.max(minHeight, box.maxY - box.minY + 2 * st.innerYSep);
      fitCenter = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
    } else locked.push("fits nodes the editor can't place");
  }

  const shape0 = makeShape(
    {
      kind: st.shape,
      textWidth: tw,
      textHeight: th,
      textDepth: td,
      innerXSep: st.innerXSep,
      innerYSep: st.innerYSep,
      outerXSep: st.outerXSep,
      outerYSep: st.outerYSep,
      minWidth,
      minHeight,
      roundedCorners: st.roundedCorners,
      aspect: st.aspect,
      trapeziumLeftAngle: st.trapeziumLeftAngle,
      trapeziumRightAngle: st.trapeziumRightAngle,
      shapeBorderRotate: st.shapeBorderRotate,
    },
    { x: 0, y: 0 },
  );

  // Position: the "at" point, which the node's anchor is put on.
  let at: Point = { x: st.matrix[4], y: st.matrix[5] };
  let anchor = st.anchor;
  if (kind === "path" && pathPos) {
    posKind = "path";
    at = pathPos.point;
  }
  const atText = syn.at?.coord.text ?? st.at;
  if (atText !== undefined) {
    posKind = "at";
    const r = syn.at ? evalCoordText(atText, coordEnv(ctx, st)) : evalLoose(atText, ctx, st);
    refs.push(...r.refs);
    if (r.ok) at = r.point;
    else locked.push(r.reason);
  }
  const placement = st.placement;
  if (placement) {
    if (placement.kind === "relative" && placement.dir === "unmodelled") {
      posKind = "unknown";
      locked.push(`position set by "${placement.of}"`);
    } else if (placement.kind === "old") {
      posKind = "old-positioning";
      const target = evalLoose(placement.of, ctx, st);
      refs.push(...target.refs);
      if (target.ok) {
        const [ux, uy] = positioningDirection(placement.dir);
        const dist = st.nodeDistance;
        const [dx, dy] = applyLinear(st.matrix, ux * dist.v, uy * dist.v);
        const base = target.node ? target.node.shape.center : target.point;
        at = { x: base.x + dx, y: base.y + dy };
      } else locked.push(target.reason);
    } else if (placement.kind === "relative") {
      const [ux, uy] = positioningDirection(placement.dir);
      let shiftV = 0;
      let shiftH = 0;
      if (placement.shift !== undefined) {
        const d = parseNodeDistance(placement.shift, st);
        if (d) {
          shiftV = d.v;
          shiftH = d.h;
        } else locked.push(`distance "${placement.shift}"`);
      }
      if (placement.of !== undefined) {
        posKind = "positioning";
        if (placement.shift === undefined) {
          shiftV = st.nodeDistance.v;
          shiftH = st.nodeDistance.h;
        }
        const target = evalLoose(placement.of, ctx, st);
        refs.push(...target.refs);
        if (target.ok) {
          let base = target.point;
          if (target.node) {
            // A bare node name: measure from its border, or its centre on grid.
            base = st.onGrid ? target.node.shape.center : (anchorPoint(target.node.shape, OPPOSITE[positioningAnchor(placement.dir)] ?? "center") ?? base);
          }
          if (st.onGrid && anchor === positioningAnchor(placement.dir)) anchor = "center";
          const [dx, dy] = applyLinear(st.matrix, ux * shiftH, uy * shiftV);
          at = { x: base.x + dx, y: base.y + dy };
        } else locked.push(target.reason);
      } else {
        // "below=2pt": shift the node away from its at point.
        const [dx, dy] = applyLinear(st.matrix, ux * shiftH, uy * shiftV);
        at = { x: at.x + dx, y: at.y + dy };
      }
    }
  }
  if (st.xshift || st.yshift) {
    const [dx, dy] = applyLinear(st.matrix, st.xshift, st.yshift);
    at = { x: at.x + dx, y: at.y + dy };
  }
  let center: Point;
  const off = anchorOffset(shape0, anchor);
  if (!off) locked.push(`anchor "${anchor}"`);
  center = { x: at.x - (off?.x ?? 0), y: at.y - (off?.y ?? 0) };
  if (fitCenter) center = fitCenter;
  const override = ctx.overrides.get(id);
  if (override) center = override;
  const shape: NodeShape = { ...shape0, center };

  // Editing restrictions.
  if (kind === "path") locked.push("it is part of a path (edge labels are edited in a later milestone)");
  if (name && /[\\#]/.test(name)) locked.push("its name contains a macro");
  if (posKind === "fit") locked.push("its size and position follow the nodes it fits");
  for (const r of refs) if (ctx.out.opaqueNames.has(r)) locked.push(`it is placed relative to "${r}", inside a block kept as-is`);

  const strokeColor = st.drawColor === "none" ? undefined : (st.drawColor ?? st.color);
  const fillColor = st.fillColor === "none" ? undefined : (st.fillColor ?? st.color);
  const node: LaidOutNode = {
    id,
    kind,
    syntax: syn,
    statement: statement ?? { from: syn.from, to: syn.to },
    shape,
    textOrigin: { x: center.x - tw / 2, y: center.y + (th + td) / 2 },
    shadow: st.shadow,
    textColor: st.textColor ?? st.color,
    lineWidth: st.lineWidth,
    dash: st.dash,
    opacity: st.opacity,
    fillOpacity: st.fillOpacity ?? st.opacity,
    extras: [],
    position: { kind: posKind, refs: [...new Set(refs)], anchor },
    frame: st.matrix,
    units: { x: Math.hypot(...st.xUnit), y: Math.hypot(...st.yUnit) },
    nodeDistance: { ...st.nodeDistance },
    onGrid: st.onGrid,
    unknownKeys: st.unknown,
    unrendered: [...st.unrendered, ...(text?.issues ?? []).map((i) => `label: ${i}`)],
    layer: st.layer,
  };
  if (name) node.name = name;
  if (text) node.text = text;
  if (st.draw && strokeColor) node.stroke = strokeColor;
  if (st.fill && fillColor && !st.shading) node.fill = fillColor;
  if (st.shading) node.shading = st.shading;
  if (locked.length) node.locked = locked[0]!;
  if (kind === "path" && st.sloped && pathPos) {
    let a = (pathPos.angle * 180) / Math.PI;
    if (a > 90) a -= 180;
    if (a < -90) a += 180;
    node.rotate = a;
  }

  // "label=" and "pin=" extras.
  for (const spec of st.labels) {
    const extra = labelNode(spec, node, scope, ctx);
    if (extra) node.extras.push(extra);
  }

  if (name) ctx.names.set(name, { shape, nodeId: id });
  if (kind === "path") ctx.out.pathNodes.push(node);
  else ctx.out.nodes.push(node);
  return node;
}

/** Bounding box of "fit=(a) (b) (c)". */
function fitBox(spec: string, ctx: Ctx, st: State, refs: string[]) {
  const coords = [...spec.matchAll(/\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)].map((m) => m[1]!);
  if (!coords.length) return null;
  let box: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
  for (const c of coords) {
    const r = evalCoordText(c, coordEnv(ctx, st));
    refs.push(...r.refs);
    if (!r.ok) return null;
    const b = r.node ? shapeBounds(r.node.shape) : { minX: r.point.x, maxX: r.point.x, minY: r.point.y, maxY: r.point.y };
    box = box
      ? { minX: Math.min(box.minX, b.minX), minY: Math.min(box.minY, b.minY), maxX: Math.max(box.maxX, b.maxX), maxY: Math.max(box.maxY, b.maxY) }
      : b;
  }
  return box;
}

/** "label=[opts]above left:text" → a small node next to `owner`. */
function labelNode(spec: string, owner: LaidOutNode, scope: Scope, ctx: Ctx): LaidOutNode | null {
  let s = spec.trim();
  if (s.startsWith("{") && s.endsWith("}")) s = s.slice(1, -1);
  let opts = "";
  if (s.startsWith("[")) {
    const end = s.indexOf("]");
    opts = s.slice(1, end);
    s = s.slice(end + 1);
  }
  let dir = "above";
  const colon = s.indexOf(":");
  if (colon >= 0 && !s.slice(0, colon).includes("$")) {
    dir = s.slice(0, colon).trim();
    s = s.slice(colon + 1);
  }
  const st = itemCopy(scope.state);
  const styles = scope.styles.child();
  const kc = keyCtx(ctx, styles);
  applyStyle(st, "every label", kc);
  applyKeys(st, parseOptionString(opts), kc);
  const text = layoutLabel(s.trim(), { font: st.font, color: st.textColor ?? st.color }, ctx.labelEnv);
  const angleAnchor: Record<string, number> = { right: 0, "above right": 45, above: 90, "above left": 135, left: 180, "below left": 225, below: 270, "below right": 315 };
  const angle = /^-?\d+(\.\d+)?$/.test(dir) ? parseFloat(dir) : angleAnchor[dir];
  if (angle === undefined) return null;
  const r = (angle * Math.PI) / 180;
  const attach = anchorPoint(owner.shape, String(angle)) ?? owner.shape.center;
  const shape0 = makeShape(
    {
      kind: "rectangle",
      textWidth: text.width,
      textHeight: text.height,
      textDepth: text.depth,
      innerXSep: st.innerXSep,
      innerYSep: st.innerYSep,
      outerXSep: 0,
      outerYSep: 0,
      minWidth: 0,
      minHeight: 0,
      roundedCorners: 0,
      aspect: 1,
      trapeziumLeftAngle: 60,
      trapeziumRightAngle: 60,
      shapeBorderRotate: 0,
    },
    { x: 0, y: 0 },
  );
  // The label's anchor faces the node: the opposite direction.
  const toward = { x: -Math.cos(r), y: -Math.sin(r) };
  const edge = borderToward(shape0, toward);
  const center = { x: attach.x - edge.x, y: attach.y - edge.y };
  return {
    id: `${owner.id}/label`,
    kind: "path",
    syntax: owner.syntax,
    statement: owner.statement,
    shape: { ...shape0, center },
    text,
    textOrigin: { x: center.x - text.width / 2, y: center.y + (text.height + text.depth) / 2 },
    shadow: false,
    textColor: st.textColor ?? st.color,
    lineWidth: st.lineWidth,
    dash: null,
    opacity: st.opacity,
    fillOpacity: 1,
    extras: [],
    position: { kind: "path", refs: [], anchor: "center" },
    frame: st.matrix,
    units: { x: Math.hypot(...st.xUnit), y: Math.hypot(...st.yUnit) },
    nodeDistance: st.nodeDistance,
    onGrid: false,
    unknownKeys: st.unknown,
    unrendered: [],
    layer: owner.layer,
  };
}

// ---------------------------------------------------------------- paths

interface Segment {
  kind: "line" | "curve" | "hv" | "vh";
  from: Point;
  to: Point;
  c1?: Point;
  c2?: Point;
}

interface PathPoint {
  point: Point;
  /** Set for a bare node name: the path clips to its border. */
  node?: NameEntry;
  /** Id of the node the point belongs to, with or without an anchor. */
  ref?: string;
}

function segPoint(seg: Segment, t: number): { point: Point; angle: number } {
  const lerp = (a: Point, b: Point, u: number) => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
  const ang = (a: Point, b: Point) => Math.atan2(b.y - a.y, b.x - a.x);
  if (seg.kind === "line") return { point: lerp(seg.from, seg.to, t), angle: ang(seg.from, seg.to) };
  if (seg.kind === "hv" || seg.kind === "vh") {
    const corner = seg.kind === "vh" ? { x: seg.from.x, y: seg.to.y } : { x: seg.to.x, y: seg.from.y };
    if (t <= 0.5) return { point: lerp(seg.from, corner, t * 2), angle: ang(seg.from, corner) };
    return { point: lerp(corner, seg.to, (t - 0.5) * 2), angle: ang(corner, seg.to) };
  }
  const { from: p0, c1, c2, to: p3 } = seg as Required<Segment>;
  const u = 1 - t;
  const point = {
    x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y,
  };
  const dx = 3 * u * u * (c1.x - p0.x) + 6 * u * t * (c2.x - c1.x) + 3 * t * t * (p3.x - c2.x);
  const dy = 3 * u * u * (c1.y - p0.y) + 6 * u * t * (c2.y - c1.y) + 3 * t * t * (p3.y - c2.y);
  return { point, angle: Math.atan2(dy, dx) };
}

const f3 = (v: number) => Math.round(v * 1000) / 1000;
const P = (p: Point) => `${f3(p.x)} ${f3(p.y)}`;

/** Border point of `pp` towards `toward`, or the point itself when it isn't a bare node. */
function clip(pp: PathPoint, toward: Point): Point {
  if (!pp.node) return pp.point;
  if (pp.node.shape.kind === "coordinate") return pp.node.shape.center;
  return borderToward(pp.node.shape, toward);
}

function clipAngle(pp: PathPoint, angleDeg: number): Point {
  if (!pp.node || pp.node.shape.kind === "coordinate") return pp.point;
  const r = (angleDeg * Math.PI) / 180;
  return anchorPoint(pp.node.shape, String(((angleDeg % 360) + 360) % 360)) ?? { x: pp.point.x + Math.cos(r), y: pp.point.y + Math.sin(r) };
}

/** Builds the segment for "to" with bend/out/in options. */
function toSegment(a: PathPoint, b: PathPoint, st: State): Segment {
  const ca = a.point;
  const cb = b.point;
  if (st.bend === undefined && st.out === undefined && st.in === undefined) {
    return { kind: "line", from: clip(a, cb), to: clip(b, ca) };
  }
  const base = (Math.atan2(cb.y - ca.y, cb.x - ca.x) * 180) / Math.PI;
  let outA: number;
  let inA: number;
  if (st.bend) {
    const k = st.bend.side === "left" ? 1 : -1;
    outA = base + k * st.bend.angle;
    inA = base + 180 - k * st.bend.angle;
  } else {
    outA = st.out ?? base;
    inA = st.in ?? base + 180;
  }
  const from = clipAngle(a, outA);
  const to = clipAngle(b, inA);
  const dist = Math.hypot(to.x - from.x, to.y - from.y) * 0.3915 * st.looseness;
  const r1 = (outA * Math.PI) / 180;
  const r2 = (inA * Math.PI) / 180;
  return {
    kind: "curve",
    from,
    to,
    c1: { x: from.x + Math.cos(r1) * dist, y: from.y + Math.sin(r1) * dist },
    c2: { x: to.x + Math.cos(r2) * dist, y: to.y + Math.sin(r2) * dist },
  };
}

function segToD(seg: Segment, move: boolean): string {
  const m = move ? `M ${P(seg.from)} ` : "";
  switch (seg.kind) {
    case "line":
      return `${m}L ${P(seg.to)}`;
    case "hv":
      return `${m}L ${f3(seg.to.x)} ${f3(seg.from.y)} L ${P(seg.to)}`;
    case "vh":
      return `${m}L ${f3(seg.from.x)} ${f3(seg.to.y)} L ${P(seg.to)}`;
    case "curve":
      return `${m}C ${P(seg.c1!)} ${P(seg.c2!)} ${P(seg.to)}`;
  }
}

function tipLength(tip: ArrowTip, lw: number) {
  return (tip.length ?? defaultTipLength(tip.kind, lw)) * Math.max(1, tip.count) * (tip.count > 1 ? 0.8 : 1);
}

/** Shortens the end of a segment by `len` so the tip ends on the original point. */
function shortenEnd(seg: Segment, len: number): Segment {
  if (len <= 0) return seg;
  const end = seg.to;
  let prev: Point;
  if (seg.kind === "curve") prev = seg.c2!;
  else if (seg.kind === "hv") prev = { x: seg.to.x, y: seg.from.y };
  else if (seg.kind === "vh") prev = { x: seg.from.x, y: seg.to.y };
  else prev = seg.from;
  const d = Math.hypot(end.x - prev.x, end.y - prev.y) || 1;
  const k = Math.min(len, d * 0.9) / d;
  const to = { x: end.x - (end.x - prev.x) * k, y: end.y - (end.y - prev.y) * k };
  const out = { ...seg, to };
  if (seg.kind === "curve") out.c2 = { x: seg.c2!.x - (end.x - prev.x) * k * 0.5, y: seg.c2!.y - (end.y - prev.y) * k * 0.5 };
  return out;
}

function reverse(seg: Segment): Segment {
  const r: Segment = { ...seg, from: seg.to, to: seg.from };
  if (seg.kind === "curve") {
    r.c1 = seg.c2!;
    r.c2 = seg.c1!;
  }
  if (seg.kind === "hv") r.kind = "vh";
  if (seg.kind === "vh") r.kind = "hv";
  return r;
}

function endAngle(seg: Segment): number {
  return segPoint(seg, 1).angle;
}

interface PendingNode {
  syn: NodeSyntax;
  /** True when the node came after an operation and before its target ("-- node {x} (b)"). */
  after: boolean;
}

interface PathBuild {
  segments: Segment[];
  subpathStarts: number[];
  /** Closed shapes drawn with the path: rectangles, circles, arcs. */
  extra: string[];
  connects: string[];
  edges: Array<[string, string]>;
  issues: string[];
}

/** Lays out a path statement, and any "edge" operations in it as separate paths. */
function layoutPath(syn: PathSyntax, scope: Scope, ctx: Ctx, start?: PathPoint): void {
  const st = itemCopy(scope.state);
  const styles = scope.styles.child();
  const kc = keyCtx(ctx, styles);
  applyStyle(st, "every path", kc);
  if (syn.command === "\\draw" || syn.command === "\\filldraw") st.draw = true;
  if (syn.command === "\\fill" || syn.command === "\\filldraw") st.fill = true;
  // Options anywhere on the path apply to all of it, except those that
  // belong to a "to" or "edge" operation.
  syn.items.forEach((it, i) => {
    const prev = syn.items[i - 1];
    const opOption = prev && prev.kind === "keyword" && (prev.word === "to" || prev.word === "edge");
    if (it.kind === "options" && !opOption) applyKeys(st, keysOf(it.list), kc);
  });

  const main: PathBuild = { segments: [], subpathStarts: [], extra: [], connects: [], edges: [], issues: [] };
  // The last node the current subpath passed through.
  let chainRef: string | undefined = start?.ref;
  const edges: Array<{ build: PathBuild; st: State; range: Range; nodes: PendingNode[] }> = [];
  const pending: PendingNode[] = [];
  let cur: PathPoint | null = start ?? null;
  // "+(...)" is relative to this point; "++(...)" moves it.
  let base: Point | null = start?.point ?? null;
  let subStart: Point | null = start?.point ?? null;
  if (start?.ref) main.connects.push(start.ref);
  type Op = "move" | "--" | "-|" | "|-" | "to" | "edge" | "controls" | "rectangle" | "circle" | "ellipse" | "arc" | "skip";
  let op: Op = "move";
  let opState: State | null = null;
  let opRange: Range | null = null;
  let opNodes: PendingNode[] = [];
  let controls: Array<{ text: string; relative?: "+" | "++" }> = [];
  let broken = false;

  const evalAt = (coord: { text: string; relative?: "+" | "++" }, origin: Point | null): CoordResult => {
    if (coord.relative) {
      const linear: Matrix = [st.matrix[0], st.matrix[1], st.matrix[2], st.matrix[3], 0, 0];
      const rel = evalCoordText(coord.text, { names: ctx.names, state: { ...st, matrix: linear } });
      if (!rel.ok) return rel;
      if (!origin) return { ok: false, reason: "relative coordinate without a start point", refs: rel.refs };
      return { ok: true, point: { x: origin.x + rel.point.x, y: origin.y + rel.point.y }, refs: rel.refs };
    }
    return evalCoordText(coord.text, coordEnv(ctx, st));
  };

  const placeNodes = (nodes: PendingNode[], seg: Segment | null, at: Point, nodeState: State) => {
    for (const pn of nodes) {
      const probe = itemCopy(nodeState);
      applyKeys(probe, pn.syn.options.flatMap(keysOf), keyCtx(ctx, styles.child()));
      const t = probe.pos ?? (pn.after ? 0.5 : 1);
      const where = seg ? segPoint(seg, t) : { point: at, angle: 0 };
      let synEff = pn.syn;
      // "auto" puts the label on the left of the direction of travel ("swap": right).
      const explicit = pn.syn.options.some((o) => o.items.some((i) => /^(above|below|left|right)( (left|right))?$|^anchor$/.test(i.key)));
      if (probe.autoLabels && !explicit && seg && pn.syn.kind !== "coordinate") {
        const right = (probe.autoLabels === "right") !== probe.swap;
        const normal = where.angle + (right ? -Math.PI / 2 : Math.PI / 2);
        // The anchor faces back towards the path.
        const anchors = ["west", "south west", "south", "south east", "east", "north east", "north", "north west"];
        const deg = ((((normal * 180) / Math.PI) % 360) + 360) % 360;
        const idx = Math.round(deg / 45) % 8;
        const anchorItem = { from: 0, to: 0, key: "anchor", keyRange: { from: 0, to: 0 }, value: anchors[idx]! };
        synEff = { ...pn.syn, options: [...pn.syn.options, { from: 0, to: 0, items: [anchorItem], commas: [] }] };
      }
      const n = layoutNode(synEff, scope, ctx, pn.syn.kind === "coordinate" ? "coordinate" : "path", nodeState, syn, where);
      // Path coordinates are points other paths can use, not labels.
      if (n && pn.syn.kind === "coordinate") ctx.out.pathNodes.pop();
    }
  };

  const items = syn.items;
  for (let i = 0; i < items.length && !broken; i++) {
    const it: PathItemSyntax = items[i]!;
    switch (it.kind) {
      case "options":
        if ((op === "to" || op === "edge") && opState) applyKeys(opState, keysOf(it.list), kc);
        break;
      case "op":
        if (it.op === "..") op = op === "controls" ? "controls" : "skip";
        else {
          op = it.op;
          opState = null;
        }
        break;
      case "keyword":
        switch (it.word) {
          case "to":
            op = "to";
            opState = itemCopy(st);
            break;
          case "edge":
            op = "edge";
            opState = itemCopy(st);
            opState.fill = false;
            applyStyle(opState, "every edge", kc);
            opState.draw = true;
            opRange = it.range;
            opNodes = [];
            break;
          case "controls":
            op = "controls";
            controls = [];
            break;
          case "and":
            break;
          case "cycle":
            if (cur && subStart) {
              const seg: Segment = { kind: "line", from: cur.point, to: subStart };
              main.segments.push(seg);
              placeNodes(pending.splice(0), seg, subStart, st);
              cur = { point: subStart };
              base = subStart;
            }
            op = "move";
            break;
          case "rectangle":
          case "arc":
            op = it.word;
            break;
          case "circle":
          case "ellipse": {
            op = it.word;
            // "circle [radius=2pt]" takes its size from options.
            const next = items[i + 1];
            if (next && next.kind === "options" && cur) {
              const kv = keysOf(next.list);
              const rx = kv.find((k) => k.key === "radius" || k.key === "x radius")?.value;
              const ry = kv.find((k) => k.key === "radius" || k.key === "y radius")?.value;
              const a = rx ? radius(rx) : null;
              const b = ry ? radius(ry) : null;
              if (a !== null && b !== null) {
                main.extra.push(ellipseD(cur.point, a, b));
                i++;
                op = "move";
              }
            }
            break;
          }
          default:
            main.issues.push(`"${it.word}" isn't drawn natively`);
            op = "skip";
        }
        break;
      case "node":
        if (op === "edge") opNodes.push({ syn: it.node, after: true });
        else pending.push({ syn: it.node, after: op !== "move" && op !== "skip" });
        break;
      case "unknown": {
        const t = it.text.trim();
        main.issues.push(`"${t.slice(0, 30)}" isn't understood here`);
        if (/^\\|^let$|^plot$|^pic$|^decorate$|^foreach$/.test(t)) broken = true;
        break;
      }
      case "coord": {
        if (op === "circle" || op === "ellipse") {
          const parts = it.coord.text.split(/\s+and\s+/);
          const a = radius(parts[0]!);
          const b = radius(parts[1] ?? parts[0]!);
          if (cur && a !== null && b !== null) main.extra.push(ellipseD(cur.point, a, b));
          else main.issues.push(`${op} size "${it.coord.text}"`);
          op = "move";
          break;
        }
        if (op === "arc") {
          const m = /^\s*(-?[\d.]+)\s*:\s*(-?[\d.]+)\s*:\s*(.+)$/.exec(it.coord.text);
          const r = m ? radius(m[3]!) : null;
          if (m && cur && r !== null) {
            const a0 = (parseFloat(m[1]!) * Math.PI) / 180;
            const a1 = (parseFloat(m[2]!) * Math.PI) / 180;
            const c = { x: cur.point.x - r * Math.cos(a0), y: cur.point.y - r * Math.sin(a0) };
            const end = { x: c.x + r * Math.cos(a1), y: c.y + r * Math.sin(a1) };
            const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
            main.extra.push(`M ${P(cur.point)} A ${f3(r)} ${f3(r)} 0 ${large} ${a1 > a0 ? 1 : 0} ${P(end)}`);
            cur = { point: end };
            base = end;
          } else main.issues.push(`arc "${it.coord.text}"`);
          op = "move";
          break;
        }
        if (op === "controls") {
          const next = items[i + 1];
          const isControl = next && (next.kind === "keyword" || (next.kind === "op" && next.op === ".."));
          if (isControl) {
            const c: { text: string; relative?: "+" | "++" } = { text: it.coord.text };
            if (it.coord.relative) c.relative = it.coord.relative;
            controls.push(c);
            break;
          }
        }
        const r = evalAt(it.coord, base);
        if (!r.ok) {
          const opaqueRef = r.refs.find((n) => ctx.out.opaqueNames.has(n));
          main.issues.push(opaqueRef ? `refers to "${opaqueRef}" inside a block kept as-is` : r.reason);
          broken = true;
          break;
        }
        const target: PathPoint = r.node ? { point: r.point, node: r.node } : { point: r.point };
        // Coordinates are waypoints, not edge endpoints.
        const entry = r.node ?? r.anchored;
        const refId = entry && entry.shape.kind !== "coordinate" ? entry.nodeId : undefined;
        if (refId) target.ref = refId;
        const moveBase = () => {
          if (it.coord.relative !== "+") base = target.point;
        };
        if (op === "move" || op === "skip" || !cur) {
          placeNodes(pending.splice(0), null, cur?.point ?? r.point, st);
          cur = target;
          moveBase();
          subStart = target.point;
          main.subpathStarts.push(main.segments.length);
          if (refId) main.connects.push(refId);
          chainRef = refId;
          op = "move";
          break;
        }
        if (op === "rectangle") {
          const a = cur.point;
          const b = target.point;
          main.extra.push(`M ${P(a)} L ${f3(b.x)} ${f3(a.y)} L ${P(b)} L ${f3(a.x)} ${f3(b.y)} Z`);
          cur = target;
          moveBase();
          op = "move";
          break;
        }
        let seg: Segment;
        if (op === "controls") {
          // The first control is relative to the start, the second to the end.
          const c1r = controls[0] ? evalAt(controls[0], cur.point) : null;
          const c2r = controls[1] ? evalAt(controls[1], target.point) : c1r;
          if ((c1r && !c1r.ok) || (c2r && !c2r.ok)) {
            main.issues.push("control point");
            broken = true;
            break;
          }
          const c1 = c1r?.ok ? c1r.point : cur.point;
          const c2 = c2r?.ok ? c2r.point : c1;
          seg = { kind: "curve", from: clip(cur, c1), to: clip(target, c2), c1, c2 };
          controls = [];
        } else if (op === "--") seg = { kind: "line", from: clip(cur, target.point), to: clip(target, cur.point) };
        else if (op === "|-") {
          const corner = { x: cur.point.x, y: target.point.y };
          seg = { kind: "vh", from: clip(cur, corner), to: clip(target, corner) };
        } else if (op === "-|") {
          const corner = { x: target.point.x, y: cur.point.y };
          seg = { kind: "hv", from: clip(cur, corner), to: clip(target, corner) };
        } else seg = toSegment(cur, target, opState ?? st);

        if (op === "edge") {
          // An edge is its own path and leaves the current point where it was.
          const ids = [cur.ref, refId].filter((x): x is string => !!x);
          edges.push({
            build: { segments: [seg], subpathStarts: [0], extra: [], connects: ids, edges: ids.length === 2 ? [[ids[0]!, ids[1]!]] : [], issues: [] },
            st: opState ?? st,
            range: { from: opRange?.from ?? it.coord.from, to: it.coord.to },
            nodes: opNodes,
          });
          opNodes = [];
          opState = null;
          op = "move";
          break;
        }
        main.segments.push(seg);
        placeNodes(pending.splice(0), seg, seg.to, opState ?? st);
        if (refId) {
          main.connects.push(refId);
          if (chainRef && chainRef !== refId) main.edges.push([chainRef, refId]);
          chainRef = refId;
        }
        cur = target;
        moveBase();
        opState = null;
        break;
      }
    }
  }
  // Nodes after the last coordinate sit on the last segment, at its end by default.
  if (pending.length) {
    const last = main.segments[main.segments.length - 1] ?? null;
    placeNodes(
      pending.map((p) => ({ ...p, after: false })),
      last,
      cur?.point ?? { x: 0, y: 0 },
      st,
    );
  }

  const id = `path@${syn.from}`;
  emitPath(id, syn, { from: syn.from, to: syn.to }, main, st, ctx);
  edges.forEach((e, k) => {
    emitPath(`${id}/edge${k}`, syn, e.range, e.build, e.st, ctx);
    placeNodes(e.nodes, e.build.segments[0]!, e.build.segments[0]!.to, e.st);
  });

  function radius(text: string): number | null {
    const q = evalQuantity(text);
    if (!q) return null;
    return q.dimensioned ? q.value : q.value * CM;
  }
}

function ellipseD(c: Point, a: number, b: number): string {
  return `M ${f3(c.x + a)} ${f3(c.y)} A ${f3(a)} ${f3(b)} 0 1 0 ${f3(c.x - a)} ${f3(c.y)} A ${f3(a)} ${f3(b)} 0 1 0 ${f3(c.x + a)} ${f3(c.y)} Z`;
}

function emitPath(id: string, syn: PathSyntax, range: Range, build: PathBuild, st: State, ctx: Ctx) {
  const tips: Tip[] = [];
  const lw = st.lineWidth;
  const stroke = st.drawColor === "none" ? undefined : (st.drawColor ?? st.color);
  const segs = build.segments.slice();
  const starts = build.subpathStarts;
  // Arrow tips go on the last subpath, as in TikZ.
  if (st.draw && segs.length && (st.startTip || st.endTip)) {
    const lastStart = Math.min(starts.length ? starts[starts.length - 1]! : 0, segs.length - 1);
    if (st.endTip) {
      const i = segs.length - 1;
      const seg = segs[i]!;
      const angle = endAngle(seg) + (st.endTip.reversed ? Math.PI : 0);
      tips.push({ at: seg.to, angle, tip: { ...st.endTip, reversed: false }, color: stroke ?? [0, 0, 0], lineWidth: lw });
      segs[i] = shortenEnd(seg, tipLength(st.endTip, lw) * 0.85 + st.shortenEnd);
    } else if (st.shortenEnd) segs[segs.length - 1] = shortenEnd(segs[segs.length - 1]!, st.shortenEnd);
    if (st.startTip) {
      const rev = reverse(segs[lastStart]!);
      const angle = endAngle(rev) + (st.startTip.reversed ? Math.PI : 0);
      tips.push({ at: rev.to, angle, tip: { ...st.startTip, reversed: false }, color: stroke ?? [0, 0, 0], lineWidth: lw });
      segs[lastStart] = reverse(shortenEnd(rev, tipLength(st.startTip, lw) * 0.85 + st.shortenStart));
    }
  }
  let d = "";
  if (st.roundedCorners && segs.length && !segs.some((s) => s.kind === "curve")) d = roundPathCorners(segs, starts, st.roundedCorners);
  else {
    let lastEnd: Point | null = null;
    segs.forEach((seg, i) => {
      const move = !lastEnd || starts.includes(i) || Math.hypot(seg.from.x - lastEnd.x, seg.from.y - lastEnd.y) > 0.01;
      d += (d ? " " : "") + segToD(seg, move);
      lastEnd = seg.to;
    });
  }
  if (build.extra.length) d += (d ? " " : "") + build.extra.join(" ");
  const path: LaidOutPath = {
    id,
    syntax: syn,
    range,
    d,
    lineWidth: lw,
    dash: st.dash,
    opacity: st.opacity,
    fillOpacity: st.fillOpacity ?? st.opacity,
    tips,
    connects: [...new Set(build.connects)],
    edges: build.edges,
    issues: build.issues,
    unknownKeys: st.unknown,
    unrendered: st.unrendered,
    layer: st.layer,
  };
  if (st.draw && stroke) path.stroke = stroke;
  const fill = st.fillColor === "none" ? undefined : (st.fillColor ?? st.color);
  if (st.fill && fill && !st.shading) path.fill = fill;
  if (st.shading) path.shading = st.shading;
  ctx.out.paths.push(path);
}

/** Polyline paths with "rounded corners": round the joints between straight pieces. */
function roundPathCorners(segs: Segment[], starts: number[], r: number): string {
  const pts: Point[][] = [];
  segs.forEach((s, i) => {
    if (!pts.length || starts.includes(i)) pts.push([s.from]);
    const line = pts[pts.length - 1]!;
    if (s.kind === "hv") line.push({ x: s.to.x, y: s.from.y });
    if (s.kind === "vh") line.push({ x: s.from.x, y: s.to.y });
    line.push(s.to);
  });
  return pts
    .map((line) => {
      let d = `M ${P(line[0]!)}`;
      for (let i = 1; i < line.length - 1; i++) {
        const a = line[i - 1]!;
        const b = line[i]!;
        const c = line[i + 1]!;
        const d1 = Math.hypot(b.x - a.x, b.y - a.y);
        const d2 = Math.hypot(c.x - b.x, c.y - b.y);
        if (d1 < 1e-6 || d2 < 1e-6) continue;
        const rr = Math.min(r, d1 / 2, d2 / 2);
        const p1 = { x: b.x + ((a.x - b.x) / d1) * rr, y: b.y + ((a.y - b.y) / d1) * rr };
        const p2 = { x: b.x + ((c.x - b.x) / d2) * rr, y: b.y + ((c.y - b.y) / d2) * rr };
        d += ` L ${P(p1)} Q ${P(b)} ${P(p2)}`;
      }
      return `${d} L ${P(line[line.length - 1]!)}`;
    })
    .join(" ");
}

function computeBounds(out: PictureLayout) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const n of [...out.nodes, ...out.pathNodes, ...out.nodes.flatMap((n) => n.extras)]) {
    const b = shapeBounds(n.shape);
    add(b.minX, b.minY);
    add(b.maxX, b.maxY);
  }
  for (const p of out.paths) {
    const nums = p.d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    // Arc commands carry radii and flags; their endpoints still bound the shape well enough.
    for (let i = 0; i + 1 < nums.length; i += 2) add(nums[i]!, nums[i + 1]!);
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

export { outline, applyMatrix };
