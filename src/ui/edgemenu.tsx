// The context menu for an edge (M2b): corners, the edge's form, its anchors,
// and splitting a \draw into separate edges. Labels join it in step 7.
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { edgeOpBlocker } from "../edit/edgeop.ts";
import { endBlocker, endStop } from "../edit/edges.ts";
import { splitBlocker } from "../edit/split.ts";
import { edgeVertices, isEdgeOperation, nearestLineSegment } from "../edit/vertices.ts";
import { type Edge, pathEdges } from "../model/edges.ts";
import { anchorPoint, type Point } from "../tikz/shapes.ts";
import { curveBlocker } from "../edit/curves.ts";
import { addVertex, baseLayout, makeCurved, makeOrthogonal, moveEnd, removeVertex, splitEdge, straightenEdge } from "./store.ts";

/** The compass, laid out as it points; the middle is the border ("automatic"). */
const COMPASS: Array<string | null> = ["north west", "north", "north east", "west", null, "east", "south west", "south", "south east"];
const ARROWS: Record<string, string> = {
  "north west": "↖",
  north: "↑",
  "north east": "↗",
  west: "←",
  east: "→",
  "south west": "↙",
  south: "↓",
  "south east": "↘",
};

/** A 3×3 grid of a node's anchors for one end of the edge. */
function AnchorPicker({ edge, which, onDone }: { edge: Edge; which: "from" | "to"; onDone: () => void }) {
  const layout = baseLayout.value;
  const nodeId = which === "from" ? edge.source : edge.target;
  const node = nodeId ? layout?.nodes.find((n) => n.id === nodeId) : undefined;
  const stop = endStop(edge, which);
  const current = stop.bare ? null : (stop.anchor ?? "");
  return (
    <div class="tf-compass" role="group" aria-label={which === "from" ? "Start anchor" : "End anchor"}>
      {COMPASS.map((a) => {
        const has = a === null || (node && anchorPoint(node.shape, a));
        const label = a === null ? "Border (automatic)" : a;
        return (
          <button
            class={`tf-compass-btn${a === current ? " current" : ""}`}
            disabled={!has}
            aria-pressed={a === current}
            aria-label={label}
            title={a === null ? "On the border, pointing at the other end: (b)" : `At ${node?.name ?? "the node"}.${a}`}
            data-anchor={a ?? "border"}
            onClick={() => {
              if (!nodeId) return;
              moveEnd(edge.id, which, a === null ? { node: nodeId } : { node: nodeId, anchor: a });
              onDone();
            }}
          >
            {a === null ? "●" : ARROWS[a]}
          </button>
        );
      })}
    </div>
  );
}

function AnchorItem({ edge, which, open, onOpen, onDone }: { edge: Edge; which: "from" | "to"; open: boolean; onOpen: () => void; onDone: () => void }) {
  const blocked = endBlocker(edge, which);
  const node = which === "from" ? edge.source : edge.target;
  const why = blocked ?? (node ? null : "This end is a point, not a node. Drag it onto a node to attach it.");
  const label = which === "from" ? "Change start anchor" : "Change end anchor";
  return (
    <div
      class={`tf-menu-item has-sub${why ? " disabled" : ""}${open && !why ? " open" : ""}`}
      role="menuitem"
      aria-haspopup={!why}
      aria-expanded={!why && open}
      aria-disabled={!!why}
      tabindex={-1}
      title={why ?? undefined}
      data-testid={`menu-${which}-anchor`}
      onMouseEnter={onOpen}
      onFocus={onOpen}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "Enter") {
          e.preventDefault();
          (e.currentTarget as HTMLElement).querySelector<HTMLButtonElement>(".tf-compass-btn:not(:disabled)")?.focus();
        }
      }}
    >
      <span>{label}</span>
      <span class="tf-menu-more" aria-hidden="true">
        ▸
      </span>
      {!why && open && (
        <div class="tf-submenu">
          <AnchorPicker edge={edge} which={which} onDone={onDone} />
        </div>
      )}
    </div>
  );
}

/** A menu item that does something, disabled with the reason as its tooltip. */
function ActionItem({ label, why, run, testid, onHover }: { label: string; why: string | null; run: () => void; testid: string; onHover: () => void }) {
  return (
    <div
      class={`tf-menu-item${why ? " disabled" : ""}`}
      role="menuitem"
      aria-disabled={!!why}
      tabindex={-1}
      title={why ?? undefined}
      data-testid={testid}
      onMouseEnter={onHover}
      onFocus={onHover}
      onClick={() => {
        if (!why) run();
      }}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !why) {
          e.preventDefault();
          run();
        }
      }}
    >
      <span>{label}</span>
    </div>
  );
}

export interface EdgeMenuAt {
  /** Where the menu was asked for, in the model (pt). */
  at: Point;
  /** The corner right-clicked, if one was (a stop index). */
  vertex: number | null;
  /** Screen px per pt, for how near the pointer has to be. */
  scale: number;
}

/** The menu for `edge` at (x, y) in the canvas pane. */
export function EdgeMenu({ edge, x, y, at, onClose }: { edge: Edge; x: number; y: number; at: EdgeMenuAt; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  /** The item whose flyout is open: one at a time. */
  const open = useSignal<string | null>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[role=menuitem]:not([aria-disabled=true])")?.focus();
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [edge.id]);
  return (
    <div
      ref={ref}
      class="tf-menu"
      role="menu"
      aria-label="Edge"
      data-testid="edge-menu"
      style={{ left: `${Math.round(x)}px`, top: `${Math.round(y)}px` }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          // Step between the menu's items.
          e.preventDefault();
          const items = [...(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
          const at = items.findIndex((i) => i.contains(document.activeElement));
          const next = items[(at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length];
          next?.focus();
        } else if (e.key === "ArrowLeft") {
          (document.activeElement?.closest("[role=menuitem]") as HTMLElement | null)?.focus();
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {edge.lock && <div class="tf-menu-note">This edge is kept as written; see the panel for why.</div>}
      <CornerItems edge={edge} at={at} close={onClose} hover={() => (open.value = null)} />
      <FormItems edge={edge} close={onClose} hover={() => (open.value = null)} />
      <div class="tf-menu-sep" role="separator" />
      <AnchorItem edge={edge} which="from" open={open.value === "from"} onOpen={() => (open.value = "from")} onDone={onClose} />
      <AnchorItem edge={edge} which="to" open={open.value === "to"} onOpen={() => (open.value = "to")} onDone={onClose} />
      <SplitItem edge={edge} close={onClose} hover={() => (open.value = null)} />
    </div>
  );
}

/** Add vertex here, Remove vertex, Straighten. */
function CornerItems({ edge, at, close, hover }: { edge: Edge; at: EdgeMenuAt; close: () => void; hover: () => void }) {
  const locked = edge.lock ? "This edge is kept as written." : null;
  const seg = nearestLineSegment(edge, at.at);
  const addWhy =
    locked ??
    (isEdgeOperation(edge) && edgeOpBlocker(edge)
      ? edgeOpBlocker(edge)
      : edge.mode === "orthogonal"
        ? "This edge is orthogonal: drag a segment to slide it."
        : !seg
          ? "Corners go on straight edges: straighten this one first."
          : null);
  const corners = edgeVertices(edge);
  // The corner right-clicked, or the one nearest the pointer (within 10 px).
  const near = at.vertex ?? corners.find((k) => {
    const q = edge.route.stops[k]!.point;
    return Math.hypot(q.x - at.at.x, q.y - at.at.y) * at.scale <= 10;
  });
  const removeWhy = locked ?? (!corners.length ? "This edge has no corners." : near === undefined || near === null ? "Right-click a corner to remove it." : null);
  const straight = edge.segs.length === 1 && edge.route.segs[edge.segs[0]!]!.kind === "line";
  return (
    <>
      <ActionItem label="Add vertex here" why={addWhy} testid="menu-add-vertex" onHover={hover} run={() => (addVertex(edge.id, seg!.seg, seg!.point), close())} />
      <ActionItem label="Remove vertex" why={removeWhy} testid="menu-remove-vertex" onHover={hover} run={() => (removeVertex(edge.id, near!), close())} />
      <ActionItem label="Straighten" why={locked ?? (straight ? "It is already straight." : null)} testid="menu-straighten" onHover={hover} run={() => (straightenEdge(edge.id), close())} />
    </>
  );
}

/** Make orthogonal, Make curved. */
function FormItems({ edge, close, hover }: { edge: Edge; close: () => void; hover: () => void }) {
  const locked = edge.lock ? "This edge is kept as written." : null;
  const a = edge.route.stops[edge.from]!.point;
  const b = edge.route.stops[edge.to]!.point;
  const lined = Math.abs(a.x - b.x) < 0.5 || Math.abs(a.y - b.y) < 0.5;
  const orthoWhy =
    locked ??
    (isEdgeOperation(edge) && edgeOpBlocker(edge)
      ? edgeOpBlocker(edge)
      : edge.mode === "orthogonal"
        ? "It is already orthogonal: drag a segment to slide it."
        : lined && edge.mode === "straight"
          ? "It already runs straight across or down."
          : null);
  return (
    <>
      <ActionItem label="Make orthogonal" why={orthoWhy} testid="menu-orthogonal" onHover={hover} run={() => (makeOrthogonal(edge.id), close())} />
      <ActionItem label="Make curved" why={curveBlocker(edge)} testid="menu-curved" onHover={hover} run={() => (makeCurved(edge.id), close())} />
    </>
  );
}

/** "Split into separate edges", for a \draw with more than one edge. */
function SplitItem({ edge, close, hover }: { edge: Edge; close: () => void; hover: () => void }) {
  const layout = baseLayout.value;
  if (!layout || pathEdges(edge.path, layout).length < 2) return null;
  return (
    <>
      <div class="tf-menu-sep" role="separator" />
      <ActionItem label="Split into separate edges" why={splitBlocker(edge, layout)} testid="menu-split" onHover={hover} run={() => (splitEdge(edge.id), close())} />
    </>
  );
}
