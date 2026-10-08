// The context menu for an edge (M2b). Step 3 has the anchor items; vertices,
// modes and labels join it in later steps.
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { endBlocker, endStop } from "../edit/edges.ts";
import type { Edge } from "../model/edges.ts";
import { anchorPoint } from "../tikz/shapes.ts";
import { baseLayout, moveEnd } from "./store.ts";

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

/** The menu for `edge` at (x, y) in the canvas pane. */
export function EdgeMenu({ edge, x, y, onClose }: { edge: Edge; x: number; y: number; onClose: () => void }) {
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
      <AnchorItem edge={edge} which="from" open={open.value === "from"} onOpen={() => (open.value = "from")} onDone={onClose} />
      <AnchorItem edge={edge} which="to" open={open.value === "to"} onOpen={() => (open.value = "to")} onDone={onClose} />
    </div>
  );
}
