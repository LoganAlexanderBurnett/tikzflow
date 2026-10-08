// The canvas: draws the native preview and handles selection and dragging.
// The model is in TeX pt with y up; the SVG flips y for geometry and places
// labels at (x, -y).
import { useComputed, useSignal, useSignalEffect } from "@preact/signals";
import type { JSX } from "preact";
import { memo } from "preact/compat";
import { useCallback, useEffect, useMemo, useRef } from "preact/hooks";
import { planMove, positioningText, referenceCandidates } from "../edit/move.ts";
import type { Scope } from "../edit/properties.ts";
import { type Hold, planResize, type ResizeOutcome, resizeBlocker, type SizeWant } from "../edit/resize.ts";
import { type GapMark, snapNode } from "../edit/snap.ts";
import { labelledNode } from "../edit/label.ts";
import { pictureEnv } from "../model/document.ts";
import { type Edge, edgeD, edgeEnds, edgeOfLabel } from "../model/edges.ts";
import { undrawable } from "../model/explain.ts";
import { type RGB, cssColor } from "../tikz/colors.ts";
import { defaultTipLength, defaultTipWidth } from "../tikz/keys.ts";
import type { LaidOutNode, LaidOutPath, PictureLayout, Tip } from "../tikz/layout.ts";
import { outline, type Point } from "../tikz/shapes.ts";
import { PT_PER_UNIT } from "../tikz/units.ts";
import type { Shading } from "../tikz/state.ts";
import { katexMacros, labelHtml } from "./labelHtml.ts";
import {
  activeScope,
  applyEdit,
  applyResize,
  cancelLabelEdit,
  commitLabelEdit,
  createFromKeyboard,
  dropFromPalette,
  labelEdit,
  labelEditProblem,
  setLabelDraft,
  startLabelEdit,
  baseLayout,
  currentPicture,
  doc,
  fitRequests,
  guides,
  layout,
  overrides,
  PALETTE_DRAG,
  palette,
  revealRequest,
  pinNode,
  previewLayout,
  selectFromCanvas,
  selectedEdge,
  selectedIds,
  selection,
  shownEdges,
  status,
  text,
  unusedCoords,
  viewCentre,
} from "./store.ts";

/** \coordinate markers: a dot with the name on hover; hollow if nothing uses it. */
function CoordinateMark({ n, scale, selected, unused }: { n: LaidOutNode; scale: number; selected: boolean; unused: boolean }) {
  const x = f(n.shape.center.x);
  const y = f(-n.shape.center.y);
  const name = n.name ?? "";
  return (
    <g data-node={n.id} data-testid="coordinate" class={`tf-coord${unused ? " unused" : ""}${selected ? " selected" : ""}${n.locked ? " locked" : ""}`}>
      <title>{unused ? `${name}: not used by anything in the picture` : name}</title>
      <circle cx={x} cy={y} r={f(8 / scale)} class="hit" />
      <circle cx={x} cy={y} r={f(2.6 / scale)} class="dot" stroke-width={f(1.2 / scale)} stroke-dasharray={unused ? `${f(1.6 / scale)} ${f(1.2 / scale)}` : undefined} />
      <text x={f(n.shape.center.x + 5 / scale)} y={f(-n.shape.center.y - 5 / scale)} font-size={f(11 / scale)} stroke-width={f(3 / scale)} class="name">
        {name}
        {unused ? " (unused)" : ""}
      </text>
    </g>
  );
}

/** A small marker on a node with options the preview can't draw. */
function UndrawnMark({ n, scale }: { n: LaidOutNode; scale: number }) {
  const what = undrawable(n);
  if (!what.length) return null;
  const x = f(n.shape.center.x + n.shape.hw);
  const y = f(-(n.shape.center.y + n.shape.hh));
  return (
    <g data-node={n.id} class="tf-undrawn" data-testid="undrawn-marker">
      <title>{`The preview doesn't draw: ${what.join(", ")}. They're kept in the code and will show in the accurate preview.`}</title>
      <circle cx={x} cy={y} r={f(4 / scale)} stroke-width={f(1.2 / scale)} />
    </g>
  );
}

/** The selected edge: a halo along it, its ends, its labels outlined. */
function EdgeSelection({ edge, scale }: { edge: Edge; scale: number }) {
  const ends = edgeEnds(edge);
  const r = 3 / scale;
  return (
    <g class={`tf-edge-selection${edge.lock ? " locked" : ""}`} data-testid="edge-selection">
      <path d={edgeD(edge)} class="tf-path-halo" stroke-width={6 / scale} />
      {[ends.start, ends.end].map((p) => (
        <circle cx={f(p.x)} cy={f(p.y)} r={f(r)} class="tf-edge-end" stroke-width={f(1.2 / scale)} />
      ))}
      {edge.labels.map((n) => (
        <rect
          x={f(n.shape.center.x - n.shape.hw - 2 / scale)}
          y={f(n.shape.center.y - n.shape.hh - 2 / scale)}
          width={f(2 * n.shape.hw + 4 / scale)}
          height={f(2 * n.shape.hh + 4 / scale)}
          class="tf-selection"
          stroke-width={1 / scale}
          stroke-dasharray={`${3 / scale} ${2 / scale}`}
        />
      ))}
    </g>
  );
}

const NO_HITS: readonly EdgeHit[] = [];

interface View {
  /** Screen pixels per pt. */
  scale: number;
  /** Model point at the centre of the canvas. */
  cx: number;
  cy: number;
}

const f = (v: number) => Math.round(v * 1000) / 1000;

function rgba(c: RGB | undefined, fallback = "none"): string {
  return c ? cssColor(c) : fallback;
}

/** An arrow tip as a path in model coordinates. */
function tipShape(t: Tip): { d: string; filled: boolean } {
  const len = t.tip.length ?? defaultTipLength(t.tip.kind, t.lineWidth);
  const wid = t.tip.width ?? defaultTipWidth(t.tip.kind, t.lineWidth);
  const ux = Math.cos(t.angle);
  const uy = Math.sin(t.angle);
  const nx = -uy;
  const ny = ux;
  const parts: string[] = [];
  let filled = !t.tip.open;
  for (let k = 0; k < Math.max(1, t.tip.count); k++) {
    const ax = t.at.x - ux * len * k * 0.8;
    const ay = t.at.y - uy * len * k * 0.8;
    const P = (along: number, across: number) => `${f(ax - ux * along + nx * across)} ${f(ay - uy * along + ny * across)}`;
    const w = wid / 2;
    switch (t.tip.kind) {
      case "stealth":
        parts.push(`M ${P(0, 0)} L ${P(len, w)} L ${P(len * 0.7, 0)} L ${P(len, -w)} Z`);
        break;
      case "latex":
        parts.push(`M ${P(0, 0)} Q ${P(len * 0.45, w * 0.35)} ${P(len, w)} L ${P(len, -w)} Q ${P(len * 0.45, -w * 0.35)} ${P(0, 0)} Z`);
        break;
      case "triangle":
        parts.push(`M ${P(0, 0)} L ${P(len, w)} L ${P(len, -w)} Z`);
        break;
      case "bar":
        parts.push(`M ${P(0, w)} L ${P(0, -w)}`);
        filled = false;
        break;
      case "circle": {
        const r = len / 2;
        parts.push(`M ${P(0, 0)} A ${f(r)} ${f(r)} 0 1 1 ${P(len, 0)} A ${f(r)} ${f(r)} 0 1 1 ${P(0, 0)} Z`);
        break;
      }
      case "square":
        parts.push(`M ${P(0, w)} L ${P(len, w)} L ${P(len, -w)} L ${P(0, -w)} Z`);
        break;
      case "diamond":
        parts.push(`M ${P(0, 0)} L ${P(len / 2, w)} L ${P(len, 0)} L ${P(len / 2, -w)} Z`);
        break;
      case "kite":
        parts.push(`M ${P(0, 0)} L ${P(len * 0.6, w)} L ${P(len, 0)} L ${P(len * 0.6, -w)} Z`);
        break;
      case "round":
      case "butt":
        break;
      default: {
        // TikZ's default "to" tip: two curved barbs.
        parts.push(`M ${P(len, w * 1.1)} Q ${P(len * 0.35, w * 0.3)} ${P(0, 0)} Q ${P(len * 0.35, -w * 0.3)} ${P(len, -w * 1.1)}`);
        filled = false;
      }
    }
  }
  return { d: parts.join(" "), filled };
}

function gradientStops(s: Shading): Array<{ offset: number; color: string }> {
  const stops = [{ offset: 0, color: cssColor(s.from) }];
  if (s.middle) stops.push({ offset: 0.5, color: cssColor(s.middle) });
  stops.push({ offset: 1, color: cssColor(s.to) });
  return stops;
}

function Gradient({ id, shading }: { id: string; shading: Shading }) {
  const stops = gradientStops(shading).map((s) => <stop offset={s.offset} stop-color={s.color} />);
  if (shading.kind === "radial") return <radialGradient id={id}>{stops}</radialGradient>;
  // Geometry is drawn flipped, so "from" (top or left) is y=1 in the box.
  if (shading.kind === "vertical") return <linearGradient id={id} x1="0" y1="1" x2="0" y2="0">{stops}</linearGradient>;
  return <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">{stops}</linearGradient>;
}

const gradId = (id: string) => `sh-${id.replace(/[^A-Za-z0-9_-]/g, "_")}`;

// The components below are memoised on what they draw: while dragging, only
// the moved node and the paths touching it change.
const nodeSig = (n: LaidOutNode) =>
  [n.id, n.shape.kind, n.shape.center.x, n.shape.center.y, n.shape.hw, n.shape.hh, n.shape.roundedCorners, n.stroke, n.fill, n.lineWidth, n.dash, n.opacity, n.fillOpacity, n.shadow, n.locked, n.shading && JSON.stringify(n.shading)].join("|");

const NodeShape = memo(NodeShapeView, (a, b) => a.scale === b.scale && a.selected === b.selected && nodeSig(a.n) === nodeSig(b.n));

function NodeShapeView({ n, scale, selected }: { n: LaidOutNode; scale: number; selected: boolean }) {
  // Coordinates are drawn as markers on top (CoordinateMark).
  if (n.kind === "coordinate") return null;
  const d = outline(n.shape);
  const minStroke = 0.6 / scale;
  const fill = n.shading ? `url(#${gradId(n.id)})` : rgba(n.fill, "transparent");
  return (
    <g data-node={n.id} class={`tf-node${n.locked ? " locked" : ""}${selected ? " selected" : ""}`}>
      {n.shadow && d && <path d={d} transform="translate(2.5 -2.5)" fill="#000" opacity={0.35} />}
      {d && (
        <path
          d={d}
          fill={fill}
          fill-opacity={n.fillOpacity}
          stroke={rgba(n.stroke)}
          stroke-width={Math.max(n.lineWidth, minStroke)}
          stroke-dasharray={n.dash?.join(" ")}
          opacity={n.opacity}
          vector-effect="none"
        />
      )}
    </g>
  );
}

const NodeLabel = memo(
  NodeLabelView,
  (a, b) =>
    a.macros === b.macros &&
    a.n.text === b.n.text &&
    a.n.textOrigin.x === b.n.textOrigin.x &&
    a.n.textOrigin.y === b.n.textOrigin.y &&
    a.n.rotate === b.n.rotate &&
    a.n.opacity === b.n.opacity &&
    String(a.n.textColor) === String(b.n.textColor),
);

function NodeLabelView({ n, macros }: { n: LaidOutNode; macros: Record<string, string> }) {
  const t = n.text;
  const html = useMemo(() => (t ? labelHtml(t, macros) : ""), [t, macros]);
  if (!t || !html) return null;
  const w = Math.max(t.width, 1);
  const h = t.height + t.depth;
  const x = n.textOrigin.x;
  const y = -n.textOrigin.y;
  const rot = n.rotate ? `rotate(${-n.rotate} ${f(n.shape.center.x)} ${f(-n.shape.center.y)})` : undefined;
  return (
    <foreignObject x={f(x)} y={f(y)} width={f(w + 2)} height={f(h + 2)} transform={rot} class="tf-label-box" data-node={n.kind === "path" ? undefined : n.id}>
      <div class="tf-label" style={{ color: cssColor(n.textColor), opacity: n.opacity }} dangerouslySetInnerHTML={{ __html: html }} />
    </foreignObject>
  );
}

const pathSig = (p: LaidOutPath) =>
  [p.id, p.d, p.stroke, p.fill, p.lineWidth, p.dash, p.opacity, p.fillOpacity, p.shading && JSON.stringify(p.shading), JSON.stringify(p.tips)].join("|");

/** Where each edge of a path can be clicked. */
interface EdgeHit {
  id: string;
  d: string;
}

const PathShape = memo(
  PathShapeView,
  (a, b) => a.scale === b.scale && a.selected === b.selected && pathSig(a.p) === pathSig(b.p) && a.hits.map((h) => h.id + h.d).join("|") === b.hits.map((h) => h.id + h.d).join("|"),
);

function PathShapeView({ p, scale, selected, hits }: { p: LaidOutPath; scale: number; selected: boolean; hits: readonly EdgeHit[] }) {
  if (!p.d && !p.tips.length) return null;
  const minStroke = 0.6 / scale;
  const fill = p.shading ? `url(#${gradId(p.id)})` : rgba(p.fill);
  return (
    <g data-path={p.id} class={`tf-path${selected ? " selected" : ""}`}>
      {selected && <path d={p.d} class="tf-path-halo" stroke-width={p.lineWidth + 4 / scale} />}
      {/* A path with edges is clicked edge by edge; other paths as a whole. */}
      {hits.length ? null : <path d={p.d} class="tf-path-hit" stroke-width={10 / scale} />}
      <path
        d={p.d}
        fill={fill}
        fill-opacity={p.fillOpacity}
        stroke={rgba(p.stroke)}
        stroke-width={Math.max(p.lineWidth, minStroke)}
        stroke-dasharray={p.dash?.join(" ")}
        stroke-linejoin="round"
        opacity={p.opacity}
      />
      {p.tips.map((t) => {
        const s = tipShape(t);
        return (
          <path
            d={s.d}
            fill={s.filled ? cssColor(t.color) : t.tip.open ? "var(--canvas-bg)" : "none"}
            stroke={cssColor(t.color)}
            stroke-width={Math.max(t.lineWidth, minStroke)}
            stroke-linejoin="round"
            stroke-linecap="round"
          />
        );
      })}
      {hits.map((h) => (
        <path key={h.id} d={h.d} data-edge={h.id} data-testid="edge-hit" class="tf-path-hit" stroke-width={10 / scale} />
      ))}
    </g>
  );
}

type Item = { kind: "node"; n: LaidOutNode; at: number; layer: number } | { kind: "path"; p: LaidOutPath; at: number; layer: number };

/** Nodes and paths in drawing order: background layer first, then source order. */
function drawOrder(l: PictureLayout): Item[] {
  const items: Item[] = [
    ...l.nodes.map((n) => ({ kind: "node" as const, n, at: n.syntax.from, layer: n.layer })),
    ...l.paths.map((p) => ({ kind: "path" as const, p, at: p.syntax.from + (p.id.includes("/edge") ? 0.5 : 0), layer: p.layer })),
  ];
  return items.sort((a, b) => a.layer - b.layer || a.at - b.at);
}

/**
 * The in-place label editor: a text box over the node holding the label's TeX.
 * Enter applies it, Shift+Enter adds a line, Escape cancels, and clicking
 * elsewhere applies it too. Text that would break the code is refused.
 */
function LabelEditor({ view, size, onDone }: { view: View; size: { w: number; h: number }; onDone: () => void }) {
  const e = labelEdit.value;
  const session = e?.session;
  // Focus the box as soon as it exists, so the first keystroke lands in it. The
  // callback only changes with the node, so typing doesn't refocus or reselect.
  const ref = useCallback(
    (el: HTMLTextAreaElement | null) => {
      el?.focus();
      el?.select();
    },
    [session],
  );
  // A node being created isn't in the code yet; it is in the preview layout.
  const n = e ? labelledNode(e.creating ? layout.value : baseLayout.value, e.id) : undefined;
  if (!e || !n) return null;
  const problem = labelEditProblem.value;
  const x = (n.shape.center.x - (view.cx - size.w / 2 / view.scale)) * view.scale;
  const y = (-n.shape.center.y - (-view.cy - size.h / 2 / view.scale)) * view.scale;
  const width = Math.max(240, 2 * n.shape.hw * view.scale + 16);
  const finish = () => {
    labelEdit.value = null;
    onDone();
  };
  return (
    <div class="tf-label-editor" style={{ left: `${f(x)}px`, top: `${f(y)}px`, width: `${f(width)}px` }} data-testid="label-editor">
      <textarea
        ref={ref}
        value={e.draft}
        rows={Math.max(1, e.draft.split("\n").length)}
        spellcheck={false}
        aria-label="Node label, as TeX"
        aria-invalid={!!problem}
        onInput={(ev) => setLabelDraft((ev.target as HTMLTextAreaElement).value)}
        onKeyDown={(ev) => {
          // Keep keys like Ctrl+Z for the text box itself.
          ev.stopPropagation();
          if (ev.key === "Escape") {
            ev.preventDefault();
            cancelLabelEdit();
            onDone();
          } else if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
            ev.preventDefault();
            if (commitLabelEdit()) onDone();
          } else if (ev.key === "Tab" && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey && !ev.isComposing) {
            // Apply this label and go straight on to the next connected node.
            ev.preventDefault();
            if (commitLabelEdit()) {
              onDone();
              createFromKeyboard("child");
            }
          }
        }}
        onBlur={() => {
          if (!labelEdit.value) return;
          if (!commitLabelEdit()) {
            status.value = `Label not changed. ${status.value ?? ""}`.trim();
            finish();
          }
        }}
      />
      <div class="tf-label-hint">{problem ? <span class="tf-problem">{problem}</span> : "Enter applies · Shift+Enter new line · Esc cancels"}</div>
    </div>
  );
}

type HandleId ="n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const HANDLES: Array<{ id: HandleId; fx: -1 | 0 | 1; fy: -1 | 0 | 1; cursor: string }> = [
  { id: "nw", fx: -1, fy: 1, cursor: "nwse-resize" },
  { id: "n", fx: 0, fy: 1, cursor: "ns-resize" },
  { id: "ne", fx: 1, fy: 1, cursor: "nesw-resize" },
  { id: "e", fx: 1, fy: 0, cursor: "ew-resize" },
  { id: "se", fx: 1, fy: -1, cursor: "nwse-resize" },
  { id: "s", fx: 0, fy: -1, cursor: "ns-resize" },
  { id: "sw", fx: -1, fy: -1, cursor: "nesw-resize" },
  { id: "w", fx: -1, fy: 0, cursor: "ew-resize" },
];

/** The state of a resize drag: where it started and the last plan that worked. */
interface ResizeDrag {
  kind: "resize";
  id: string;
  handle: (typeof HANDLES)[number];
  scope: Scope;
  pointer: Point;
  w0: number;
  h0: number;
  moved: boolean;
  key: string;
  last: Extract<ResizeOutcome, { ok: true }> | null;
  /** Nodes whose width or height the drag snapped to. */
  match: { w?: LaidOutNode; h?: LaidOutNode };
}

const MM_PT = PT_PER_UNIT.mm!;

export function Canvas() {
  const svgRef = useRef<SVGSVGElement>(null);
  const size = useSignal({ w: 800, h: 600 });
  const view = useSignal<View>({ scale: 2, cx: 0, cy: 0 });
  const drag = useRef<
    | { kind: "node"; id: string; pointer: Point; center: Point; moved: boolean; target: Point; alignedWith: string[] }
    | { kind: "pan"; client: Point; view: View; moved: boolean }
    | ResizeDrag
    | null
  >(null);

  // Track the canvas size.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      size.value = { w: Math.max(50, r.width), h: Math.max(50, r.height) };
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = () => {
    // peek: fitting happens in an effect, and an edit that changes the layout
    // must not refit (and so rescale) the view under the user.
    const l = baseLayout.peek();
    if (!l) return;
    const b = l.bounds;
    const bw = Math.max(20, b.maxX - b.minX);
    const bh = Math.max(20, b.maxY - b.minY);
    const { w, h } = size.value;
    const scale = Math.min(6, Math.max(0.2, Math.min((w - 48) / bw, (h - 48) / bh)));
    view.value = { scale, cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2 };
  };
  // Fit when asked (new document, other picture, toolbar), once the size is known.
  const sized = useRef(false);
  useSignalEffect(() => {
    void fitRequests.value;
    const s = size.value;
    if (!sized.current && s.w === 800 && s.h === 600) return;
    sized.current = true;
    fit();
  });

  // Pan (never zoom) just far enough that a node being created, and the label box
  // that opens over it, are in view.
  useSignalEffect(() => {
    const r = revealRequest.value;
    if (!r) return;
    const v = view.peek();
    const { w, h } = size.peek();
    const px = (n: number) => n / v.scale;
    const need = { x0: r.center.x - r.hw - px(24), x1: r.center.x + r.hw + px(24), y0: r.center.y - r.hh - px(110), y1: r.center.y + r.hh + px(24) };
    const fit1 = (lo: number, hi: number, c: number, span: number) => (hi - lo > span ? (lo + hi) / 2 : Math.min(Math.max(c, hi - span / 2), lo + span / 2));
    const cx = fit1(need.x0, need.x1, v.cx, px(w));
    const cy = fit1(need.y0, need.y1, v.cy, px(h));
    if (cx !== v.cx || cy !== v.cy) view.value = { ...v, cx, cy };
  });

  const macros = useComputed(() => {
    const d = doc.value;
    const pic = d.syntax.pictures[currentPicture.value];
    return pic ? katexMacros(pictureEnv(d, pic).macros) : {};
  });

  const toModel = (e: { clientX: number; clientY: number }): Point => {
    const svg = svgRef.current!;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: pt.x, y: -pt.y };
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    const target = e.target as Element;
    const nodeEl = target.closest("[data-node]");
    const pathEl = target.closest("[data-path]");
    const svg = svgRef.current!;
    svg.focus({ preventScroll: true });
    const handleEl = target.closest("[data-handle]");
    if (e.button === 0 && handleEl) {
      const handle = HANDLES.find((h) => h.id === handleEl.getAttribute("data-handle"));
      const id = selectedIds.value[0];
      const n = baseLayout.value?.nodes.find((x) => x.id === id);
      const scope = activeScope.value;
      if (handle && n && scope && selectedIds.value.length === 1) {
        drag.current = {
          kind: "resize",
          id: n.id,
          handle,
          scope,
          pointer: toModel(e),
          w0: 2 * n.shape.hw,
          h0: 2 * n.shape.hh,
          moved: false,
          key: "",
          last: null,
          match: {},
        };
        svg.setPointerCapture(e.pointerId);
      }
      return;
    }
    if (e.button === 0 && nodeEl) {
      const id = nodeEl.getAttribute("data-node")!;
      const n = baseLayout.value?.nodes.find((x) => x.id === id);
      // Shift-click adds the node to the selection (or takes it out); it doesn't start a drag.
      if (e.shiftKey) {
        selectFromCanvas({ kind: "node", id }, true);
        return;
      }
      selectFromCanvas({ kind: "node", id });
      // A node locked only by an undefined reference can still be dragged:
      // dropping it pins it there with plain coordinates.
      if (n && (!n.locked || n.lock?.kind === "undefined-ref")) {
        const p = toModel(e);
        drag.current = { kind: "node", id, pointer: p, center: n.shape.center, moved: false, target: n.shape.center, alignedWith: [] };
        svg.setPointerCapture(e.pointerId);
        if (n.locked) status.value = `${n.locked}. Drag it to pin it where you drop it, or see the panel for other fixes.`;
      } else if (n?.locked) status.value = `Locked: ${n.locked}. The panel on the right says why and how to fix it.`;
      return;
    }
    const labelEl = target.closest("[data-label]");
    if (e.button === 0 && labelEl) {
      // A label on a path selects its edge (or the path, if it has none).
      const id = labelEl.getAttribute("data-label")!;
      const edge = edgeOfLabel(shownEdges.value, id);
      const path = baseLayout.value?.paths.find((x) => x.syntax.from === labelledNode(baseLayout.value, id)?.statement.from);
      selectFromCanvas(edge ? { kind: "edge", id: edge.id } : path ? { kind: "path", id: path.id } : null);
      return;
    }
    const edgeEl = target.closest("[data-edge]");
    if (e.button === 0 && edgeEl) {
      selectFromCanvas({ kind: "edge", id: edgeEl.getAttribute("data-edge")! });
      return;
    }
    if (e.button === 0 && pathEl) {
      selectFromCanvas({ kind: "path", id: pathEl.getAttribute("data-path")! });
      return;
    }
    drag.current = { kind: "pan", client: { x: e.clientX, y: e.clientY }, view: view.value, moved: false };
    svg.setPointerCapture(e.pointerId);
  };

  /** A resize drag: work out the size wanted, snap it, and show the result live. */
  const resizeMove = (d: ResizeDrag, e: PointerEvent) => {
    const p = toModel(e);
    const dx = p.x - d.pointer.x;
    const dy = p.y - d.pointer.y;
    if (!d.moved && Math.hypot(dx, dy) * view.value.scale < 3) return;
    d.moved = true;
    const l = baseLayout.value;
    if (!l) return;
    const { fx, fy } = d.handle;
    // The edge opposite the handle stays put, as in PowerPoint or Figma. With
    // Ctrl (Cmd on a Mac) the centre stays and both edges move, so the size
    // changes twice as fast as the pointer. Alt is taken: it turns snapping off.
    const symmetric = e.ctrlKey || e.metaKey;
    const share = symmetric ? 0.5 : 1;
    const hold: Hold = { x: symmetric ? 0 : ((-fx) as -1 | 0 | 1), y: symmetric ? 0 : ((-fy) as -1 | 0 | 1) };
    const want: SizeWant = {};
    if (fx) want.w = Math.max(1, d.w0 + (fx > 0 ? dx : -dx) / share);
    if (fy) want.h = Math.max(1, d.h0 + (fy > 0 ? dy : -dy) / share);
    // Snap to the width or height of another node (Alt drags without).
    const snapped: { w?: LaidOutNode; h?: LaidOutNode } = {};
    if (!e.altKey) {
      const threshold = 7 / view.value.scale;
      const others = l.nodes.filter((n) => n.id !== d.id && n.kind === "statement");
      const nearest = (value: number, share: number, size: (n: LaidOutNode) => number) => {
        let best: { node: LaidOutNode; dist: number } | undefined;
        for (const o of others) {
          const dist = Math.abs(size(o) - value) * share;
          if (dist < threshold && (!best || dist < best.dist)) best = { node: o, dist };
        }
        return best?.node;
      };
      if (want.w !== undefined) {
        const m = nearest(want.w, share, (n) => 2 * n.shape.hw);
        if (m) {
          want.w = 2 * m.shape.hw;
          snapped.w = m;
        }
      }
      if (want.h !== undefined) {
        const m = nearest(want.h, share, (n) => 2 * n.shape.hh);
        if (m) {
          want.h = 2 * m.shape.hh;
          snapped.h = m;
        }
      }
    }
    // Sizes are written in whole millimetres, so only re-plan when that changes.
    const key = `${Math.round((want.w ?? 0) / MM_PT)}|${Math.round((want.h ?? 0) / MM_PT)}|${snapped.w?.id ?? ""}|${snapped.h?.id ?? ""}|${symmetric}`;
    if (key === d.key) return;
    d.key = key;
    const out = planResize(doc.value, currentPicture.value, l, d.id, want, d.scope, hold);
    if (!out.ok) {
      status.value = out.reason;
      return;
    }
    d.last = out;
    d.match = {};
    previewLayout.value = out.changes.length ? out.layout : null;
    // Mark the nodes it now has the same width or height as.
    const after = out.layout.nodes.find((n) => n.id === d.id);
    const gaps: GapMark[] = [];
    const mark = (n: LaidOutNode, axis: "w" | "h") => {
      const c = n.shape.center;
      const off = 6 / view.value.scale;
      if (axis === "w") gaps.push({ from: { x: c.x - n.shape.hw, y: c.y + n.shape.hh + off }, to: { x: c.x + n.shape.hw, y: c.y + n.shape.hh + off } });
      else gaps.push({ from: { x: c.x + n.shape.hw + off, y: c.y - n.shape.hh }, to: { x: c.x + n.shape.hw + off, y: c.y + n.shape.hh } });
    };
    for (const axis of ["w", "h"] as const) {
      const m = snapped[axis];
      if (!m || !after) continue;
      const mine = axis === "w" ? 2 * after.shape.hw : 2 * after.shape.hh;
      const theirs = axis === "w" ? 2 * m.shape.hw : 2 * m.shape.hh;
      if (Math.abs(mine - theirs) > 0.75 * MM_PT) continue;
      d.match[axis] = m;
      mark(after, axis);
      const other = out.layout.nodes.find((n) => n.id === m.id);
      if (other) mark(other, axis);
    }
    guides.value = { lines: [], gaps };
  };

  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === "pan") {
      const dx = e.clientX - d.client.x;
      const dy = e.clientY - d.client.y;
      if (Math.hypot(dx, dy) > 3) d.moved = true;
      view.value = { ...d.view, cx: d.view.cx - dx / d.view.scale, cy: d.view.cy + dy / d.view.scale };
      return;
    }
    if (d.kind === "resize") {
      resizeMove(d, e);
      return;
    }
    const p = toModel(e);
    const raw = { x: d.center.x + p.x - d.pointer.x, y: d.center.y + p.y - d.pointer.y };
    if (!d.moved && Math.hypot(p.x - d.pointer.x, p.y - d.pointer.y) * view.value.scale < 3) return;
    d.moved = true;
    const l = baseLayout.value;
    const n = l?.nodes.find((x) => x.id === d.id);
    if (!l || !n) return;
    const snapped = e.altKey ? { center: raw, guides: [], gaps: [], targets: [] } : snapNode(l, n, raw, 7 / view.value.scale);
    d.target = snapped.center;
    d.alignedWith = snapped.targets;
    overrides.value = new Map([[d.id, snapped.center]]);
    guides.value = { lines: snapped.guides, gaps: snapped.gaps };
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === "pan") {
      if (!d.moved) selectFromCanvas(null);
      return;
    }
    if (d.kind === "resize") {
      previewLayout.value = null;
      guides.value = { lines: [], gaps: [] };
      if (!d.moved || !d.last) return;
      const name = (n: LaidOutNode) => n.name ?? n.id;
      const same = [d.match.w && `width as ${name(d.match.w)}`, d.match.h && `height as ${name(d.match.h)}`].filter(Boolean);
      applyResize(d.last.changes, d.last.written, d.scope, d.last.notes, d.last.position, same.length ? ` Same ${same.join(" and ")}.` : "");
      return;
    }
    if (!d.moved) return;
    if (baseLayout.value?.nodes.find((x) => x.id === d.id)?.lock) {
      overrides.value = new Map();
      guides.value = { lines: [], gaps: [] };
      pinNode(d.id, d.target);
      return;
    }
    const result = planMove(text.value, currentPicture.value, d.id, d.target);
    overrides.value = new Map();
    guides.value = { lines: [], gaps: [] };
    if (!result) {
      status.value = "That position couldn't be written; the node stays where it was.";
      return;
    }
    applyEdit(result.changes, "move.drag");
    const s = result.spec;
    status.value =
      s.kind === "positioning"
        ? `Wrote ${positioningText(s)}.`
        : s.kind === "perp"
          ? `Wrote at (${s.xFrom} |- ${s.yFrom}).`
          : s.kind === "shift"
            ? "Kept the position as written and adjusted its shift."
            : "Wrote coordinates: nothing nearby lines up.";
    if (result.library) status.value += " Loaded the positioning library.";
    // Explain when a node it lines up with couldn't be used: TikZ only lets a
    // node refer to nodes defined before it.
    const l = baseLayout.value;
    const moved = l?.nodes.find((x) => x.id === d.id);
    if (l && moved && s.kind !== "perp") {
      const usable = new Set(referenceCandidates(l, moved).map((x) => x.id));
      const later = d.alignedWith.filter((id) => !usable.has(id) && l.nodes.findIndex((x) => x.id === id) > l.nodes.indexOf(moved));
      const name = (id: string) => l.nodes.find((x) => x.id === id)?.name ?? id;
      if (later.length) status.value += ` It lines up with ${later.map(name).join(", ")}, which comes later in the code, so the position is written relative to earlier nodes.`;
    }
    for (const note of result.notes) status.value += ` Note: ${note}.`;
  };

  /** Double-click a node to edit its label where it is. */
  const onDoubleClick = (e: MouseEvent) => {
    const l = baseLayout.value;
    if (!l) return;
    for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
      // A label on an edge.
      const labelId = el.closest("[data-label]")?.getAttribute("data-label");
      if (labelId) {
        e.preventDefault();
        startLabelEdit(labelId);
        return;
      }
      const id = el.closest("[data-node]")?.getAttribute("data-node");
      const n = id ? l.nodes.find((x) => x.id === id) : undefined;
      if (n?.kind === "statement") {
        e.preventDefault();
        startLabelEdit(n.id);
        return;
      }
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "F2" && selectedIds.value.length) {
      e.preventDefault();
      startLabelEdit(selectedIds.value[selectedIds.value.length - 1]!);
      return;
    }
    // Tab adds a connected node after the selected one, Enter one beside it.
    if ((e.key === "Tab" || e.key === "Enter") && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !labelEdit.value) {
      const empty = !baseLayout.value?.nodes.some((n) => n.kind === "statement");
      if (selectedIds.value.length || (empty && e.key === "Tab")) {
        e.preventDefault();
        createFromKeyboard(e.key === "Tab" ? "child" : "sibling");
      }
    }
  };

  /** A shape dragged from the palette is dropped here. */
  const onDragOver = (e: DragEvent) => {
    if (e.dataTransfer?.types.includes(PALETTE_DRAG)) e.preventDefault();
  };
  const onDrop = (e: DragEvent) => {
    const id = e.dataTransfer?.getData(PALETTE_DRAG);
    if (!id) return;
    e.preventDefault();
    const entry = palette.value.find((x) => x.id === id);
    if (entry) dropFromPalette(entry, toModel(e), 7 / view.value.scale);
  };

  useEffect(() => {
    viewCentre.get = () => ({ x: view.value.cx, y: view.value.cy });
  }, []);

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const before = toModel(e);
    const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
    const v = view.value;
    const scale = Math.min(20, Math.max(0.1, v.scale * factor));
    // Keep the point under the pointer fixed.
    view.value = { scale, cx: before.x - (before.x - v.cx) * (v.scale / scale), cy: before.y - (before.y - v.cy) * (v.scale / scale) };
  };

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const l = layout.value;
  const v = view.value;
  const { w, h } = size.value;
  const vb = `${f(v.cx - w / 2 / v.scale)} ${f(-v.cy - h / 2 / v.scale)} ${f(w / v.scale)} ${f(h / v.scale)}`;
  const sel = selection.value;
  const g = guides.value;

  const items = l ? drawOrder(l) : [];
  const edgeList = shownEdges.value;
  const hitsByPath = new Map<string, EdgeHit[]>();
  for (const e of edgeList) {
    const list = hitsByPath.get(e.path.id) ?? [];
    list.push({ id: e.id, d: edgeD(e) });
    hitsByPath.set(e.path.id, list);
  }
  // The selected edge as shown (it follows a node being dragged).
  const selEdgeId = selectedEdge.value?.id;
  const selEdge: Edge | undefined = selEdgeId ? edgeList.find((x) => x.id === selEdgeId) : undefined;
  const gradients: JSX.Element[] = [];
  if (l) {
    for (const n of l.nodes) if (n.shading) gradients.push(<Gradient id={gradId(n.id)} shading={n.shading} />);
    for (const p of l.paths) if (p.shading) gradients.push(<Gradient id={gradId(p.id)} shading={p.shading} />);
  }
  const selIds = selectedIds.value;
  const selected = l ? selIds.flatMap((id) => l.nodes.find((n) => n.id === id) ?? []) : [];
  // One selected node that can be resized gets handles, unless it's being moved.
  const only = selected.length === 1 ? selected[0] : undefined;
  const handleNode = only && !resizeBlocker(only) && !overrides.value.size ? only : undefined;

  return (
    <>
    <svg
      ref={svgRef}
      class="tf-canvas"
      viewBox={vb}
      tabindex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDblClick={onDoubleClick}
      onKeyDown={onKeyDown}
      onDragOver={onDragOver}
      onDrop={onDrop}
      data-testid="canvas"
    >
      <defs>{gradients}</defs>
      {items.map((it) =>
        it.kind === "node" ? (
          <g key={it.n.id}>
            <g transform="scale(1 -1)">
              <NodeShape n={it.n} scale={v.scale} selected={selIds.includes(it.n.id)} />
            </g>
            <NodeLabel n={it.n} macros={macros.value} />
            {it.n.extras.map((x) => (
              <NodeLabel key={x.id} n={x} macros={macros.value} />
            ))}
          </g>
        ) : (
          <g key={it.p.id} transform="scale(1 -1)">
            <PathShape p={it.p} scale={v.scale} selected={sel?.kind === "path" && sel.id === it.p.id} hits={hitsByPath.get(it.p.id) ?? NO_HITS} />
          </g>
        ),
      )}
      {l?.pathNodes.map((n) => (
        <g key={n.id}>
          {(n.stroke || n.fill) && (
            <g transform="scale(1 -1)">
              <NodeShape n={n} scale={v.scale} selected={false} />
            </g>
          )}
          <NodeLabel n={n} macros={macros.value} />
          {n.kind === "path" && n.text && (
            <rect
              data-label={n.id}
              data-testid="edge-label"
              class="tf-label-hit"
              x={f(n.shape.center.x - n.shape.hw)}
              y={f(-n.shape.center.y - n.shape.hh)}
              width={f(2 * n.shape.hw)}
              height={f(2 * n.shape.hh)}
            >
              <title>Double-click to edit this label</title>
            </rect>
          )}
        </g>
      ))}
      {l?.nodes.map((n) =>
        n.kind === "coordinate" ? (
          <CoordinateMark key={`mark-${n.id}`} n={n} scale={v.scale} selected={selIds.includes(n.id)} unused={unusedCoords.value.has(n.id)} />
        ) : n.kind === "statement" ? (
          <UndrawnMark key={`mark-${n.id}`} n={n} scale={v.scale} />
        ) : null,
      )}
      <g transform="scale(1 -1)" class="tf-overlay">
        {selEdge && <EdgeSelection edge={selEdge} scale={v.scale} />}
        {selected.map((n) => (
          <rect
            x={f(n.shape.center.x - n.shape.hw - 3 / v.scale)}
            y={f(n.shape.center.y - n.shape.hh - 3 / v.scale)}
            width={f(2 * n.shape.hw + 6 / v.scale)}
            height={f(2 * n.shape.hh + 6 / v.scale)}
            class={`tf-selection${n.locked ? " locked" : ""}`}
            stroke-width={1.5 / v.scale}
            stroke-dasharray={`${4 / v.scale} ${3 / v.scale}`}
          />
        ))}
        {handleNode &&
          HANDLES.map((h) => {
            const r = 3.5 / v.scale;
            return (
              <rect
                key={h.id}
                data-handle={h.id}
                data-testid="resize-handle"
                x={f(handleNode.shape.center.x + h.fx * (handleNode.shape.hw + 3 / v.scale) - r)}
                y={f(handleNode.shape.center.y + h.fy * (handleNode.shape.hh + 3 / v.scale) - r)}
                width={f(2 * r)}
                height={f(2 * r)}
                class="tf-handle"
                style={{ cursor: h.cursor }}
                stroke-width={f(1 / v.scale)}
              >
                <title>Drag to resize. Ctrl resizes from the centre, Alt turns snapping off.</title>
              </rect>
            );
          })}
        {g.lines.map((gl) =>
          gl.axis === "v" ? (
            <line x1={gl.at} x2={gl.at} y1={gl.from} y2={gl.to} class="tf-guide" stroke-width={1 / v.scale} />
          ) : (
            <line y1={gl.at} y2={gl.at} x1={gl.from} x2={gl.to} class="tf-guide" stroke-width={1 / v.scale} />
          ),
        )}
        {g.gaps.map((gp) => (
          <line x1={gp.from.x} y1={gp.from.y} x2={gp.to.x} y2={gp.to.y} class="tf-gap" stroke-width={2 / v.scale} />
        ))}
      </g>
    </svg>
    <LabelEditor view={v} size={size.value} onDone={() => svgRef.current?.focus({ preventScroll: true })} />
    </>
  );
}

