// Labels their own line cuts through (D65): a small marker on each, and a
// popover with the two fixes, Flip side and Beside the line (auto). Moving a
// node never rewrites labels; this tells the user instead.

import { signal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { LaidOutNode } from "../tikz/layout.ts";
import { baseLayout, flipLabel, labelWarnings, putLabelBesideLine } from "./store.ts";

const f = (v: number) => Math.round(v * 1000) / 1000;

/** The open popover: the label, and where it opens in the canvas pane (px). */
export const labelFix = signal<{ labelId: string; x: number; y: number } | null>(null);

/** The markers, in the canvas overlay (model coordinates, y up). */
export function LabelWarnings({ scale, hidden }: { scale: number; hidden: boolean }) {
  const l = baseLayout.value;
  const list = labelWarnings.value;
  if (hidden || !l || !list.length) return null;
  const r = 5 / scale;
  return (
    <g class="tf-label-warnings">
      {list.map(({ labelId }) => {
        const n: LaidOutNode | undefined = l.pathNodes.find((x) => x.id === labelId);
        if (!n) return null;
        const x = n.shape.center.x + n.shape.hw + r * 0.6;
        const y = n.shape.center.y + n.shape.hh + r * 0.6;
        return (
          <g key={labelId} data-label-warning={labelId} data-testid="label-warning" class="tf-label-warning" transform={`translate(${f(x)} ${f(y)})`}>
            <circle r={f(r)} stroke-width={f(1 / scale)} />
            <path d={`M0 ${f(2.6 / scale)} V${f(-0.4 / scale)} M0 ${f(-1.9 / scale)} V${f(-2.5 / scale)}`} stroke-width={f(1.3 / scale)} />
            <title>Its line runs through this label. Click to flip it or put it beside the line.</title>
          </g>
        );
      })}
    </g>
  );
}

/** The popover with the two fixes. */
export function LabelFixMenu({ onClose }: { onClose: () => void }) {
  const at = labelFix.value;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!at) return;
    ref.current?.querySelector("button")?.focus();
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [at?.labelId]);
  if (!at) return null;
  const close = () => {
    labelFix.value = null;
    onClose();
  };
  const run = (fix: (id: string) => boolean) => {
    fix(at.labelId);
    close();
  };
  return (
    <div
      ref={ref}
      class="tf-menu tf-label-fix"
      role="menu"
      data-testid="label-fix"
      style={{ left: `${f(at.x)}px`, top: `${f(at.y)}px` }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          close();
        }
      }}
    >
      <div class="tf-menu-note">The line runs through this label.</div>
      <button class="tf-menu-item" role="menuitem" data-testid="label-fix-beside" onClick={() => run(putLabelBesideLine)}>
        Beside the line (auto)
      </button>
      <button class="tf-menu-item" role="menuitem" data-testid="label-fix-flip" onClick={() => run(flipLabel)}>
        Flip side
      </button>
    </div>
  );
}
