// The canvas: draws the native preview and handles selection and dragging.
// The model is in TeX pt with y up; the SVG flips y for geometry and places
// labels at (x, -y).
import { signal, useComputed, useSignal, useSignalEffect } from "@preact/signals";
import type { JSX } from "preact";
import { memo } from "preact/compat";
import { useCallback, useEffect, useMemo, useRef } from "preact/hooks";
import { planMove, planPin, positioningText, referenceCandidates } from "../edit/move.ts";
import { annotationsOf, followsByDesign, keptMessage } from "../edit/links.ts";
import { groupBlocker, groupMembers, groupMessage, movingWith, planGroupMove } from "../edit/group.ts";
import { conversionMessage, planChainMove } from "../edit/chains.ts";
import type { Scope } from "../edit/properties.ts";
import { type Hold, planResize, type ResizeOutcome, resizeBlocker, type SizeWant } from "../edit/resize.ts";
import { type GapMark, snapNode } from "../edit/snap.ts";
import { labelledNode } from "../edit/label.ts";
import type { Change } from "../edit/changes.ts";
import { END_ANCHORS, endBlocker, type EndTarget, planWaypoint, snapWaypoint } from "../edit/edges.ts";
import { type CurveHandle, curveForm, curveMiddle, curveSegments, planCurve } from "../edit/curves.ts";
import { orthoPolyline, planSlide, snapSlide } from "../edit/orthogonal.ts";
import { edgeOpBlocker } from "../edit/edgeop.ts";
import { fixLabelSides, planSlideLabel, slideBlocker } from "../edit/labels.ts";
import { edgeVertices, isEdgeOperation, planAddVertex } from "../edit/vertices.ts";
import { EdgeMenu, type EdgeMenuAt } from "./edgemenu.tsx";
import { analyzeDocument, layoutDocumentPicture, pictureEnv } from "../model/document.ts";
import { type Edge, edgeD, edgeEnds, edgeOfLabel } from "../model/edges.ts";
import { undrawable } from "../model/explain.ts";
import { type RGB, cssColor } from "../tikz/colors.ts";
import { defaultTipLength, defaultTipWidth } from "../tikz/keys.ts";
import type { LaidOutNode, LaidOutPath, PictureLayout, Tip } from "../tikz/layout.ts";
import { anchorPoint, outline, type Point, shapeMiddle } from "../tikz/shapes.ts";
import { PT_PER_UNIT } from "../tikz/units.ts";
import type { Shading } from "../tikz/state.ts";
import { katexMacros, labelHtml } from "./labelHtml.ts";
import { CompiledPicture } from "./compiled.tsx";
import { isMac } from "./shortcuts.tsx";
import { WidthGuide } from "./pagepanel.tsx";
import { ContrastMarks, selectContrastIssue } from "./contrastmarks.tsx";
import { labelFix, LabelFixMenu, LabelWarnings } from "./labelwarning.tsx";
import { VisionFilter, visionFilterAttr } from "./visionui.tsx";
import { markedNodes, pickBlock, selectedBlock, showingTex, STALE_HIDE, STALE_SHOW, stalePicture } from "./preview.ts";
import {
  activeScope,
  applyEdgeEdit,
  applyEdit,
  dropIntoLane,
  keepFollowers,
  moveFollowers,
  cornerMessage,
  edgeCode,
  removeVertex,
  applyResize,
  cancelLabelEdit,
  commitLabelEdit,
  connectNodes,
  createFromKeyboard,
  deleteSelection,
  alsoNotes,
  moveEnd,
  previewEnd,
  dropFromPalette,
  editLock,
  labelEdit,
  labelEditProblem,
  setLabelDraft,
  startLabelEdit,
  baseLayout,
  currentPicture,
  doc,
  edges,
  fitRequests,
  guides,
  layout,
  overrides,
  PALETTE_DRAG,
  palette,
  revealRequest,
  pinNode,
  previewLayout,
  pickLabel,
  selectFromCanvas,
  selectNodes,
  selectedEdge,
  selectedLabelId,
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

/**
 * Nodes TeX put elsewhere than the editor (D98): TeX's box, dashed, where TeX's picture shows the node, and a
 * marker on the editor's own box, whose outline the selection follows.
 */
function MisplacedMarks({ layout, scale, selected }: { layout: PictureLayout | null; scale: number; selected: readonly string[] }) {
  const list = markedNodes.value;
  if (!list.length || !layout) return null;
  return (
    <g class="tf-misplaced" data-testid="misplaced-marks">
      {list.map((m) => {
        const n = layout.nodes.find((x) => x.id === m.id);
        if (!n) return null;
        const mid = shapeMiddle(n.shape);
        const note = `TeX puts ${m.name} ${Math.round(m.off * 10) / 10} pt from where the editor's own drawing does, so its outline here and positions written next to it may be off. Select it to see TeX's box.`;
        return (
          <g key={m.id} data-node={n.id} data-testid="misplaced-marker">
            <title>{note}</title>
            {selected.includes(n.id) && (
              <rect data-testid="misplaced-tex-box" x={f(m.tex.x - m.tex.w / 2)} y={f(-(m.tex.y + m.tex.h / 2))} width={f(m.tex.w)} height={f(m.tex.h)} stroke-width={f(1.2 / scale)} stroke-dasharray={`${3 / scale} ${2 / scale}`} />
            )}
            <circle cx={f(mid.x - n.shape.hw)} cy={f(-(mid.y + n.shape.hh))} r={f(4 / scale)} stroke-width={f(1.2 / scale)} />
          </g>
        );
      })}
    </g>
  );
}

/** A small marker on a node with options the preview can't draw. */
function UndrawnMark({ n, scale }: { n: LaidOutNode; scale: number }) {
  const what = undrawable(n);
  if (!what.length) return null;
  const x = f(shapeMiddle(n.shape).x + n.shape.hw);
  const y = f(-(shapeMiddle(n.shape).y + n.shape.hh));
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

/** The two ends of the selected edge, as handles to drag to another anchor or node. */
function EndHandles({ edge, scale }: { edge: Edge; scale: number }) {
  const ends = edgeEnds(edge);
  return (
    <g class="tf-end-handles">
      {(["from", "to"] as const).map((which) => {
        const p = which === "from" ? ends.start : ends.end;
        const blocked = endBlocker(edge, which);
        return (
          <circle
            key={which}
            data-end={which}
            data-testid={`edge-end-${which}`}
            cx={f(p.x)}
            cy={f(p.y)}
            r={f(5 / scale)}
            class={`tf-end-handle${blocked ? " blocked" : ""}`}
            stroke-width={f(1.4 / scale)}
          >
            <title>{blocked ?? `Drag the ${which === "from" ? "start" : "end"} to another anchor or node. Right-click for its anchors.`}</title>
          </circle>
        );
      })}
    </g>
  );
}

/**
 * The corners of the selected edge, to drag or double-click away, and ghost
 * handles in the middle of its straight segments: drag one to add a corner.
 * Orthogonal edges are edited by sliding their segments instead.
 */
function VertexHandles({ edge, scale }: { edge: Edge; scale: number }) {
  if (edge.mode === "orthogonal" || (isEdgeOperation(edge) && edgeOpBlocker(edge))) return null;
  return (
    <g class="tf-vertex-handles">
      {edge.segs.map((k) => {
        const s = edge.route.segs[k]!;
        if (s.kind !== "line" || Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y) * scale < 24) return null;
        return (
          <circle key={`g${k}`} data-ghost={k} data-testid="ghost-handle" cx={f((s.from.x + s.to.x) / 2)} cy={f((s.from.y + s.to.y) / 2)} r={f(3.5 / scale)} class="tf-ghost-handle" stroke-width={f(1.2 / scale)}>
            <title>Drag to add a corner here</title>
          </circle>
        );
      })}
      {edgeVertices(edge).map((k) => {
        const q = edge.route.stops[k]!.point;
        const r = 4 / scale;
        return (
          <rect key={`v${k}`} data-vertex={k} data-testid="vertex-handle" x={f(q.x - r)} y={f(q.y - r)} width={f(2 * r)} height={f(2 * r)} transform={`rotate(45 ${f(q.x)} ${f(q.y)})`} class="tf-vertex-handle" stroke-width={f(1.2 / scale)}>
            <title>Drag to move this corner. Double-click to remove it.</title>
          </rect>
        );
      })}
    </g>
  );
}

/** Handles on the segments of an orthogonal edge: drag one to slide it across. */
function SegmentHandles({ edge, scale }: { edge: Edge; scale: number }) {
  if (edge.mode !== "orthogonal" || isEdgeOperation(edge)) return null;
  const poly = orthoPolyline(edge);
  if (!poly) return null;
  return (
    <g class="tf-segment-handles">
      {poly.pieces.map((p, i) => {
        const len = Math.hypot(p.drawnTo.x - p.drawnFrom.x, p.drawnTo.y - p.drawnFrom.y);
        if (len * scale < 16) return null;
        const mx = (p.drawnFrom.x + p.drawnTo.x) / 2;
        const my = (p.drawnFrom.y + p.drawnTo.y) / 2;
        const w = (p.axis === "h" ? 12 : 5) / scale;
        const h = (p.axis === "h" ? 5 : 12) / scale;
        return (
          <rect key={i} data-segment={i} data-testid="segment-handle" x={f(mx - w / 2)} y={f(my - h / 2)} width={f(w)} height={f(h)} rx={f(1.5 / scale)} class={`tf-segment-handle ${p.axis}`} stroke-width={f(1.2 / scale)}>
            <title>{p.axis === "h" ? "Drag up or down to slide this segment" : "Drag left or right to slide this segment"}</title>
          </rect>
        );
      })}
    </g>
  );
}

/** The handles of the selected edge's curves: near each end and in the middle, or the control points of a `.. controls ..` curve. */
function ControlHandles({ edge, scale }: { edge: Edge; scale: number }) {
  const segs = curveSegments(edge);
  if (!segs.length) return null;
  return (
    <g class="tf-control-handles">
      {segs.map((k) => {
        const s = edge.route.segs[k]!;
        const form = curveForm(edge, k);
        if (form === "controls") {
          const arms: Array<[Point, Point, 1 | 2]> = [
            [s.from, s.c1!, 1],
            [s.to, s.c2!, 2],
          ];
          return arms.map(([end, c, which]) => (
            <g key={`${k}:c${which}`}>
              <line x1={f(end.x)} y1={f(end.y)} x2={f(c.x)} y2={f(c.y)} class="tf-control-arm" stroke-width={f(1 / scale)} stroke-dasharray={`${f(3 / scale)} ${f(2 / scale)}`} />
              <circle data-control={`${k}:c${which}`} data-testid="control-handle" cx={f(c.x)} cy={f(c.y)} r={f(4 / scale)} class="tf-control-handle" stroke-width={f(1.2 / scale)}>
                <title>Drag to move this control point</title>
              </circle>
            </g>
          ));
        }
        if (form !== "keys") return null;
        const mid = curveMiddle(s);
        const arms: Array<[Point, Point, 1 | 2]> = [
          [s.from, curveEndHandle(s.from, s.c1!, scale), 1],
          [s.to, curveEndHandle(s.to, s.c2!, scale), 2],
        ];
        return (
          <g key={k}>
            {arms.map(([end, h, which]) => (
              <g key={which}>
                <line x1={f(end.x)} y1={f(end.y)} x2={f(h.x)} y2={f(h.y)} class="tf-control-arm" stroke-width={f(1 / scale)} stroke-dasharray={`${f(3 / scale)} ${f(2 / scale)}`} />
                <circle data-control={`${k}:end${which}`} data-testid="curve-end-handle" cx={f(h.x)} cy={f(h.y)} r={f(3.5 / scale)} class="tf-control-handle tf-curve-end" stroke-width={f(1.2 / scale)}>
                  <title>Drag to turn the curve where it {which === 1 ? "leaves" : "arrives"}: this end's angle only</title>
                </circle>
              </g>
            ))}
            <rect data-control={`${k}:mid`} data-testid="curve-mid-handle" x={f(mid.x - 4.5 / scale)} y={f(mid.y - 4.5 / scale)} width={f(9 / scale)} height={f(9 / scale)} rx={f(2 / scale)} class="tf-control-handle tf-curve-mid" stroke-width={f(1.2 / scale)}>
              <title>Drag to bend the curve: both ends move together</title>
            </rect>
          </g>
        );
      })}
    </g>
  );
}

/** Where a curve's end handle sits: on the arm that leaves the end, a short way along it. */
function curveEndHandle(end: Point, control: Point, scale: number): Point {
  const len = Math.hypot(control.x - end.x, control.y - end.y);
  if (len < 1e-6) return { x: end.x + 22 / scale, y: end.y };
  const d = Math.max(len * 0.5, 22 / scale);
  return { x: end.x + ((control.x - end.x) / len) * d, y: end.y + ((control.y - end.y) / len) * d };
}


/** Small handles outside a node's sides: drag one to another node to draw an edge. */
function ConnectHandles({ n, scale }: { n: LaidOutNode; scale: number }) {
  const off = CONNECT_OFFSET / scale;
  const dirs: Record<(typeof SIDES)[number], Point> = { north: { x: 0, y: 1 }, east: { x: 1, y: 0 }, south: { x: 0, y: -1 }, west: { x: -1, y: 0 } };
  return (
    <g class="tf-connect-handles">
      {SIDES.map((side) => {
        const a = anchorPoint(n.shape, side);
        if (!a) return null;
        const d = dirs[side];
        return (
          <circle
            key={side}
            data-connect={side}
            data-connect-node={n.id}
            data-testid="connect-handle"
            cx={f(a.x + d.x * off)}
            cy={f(a.y + d.y * off)}
            r={f(4.5 / scale)}
            class="tf-connect-handle"
            stroke-width={f(1.2 / scale)}
          >
            <title>Drag to another node to draw an edge</title>
          </circle>
        );
      })}
    </g>
  );
}

/** While an end or a new edge is dragged: the node it would attach to, its anchors, and a line to the pointer. */
function EdgeDragOverlay({ view, layout, scale }: { view: EdgeDragView; layout: PictureLayout; scale: number }) {
  const n = view.target && layout.nodes.find((x) => x.id === view.target!.node);
  return (
    <g class={`tf-edge-drag${view.ok ? "" : " refused"}`} data-testid="edge-drag">
      {n && (
        <rect
          x={f(shapeMiddle(n.shape).x - n.shape.hw - 3 / scale)}
          y={f(shapeMiddle(n.shape).y - n.shape.hh - 3 / scale)}
          width={f(2 * n.shape.hw + 6 / scale)}
          height={f(2 * n.shape.hh + 6 / scale)}
          class="tf-drop-target"
          stroke-width={f(1.5 / scale)}
        />
      )}
      {n &&
        END_ANCHORS.map((a) => {
          const q = anchorPoint(n.shape, a);
          if (!q) return null;
          const active = view.target?.anchor === a;
          return <circle key={a} cx={f(q.x)} cy={f(q.y)} r={f((active ? 4.5 : 3) / scale)} class={`tf-anchor-dot${active ? " active" : ""}`} stroke-width={f(1 / scale)} />;
        })}
      {view.line && <line x1={f(view.line.from.x)} y1={f(view.line.from.y)} x2={f(view.line.to.x)} y2={f(view.line.to.y)} class="tf-drag-line" stroke-width={f(1.5 / scale)} stroke-dasharray={`${f(4 / scale)} ${f(3 / scale)}`} />}
    </g>
  );
}

interface View {
  /** Screen pixels per pt. */
  scale: number;
  /** Model point at the center of the canvas. */
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

// The components below are memoized on what they draw: while dragging, only
// the moved node and the paths touching it change.
const nodeSig = (n: LaidOutNode) =>
  [n.id, n.shape.kind, n.shape.center.x, n.shape.center.y, n.shape.hw, n.shape.hh, n.shape.rotate, n.shape.roundedCorners, n.stroke, n.fill, n.lineWidth, n.dash, n.opacity, n.fillOpacity, n.shadow, n.locked, n.shading && JSON.stringify(n.shading), n.double && JSON.stringify(n.double)].join("|");

// A drag frame keeps the objects of what it didn't move (D108): the same object draws the same.
const NodeShape = memo(NodeShapeView, (a, b) => a.scale === b.scale && a.selected === b.selected && a.inert === b.inert && (a.n === b.n || nodeSig(a.n) === nodeSig(b.n)));

/** `inert`: a copy that only shows (the patch over a stale TeX picture, D96), without the ids the pointer and tests look for. */
function NodeShapeView({ n, scale, selected, inert }: { n: LaidOutNode; scale: number; selected: boolean; inert?: boolean }) {
  // Coordinates are drawn as markers on top (CoordinateMark).
  if (n.kind === "coordinate") return null;
  const d = outline(n.shape);
  const minStroke = 0.6 / scale;
  const fill = n.shading ? `url(#${gradId(n.id)})` : rgba(n.fill, "transparent");
  // A turned node (D87): its outline is drawn unturned and turned about its center, as its text is.
  // Outlines are drawn y up (the text y down), so the turn is counterclockwise there.
  const turn = n.shape.rotate ? `rotate(${n.shape.rotate} ${f(n.shape.center.x)} ${f(n.shape.center.y)})` : undefined;
  return (
    <g data-node={inert ? undefined : n.id} class={`tf-node${n.locked ? " locked" : ""}${selected ? " selected" : ""}`} transform={turn}>
      {n.shadow && d && <path d={d} transform="translate(2.5 -2.5)" fill="#000" opacity={0.35} />}
      {d && (
        <path
          d={d}
          fill={fill}
          fill-opacity={n.fillOpacity}
          stroke={rgba(n.stroke)}
          stroke-width={n.double ? 2 * n.lineWidth + n.double.distance : Math.max(n.lineWidth, minStroke)}
          stroke-dasharray={n.dash?.join(" ")}
          opacity={n.opacity}
          vector-effect="none"
        />
      )}
      {/* "double": a wide line in the draw color, then the gap drawn over it (as pgf does). */}
      {d && n.double && n.stroke && <path d={d} fill="none" stroke={cssColor(n.double.color)} stroke-width={n.double.distance} opacity={n.opacity} />}
    </g>
  );
}

const NodeLabel = memo(
  NodeLabelView,
  (a, b) =>
    a.macros === b.macros &&
    a.inert === b.inert &&
    (a.n === b.n ||
      (a.n.text === b.n.text &&
    a.n.textOrigin.x === b.n.textOrigin.x &&
    a.n.textOrigin.y === b.n.textOrigin.y &&
    a.n.rotate === b.n.rotate &&
    a.n.opacity === b.n.opacity &&
    String(a.n.textColor) === String(b.n.textColor))),
);

function NodeLabelView({ n, macros, inert }: { n: LaidOutNode; macros: Record<string, string>; inert?: boolean }) {
  const t = n.text;
  const html = useMemo(() => (t ? labelHtml(t, macros) : ""), [t, macros]);
  if (!t || !html) return null;
  const w = Math.max(t.width, 1);
  const h = t.height + t.depth;
  const x = n.textOrigin.x;
  const y = -n.textOrigin.y;
  const rot = n.rotate ? `rotate(${-n.rotate} ${f(n.shape.center.x)} ${f(-n.shape.center.y)})` : undefined;
  return (
    <foreignObject x={f(x)} y={f(y)} width={f(w + 2)} height={f(h + 2)} transform={rot} class="tf-label-box" data-node={n.kind === "path" || inert ? undefined : n.id}>
      <div class="tf-label" style={{ color: cssColor(n.textColor), opacity: n.opacity }} dangerouslySetInnerHTML={{ __html: html }} />
    </foreignObject>
  );
}

const pathSig = (p: LaidOutPath) =>
  [p.id, p.d, p.stroke, p.fill, p.lineWidth, p.dash, p.opacity, p.fillOpacity, p.shading && JSON.stringify(p.shading), p.double && JSON.stringify(p.double), JSON.stringify(p.tips)].join("|");

/** Where each edge of a path can be clicked. */
interface EdgeHit {
  id: string;
  d: string;
}

/** Each edge's click area, kept per edge object: a drag frame keeps those of the paths it didn't lay out again (D108). */
const hitCache = new WeakMap<Edge, EdgeHit>();
/** The hits of one path, kept per path object so a memoized path sees the same list. */
const pathHitCache = new WeakMap<LaidOutPath, EdgeHit[]>();

function pathHits(edges: readonly Edge[]): Map<string, EdgeHit[]> {
  const byPath = new Map<string, { path: LaidOutPath; hits: EdgeHit[] }>();
  for (const e of edges) {
    let h = hitCache.get(e);
    if (!h) {
      h = { id: e.id, d: edgeD(e) };
      hitCache.set(e, h);
    }
    const entry = byPath.get(e.path.id);
    if (entry) entry.hits.push(h);
    else byPath.set(e.path.id, { path: e.path, hits: [h] });
  }
  const out = new Map<string, EdgeHit[]>();
  for (const [id, { path, hits }] of byPath) {
    const known = pathHitCache.get(path);
    if (known && known.length === hits.length && known.every((k, i) => k === hits[i])) out.set(id, known);
    else {
      pathHitCache.set(path, hits);
      out.set(id, hits);
    }
  }
  return out;
}

const PathShape = memo(
  PathShapeView,
  (a, b) =>
    a.scale === b.scale &&
    a.selected === b.selected &&
    a.inert === b.inert &&
    ((a.p === b.p && a.hits === b.hits) || (pathSig(a.p) === pathSig(b.p) && a.hits.map((h) => h.id + h.d).join("|") === b.hits.map((h) => h.id + h.d).join("|"))),
);

function PathShapeView({ p, scale, selected, hits, inert }: { p: LaidOutPath; scale: number; selected: boolean; hits: readonly EdgeHit[]; inert?: boolean }) {
  if (!p.d && !p.tips.length) return null;
  const minStroke = 0.6 / scale;
  const fill = p.shading ? `url(#${gradId(p.id)})` : rgba(p.fill);
  return (
    <g data-path={inert ? undefined : p.id} class={`tf-path${selected ? " selected" : ""}`}>
      {selected && <path d={p.d} class="tf-path-halo" stroke-width={p.lineWidth + 4 / scale} />}
      {/* A path with edges is clicked edge by edge; other paths as a whole. */}
      {hits.length || inert ? null : <path d={p.d} class="tf-path-hit" stroke-width={10 / scale} />}
      <path
        d={p.d}
        fill={fill}
        fill-opacity={p.fillOpacity}
        stroke={rgba(p.stroke)}
        stroke-width={p.double ? 2 * p.lineWidth + p.double.distance : Math.max(p.lineWidth, minStroke)}
        stroke-dasharray={p.dash?.join(" ")}
        stroke-linejoin="round"
        opacity={p.opacity}
      />
      {p.double && p.stroke && <path d={p.d} fill="none" stroke={cssColor(p.double.color)} stroke-width={p.double.distance} stroke-linejoin="round" opacity={p.opacity} />}
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

/** Where TeX's stale picture is cut out (`hide`) and the native patch shows (`show`), as SVG masks (D96). */
function StaleMasks() {
  const marks = stalePicture.value?.patch.marks;
  if (!marks?.length) return null;
  const shapes = (color: string) => (
    <g transform="scale(1 -1)">
      {marks.map((m) =>
        m.kind === "box" ? (
          <rect x={f(m.box.x0)} y={f(m.box.y0)} width={f(m.box.x1 - m.box.x0)} height={f(m.box.y1 - m.box.y0)} fill={color} />
        ) : (
          <path d={m.d} fill={m.fill ? color : "none"} stroke={color} stroke-width={f(m.width)} stroke-linecap="round" stroke-linejoin="round" />
        ),
      )}
    </g>
  );
  const box = { maskUnits: "userSpaceOnUse", x: -1e5, y: -1e5, width: 2e5, height: 2e5 };
  return (
    <>
      <mask id={STALE_HIDE} {...box}>
        <rect x={-1e5} y={-1e5} width={2e5} height={2e5} fill="white" />
        {shapes("black")}
      </mask>
      <mask id={STALE_SHOW} {...box}>
        {shapes("white")}
      </mask>
    </>
  );
}

/** The native drawing of what changed since TeX's last picture, shown only where that picture is cut out (D96). Not clickable: the native drawing underneath answers the pointer. */
function StalePatchLayer({ l, scale, macros }: { l: PictureLayout | null; scale: number; macros: Record<string, string> }) {
  const s = stalePicture.value;
  if (!s || !l || !s.patch.marks.length) return null;
  const { draw } = s.patch;
  const items = drawOrder(l).filter((it) => (it.kind === "node" ? draw.has(it.n.id) || it.n.extras.some((x) => draw.has(x.id)) : draw.has(it.p.id)));
  return (
    <g class="tf-stale-patch" mask={`url(#${STALE_SHOW})`} data-testid="stale-patch" aria-hidden="true">
      {items.map((it) =>
        it.kind === "node" ? (
          <g key={it.n.id}>
            <g transform="scale(1 -1)">
              <NodeShape n={it.n} scale={scale} selected={false} inert />
            </g>
            <NodeLabel n={it.n} macros={macros} inert />
            {it.n.extras.map((x) => (
              <NodeLabel key={x.id} n={x} macros={macros} inert />
            ))}
          </g>
        ) : (
          <g key={it.p.id} transform="scale(1 -1)">
            <PathShape p={it.p} scale={scale} selected={false} hits={NO_HITS} inert />
          </g>
        ),
      )}
      {l.pathNodes
        .filter((n) => draw.has(n.id))
        .map((n) => (
          <g key={n.id}>
            {(n.stroke || n.fill) && (
              <g transform="scale(1 -1)">
                <NodeShape n={n} scale={scale} selected={false} inert />
              </g>
            )}
            <NodeLabel n={n} macros={macros} inert />
          </g>
        ))}
    </g>
  );
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
  const n = e ? labelledNode(e.creating || e.adding ? layout.value : baseLayout.value, e.id) : undefined;
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
          } else if (ev.key === "Tab" && !e.adding && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey && !ev.isComposing) {
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
/** Dragging several nodes together (a multi-selection, or a fit node's members). */
interface GroupDrag {
  kind: "group";
  /** The selection being dragged, and the node under the pointer. */
  ids: string[];
  grab: string;
  pointer: Point;
  center: Point;
  moved: boolean;
  target: Point;
  members: string[];
  /** Members and what follows them: not snap targets. */
  moving: Set<string>;
  /** Why the group can't be moved, or null. */
  blocked: string | null;
  /** Nodes outside the group that follow it (D104): they stay where they are unless followers move too; its annotations always move (D107). */
  followers: Followers;
  /** Whether the followers move along in this drag, and the last pointer position, for Ctrl pressed mid-drag. */
  along: boolean;
  last: { raw: Point; alt: boolean } | null;
}

/** Dragging one node (D24). Its followers stay where they are unless they move too (D104). */
interface NodeDrag {
  kind: "node";
  id: string;
  pointer: Point;
  center: Point;
  moved: boolean;
  target: Point;
  alignedWith: string[];
  followers: Followers;
  along: boolean;
  last: { raw: Point; alt: boolean } | null;
}

/** What follows dragged nodes: every node that moves along with them, and of those their annotations, which move even when only the dragged nodes do (D107). */
interface Followers {
  ids: string[];
  annotations: string[];
}

/**
 * The nodes that move along with `members` because they are placed against them, not counting group
 * and lane boxes and the coordinates lanes share (they follow their members) or labels on paths.
 */
function followersOf(text: string, l: PictureLayout, members: readonly string[]): Followers {
  const design = followsByDesign(text, l);
  const ids = [...movingWith(l, members)].filter((id) => {
    if (members.includes(id) || design.has(id)) return false;
    const n = l.nodes.find((x) => x.id === id);
    return !!n && n.kind !== "path" && n.lock?.kind !== "path";
  });
  return { ids, annotations: annotationsOf(text, l, members, design).filter((id) => ids.includes(id)) };
}

/** The followers held where they are while only the dragged nodes (and their annotations) move. */
const staying = (f: Followers) => f.ids.filter((id) => !f.annotations.includes(id));

/** The followers that stay, held at their centers in `l`, as drag overrides. */
function holds(l: PictureLayout, f: Followers): Array<readonly [string, Point]> {
  return staying(f).flatMap((id) => {
    const c = l.nodes.find((x) => x.id === id)?.shape.center;
    return c ? [[id, c] as const] : [];
  });
}

/** " Its labels moved with it: Reading, 12." */
function annotationNote(l: PictureLayout | null, f: Followers, group = false): string {
  if (!f.annotations.length) return "";
  const names = f.annotations.map((id) => {
    const n = l?.nodes.find((x) => x.id === id);
    return n?.name ?? n?.syntax.label?.text.trim() ?? id;
  });
  return ` ${group ? "Their" : "Its"} ${names.length === 1 ? "label" : "labels"} moved with ${group ? "them" : "it"}: ${names.slice(0, 4).join(", ")}${names.length > 4 ? `, and ${names.length - 4} more` : ""}.`;
}

/** Ctrl, or ⌘ on a Mac: the key that moves followers along for one drag. */
const modKey = () => (isMac() ? "⌘" : "Ctrl");

/** Whether a drag moves the followers too (D104): the toolbar's switch, flipped while Ctrl (⌘) is held. */
const followersAlong = (e: { ctrlKey: boolean; metaKey: boolean }) => moveFollowers.value !== (e.ctrlKey || e.metaKey);

/** The followers of the node or group being dragged, shown faintly: moving along, or staying where they are. */
const dragFollowers = signal<{ followers: Followers; along: boolean } | null>(null);

/** Faint outlines on the dragged node's followers (D102): solid when they move along (annotations always do, D107), dashed when they stay. */
function FollowerMarks({ layout, scale }: { layout: PictureLayout | null; scale: number }) {
  const d = dragFollowers.value;
  if (!d || !d.followers.ids.length || !layout) return null;
  return (
    <g class={`tf-followers${d.along ? " along" : " staying"}`} data-testid="follower-marks" data-along={d.along ? "yes" : "no"}>
      {d.followers.ids.map((id) => {
        const n = layout.nodes.find((x) => x.id === id);
        if (!n) return null;
        const moves = d.along || d.followers.annotations.includes(id);
        const mid = shapeMiddle(n.shape);
        const pad = 3 / scale;
        return (
          <rect
            key={id}
            data-follower={id}
            data-moving={moves ? "yes" : "no"}
            x={f(mid.x - n.shape.hw - pad)}
            y={f(-(mid.y + n.shape.hh + pad))}
            width={f(2 * (n.shape.hw + pad))}
            height={f(2 * (n.shape.hh + pad))}
            stroke-width={f(1.5 / scale)}
            stroke-dasharray={moves ? undefined : `${4 / scale} ${3 / scale}`}
          />
        );
      })}
    </g>
  );
}

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
  /** What follows the node: it stays where it is unless followers move too (Ctrl, or the toolbar's switch), as in dragging (D107). */
  followers: Followers;
  along: boolean;
}

const MM_PT = PT_PER_UNIT.mm!;

/** Dragging an end of the selected edge to another anchor or node. */
interface EndDrag {
  kind: "end";
  edgeId: string;
  which: "from" | "to";
  pointer: Point;
  moved: boolean;
  target: EndTarget | null;
  key: string;
  /** Whether the edge can go where it is now. */
  ok: boolean;
}

/** Dragging a corner of the selected edge, or a ghost handle to add one. */
interface VertexDrag {
  kind: "vertex";
  edgeId: string;
  /** The corner being moved (a stop index), or else the segment a new corner goes on. */
  stop: number | null;
  seg: number | null;
  pointer: Point;
  origin: Point;
  /** The points before and after it, to line up with. */
  neighbors: Point[];
  moved: boolean;
  key: string;
  last: { changes: Change[]; stop: number; layout: PictureLayout; edgeId?: string | undefined; notes: readonly string[] } | null;
}

/** Sliding a segment of an orthogonal edge across. */
interface SlideDrag {
  kind: "slide";
  edgeId: string;
  piece: number;
  axis: "h" | "v";
  pointer: Point;
  /** The segment's y (horizontal) or x (vertical) when the drag started. */
  origin: number;
  moved: boolean;
  key: string;
  last: { changes: Change[]; text: string; layout: PictureLayout; notes: readonly string[] } | null;
}

/** Sliding a label along its edge. */
interface LabelDrag {
  kind: "label";
  labelId: string;
  edgeId: string;
  moved: boolean;
  pointer: Point;
  /** Where the label is attached to the edge when the drag starts. */
  origin: Point;
  key: string;
  last: { changes: Change[]; layout: PictureLayout; pos: number; written: string } | null;
}

/** Dragging a control point of a curve. */
interface ControlDrag {
  kind: "control";
  edgeId: string;
  seg: number;
  handle: CurveHandle;
  pointer: Point;
  /** Where the handle was when the drag started. */
  origin: Point;
  moved: boolean;
  key: string;
  last: { changes: Change[]; text: string; layout: PictureLayout; notes: readonly string[] } | null;
}

/** Drawing a new edge from a node's connection handle. */
interface ConnectDrag {
  kind: "connect";
  from: EndTarget;
  start: Point;
  target: EndTarget | null;
}

/** What the canvas shows while an end or a new edge is dragged: the node under the pointer, its anchors, and a line. */
interface EdgeDragView {
  target: EndTarget | null;
  ok: boolean;
  line?: { from: Point; to: Point };
}

/** How far outside a node its connection handles sit, in screen px. */
const CONNECT_OFFSET = 13;
const SIDES = ["north", "east", "south", "west"] as const;

/** The node under `p` (with a margin, in pt) and the anchor of it within `snap` pt, if any. */
function targetAt(l: PictureLayout, p: Point, margin: number, snap: number, exclude?: string): EndTarget | null {
  const hit = [...l.nodes].reverse().find((n) => n.kind === "statement" && n.id !== exclude && Math.abs(p.x - n.shape.center.x) <= n.shape.hw + margin && Math.abs(p.y - n.shape.center.y) <= n.shape.hh + margin);
  if (!hit) return null;
  let best: { anchor: string; d: number } | null = null;
  for (const a of END_ANCHORS) {
    const q = anchorPoint(hit.shape, a);
    const d = q ? Math.hypot(q.x - p.x, q.y - p.y) : Infinity;
    if (d <= snap && (!best || d < best.d)) best = { anchor: a, d };
  }
  return best ? { node: hit.id, anchor: best.anchor } : { node: hit.id };
}

/** How far (screen px) a right or middle press may move and still be a click. */
const PAN_SLOP = 4;

export function Canvas() {
  const svgRef = useRef<SVGSVGElement>(null);
  const size = useSignal({ w: 800, h: 600 });
  const view = useSignal<View>({ scale: 2, cx: 0, cy: 0 });
  const drag = useRef<
    | NodeDrag
    | { kind: "pan"; client: Point; view: View; moved: boolean; button: number }
    | GroupDrag
    | ResizeDrag
    | EndDrag
    | VertexDrag
    | SlideDrag
    | LabelDrag
    | ControlDrag
    | ConnectDrag
    | null
  >(null);
  /** The node the pointer is over, for its connection handles. */
  const hover = useSignal<string | null>(null);
  const edgeDrag = useSignal<EdgeDragView | null>(null);
  /** The edge context menu, at a position in the canvas pane. */
  const menu = useSignal<{ edgeId: string; x: number; y: number; at: EdgeMenuAt } | null>(null);
  /** Space is held: a left drag pans, as in design tools. */
  const spaceHeld = useSignal(false);
  /** A right-button drag panned: the context menu that follows the release is not opened. */
  const panned = useRef(false);
  /** A context menu asked for while the right button is still down (macOS and Linux ask on press): opened on release if the pointer didn't move. */
  const pendingMenu = useRef<{ clientX: number; clientY: number; target: Element } | null>(null);

  // Space+drag pans. Only while the canvas (or nothing in particular) has the focus, so Space still types in the code and in fields.
  useEffect(() => {
    const free = (t: EventTarget | null) => t === svgRef.current || t === document.body || t === document.documentElement || t === null;
    const down = (e: KeyboardEvent) => {
      if (e.key !== " " || e.ctrlKey || e.metaKey || e.altKey || !free(e.target) || labelEdit.value) return;
      e.preventDefault();
      spaceHeld.value = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === " ") spaceHeld.value = false;
    };
    const blur = () => (spaceHeld.value = false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

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
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    const target = e.target as Element;
    const nodeEl = target.closest("[data-node]");
    const pathEl = target.closest("[data-path]");
    const svg = svgRef.current!;
    svg.focus({ preventScroll: true });
    // Right or middle drag, or a left drag with Space held, pans from anywhere, as in design tools.
    // A right click that doesn't move still opens the menu (onContextMenu).
    if (e.button === 2 || e.button === 1 || spaceHeld.value) {
      panned.current = false;
      pendingMenu.current = null;
      drag.current = { kind: "pan", client: { x: e.clientX, y: e.clientY }, view: view.value, moved: false, button: e.button === 0 ? -1 : e.button };
      svg.setPointerCapture(e.pointerId);
      return;
    }
    // Another window is editing this diagram (D97): a click selects a node, a drag pans, nothing moves.
    if (editLock.peek()) {
      if (nodeEl) selectFromCanvas({ kind: "node", id: nodeEl.getAttribute("data-node")! });
      drag.current = { kind: "pan", client: { x: e.clientX, y: e.clientY }, view: view.value, moved: false, button: -1 };
      svg.setPointerCapture(e.pointerId);
      return;
    }
    // A label its line runs through (D65): its fixes.
    const warnEl = target.closest("[data-label-warning]");
    if (e.button === 0 && warnEl) {
      // The popover is placed in the stage that holds the canvas.
      const pane = svg.parentElement?.getBoundingClientRect();
      labelFix.value = { labelId: warnEl.getAttribute("data-label-warning")!, x: e.clientX - (pane?.left ?? 0) + 8, y: e.clientY - (pane?.top ?? 0) + 8 };
      return;
    }
    // A node whose text is hard to read (D85): select it, or the edge a label is on.
    const markEl = target.closest("[data-contrast-mark]");
    if (e.button === 0 && markEl) {
      selectContrastIssue(markEl.getAttribute("data-contrast-mark")!);
      return;
    }
    // An end of the selected edge: drag it to another anchor or node.
    const endEl = target.closest("[data-end]");
    const edge = selectedEdge.value;
    if (e.button === 0 && endEl && edge) {
      const which = endEl.getAttribute("data-end") === "from" ? "from" : "to";
      const blocked = endBlocker(edge, which);
      if (blocked) {
        status.value = blocked;
        return;
      }
      drag.current = { kind: "end", edgeId: edge.id, which, pointer: toModel(e), moved: false, target: null, key: "", ok: false };
      svg.setPointerCapture(e.pointerId);
      return;
    }
    // A control point of the selected edge's curve.
    const controlEl = target.closest("[data-control]");
    if (e.button === 0 && edge && controlEl) {
      const [k, w] = controlEl.getAttribute("data-control")!.split(":");
      const seg = Number(k);
      const handle = w as CurveHandle;
      const s = edge.route.segs[seg];
      if (s?.c1 && s.c2) {
        // The end handles sit on their arms, so they are grabbed where they are drawn; the middle handle is the curve's middle.
        const origin = handle === "c1" ? s.c1 : handle === "c2" ? s.c2 : handle === "mid" ? curveMiddle(s) : toModel(e);
        drag.current = { kind: "control", edgeId: edge.id, seg, handle, pointer: toModel(e), origin, moved: false, key: "", last: null };
        svg.setPointerCapture(e.pointerId);
      }
      return;
    }
    // A segment of the selected orthogonal edge: slide it across.
    const segmentEl = target.closest("[data-segment]");
    if (e.button === 0 && edge && segmentEl) {
      const piece = Number(segmentEl.getAttribute("data-segment"));
      const p = orthoPolyline(edge)?.pieces[piece];
      if (p) {
        drag.current = { kind: "slide", edgeId: edge.id, piece, axis: p.axis, pointer: toModel(e), origin: p.axis === "h" ? p.from.y : p.from.x, moved: false, key: "", last: null };
        svg.setPointerCapture(e.pointerId);
      }
      return;
    }
    // A corner of the selected edge, or a ghost handle to add one.
    const vertexEl = target.closest("[data-vertex]");
    const ghostEl = target.closest("[data-ghost]");
    if (e.button === 0 && edge && (vertexEl || ghostEl)) {
      const route = edge.route;
      const pointer = toModel(e);
      const segs = edge.segs.map((k) => route.segs[k]!);
      if (vertexEl) {
        const stop = Number(vertexEl.getAttribute("data-vertex"));
        const before = segs.find((s) => s.b === stop);
        const after = segs.find((s) => s.a === stop);
        const neighbors = [before && route.stops[before.a]!.point, after && route.stops[after.b]!.point].filter((q): q is Point => !!q);
        drag.current = { kind: "vertex", edgeId: edge.id, stop, seg: null, pointer, origin: route.stops[stop]!.point, neighbors, moved: false, key: "", last: null };
      } else {
        const seg = Number(ghostEl!.getAttribute("data-ghost"));
        const s = route.segs[seg]!;
        const origin = { x: (s.from.x + s.to.x) / 2, y: (s.from.y + s.to.y) / 2 };
        drag.current = { kind: "vertex", edgeId: edge.id, stop: null, seg, pointer, origin, neighbors: [route.stops[s.a]!.point, route.stops[s.b]!.point], moved: false, key: "", last: null };
      }
      svg.setPointerCapture(e.pointerId);
      return;
    }
    // A connection handle next to a node: drag it to another node to draw an edge.
    const connectEl = target.closest("[data-connect]");
    if (e.button === 0 && connectEl) {
      const id = connectEl.getAttribute("data-connect-node")!;
      const anchor = connectEl.getAttribute("data-connect")!;
      const n = baseLayout.value?.nodes.find((x) => x.id === id);
      if (n) {
        drag.current = { kind: "connect", from: { node: id, anchor }, start: anchorPoint(n.shape, anchor) ?? n.shape.center, target: null };
        svg.setPointerCapture(e.pointerId);
        status.value = "Drop on another node to draw an edge: on its middle for (a) -- (b), on one of its anchor dots for that anchor.";
      }
      return;
    }
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
          followers: scope.kind === "style" || !baseLayout.value ? { ids: [], annotations: [] } : followersOf(text.value, baseLayout.value, [n.id]),
          along: followersAlong(e),
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
      // A node of a multi-selection drags the whole selection; a fit node drags what it fits.
      const l = baseLayout.value;
      const sel = selectedIds.value;
      const inSelection = sel.length > 1 && sel.includes(id);
      if (l && n && (inSelection || n.lock?.kind === "fit")) {
        const ids = inSelection ? [...sel] : [id];
        if (!inSelection) selectFromCanvas({ kind: "node", id });
        const { members } = groupMembers(l, ids);
        drag.current = {
          kind: "group",
          ids,
          grab: id,
          pointer: toModel(e),
          center: n.shape.center,
          moved: false,
          target: n.shape.center,
          members,
          moving: movingWith(l, members),
          blocked: groupBlocker(l, ids),
          followers: followersOf(text.value, l, members),
          along: followersAlong(e),
          last: null,
        };
        svg.setPointerCapture(e.pointerId);
        return;
      }
      selectFromCanvas({ kind: "node", id });
      // A node locked only by an undefined reference can still be dragged:
      // dropping it pins it there with plain coordinates. A node its chain
      // places is dragged too: dropping it writes the chain out (D77 item 4).
      if (n && (!n.locked || n.lock?.kind === "undefined-ref" || n.lock?.kind === "chain")) {
        const p = toModel(e);
        drag.current = { kind: "node", id, pointer: p, center: n.shape.center, moved: false, target: n.shape.center, alignedWith: [], followers: l ? followersOf(text.value, l, [id]) : { ids: [], annotations: [] }, along: followersAlong(e), last: null };
        svg.setPointerCapture(e.pointerId);
        if (n.lock?.kind === "chain") status.value = "This node's position is set by a chain. Dropping it writes out the positions of the chain's nodes, so they can all be dragged.";
        else if (n.locked) status.value = `${n.locked}. Drag it to pin it where you drop it, or see the panel for other fixes.`;
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
      pickLabel(edge?.id ?? null, id);
      // Dragging it slides it along its edge.
      const l = baseLayout.value;
      if (edge && l && !labelEdit.value && !slideBlocker(l, id)) {
        const attached = labelledNode(l, id)?.pathPos?.point;
        if (attached) {
          drag.current = { kind: "label", labelId: id, edgeId: edge.id, moved: false, pointer: toModel(e), origin: attached, key: "", last: null };
          svg.setPointerCapture(e.pointerId);
        }
      }
      return;
    }
    const edgeEl = target.closest("[data-edge]");
    if (e.button === 0 && edgeEl) {
      pickLabel(null, null);
      selectFromCanvas({ kind: "edge", id: edgeEl.getAttribute("data-edge")! });
      return;
    }
    if (e.button === 0 && pathEl) {
      selectFromCanvas({ kind: "path", id: pathEl.getAttribute("data-path")! });
      return;
    }
    // A locked block TeX drew (a loop, a matrix, …): show its code.
    const blockEl = target.closest("[data-block]");
    if (e.button === 0 && blockEl) {
      selectFromCanvas(null);
      pickBlock(blockEl.getAttribute("data-block")!);
      status.value = "Kept as written: the editor can't change this block visually, so TeX draws it. Its code is selected.";
      return;
    }
    selectedBlock.value = null;
    drag.current = { kind: "pan", client: { x: e.clientX, y: e.clientY }, view: view.value, moved: false, button: 0 };
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
    // Shift the center stays and both edges move, so the size changes twice as
    // fast as the pointer. Alt turns snapping off, and Ctrl (⌘) moves the nodes
    // placed against it along, as in dragging (D107).
    const symmetric = e.shiftKey;
    d.along = followersAlong(e);
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
    resizePreview(d);
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

  /** Shows the resize's last plan, with the node's followers held where they are unless they move too (D107). */
  const resizePreview = (d: ResizeDrag) => {
    const out = d.last;
    const l = baseLayout.value;
    if (!out || !out.changes.length || !l) {
      previewLayout.value = null;
      dragFollowers.value = null;
      return;
    }
    const held = d.along ? [] : holds(l, d.followers);
    previewLayout.value = held.length ? (layoutDocumentPicture(analyzeDocument(out.text), currentPicture.value, new Map(held)) ?? out.layout) : out.layout;
    dragFollowers.value = d.followers.ids.length ? { followers: d.followers, along: d.along } : null;
  };

  /** Dragging a group: snap the node under the pointer, and show every member moved by as much. */
  const groupMove = (d: GroupDrag, e: PointerEvent) => {
    const p = toModel(e);
    if (!d.moved && Math.hypot(p.x - d.pointer.x, p.y - d.pointer.y) * view.value.scale < 3) return;
    d.moved = true;
    if (d.blocked) {
      status.value = d.blocked;
      return;
    }
    d.along = followersAlong(e);
    d.last = { raw: { x: d.center.x + p.x - d.pointer.x, y: d.center.y + p.y - d.pointer.y }, alt: e.altKey };
    groupUpdate(d);
  };

  /** Shows the group at its last pointer position: members moved, followers along or held where they are (D104). */
  const groupUpdate = (d: GroupDrag) => {
    const l = baseLayout.value;
    const n = l?.nodes.find((x) => x.id === d.grab);
    if (!l || !n || !d.last) return;
    const { raw, alt } = d.last;
    // Followers that stay can be lined up with; ones that move along can't.
    const snapped = alt ? { center: raw, guides: [], gaps: [] } : snapNode(l, n, raw, 7 / view.value.scale, d.along ? d.moving : new Set(d.members));
    d.target = snapped.center;
    const dx = d.target.x - d.center.x;
    const dy = d.target.y - d.center.y;
    const at = (id: string) => l.nodes.find((x) => x.id === id)?.shape.center;
    overrides.value = new Map([
      ...d.members.flatMap((id) => {
        const c = at(id);
        return c ? [[id, { x: c.x + dx, y: c.y + dy }] as const] : [];
      }),
      ...(d.along ? [] : holds(l, d.followers)),
    ]);
    dragFollowers.value = { followers: d.followers, along: d.along };
    guides.value = { lines: snapped.guides, gaps: snapped.gaps };
  };

  /** Dragging an end: find the node and anchor under the pointer and show the edge going there. */
  const endMove = (d: EndDrag, e: PointerEvent) => {
    const p = toModel(e);
    if (!d.moved && Math.hypot(p.x - d.pointer.x, p.y - d.pointer.y) * view.value.scale < 3) return;
    d.moved = true;
    const l = baseLayout.value;
    if (!l) return;
    const t = targetAt(l, p, 4 / view.value.scale, 9 / view.value.scale);
    const key = t ? `${t.node}|${t.anchor ?? ""}` : "";
    const edge = shownEdges.value.find((x) => x.id === d.edgeId);
    if (key !== d.key) {
      d.key = key;
      d.target = t;
      const why = previewEnd(d.edgeId, d.which, t);
      d.ok = !!t && !why;
      status.value = !t ? "Drop the end on a node." : why ?? "Release to attach the end here.";
    }
    // Without a valid target, a line from the other end follows the pointer.
    const fixed = edge && edgeEnds(edge)[d.which === "from" ? "end" : "start"];
    edgeDrag.value = { target: d.target, ok: d.ok, ...(!d.ok && fixed ? { line: { from: fixed, to: p } } : {}) };
  };

  /** Dragging a corner: snap it, write it, and show the edge as it would be. */
  const vertexMove = (d: VertexDrag, e: PointerEvent) => {
    const p = toModel(e);
    if (!d.moved && Math.hypot(p.x - d.pointer.x, p.y - d.pointer.y) * view.value.scale < 3) return;
    d.moved = true;
    const l = baseLayout.value;
    const edge = edges.value.find((x) => x.id === d.edgeId);
    if (!l || !edge) return;
    const raw = { x: d.origin.x + p.x - d.pointer.x, y: d.origin.y + p.y - d.pointer.y };
    const snapped = e.altKey ? { point: raw, guides: [] } : snapWaypoint(l, edge, d.neighbors, raw, 7 / view.value.scale);
    guides.value = { lines: snapped.guides, gaps: [] };
    // Points are written in whole millimetres: only plan again when that changes.
    const key = `${Math.round(snapped.point.x / MM_PT)}|${Math.round(snapped.point.y / MM_PT)}|${snapped.guides.length}`;
    if (key === d.key) return;
    d.key = key;
    // A label the new line would cut through goes beside it, in the same edit (D65).
    const r = fixLabelSides(
      text.value,
      currentPicture.value,
      d.edgeId,
      d.stop !== null
        ? planWaypoint(text.value, currentPicture.value, d.edgeId, d.stop, snapped.point)
        : planAddVertex(text.value, currentPicture.value, d.edgeId, d.seg!, snapped.point),
    );
    if (!r.ok) {
      d.last = null;
      previewLayout.value = null;
      status.value = r.reason;
      return;
    }
    const stop = d.stop ?? ("stop" in r ? (r.stop as number) : 0);
    d.last = { changes: r.changes, stop, layout: r.layout, edgeId: r.edgeId, notes: r.notes };
    previewLayout.value = r.layout;
    status.value = cornerMessage(r.layout, r.edgeId ?? d.edgeId, stop, d.stop !== null ? "Release to write" : "Release to add");
  };

  /** Sliding a segment: snap it to node lines, write the route, and show it. */
  const slideMove = (d: SlideDrag, e: PointerEvent) => {
    const p = toModel(e);
    if (!d.moved && Math.hypot(p.x - d.pointer.x, p.y - d.pointer.y) * view.value.scale < 3) return;
    d.moved = true;
    const l = baseLayout.value;
    const edge = edges.value.find((x) => x.id === d.edgeId);
    const piece = edge && orthoPolyline(edge)?.pieces[d.piece];
    if (!l || !edge || !piece) return;
    const raw = d.origin + (d.axis === "h" ? p.y - d.pointer.y : p.x - d.pointer.x);
    const snapped = e.altKey ? { value: raw, guides: [] } : snapSlide(l, edge, piece, raw, 7 / view.value.scale);
    guides.value = { lines: snapped.guides, gaps: [] };
    const key = `${Math.round(snapped.value / MM_PT)}|${snapped.guides.length}`;
    if (key === d.key) return;
    d.key = key;
    const r = fixLabelSides(text.value, currentPicture.value, d.edgeId, planSlide(text.value, currentPicture.value, d.edgeId, d.piece, snapped.value));
    if (!r.ok) {
      d.last = null;
      previewLayout.value = null;
      status.value = r.reason;
      return;
    }
    d.last = { changes: r.changes, text: r.text, layout: r.layout, notes: r.notes };
    previewLayout.value = r.layout;
    status.value = `Release to write ${edgeCode(r.text, r.layout, d.edgeId)}`;
  };

  /** Sliding a label: write pos= for where the pointer is nearest on its edge, and show it. Alt turns snapping off. */
  const labelMove = (d: LabelDrag, e: PointerEvent) => {
    const pointer = toModel(e);
    if (!d.moved && Math.hypot(pointer.x - d.pointer.x, pointer.y - d.pointer.y) * view.value.scale < 4) return;
    d.moved = true;
    // The point the label is attached to follows the pointer's movement, not the pointer itself.
    const p = { x: d.origin.x + pointer.x - d.pointer.x, y: d.origin.y + pointer.y - d.pointer.y };
    const key = `${Math.round(p.x * 2)}|${Math.round(p.y * 2)}|${e.altKey}`;
    if (key === d.key) return;
    d.key = key;
    const r = planSlideLabel(text.value, currentPicture.value, d.labelId, p, !e.altKey);
    if (!r.ok) {
      d.last = null;
      previewLayout.value = null;
      status.value = r.reason;
      return;
    }
    d.last = r;
    previewLayout.value = r.layout;
    status.value = `Release to write ${r.written}`;
  };

  /** Dragging a curve handle: write the curve (bend, out/in, controls) and show it. Alt turns snapping off. */
  const controlMove = (d: ControlDrag, e: PointerEvent) => {
    const p = toModel(e);
    if (!d.moved && Math.hypot(p.x - d.pointer.x, p.y - d.pointer.y) * view.value.scale < 3) return;
    d.moved = true;
    const at = { x: d.origin.x + p.x - d.pointer.x, y: d.origin.y + p.y - d.pointer.y };
    const key = `${Math.round(at.x / MM_PT)}|${Math.round(at.y / MM_PT)}|${e.altKey}`;
    if (key === d.key) return;
    d.key = key;
    const r = fixLabelSides(text.value, currentPicture.value, d.edgeId, planCurve(text.value, currentPicture.value, d.edgeId, d.seg, d.handle, at, !e.altKey));
    if (!r.ok) {
      d.last = null;
      previewLayout.value = null;
      status.value = r.reason;
      return;
    }
    d.last = { changes: r.changes, text: r.text, layout: r.layout, notes: r.notes };
    previewLayout.value = r.layout;
    status.value = `Release to write ${edgeCode(r.text, r.layout, d.edgeId)}`;
  };

  /** Drawing a new edge: a line from the start to the pointer, or to the anchor it would attach to. */
  const connectMove = (d: ConnectDrag, e: PointerEvent) => {
    const p = toModel(e);
    const l = baseLayout.value;
    if (!l) return;
    const t = targetAt(l, p, 4 / view.value.scale, 9 / view.value.scale, d.from.node);
    d.target = t;
    const n = t && l.nodes.find((x) => x.id === t.node);
    const to = n ? (t.anchor ? (anchorPoint(n.shape, t.anchor) ?? p) : n.shape.center) : p;
    edgeDrag.value = { target: t, ok: !!t, line: { from: d.start, to } };
  };

  /** Without a drag: which node is the pointer near, for its connection handles. */
  const hoverMove = (e: PointerEvent) => {
    const l = baseLayout.value;
    if (!l || labelEdit.value) return;
    const p = toModel(e);
    // Near enough to reach its connection handles, which sit outside it.
    const reach = (CONNECT_OFFSET + 8) / view.value.scale;
    const n = [...l.nodes].reverse().find((x) => x.kind === "statement" && Math.abs(p.x - x.shape.center.x) <= x.shape.hw + reach && Math.abs(p.y - x.shape.center.y) <= x.shape.hh + reach);
    const id = n?.id ?? null;
    if (id !== hover.value) hover.value = id;
  };

  // Frame pacing (D108): Edge hands the page every move of a fast mouse, each in its own task, and
  // draws only when the page has time. A drag keeps the latest move and handles it once per frame.
  const pendingMove = useRef<PointerEvent | null>(null);
  const moveFrame = useRef(0);
  const flushMove = () => {
    if (moveFrame.current) cancelAnimationFrame(moveFrame.current);
    moveFrame.current = 0;
    const e = pendingMove.current;
    pendingMove.current = null;
    if (e && drag.current) handleMove(e);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!drag.current) {
      hoverMove(e);
      return;
    }
    pendingMove.current = e;
    if (!moveFrame.current) moveFrame.current = requestAnimationFrame(flushMove);
  };

  const handleMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === "end") {
      endMove(d, e);
      return;
    }
    if (d.kind === "connect") {
      connectMove(d, e);
      return;
    }
    if (d.kind === "vertex") {
      vertexMove(d, e);
      return;
    }
    if (d.kind === "label") {
      labelMove(d, e);
      return;
    }
    if (d.kind === "slide") {
      slideMove(d, e);
      return;
    }
    if (d.kind === "control") {
      controlMove(d, e);
      return;
    }
    if (d.kind === "pan") {
      const dx = e.clientX - d.client.x;
      const dy = e.clientY - d.client.y;
      if (Math.hypot(dx, dy) > PAN_SLOP) d.moved = true;
      // Under the slop a right or middle click stays a click: the view doesn't move until it's a drag.
      if (d.moved || d.button === 0) view.value = { ...d.view, cx: d.view.cx - dx / d.view.scale, cy: d.view.cy + dy / d.view.scale };
      return;
    }
    if (d.kind === "resize") {
      resizeMove(d, e);
      return;
    }
    if (d.kind === "group") {
      groupMove(d, e);
      return;
    }
    const p = toModel(e);
    const raw = { x: d.center.x + p.x - d.pointer.x, y: d.center.y + p.y - d.pointer.y };
    if (!d.moved && Math.hypot(p.x - d.pointer.x, p.y - d.pointer.y) * view.value.scale < 3) return;
    d.moved = true;
    d.along = followersAlong(e);
    d.last = { raw, alt: e.altKey };
    nodeUpdate(d);
  };

  /** Shows the node at its last pointer position, its followers along or held where they are (D104). */
  const nodeUpdate = (d: NodeDrag) => {
    const l = baseLayout.value;
    const n = l?.nodes.find((x) => x.id === d.id);
    if (!l || !n || !d.last) return;
    const { raw, alt } = d.last;
    const snapped = alt ? { center: raw, guides: [], gaps: [], targets: [] } : snapNode(l, n, raw, 7 / view.value.scale);
    d.target = snapped.center;
    d.alignedWith = snapped.targets;
    overrides.value = new Map([[d.id, snapped.center], ...(d.along ? [] : holds(l, d.followers))]);
    dragFollowers.value = { followers: d.followers, along: d.along };
    guides.value = { lines: snapped.guides, gaps: snapped.gaps };
  };

  // Ctrl (⌘) pressed or released mid-drag switches the followers along or back at once (D104).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Control" && e.key !== "Meta") return;
      const d = drag.current;
      if (!d || (d.kind !== "node" && d.kind !== "group" && d.kind !== "resize") || !d.moved) return;
      const along = followersAlong(e);
      if (along === d.along) return;
      d.along = along;
      if (d.kind === "node") nodeUpdate(d);
      else if (d.kind === "group") groupUpdate(d);
      else resizePreview(d);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, []);

  const onPointerUp = () => {
    // The last move first, so the drop is where the pointer was let go.
    if (pendingMove.current) flushMove();
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === "end") {
      edgeDrag.value = null;
      if (!d.moved) return;
      if (d.target && d.ok) moveEnd(d.edgeId, d.which, d.target);
      else {
        previewEnd(d.edgeId, d.which, null);
        if (!d.target) status.value = "The end stays where it was: drop it on a node.";
      }
      return;
    }
    if (d.kind === "label") {
      previewLayout.value = null;
      if (d.moved && d.last && d.last.changes.length) applyEdgeEdit(d.last.changes, "input.edge.label", `Slid the label: ${d.last.written}`);
      else if (d.moved && d.last) status.value = "The label stays where it was.";
      return;
    }
    if (d.kind === "slide") {
      previewLayout.value = null;
      guides.value = { lines: [], gaps: [] };
      if (d.moved && d.last) applyEdgeEdit(d.last.changes, "input.edge.slide", `Slid the segment: ${edgeCode(d.last.text, d.last.layout, d.edgeId)}${alsoNotes(d.last.notes)}`);
      return;
    }
    if (d.kind === "control") {
      previewLayout.value = null;
      if (d.moved && d.last) applyEdgeEdit(d.last.changes, "input.edge.curve", `Reshaped the curve: ${edgeCode(d.last.text, d.last.layout, d.edgeId)}${alsoNotes(d.last.notes)}`);
      return;
    }
    if (d.kind === "vertex") {
      previewLayout.value = null;
      guides.value = { lines: [], gaps: [] };
      if (!d.moved) return;
      if (d.last) applyEdgeEdit(d.last.changes, "input.edge.vertex", `${cornerMessage(d.last.layout, d.last.edgeId ?? d.edgeId, d.last.stop, d.stop !== null ? "Moved" : "Added")}${alsoNotes(d.last.notes)}`, d.last.edgeId);
      return;
    }
    if (d.kind === "connect") {
      edgeDrag.value = null;
      if (!d.target) {
        status.value = "No edge drawn: drop it on another node.";
        return;
      }
      // Dropped on an anchor: both ends get their anchors. Dropped on the middle: plain (a) -- (b).
      const from: EndTarget = d.target.anchor && d.from.anchor ? d.from : { node: d.from.node };
      connectNodes(from, d.target);
      return;
    }
    if (d.kind === "pan") {
      // Only a plain left click on the background clears the selection.
      if (!d.moved && d.button === 0) selectFromCanvas(null);
      if (d.button === 2) {
        panned.current = d.moved;
        const pending = pendingMenu.current;
        pendingMenu.current = null;
        // The event asked for on press went to the canvas, which held the pointer for a pan, so its
        // target is the canvas itself: look up what is under the pointer instead.
        if (pending && !d.moved) openContextMenu(document.elementFromPoint(pending.clientX, pending.clientY) ?? pending.target, pending.clientX, pending.clientY);
      }
      return;
    }
    if (d.kind === "group") {
      overrides.value = new Map();
      guides.value = { lines: [], gaps: [] };
      dragFollowers.value = null;
      // A click without a drag selects just that node, as on any node.
      if (!d.moved) {
        if (d.ids.length > 1) selectFromCanvas({ kind: "node", id: d.grab });
        return;
      }
      if (d.blocked) return;
      const r = planGroupMove(text.value, currentPicture.value, d.ids, { x: d.target.x - d.center.x, y: d.target.y - d.center.y });
      if (!r.ok) {
        status.value = r.reason;
        return;
      }
      if (!r.changes.length) return;
      // Naming chain nodes changes their ids (D77 item 4).
      const renamed = new Map(r.conversions.flatMap((c) => [...c.ids]));
      let changes = r.changes;
      let kept = "";
      if (!d.along && staying(d.followers).length) {
        // Only the group moves (D104): what follows it stays where it is, but for its annotations (D107).
        const l = baseLayout.value;
        const memberNames = new Set(d.members.flatMap((id) => l?.nodes.find((n) => n.id === id)?.name ?? []));
        const prefer = new Set(d.members.flatMap((id) => l?.nodes.find((n) => n.id === id)?.position.refs ?? []).filter((x) => !memberNames.has(x)));
        const boxes = groupMembers(l!, d.ids).boxes;
        const k = keepFollowers(r.changes, new Set([...d.members, ...boxes, ...d.followers.annotations]), prefer, renamed);
        if (!k.ok) {
          status.value = `${k.reason} Nothing was moved. Hold ${modKey()} while dragging to move the nodes placed against the group too.`;
          return;
        }
        changes = k.changes;
        for (const [a, b] of k.ids) renamed.set(a, b);
        kept = keptMessage(k.kept);
      }
      if (!d.along) kept = annotationNote(baseLayout.value, d.followers, true) + kept;
      applyEdit(changes, "move.group");
      status.value = groupMessage(r, d.members.length) + kept;
      if (renamed.size) selectNodes(d.ids.map((id) => renamed.get(id) ?? id));
      return;
    }
    if (d.kind === "resize") {
      previewLayout.value = null;
      guides.value = { lines: [], gaps: [] };
      dragFollowers.value = null;
      if (!d.moved || !d.last) return;
      const name = (n: LaidOutNode) => n.name ?? n.id;
      const same = [d.match.w && `width as ${name(d.match.w)}`, d.match.h && `height as ${name(d.match.h)}`].filter(Boolean);
      let changes = d.last.changes;
      let kept = "";
      // As in dragging (D104, D107): what is placed against the node stays where it is, but for its annotations.
      if (!d.along && changes.length && staying(d.followers).length) {
        const n = baseLayout.value?.nodes.find((x) => x.id === d.id);
        const k = keepFollowers(changes, new Set([d.id, ...d.followers.annotations]), new Set(n?.position.refs ?? []));
        if (!k.ok) {
          status.value = `${k.reason} Nothing was changed. Hold ${modKey()} while resizing to move the nodes placed against it too.`;
          return;
        }
        changes = k.changes;
        kept = keptMessage(k.kept);
      }
      applyResize(changes, d.last.written, d.scope, d.last.notes, d.last.position, (same.length ? ` Same ${same.join(" and ")}.` : "") + kept);
      return;
    }
    dragFollowers.value = null;
    if (!d.moved) return;
    overrides.value = new Map();
    guides.value = { lines: [], gaps: [] };
    const before = baseLayout.value;
    const node = before?.nodes.find((x) => x.id === d.id);
    // Only the dragged node moves (D104): what follows it is kept where it is, re-attached to what
    // the node hung off first, in the same undo step. Ctrl (⌘) or the toolbar's switch moves it along.
    // Its annotations (labels that hang off it alone) move with it either way (D107).
    const alone = !d.along && staying(d.followers).length > 0;
    const labels = d.along ? "" : annotationNote(before ?? null, d.followers);
    const keep = (changes: Change[], renamed?: ReadonlyMap<string, string>) => {
      if (!alone) return { ok: true as const, changes, kept: labels, ids: new Map<string, string>() };
      const k = keepFollowers(changes, new Set([d.id, ...d.followers.annotations]), new Set(node?.position.refs ?? []), renamed);
      if (!k.ok) {
        status.value = `${k.reason} Nothing was moved. Hold ${modKey()} while dragging to move the nodes placed against it too.`;
        return null;
      }
      return { ok: true as const, changes: k.changes, kept: labels + keptMessage(k.kept), ids: k.ids };
    };
    if (node?.lock?.kind === "chain") {
      const r = planChainMove(text.value, currentPicture.value, d.id, d.target);
      if (!r.ok) {
        status.value = r.reason;
        return;
      }
      const k = keep(r.changes, r.conversion.ids);
      if (!k) return;
      applyEdit(k.changes, "move.chain");
      if (r.id !== d.id) selectNodes([r.id]);
      const s = r.move.spec;
      status.value = `${conversionMessage(r.conversion)} ${s.kind === "positioning" ? `Wrote ${positioningText(s)}.` : s.kind === "perp" ? `Wrote at (${s.xFrom} |- ${s.yFrom}).` : s.kind === "shift" ? "Adjusted its shift." : "Wrote coordinates: nothing nearby lines up."}${k.kept}`;
      return;
    }
    if (node?.lock) {
      if (!alone) {
        pinNode(d.id, d.target);
        return;
      }
      const pin = planPin(text.value, currentPicture.value, d.id, d.target);
      if (!pin) {
        status.value = "That position couldn't be written; the node stays where it was.";
        return;
      }
      const k = keep(pin.changes);
      if (!k) return;
      applyEdit(k.changes, "fix.pin");
      status.value = `Pinned at the drop position with plain coordinates, so LaTeX can place it.${k.kept}`;
      return;
    }
    const result = planMove(text.value, currentPicture.value, d.id, d.target);
    if (!result) {
      status.value = "That position couldn't be written; the node stays where it was.";
      return;
    }
    const k = keep(result.changes);
    if (!k) return;
    // Dropped inside another lane: it joins that lane in the same step (D81).
    const lane = dropIntoLane(k.changes, d.id, d.target);
    applyEdit(lane.changes, "move.drag");
    const s = result.spec;
    status.value =
      s.kind === "positioning"
        ? `Wrote ${positioningText(s)}.`
        : s.kind === "perp"
          ? `Wrote at (${s.xFrom} |- ${s.yFrom}).`
          : s.kind === "shift"
            ? "Kept the position as written and adjusted its shift."
            : "Wrote coordinates: nothing nearby lines up.";
    status.value += k.kept;
    status.value += lane.note;
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
      // A corner of the selected edge goes.
      const corner = el.closest("[data-vertex]")?.getAttribute("data-vertex");
      const sel = selectedEdge.value;
      if (corner && sel) {
        e.preventDefault();
        removeVertex(sel.id, Number(corner));
        return;
      }
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

  /** Opens the edge menu at a point of the canvas (screen px from its top left). The menu is placed in the pane that holds it, which starts higher up. */
  const openMenu = (edgeId: string, x: number, y: number, at: Point, vertex: number | null = null, label: string | null = null) => {
    const svg = svgRef.current;
    const pane = svg?.closest(".tf-canvas-pane");
    const s = svg?.getBoundingClientRect();
    const p = pane?.getBoundingClientRect();
    const dx = s && p ? s.left - p.left : 0;
    const dy = s && p ? s.top - p.top : 0;
    menu.value = { edgeId, x: x + dx, y: y + dy, at: { at, vertex, label, scale: view.value.scale } };
  };

  /** Right-click an edge (or one of its labels) for its menu. A right drag pans instead, with no menu. */
  const onContextMenu = (e: MouseEvent) => {
    const d = drag.current;
    if (d?.kind === "pan" && d.button === 2) {
      // Asked for on press (macOS, Linux): wait for the release to know whether it was a drag.
      e.preventDefault();
      pendingMenu.current = { clientX: e.clientX, clientY: e.clientY, target: e.target as Element };
      return;
    }
    if (panned.current) {
      // Asked for on release (Windows) after a right drag that panned.
      panned.current = false;
      e.preventDefault();
      return;
    }
    if (openContextMenu(e.target as Element, e.clientX, e.clientY)) e.preventDefault();
  };

  /** Opens the edge menu for what is at a point, if it is an edge or a part of one. Returns whether it did. */
  const openContextMenu = (el: Element, clientX: number, clientY: number): boolean => {
    const e = { clientX, clientY };
    // A node's connection handles sit over the edges that leave it: look through them to what is under the pointer.
    const under = el.closest("[data-connect]") ? document.elementsFromPoint(clientX, clientY).find((x) => x.closest("[data-edge], [data-label]")) : undefined;
    const target = under ?? el;
    const edgeId =
      target.closest("[data-edge]")?.getAttribute("data-edge") ??
      (() => {
        const labelId = target.closest("[data-label]")?.getAttribute("data-label");
        return labelId ? edgeOfLabel(shownEdges.value, labelId)?.id : undefined;
      })() ??
      (target.closest("[data-end], [data-vertex], [data-ghost], [data-segment], [data-control]") ? selectedEdge.value?.id : undefined);
    if (!edgeId) return false;
    selectFromCanvas({ kind: "edge", id: edgeId });
    // A right-click on a label is about that label.
    const label = target.closest("[data-label]")?.getAttribute("data-label") ?? null;
    if (label) pickLabel(edgeId, label);
    const r = svgRef.current!.getBoundingClientRect();
    const corner = target.closest("[data-vertex]")?.getAttribute("data-vertex");
    openMenu(edgeId, e.clientX - r.left, e.clientY - r.top, toModel(e), corner ? Number(corner) : null, label);
    return true;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // Escape closes the menu even before it has taken the focus.
    if (menu.value && e.key === "Escape") {
      e.preventDefault();
      menu.value = null;
      return;
    }
    // The menu key, or Shift+F10, opens the selected edge's menu at its middle.
    const edge = selectedEdge.value;
    if (edge && (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))) {
      e.preventDefault();
      const { start, end } = edgeEnds(edge);
      const v = view.value;
      const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
      openMenu(edge.id, (mid.x - v.cx) * v.scale + size.value.w / 2, (v.cy - mid.y) * v.scale + size.value.h / 2, mid);
      return;
    }
    // Delete removes the selection, re-attaching or pinning what depended on it (D56).
    if ((e.key === "Delete" || e.key === "Backspace") && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !labelEdit.value && selection.value) {
      e.preventDefault();
      deleteSelection();
      return;
    }
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
  const hitsByPath = pathHits(edgeList);
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
  // Connection handles on the node under the pointer, unless something is being dragged or typed.
  const hoverNode = hover.value && !edgeDrag.value && !labelEdit.value && !overrides.value.size && !previewLayout.value ? l?.nodes.find((n) => n.id === hover.value && n.kind === "statement") : undefined;
  const menuEdge = menu.value ? edges.value.find((x) => x.id === menu.value!.edgeId) : undefined;

  return (
    <>
    <svg
      ref={svgRef}
      class={`tf-canvas${spaceHeld.value ? " space-pan" : ""}`}
      viewBox={vb}
      tabindex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => {
        if (!drag.current) hover.value = null;
      }}
      onContextMenu={onContextMenu}
      onMouseDown={(e) => {
        // No autoscroll on a middle press: the middle button pans.
        if (e.button === 1) e.preventDefault();
      }}
      onAuxClick={(e) => {
        if (e.button === 1) e.preventDefault();
      }}
      onDblClick={onDoubleClick}
      onKeyDown={onKeyDown}
      onDragOver={onDragOver}
      onDrop={onDrop}
      data-testid="canvas"
    >
      <defs>
        {gradients}
        <VisionFilter />
        <StaleMasks />
      </defs>
      {l && <WidthGuide cx={(l.bounds.minX + l.bounds.maxX) / 2} y0={-v.cy - h / 2 / v.scale} y1={-v.cy + h / 2 / v.scale} scale={v.scale} />}
      {/* The grayscale and colorblind views (D85) filter the drawing, not the handles and guides. */}
      <g filter={visionFilterAttr()} data-testid="drawing">
      <CompiledPicture scale={v.scale} />
      <StalePatchLayer l={l} scale={v.scale} macros={macros.value} />
      {/* With TeX's picture shown (or its last one, patched: D96), the native drawing stays only to answer the pointer (D68). */}
      <g class={`tf-native${showingTex.value ? " ghost" : ""}`} data-testid="native-drawing">
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
              class={`tf-label-hit${n.id === selectedLabelId.value ? " picked" : ""}`}
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
      </g>
      </g>
      {l?.nodes.map((n) =>
        n.kind === "coordinate" ? (
          <CoordinateMark key={`mark-${n.id}`} n={n} scale={v.scale} selected={selIds.includes(n.id)} unused={unusedCoords.value.has(n.id)} />
        ) : n.kind === "statement" ? (
          <UndrawnMark key={`mark-${n.id}`} n={n} scale={v.scale} />
        ) : null,
      )}
      <MisplacedMarks layout={l} scale={v.scale} selected={selIds} />
      <FollowerMarks layout={l} scale={v.scale} />
      <g transform="scale(1 -1)" class="tf-overlay">
        {selEdge && <EdgeSelection edge={selEdge} scale={v.scale} />}
        {selEdge && !selEdge.lock && selEdge.mode !== "loop" && !edgeDrag.value && <VertexHandles edge={selEdge} scale={v.scale} />}
        {selEdge && !selEdge.lock && selEdge.mode !== "loop" && !edgeDrag.value && <SegmentHandles edge={selEdge} scale={v.scale} />}
        {selEdge && !selEdge.lock && selEdge.mode !== "loop" && !edgeDrag.value && <ControlHandles edge={selEdge} scale={v.scale} />}
        {selEdge && !selEdge.lock && selEdge.mode !== "loop" && !edgeDrag.value && <EndHandles edge={selEdge} scale={v.scale} />}
        {hoverNode && <ConnectHandles n={hoverNode} scale={v.scale} />}
        {edgeDrag.value && l && <EdgeDragOverlay view={edgeDrag.value} layout={l} scale={v.scale} />}
        <LabelWarnings scale={v.scale} hidden={!!overrides.value.size || !!previewLayout.value || !!edgeDrag.value || !!labelEdit.value} />
        <ContrastMarks scale={v.scale} hidden={!!overrides.value.size || !!previewLayout.value || !!edgeDrag.value || !!labelEdit.value} />
        {selected.map((n) => (
          <rect
            x={f(shapeMiddle(n.shape).x - n.shape.hw - 3 / v.scale)}
            y={f(shapeMiddle(n.shape).y - n.shape.hh - 3 / v.scale)}
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
                x={f(shapeMiddle(handleNode.shape).x + h.fx * (handleNode.shape.hw + 3 / v.scale) - r)}
                y={f(shapeMiddle(handleNode.shape).y + h.fy * (handleNode.shape.hh + 3 / v.scale) - r)}
                width={f(2 * r)}
                height={f(2 * r)}
                class="tf-handle"
                style={{ cursor: h.cursor }}
                stroke-width={f(1 / v.scale)}
              >
                <title>{`Drag to resize. Shift resizes from the center, ${modKey()} moves the nodes placed against it too, Alt turns snapping off.`}</title>
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
    <LabelFixMenu onClose={() => svgRef.current?.focus({ preventScroll: true })} />
    <LabelEditor view={v} size={size.value} onDone={() => svgRef.current?.focus({ preventScroll: true })} />
    {menu.value && menuEdge && (
      <EdgeMenu
        edge={menuEdge}
        x={menu.value.x}
        y={menu.value.y}
        at={menu.value.at}
        onClose={() => {
          menu.value = null;
          svgRef.current?.focus({ preventScroll: true });
        }}
      />
    )}
    </>
  );
}

