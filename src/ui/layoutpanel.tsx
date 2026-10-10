// The Layout button (M4 step 3, D80): auto-layout with elk.js, written back
// as relative positions. The whole picture, or the selected nodes when two or
// more are selected; locked nodes stay where they are.

import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { guessDirection, type LayoutDirection, layoutBlocker, layoutScope } from "../edit/autolayout.ts";
import { autoLayout, baseLayout, layoutBusy, selectedIds } from "./store.ts";

const DIRECTIONS: Array<{ dir: LayoutDirection; label: string }> = [
  { dir: "down", label: "Top to bottom" },
  { dir: "right", label: "Left to right" },
];

export function LayoutButton() {
  const open = useSignal(false);
  const button = useRef<HTMLButtonElement>(null);
  const at = useSignal({ top: 44, left: 10 });
  const l = baseLayout.value;
  const ids = selectedIds.value.length >= 2 ? selectedIds.value : undefined;
  const blocked = l ? layoutBlocker(l, ids) : "There is no picture.";
  const scope = l ? layoutScope(l, ids) : { members: [], staying: [] };
  const guess = l ? guessDirection(l, ids) : "down";
  return (
    <span class="tf-layout">
      <button
        ref={button}
        onClick={() => {
          const r = button.current?.getBoundingClientRect();
          if (r) at.value = { top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 400)) };
          open.value = !open.value;
        }}
        aria-expanded={open.value}
        data-testid="layout-button"
        title="Lay out the picture (or the selected nodes) automatically, written as relative positions"
      >
        Layout
      </button>
      {open.value && (
        <div class="tf-page-panel tf-layout-panel" data-testid="layout-panel" style={{ top: `${at.value.top}px`, left: `${at.value.left}px` }} onKeyDown={(e) => e.key === "Escape" && (open.value = false)}>
          <div class="head">
            <h3>Auto-layout</h3>
            <button class="link" onClick={() => (open.value = false)} aria-label="Close">
              Close
            </button>
          </div>
          <p class="note" data-testid="layout-scope">
            {blocked ??
              (ids
                ? `Lays out the ${scope.members.length} selected node${scope.members.length === 1 ? "" : "s"}. Select one node or none to lay out the whole picture.`
                : `Lays out all ${scope.members.length} nodes of the picture. Select two or more nodes to lay out only those.`)}
          </p>
          <div class="row">
            {DIRECTIONS.map(({ dir, label }) => (
              <button
                disabled={!!blocked || layoutBusy.value}
                data-testid={`layout-${dir}`}
                onClick={() => {
                  void autoLayout(dir).then((ok) => {
                    if (ok) open.value = false;
                  });
                }}
              >
                {label}
                {guess === dir ? " (as now)" : ""}
              </button>
            ))}
          </div>
          <p class="note">
            Each node is placed relative to a node before it in the code (<code>below=of a</code>, <code>right=of b</code>, <code>at (a |- b)</code>); positions already written that agree with the layout are kept. Corners of edges written as fixed coordinates are removed. One Ctrl+Z undoes it.
          </p>
          {scope.staying.length > 0 && (
            <p class="note" data-testid="layout-staying">
              {scope.staying.length === 1 ? "One locked node stays" : `${scope.staying.length} locked nodes stay`} where {scope.staying.length === 1 ? "it is" : "they are"}: {scope.staying.map((n) => n.name ?? "unnamed").slice(0, 5).join(", ")}
              {scope.staying.length > 5 ? "…" : ""}.
            </p>
          )}
        </div>
      )}
    </span>
  );
}
