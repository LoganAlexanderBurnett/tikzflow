// The shape palette: the standard flowchart shapes, then the figure's own node
// styles. Click to add after the selected node (connected to it) or at the
// middle of the view; drag onto the canvas to drop one where you want it.
import type { JSX } from "preact";
import type { PaletteEntry } from "../edit/create.ts";
import { activeEntry, addFromPalette, PALETTE_DRAG, palette, selectedNodes } from "./store.ts";

/** A small drawing of a shape. */
function Icon({ shape }: { shape: string }): JSX.Element {
  const common = { fill: "none", stroke: "currentColor", "stroke-width": 1.3, "stroke-linejoin": "round" } as const;
  let body: JSX.Element;
  switch (shape) {
    case "rounded rectangle":
      body = <rect x="2" y="3" width="24" height="12" rx="6" {...common} />;
      break;
    case "diamond":
      body = <polygon points="14,1.5 26,9 14,16.5 2,9" {...common} />;
      break;
    case "trapezium":
      body = <polygon points="7,3 26,3 21,15 2,15" {...common} />;
      break;
    case "circle":
      body = <circle cx="14" cy="9" r="6.5" {...common} />;
      break;
    case "ellipse":
      body = <ellipse cx="14" cy="9" rx="12" ry="7" {...common} />;
      break;
    case "tape":
      body = <path d="M2 4 Q8 1 14 4 T26 4 V13 Q20 16 14 13 T2 13 Z" {...common} />;
      break;
    case "cylinder":
      body = (
        <>
          <path d="M3 4 V14 Q14 18 25 14 V4" {...common} />
          <ellipse cx="14" cy="4" rx="11" ry="2.8" {...common} />
        </>
      );
      break;
    default:
      body = <rect x="2" y="3" width="24" height="12" {...common} />;
  }
  return (
    <svg class="tf-pal-icon" viewBox="0 0 28 18" width="28" height="18" aria-hidden="true">
      {body}
    </svg>
  );
}

function Button({ entry, active }: { entry: PaletteEntry; active: boolean }) {
  const after = selectedNodes.value.at(-1)?.kind === "statement";
  return (
    <button
      class={`tf-pal-btn${active ? " active" : ""}`}
      data-testid={`palette-${entry.id}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer?.setData(PALETTE_DRAG, entry.id);
        e.dataTransfer?.setData("text/plain", entry.label);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={() => addFromPalette(entry)}
      title={`${entry.label}: click to add ${after ? "after the selected node, connected to it" : "at the middle of the view"}, or drag it onto the canvas.${
        entry.body ? ` Adds a "${entry.style}" style to your code.` : ` Uses your "${entry.style}" style.`
      }`}
    >
      <Icon shape={entry.shape} />
      <span>{entry.label}</span>
    </button>
  );
}

export function Palette() {
  const entries = palette.value;
  if (!entries.length) return null;
  const active = activeEntry.value?.id;
  const standard = entries.filter((e) => e.source === "standard");
  const own = entries.filter((e) => e.source === "document");
  return (
    <div class="tf-palette" data-testid="palette" role="toolbar" aria-label="Add a node">
      <span class="tf-pal-label">Add</span>
      {standard.map((e) => (
        <Button entry={e} active={e.id === active} />
      ))}
      {own.length > 0 && (
        <>
          <span class="tf-pal-sep" />
          <span class="tf-pal-label" title="Node styles this figure defines">
            This figure
          </span>
          {own.map((e) => (
            <Button entry={e} active={e.id === active} />
          ))}
        </>
      )}
      <span class="tf-pal-hint">Tab adds a connected node, Enter one beside it</span>
    </div>
  );
}
