// The canvas: draws the native preview and handles selection and dragging.
// The model is in TeX pt with y up; the SVG flips y for geometry and places
// labels at (x, -y).
import { useComputed, useSignal, useSignalEffect } from "@preact/signals";
import type { JSX } from "preact";
import { memo } from "preact/compat";
import { useEffect, useMemo, useRef } from "preact/hooks";
import { planMove, positioningText } from "../edit/move.ts";
import { snapNode } from "../edit/snap.ts";
import { pictureEnv } from "../model/document.ts";
import { type RGB, cssColor } from "../tikz/colors.ts";
import { defaultTipLength, defaultTipWidth } from "../tikz/keys.ts";
import type { LaidOutNode, LaidOutPath, PictureLayout, Tip } from "../tikz/layout.ts";
import { outline, type Point } from "../tikz/shapes.ts";
import type { Shading } from "../tikz/state.ts";
import { katexMacros, labelHtml } from "./labelHtml.ts";
import {
  applyEdit,
  baseLayout,
  currentPicture,
  doc,
  fitRequests,
  guides,
  layout,
  overrides,
  selectFromCanvas,
  selection,
  status,
  text,
} from "./store.ts";

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
      {n.kind === "coordinate" && <circle cx={n.shape.center.x} cy={n.shape.center.y} r={2 / scale} class="tf-coordinate" />}
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

const PathShape = memo(PathShapeView, (a, b) => a.scale === b.scale && a.selected === b.selected && pathSig(a.p) === pathSig(b.p));

function PathShapeView({ p, scale, selected }: { p: LaidOutPath; scale: number; selected: boolean }) {
  if (!p.d && !p.tips.length) return null;
  const minStroke = 0.6 / scale;
  const fill = p.shading ? `url(#${gradId(p.id)})` : rgba(p.fill);
  return (
    <g data-path={p.id} class={`tf-path${selected ? " selected" : ""}`}>
      {selected && <path d={p.d} class="tf-path-halo" stroke-width={p.lineWidth + 4 / scale} />}
      <path d={p.d} class="tf-path-hit" stroke-width={10 / scale} />
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

export function Canvas() {
  const svgRef = useRef<SVGSVGElement>(null);
  const size = useSignal({ w: 800, h: 600 });
  const view = useSignal<View>({ scale: 2, cx: 0, cy: 0 });
  const drag = useRef<
    | { kind: "node"; id: string; pointer: Point; center: Point; moved: boolean; target: Point }
    | { kind: "pan"; client: Point; view: View; moved: boolean }
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
    const l = baseLayout.value;
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
    if (e.button === 0 && nodeEl) {
      const id = nodeEl.getAttribute("data-node")!;
      const n = baseLayout.value?.nodes.find((x) => x.id === id);
      selectFromCanvas({ kind: "node", id });
      if (n && !n.locked) {
        const p = toModel(e);
        drag.current = { kind: "node", id, pointer: p, center: n.shape.center, moved: false, target: n.shape.center };
        svg.setPointerCapture(e.pointerId);
      } else if (n?.locked) status.value = `Locked: ${n.locked}.`;
      return;
    }
    if (e.button === 0 && pathEl) {
      selectFromCanvas({ kind: "path", id: pathEl.getAttribute("data-path")! });
      return;
    }
    drag.current = { kind: "pan", client: { x: e.clientX, y: e.clientY }, view: view.value, moved: false };
    svg.setPointerCapture(e.pointerId);
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
    const p = toModel(e);
    const raw = { x: d.center.x + p.x - d.pointer.x, y: d.center.y + p.y - d.pointer.y };
    if (!d.moved && Math.hypot(p.x - d.pointer.x, p.y - d.pointer.y) * view.value.scale < 3) return;
    d.moved = true;
    const l = baseLayout.value;
    const n = l?.nodes.find((x) => x.id === d.id);
    if (!l || !n) return;
    const snapped = e.altKey ? { center: raw, guides: [], gaps: [] } : snapNode(l, n, raw, 7 / view.value.scale);
    d.target = snapped.center;
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
    if (!d.moved) return;
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
    for (const note of result.notes) status.value += ` Note: ${note}.`;
  };

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
  const gradients: JSX.Element[] = [];
  if (l) {
    for (const n of l.nodes) if (n.shading) gradients.push(<Gradient id={gradId(n.id)} shading={n.shading} />);
    for (const p of l.paths) if (p.shading) gradients.push(<Gradient id={gradId(p.id)} shading={p.shading} />);
  }
  const selectedNode = sel?.kind === "node" ? l?.nodes.find((n) => n.id === sel.id) : undefined;

  return (
    <svg
      ref={svgRef}
      class="tf-canvas"
      viewBox={vb}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      data-testid="canvas"
    >
      <defs>{gradients}</defs>
      {items.map((it) =>
        it.kind === "node" ? (
          <g key={it.n.id}>
            <g transform="scale(1 -1)">
              <NodeShape n={it.n} scale={v.scale} selected={sel?.kind === "node" && sel.id === it.n.id} />
            </g>
            <NodeLabel n={it.n} macros={macros.value} />
            {it.n.extras.map((x) => (
              <NodeLabel key={x.id} n={x} macros={macros.value} />
            ))}
          </g>
        ) : (
          <g key={it.p.id} transform="scale(1 -1)">
            <PathShape p={it.p} scale={v.scale} selected={sel?.kind === "path" && sel.id === it.p.id} />
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
        </g>
      ))}
      <g transform="scale(1 -1)" class="tf-overlay">
        {selectedNode && (
          <rect
            x={f(selectedNode.shape.center.x - selectedNode.shape.hw - 3 / v.scale)}
            y={f(selectedNode.shape.center.y - selectedNode.shape.hh - 3 / v.scale)}
            width={f(2 * selectedNode.shape.hw + 6 / v.scale)}
            height={f(2 * selectedNode.shape.hh + 6 / v.scale)}
            class={`tf-selection${selectedNode.locked ? " locked" : ""}`}
            stroke-width={1.5 / v.scale}
            stroke-dasharray={`${4 / v.scale} ${3 / v.scale}`}
          />
        )}
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
  );
}

