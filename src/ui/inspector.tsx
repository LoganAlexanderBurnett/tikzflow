// The side panel for the selected nodes: why a node is locked and how to fix
// it, and its properties (colours, font, alignment) for the node or its style.
import { signal, useSignal } from "@preact/signals";
import type { Change } from "../edit/changes.ts";
import { attachCandidates } from "../edit/move.ts";
import {
  addColorDefinition,
  colorNameProblem,
  documentColors,
  type Family,
  FONT_SIZES,
  nodeOption,
  type PropEdit,
  rawColor,
  readFont,
  type Resolved,
  type Scope,
  sharedStyles,
  styleOption,
  styleUsers,
} from "../edit/properties.ts";
import { styleSites, styleTarget } from "../edit/styles.ts";
import { pictureEnv } from "../model/document.ts";
import { explainLock } from "../model/explain.ts";
import { cssColor, type RGB } from "../tikz/colors.ts";
import type { LaidOutNode, PictureLayout } from "../tikz/layout.ts";
import { EdgePanel, PathPanel } from "./edgepanel.tsx";
import { StylePanel } from "./stylepanel.tsx";
import { applyProperty, attachNode, baseLayout, currentPicture, doc, matchSize, pinNode, scopeStyle, selectedNodes, selection } from "./store.ts";

function LockCard({ layout, node }: { layout: PictureLayout; node: LaidOutNode }) {
  const candidates = attachCandidates(layout, node).map((n) => n.name!);
  const help = explainLock(layout, node, candidates);
  const choice = useSignal<string | null>(null);
  if (!help) return null;
  const target = choice.value ?? help.suggestion ?? candidates[candidates.length - 1] ?? "";
  return (
    <section class="tf-lock" data-testid="lock-card">
      <h3>
        <span class="tf-lock-icon" aria-hidden="true">
          🔒
        </span>{" "}
        {help.title}
      </h3>
      <p>{help.body}</p>
      {help.suggestion && <p class="tf-hint">Did you mean "{help.suggestion}"?</p>}
      {(help.canPin || help.canAttach) && (
        <div class="tf-fixes">
          {help.canPin && (
            <button onClick={() => pinNode(node.id)} title="Write plain coordinates for where the node is drawn now">
              Pin at current position
            </button>
          )}
          {help.canAttach && help.ref && candidates.length > 0 && (
            <div class="tf-attach">
              <button onClick={() => attachNode(node.id, help.ref!, target)} title={`Refer to ${target} instead of ${help.ref}, keeping anchors and distances`}>
                Attach to
              </button>
              <select value={target} onChange={(e) => (choice.value = (e.target as HTMLSelectElement).value)} aria-label="Node to attach to">
                {candidates.map((c) => (
                  <option value={c}>{c}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- colour picker

/** Common xcolor mixes: light fills, then darker outlines and text. */
const MIXES = ["blue!20", "cyan!20", "teal!20", "green!20", "lime!30", "yellow!30", "orange!20", "red!20", "magenta!20", "violet!20", "gray!20", "black!5"];
const STRONG = ["blue!60!black", "teal!70!black", "green!50!black", "orange!80!black", "red!70!black", "violet!70!black", "gray", "black!70"];
const BASIC = ["black", "white", "red", "green", "blue", "cyan", "magenta", "yellow", "orange", "brown", "purple", "teal", "violet", "gray", "lightgray", "darkgray"];

const toHex = (c: RGB) => `#${c.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;

function Swatch({ rgb, none }: { rgb?: RGB | undefined; none?: boolean }) {
  return <span class={`tf-swatch${none || !rgb ? " none" : ""}`} style={rgb && !none ? { background: cssColor(rgb) } : undefined} />;
}

interface PickerProps {
  /** Colours by name, for swatches. */
  parse: (expr: string) => RGB | null;
  docColors: Array<{ name: string; rgb?: RGB }>;
  allowNone: boolean;
  current?: RGB | undefined;
  /** A named colour, an xcolor expression, or a raw colour; `define` adds a \definecolor first. */
  onPick: (value: string, define?: { name: string; rgb: [number, number, number] }) => void;
  nameProblem: (name: string) => string | null;
}

function ColorPicker({ parse, docColors, allowNone, current, onPick, nameProblem }: PickerProps) {
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

// ---------------------------------------------------------------- properties

/** What several values have in common: the value, or "mixed". */
function common<T>(values: readonly T[]): T | "mixed" | undefined {
  if (!values.length) return undefined;
  const first = JSON.stringify(values[0]);
  return values.every((v) => JSON.stringify(v) === first) ? values[0] : "mixed";
}

function describe(r: Resolved | "mixed" | undefined): string {
  if (r === "mixed") return "Mixed";
  if (!r || r.value === undefined) return "Default";
  return r.via ? `${r.value} (from ${r.via})` : r.value;
}

const COLOR_ROWS = [
  { key: "fill", label: "Fill", allowNone: true, rgb: (n: LaidOutNode) => n.fill },
  { key: "draw", label: "Outline", allowNone: true, rgb: (n: LaidOutNode) => n.stroke },
  { key: "text", label: "Text", allowNone: false, rgb: (n: LaidOutNode) => n.textColor },
] as const;

const SIZE_LABEL: Record<string, string> = {
  "\\tiny": "Tiny",
  "\\scriptsize": "Script",
  "\\footnotesize": "Footnote",
  "\\small": "Small",
  "\\normalsize": "Normal",
  "\\large": "large",
  "\\Large": "Large",
  "\\LARGE": "LARGE",
  "\\huge": "huge",
  "\\Huge": "Huge",
};

function Properties({ layout, nodes }: { layout: PictureLayout; nodes: LaidOutNode[] }) {
  // "This node" by default (D34); a new selection starts there again.
  const scopeName = scopeStyle;
  const d = doc.value;
  const pic = d.syntax.pictures[currentPicture.value];
  const open = useSignal<string | null>(null);
  if (!pic) return null;
  const sites = styleSites(d, pic);
  const shared = sharedStyles(d, pic, nodes);
  const style = scopeName.value && shared.includes(scopeName.value) ? scopeName.value : null;
  const scope: Scope = style ? { kind: "style", name: style } : { kind: "nodes", ids: nodes.map((n) => n.id) };
  const env = pictureEnv(d, pic);
  const docColors = documentColors(d, pic);
  const parse = (e: string) => {
    for (const c of docColors) if (c.name === e && c.rgb) return c.rgb;
    return env.colors.parse(e);
  };
  const resolve = (key: string) => common(style ? [styleOption(sites, style, key)] : nodes.map((n) => nodeOption(sites, n.syntax, key)));
  const apply = (e: PropEdit, extra?: Change[], done?: string) => {
    if (applyProperty(scope, e, extra, done)) open.value = null;
  };

  const font = resolve("font");
  const fontState = font === "mixed" ? null : readFont(font?.value);
  const fonts = style ? [readFont(styleOption(sites, style, "font").value)] : nodes.map((n) => readFont(nodeOption(sites, n.syntax, "font").value));
  const bold = common(fonts.map((f) => f.bold));
  const italic = common(fonts.map((f) => f.italic));
  const size = common(fonts.map((f) => f.size ?? "\\normalsize"));
  const family = common(fonts.map((f) => f.family ?? ""));
  const align = resolve("align");
  const alignValue = align === "mixed" ? "mixed" : (align?.value ?? "");
  const hasWidth = (() => {
    const w = resolve("text width");
    return w === "mixed" ? true : w?.value !== undefined;
  })();

  return (
    <section class="tf-props" data-testid="properties">
      <div class="tf-scope" role="radiogroup" aria-label="Apply changes to">
        <label>
          <input type="radio" name="scope" checked={!style} onChange={() => (scopeName.value = null)} />
          {nodes.length === 1 ? "This node" : `These ${nodes.length} nodes`}
        </label>
        {shared.map((s) => {
          const editable = !!styleTarget(d.text, sites, s);
          return (
            <label title={editable ? `Edit the ${s} style, so every node using it changes` : `The ${s} style isn't written in a form the editor can change`}>
              <input type="radio" name="scope" checked={style === s} disabled={!editable} onChange={() => (scopeName.value = s)} />
              All {s} nodes ({styleUsers(sites, layout, s).length})
            </label>
          );
        })}
      </div>

      {nodes.length > 1 && (
        <div class="tf-prop">
          <span class="tf-prop-label">Size</span>
          <div class="tf-match">
            <button
              data-testid="match-width"
              onClick={() => matchSize("w")}
              title={`Give the other nodes the width of ${nodeTitle(nodes[0]!)}, the first one you selected${style ? `. The ${style} style takes it, so every node using it matches` : ""}`}
            >
              Match width
            </button>
            <button
              data-testid="match-height"
              onClick={() => matchSize("h")}
              title={`Give the other nodes the height of ${nodeTitle(nodes[0]!)}, the first one you selected${style ? `. The ${style} style takes it, so every node using it matches` : ""}`}
            >
              Match height
            </button>
          </div>
          <span class="tf-note">To {nodeTitle(nodes[0]!)}, the first node selected.</span>
        </div>
      )}

      {COLOR_ROWS.map((row) => {
        const r = resolve(row.key);
        const rgbs = nodes.map(row.rgb);
        const rgb = style ? (r !== "mixed" && r?.value ? (parse(r.value) ?? undefined) : undefined) : common(rgbs.map((c) => c && [...c])) === "mixed" ? undefined : rgbs[0];
        const isNone = r !== "mixed" && r?.value === "none";
        return (
          <div class="tf-prop">
            <span class="tf-prop-label">{row.label}</span>
            <button
              class={`tf-color-btn${open.value === row.key ? " open" : ""}`}
              data-testid={`color-${row.key}`}
              onClick={() => (open.value = open.value === row.key ? null : row.key)}
              aria-expanded={open.value === row.key}
            >
              <Swatch rgb={rgb} none={isNone} />
              <span class="tf-value">{describe(r)}</span>
            </button>
            {open.value === row.key && (
              <ColorPicker
                parse={parse}
                docColors={docColors}
                allowNone={row.allowNone}
                current={rgb}
                nameProblem={(n) => colorNameProblem(d, pic, n)}
                onPick={(value, define) =>
                  apply(
                    { kind: "color", key: row.key, value },
                    define ? [addColorDefinition(d, pic, define.name, define.rgb)] : [],
                    define ? `Defined ${define.name} and used it for the ${row.label.toLowerCase()} of` : `Set the ${row.label.toLowerCase()} of`,
                  )
                }
              />
            )}
          </div>
        );
      })}

      <div class="tf-prop">
        <span class="tf-prop-label">Font</span>
        <div class="tf-font">
          <select
            aria-label="Font size"
            value={size === "mixed" ? "" : size}
            onChange={(e) => apply({ kind: "font", change: { size: (e.target as HTMLSelectElement).value } }, [], "Set the font size of")}
          >
            {size === "mixed" && <option value="">Mixed</option>}
            {size === "custom" && <option value="custom">Custom</option>}
            {FONT_SIZES.map((s) => (
              <option value={s}>{SIZE_LABEL[s]}</option>
            ))}
          </select>
          <button
            class={`tf-toggle${bold === true ? " on" : ""}`}
            aria-pressed={bold === "mixed" ? "mixed" : bold === true}
            title="Bold (\bfseries)"
            onClick={() => apply({ kind: "font", change: { bold: bold !== true } }, [], bold === true ? "Removed bold from" : "Set bold on")}
          >
            <b>B</b>
          </button>
          <button
            class={`tf-toggle${italic === true ? " on" : ""}`}
            aria-pressed={italic === "mixed" ? "mixed" : italic === true}
            title="Italic (\itshape)"
            onClick={() => apply({ kind: "font", change: { italic: italic !== true } }, [], italic === true ? "Removed italic from" : "Set italic on")}
          >
            <i>I</i>
          </button>
          <select
            class="tf-family"
            aria-label="Font family"
            value={family === "mixed" ? "mixed" : family}
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value;
              apply({ kind: "font", change: { family: v ? (v as Family) : null } }, [], "Set the font family of");
            }}
          >
            {family === "mixed" && <option value="mixed">Mixed</option>}
            <option value="">Default family</option>
            <option value="rm">Serif (\rmfamily)</option>
            <option value="sf">Sans (\sffamily)</option>
            <option value="tt">Mono (\ttfamily)</option>
          </select>
        </div>
        {fontState === null && <span class="tf-note">The selected nodes have different fonts; a change sets that part on each.</span>}
      </div>

      <div class="tf-prop">
        <span class="tf-prop-label">Align</span>
        <div class="tf-align" role="group" aria-label="Text alignment">
          {(["left", "center", "right", "justify"] as const).map((a) => {
            const disabled = a === "justify" && !!style && !hasWidth;
            const title =
              a === "justify"
                ? disabled
                  ? `Justify needs a text width, and the ${style} style doesn't set one.`
                  : hasWidth
                    ? "Justify (align=justify)"
                    : "Justify needs a text width: one will be set from the text's current width."
                : `align=${a}`;
            return (
              <button
                class={`tf-toggle${alignValue === a ? " on" : ""}`}
                aria-pressed={alignValue === a}
                disabled={disabled}
                title={title}
                onClick={() => apply({ kind: "align", value: a }, [], `Set align=${a} on`)}
              >
                {a === "left" ? "Left" : a === "center" ? "Centre" : a === "right" ? "Right" : "Justify"}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** A node's name, or for an unnamed one its label (cut short), so it can be told from the others. */
export function nodeTitle(n: LaidOutNode): string {
  if (n.name && !n.implicitName) return n.name;
  const label = n.syntax.label?.inner ? doc.value.text.slice(n.syntax.label.inner.from, n.syntax.label.inner.to) : "";
  const flat = label.replace(/%[^\n]*/g, "").replace(/\\\\/g, " ").replace(/\s+/g, " ").trim();
  if (flat) return `"${flat.length > 28 ? `${flat.slice(0, 27)}…` : flat}"`;
  return n.name ?? "Unnamed node";
}

const COLLAPSE_KEY = "tikzflow.inspector.collapsed";

/** Whether the panel was collapsed last time, remembered per viewer in this browser. */
function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

const collapsed = signal(loadCollapsed());

function setCollapsed(v: boolean): void {
  collapsed.value = v;
  try {
    localStorage.setItem(COLLAPSE_KEY, v ? "1" : "0");
  } catch {
    // Storage can be blocked; the panel still works for this visit.
  }
}

export function Inspector() {
  const layout = baseLayout.value;
  const nodes = selectedNodes.value;
  const primary = nodes[nodes.length - 1];
  const statements = nodes.filter((n) => n.kind === "statement");
  const key = nodes.map((n) => n.id).join("|");
  if (collapsed.value) {
    return (
      <aside class="tf-inspector collapsed" data-testid="inspector">
        <button class="tf-collapse" onClick={() => setCollapsed(false)} title="Show the properties panel" aria-label="Show the properties panel" aria-expanded={false} data-testid="inspector-toggle">
          «
        </button>
        {primary?.lock && (
          <span class="tf-lock-icon" title={`Locked: ${primary.locked}. Open the panel to see why.`} aria-hidden="true">
            🔒
          </span>
        )}
      </aside>
    );
  }
  return (
    <aside class="tf-inspector" data-testid="inspector">
      <button class="tf-collapse" onClick={() => setCollapsed(true)} title="Hide the properties panel" aria-label="Hide the properties panel" aria-expanded={true} data-testid="inspector-toggle">
        »
      </button>
      {selection.value?.kind === "edge" ? (
        <EdgePanel />
      ) : selection.value?.kind === "path" ? (
        <PathPanel />
      ) : !layout || !primary ? (
        <p class="tf-empty">Select a node to edit its colours, font and alignment. Shift-click selects several. Click an edge to work on it.</p>
      ) : (
        <>
          <h2 class="tf-title" title={nodes.length === 1 ? nodeTitle(primary) : undefined}>
            {nodes.length === 1 ? nodeTitle(primary) : `${nodes.length} nodes`}
          </h2>
          {primary.lock && <LockCard key={primary.id} layout={layout} node={primary} />}
          {statements.length > 0 ? (
            <Properties key={key} layout={layout} nodes={statements} />
          ) : (
            <p class="tf-empty">A coordinate has no shape or text to style.</p>
          )}
        </>
      )}
      <StylePanel />
    </aside>
  );
}
