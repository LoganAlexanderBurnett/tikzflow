// The colour picker shared by the node and edge panels: the document's own
// colours first, then xcolor mixes, then a custom colour that can be named.
import { useSignal } from "@preact/signals";
import { rawColor } from "../edit/properties.ts";
import { cssColor, type RGB } from "../tikz/colors.ts";

/** Common xcolor mixes: light fills, then darker outlines and text. */
const MIXES = ["blue!20", "cyan!20", "teal!20", "green!20", "lime!30", "yellow!30", "orange!20", "red!20", "magenta!20", "violet!20", "gray!20", "black!5"];
const STRONG = ["blue!60!black", "teal!70!black", "green!50!black", "orange!80!black", "red!70!black", "violet!70!black", "gray", "black!70"];
const BASIC = ["black", "white", "red", "green", "blue", "cyan", "magenta", "yellow", "orange", "brown", "purple", "teal", "violet", "gray", "lightgray", "darkgray"];

export const toHex = (c: RGB) => `#${c.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;

export function Swatch({ rgb, none }: { rgb?: RGB | undefined; none?: boolean }) {
  return <span class={`tf-swatch${none || !rgb ? " none" : ""}`} style={rgb && !none ? { background: cssColor(rgb) } : undefined} />;
}

export interface PickerProps {
  /** Colours by name, for swatches. */
  parse: (expr: string) => RGB | null;
  docColors: Array<{ name: string; rgb?: RGB }>;
  allowNone: boolean;
  /** A button that drops the colour (the edge falls back to its style's), calling `onPick("")`. */
  defaultLabel?: string;
  current?: RGB | undefined;
  /** A named colour, an xcolor expression, or a raw colour; `define` adds a \definecolor first. */
  onPick: (value: string, define?: { name: string; rgb: [number, number, number] }) => void;
  nameProblem: (name: string) => string | null;
}

export function ColorPicker({ parse, docColors, allowNone, defaultLabel, current, onPick, nameProblem }: PickerProps) {
  const custom = useSignal(current ? toHex(current) : "#1f77b4");
  const name = useSignal("");
  const grid = (list: string[]) => (
    <div class="tf-swatches">
      {list.map((c) => (
        <button class="tf-swatch-btn" title={c} aria-label={c} onClick={() => onPick(c)}>
          <Swatch rgb={parse(c) ?? undefined} />
        </button>
      ))}
    </div>
  );
  const rgb255 = (): [number, number, number] => {
    const h = custom.value.slice(1);
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  };
  const problem = name.value ? nameProblem(name.value) : "Give it a name to add it as a \\definecolor.";
  return (
    <div class="tf-picker" data-testid="color-picker">
      {docColors.length > 0 && (
        <>
          <h4>In this document</h4>
          <div class="tf-named">
            {docColors.map((c) => (
              <button class="tf-named-btn" onClick={() => onPick(c.name)} title={c.name}>
                <Swatch rgb={c.rgb} /> {c.name}
              </button>
            ))}
          </div>
        </>
      )}
      <h4>Mixes</h4>
      {grid(MIXES)}
      {grid(STRONG)}
      <h4>Basic</h4>
      {grid(BASIC)}
      {defaultLabel && (
        <button class="tf-none-btn" onClick={() => onPick("")} data-testid="color-default">
          <Swatch none /> {defaultLabel}
        </button>
      )}
      {allowNone && (
        <button class="tf-none-btn" onClick={() => onPick("none")}>
          <Swatch none /> None
        </button>
      )}
      <h4>Custom</h4>
      <div class="tf-custom">
        <input type="color" value={custom.value} onInput={(e) => (custom.value = (e.target as HTMLInputElement).value)} aria-label="Custom colour" />
        <input
          type="text"
          placeholder="Name, e.g. Accent"
          value={name.value}
          onInput={(e) => (name.value = (e.target as HTMLInputElement).value.trim())}
          aria-label="Colour name"
        />
      </div>
      <div class="tf-custom-actions">
        <button disabled={!!problem} title={problem ?? `Adds \\definecolor{${name.value}} and uses it`} onClick={() => onPick(name.value, { name: name.value, rgb: rgb255() })}>
          Add named colour
        </button>
        <button class="link" onClick={() => onPick(rawColor(rgb255()))} title="Writes the colour as raw RGB values">
          Use without a name
        </button>
      </div>
      {name.value && problem && <p class="tf-problem">{problem}</p>}
    </div>
  );
}

