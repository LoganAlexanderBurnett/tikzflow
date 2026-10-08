// The context menu for an edge (M2b): corners, the edge's form, its anchors,
// splitting a \draw into separate edges, and adding a label.
import { useSignal } from "@preact/signals";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { edgeOpBlocker } from "../edit/edgeop.ts";
import { deleteBlocker } from "../edit/delete.ts";
import { addLabelBlocker, flipBlocker } from "../edit/labels.ts";
import { endBlocker, endStop } from "../edit/edges.ts";
import { splitBlocker } from "../edit/split.ts";
import { edgeVertices, isEdgeOperation, nearestLineSegment } from "../edit/vertices.ts";
import type { Edge } from "../model/edges.ts";
import { anchorPoint, type Point } from "../tikz/shapes.ts";
import { curveBlocker } from "../edit/curves.ts";
import { addVertex, baseLayout, deleteSelection, flipLabel, makeCurved, makeOrthogonal, moveEnd, removeVertex, selectedLabelId, splitEdge, startAddLabel, straightenEdge } from "./store.ts";

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
  const sub = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (sub.current) fitFlyout(sub.current);
  }, [open, why]);
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
        <div class="tf-submenu" ref={sub}>
          <AnchorPicker edge={edge} which={which} onDone={onDone} />
        </div>
      )}
    </div>
  );
}

/**
 * A menu item that does something, disabled with the reason as its tooltip. With
 * `checked` set it is one of a group of choices: ticked when it is the current
 * one, and then it does nothing (D57).
 */
function ActionItem({
  label,
  why,
  run,
  testid,
  onHover,
  checked,
  hint,
}: {
  label: string;
  why: string | null;
  run: () => void;
  testid: string;
  onHover: () => void;
  checked?: boolean;
  /** A tooltip for an item that is available. */
  hint?: string;
}) {
  const choice = checked !== undefined;
  return (
    <div
      class={`tf-menu-item${why ? " disabled" : ""}`}
      role={choice ? "menuitemradio" : "menuitem"}
      aria-checked={choice ? checked : undefined}
      aria-disabled={!!why}
      tabindex={-1}
      title={why ?? hint}
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
      {choice && (
        <span class="tf-menu-check" aria-hidden="true">
          {checked ? "✓" : ""}
        </span>
      )}
      <span class="tf-menu-text">{label}</span>
    </div>
  );
}

export interface EdgeMenuAt {
  /** Where the menu was asked for, in the model (pt). */
  at: Point;
  /** The corner right-clicked, if one was (a stop index). */
  vertex: number | null;
  /** The label right-clicked, if one was. */
  label: string | null;
  /** Screen px per pt, for how near the pointer has to be. */
  scale: number;
}

/** How far a menu stays from the edge of the window. */
const MARGIN = 8;

/**
 * Keeps a menu inside the window (D57): it opens upward and leftward when it
 * would run past the bottom or the right edge, and scrolls when it is taller
 * than the window. `x` and `y` are where it was asked for, in the coordinates of
 * its positioned parent.
 */
function fitInWindow(menu: HTMLElement, x: number, y: number): void {
  menu.style.maxHeight = "";
  menu.style.overflowY = "";
  menu.style.left = `${Math.round(x)}px`;
  menu.style.top = `${Math.round(y)}px`;
  const parent = menu.offsetParent?.getBoundingClientRect() ?? { left: 0, top: 0 };
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const room = vh - 2 * MARGIN;
  const tall = menu.offsetHeight > room;
  menu.style.maxHeight = tall ? `${room}px` : "";
  // Only a menu that has to scroll clips its flyouts, so only then.
  menu.style.overflowY = tall ? "auto" : "";
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  let left = x;
  let top = y;
  if (parent.left + left + w > vw - MARGIN) left = x - w;
  if (parent.top + top + h > vh - MARGIN) top = y - h;
  left = Math.min(Math.max(left, MARGIN - parent.left), vw - MARGIN - w - parent.left);
  top = Math.min(Math.max(top, MARGIN - parent.top), vh - MARGIN - h - parent.top);
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

/** Keeps a flyout inside the window: to the left of its item when there is no room on the right, and up when it would pass the bottom. */
function fitFlyout(el: HTMLElement): void {
  el.style.left = "";
  el.style.right = "";
  el.style.top = "";
  el.style.marginLeft = "";
  el.style.marginRight = "";
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  if (el.getBoundingClientRect().right > vw - MARGIN) {
    el.style.left = "auto";
    el.style.right = "100%";
    el.style.marginLeft = "0";
    el.style.marginRight = "2px";
  }
  const r = el.getBoundingClientRect();
  const down = r.bottom - (vh - MARGIN);
  if (down > 0) el.style.top = `${-5 - down}px`;
  else if (r.top < MARGIN) el.style.top = `${-5 + (MARGIN - r.top)}px`;
}

/** The menu for `edge` at (x, y) in the canvas pane. */
export function EdgeMenu({ edge, x, y, at, onClose }: { edge: Edge; x: number; y: number; at: EdgeMenuAt; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  /** The item whose flyout is open: one at a time. */
  const open = useSignal<string | null>(null);
  useLayoutEffect(() => {
    if (ref.current) fitInWindow(ref.current, x, y);
  }, [edge.id, x, y]);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[role^=menuitem]:not([aria-disabled=true])")?.focus();
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [edge.id]);
  const hover = () => (open.value = null);
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
          const items = [...(ref.current?.querySelectorAll<HTMLElement>("[role^=menuitem]") ?? [])];
          const at = items.findIndex((i) => i.contains(document.activeElement));
          const next = items[(at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length];
          next?.focus();
        } else if (e.key === "ArrowLeft") {
          (document.activeElement?.closest("[role^=menuitem]") as HTMLElement | null)?.focus();
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {edge.lock && <div class="tf-menu-note">This edge is kept as written; see the panel for why.</div>}
      {/* The same items in the same order for every edge; the ones that don't apply say why (D57). */}
      <CornerItems edge={edge} at={at} close={onClose} hover={hover} />
      <div class="tf-menu-sep" role="separator" />
      <FormItems edge={edge} close={onClose} hover={hover} />
      <div class="tf-menu-sep" role="separator" />
      <ActionItem label="Add label here" why={addLabelBlocker(edge)} testid="menu-add-label" onHover={hover} run={() => (onClose(), startAddLabel(edge.id, at.at))} />
      <FlipItem edge={edge} at={at} close={onClose} hover={hover} />
      <div class="tf-menu-sep" role="separator" />
      <AnchorItem edge={edge} which="from" open={open.value === "from"} onOpen={() => (open.value = "from")} onDone={onClose} />
      <AnchorItem edge={edge} which="to" open={open.value === "to"} onOpen={() => (open.value = "to")} onDone={onClose} />
      <SplitItem edge={edge} close={onClose} hover={hover} />
      <div class="tf-menu-sep" role="separator" />
      <ActionItem label="Delete edge" why={deleteBlocker(edge)} testid="menu-delete" onHover={hover} run={() => (onClose(), deleteSelection())} />
    </div>
  );
}

/** Add vertex here, Remove vertex. */
function CornerItems({ edge, at, close, hover }: { edge: Edge; at: EdgeMenuAt; close: () => void; hover: () => void }) {
  const locked = edge.lock ? "This edge is kept as written." : null;
  const seg = nearestLineSegment(edge, at.at);
  const addWhy =
    locked ??
    (isEdgeOperation(edge) && edgeOpBlocker(edge)
      ? edgeOpBlocker(edge)
      : edge.mode === "orthogonal"
        ? "Orthogonal edges have no free corners: drag a segment's bar to slide it, or make the edge straight first."
        : !seg
          ? "Corners go on straight lines: make this edge straight first."
          : null);
  const corners = edgeVertices(edge);
  // The corner right-clicked, or the one nearest the pointer (within 10 px).
  const near = at.vertex ?? corners.find((k) => {
    const q = edge.route.stops[k]!.point;
    return Math.hypot(q.x - at.at.x, q.y - at.at.y) * at.scale <= 10;
  });
  const removeWhy = locked ?? (!corners.length ? "This edge has no corners to remove." : near === undefined || near === null ? "Right-click a corner to remove it." : null);
  return (
    <>
      <ActionItem label="Add vertex here" why={addWhy} testid="menu-add-vertex" onHover={hover} run={() => (addVertex(edge.id, seg!.seg, seg!.point), close())} />
      <ActionItem label="Remove vertex" why={removeWhy} testid="menu-remove-vertex" onHover={hover} run={() => (removeVertex(edge.id, near!), close())} />
    </>
  );
}

/** The edge's form: straight, orthogonal or curved. The current one is ticked; the others are what the edge can be turned into. */
function FormItems({ edge, close, hover }: { edge: Edge; close: () => void; hover: () => void }) {
  const locked = edge.lock ? "This edge is kept as written." : null;
  const a = edge.route.stops[edge.from]!.point;
  const b = edge.route.stops[edge.to]!.point;
  const lined = Math.abs(a.x - b.x) < 0.5 || Math.abs(a.y - b.y) < 0.5;
  const orthogonal = edge.mode === "orthogonal";
  const curved = edge.mode === "curved";
  const straight = edge.mode === "straight";
  const opBlocked = isEdgeOperation(edge) ? edgeOpBlocker(edge) : null;
  const orthoWhy = orthogonal ? null : (locked ?? opBlocked ?? (lined && straight ? "It already runs straight across or down, so an orthogonal route would be the same line." : null));
  const curveWhy = curved ? null : curveBlocker(edge);
  return (
    <>
      <ActionItem
        label="Straight"
        checked={straight}
        why={straight ? null : locked}
        hint={straight ? "This edge is straight." : "Remove the corners and draw one straight line"}
        testid="menu-straighten"
        onHover={hover}
        run={() => (straight ? close() : (straightenEdge(edge.id), close()))}
      />
      <ActionItem
        label="Orthogonal"
        checked={orthogonal}
        why={orthoWhy}
        hint={orthogonal ? "This edge is orthogonal: drag a segment's bar to slide it." : "Route the edge in horizontal and vertical pieces"}
        testid="menu-orthogonal"
        onHover={hover}
        run={() => (orthogonal ? close() : (makeOrthogonal(edge.id), close()))}
      />
      <ActionItem
        label="Curved"
        checked={curved}
        why={curveWhy}
        hint={curved ? "This edge is curved: drag its control points to shape it." : "Draw the edge as a curve"}
        testid="menu-curved"
        onHover={hover}
        run={() => (curved ? close() : (makeCurved(edge.id), close()))}
      />
    </>
  );
}

/** "Flip label side": the label right-clicked, the one picked, or the edge's only one. */
function FlipItem({ edge, at, close, hover }: { edge: Edge; at: EdgeMenuAt; close: () => void; hover: () => void }) {
  const layout = baseLayout.value;
  const labelId = at.label ?? selectedLabelId.value ?? (edge.labels.length === 1 ? edge.labels[0]!.id : null);
  const why =
    edge.lock
      ? `This edge can't be edited: ${edge.lock.message}.`
      : !edge.labels.length
        ? "This edge has no labels."
        : !labelId
          ? "Click the label you mean first, or right-click it."
          : layout
            ? flipBlocker(layout, labelId)
            : "There is no picture.";
  return <ActionItem label="Flip label side" why={why} testid="menu-flip-label" onHover={hover} run={() => (flipLabel(labelId!), close())} />;
}

/** "Split into separate edges": always listed; it says why when the \draw has only one edge. */
function SplitItem({ edge, close, hover }: { edge: Edge; close: () => void; hover: () => void }) {
  const layout = baseLayout.value;
  const why = layout ? splitBlocker(edge, layout) : "There is no picture.";
  return <ActionItem label="Split into separate edges" why={why} testid="menu-split" onHover={hover} run={() => (splitEdge(edge.id), close())} />;
}
