// The side panel for a selected edge (M2b): what it connects, how it is
// written, what can be dragged, why it is locked if it is, and its properties
// (arrow, line, colour, width) for the edge or a style it uses.
import { useSignal } from "@preact/signals";
import type { Change } from "../edit/changes.ts";
import {
  addColorDefinition,
  colorNameProblem,
  documentColors,
} from "../edit/properties.ts";
import {
  type Direction,
  type EdgeEdit,
  type EdgeProps,
  type EdgeScope,
  edgeScopeBlocker,
  edgeStyleNames,
  readEdgeProps,
  readStyleProps,
  styleEdgeUsers,
  TIPS,
  type TipName,
  WIDTHS,
} from "../edit/edgeprops.ts";
import { styleSites, styleTarget } from "../edit/styles.ts";
import { pictureEnv } from "../model/document.ts";
import { type Edge, edgeTitle, pathEdges } from "../model/edges.ts";
import { describeMode, explainEdge, explainPath } from "../model/explain.ts";
import { ColorPicker, Swatch } from "./colorpicker.tsx";
import { applyEdgeProperty, baseLayout, currentPicture, doc, selectedEdge, selection, startLabelEdit } from "./store.ts";

/** The label's TeX on one line, cut short. */
function labelText(source: string): string {
  const flat = source.replace(/%[^\n]*/g, "").replace(/\\\\/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > 32 ? `${flat.slice(0, 31)}…` : flat;
}

/** What can be dragged on an edge of this form. */
function howTo(mode: Edge["mode"]): string {
  if (mode === "orthogonal") return "Drag a segment's bar to slide it across.";
  if (mode === "curved") return "Drag the middle handle to bend the curve; drag a handle near an end to turn it there.";
  return "Drag a ghost handle to add a corner; double-click a corner to remove it.";
}

const DIRECTIONS: ReadonlyArray<{ value: Direction; label: string; title: string }> = [
  { value: "none", label: "—", title: "No arrow tips" },
  { value: "forward", label: "→", title: "An arrow tip at the end" },
  { value: "backward", label: "←", title: "An arrow tip at the start" },
  { value: "both", label: "↔", title: "Arrow tips at both ends" },
];

const DASH_LABEL = { solid: "Solid", dashed: "Dashed", dotted: "Dotted" } as const;

/** Where a value comes from, when a style gives it. */
const from = (via: string | undefined) => (via ? ` (from ${via})` : "");

function EdgeProperties({ edge }: { edge: Edge }) {
  const d = doc.value;
  const pic = d.syntax.pictures[currentPicture.value];
  const layout = baseLayout.value;
  const scopeName = useSignal<string | null>(null);
  const open = useSignal<string | null>(null);
  if (!pic || !layout || edge.lock) return null;
  const sites = styleSites(d, pic);
  const styles = edgeStyleNames(d, pic, edge);
  const style = scopeName.value && styles.includes(scopeName.value) ? scopeName.value : null;
  const scope: EdgeScope = style ? { kind: "style", name: style } : { kind: "edge" };
  const props: EdgeProps = style ? readStyleProps(d, pic, style) : readEdgeProps(d, pic, edge);
  const several = !edge.path.id.includes("/edge") && pathEdges(edge.path, layout).length > 1;
  const arrowBlock = style ? null : edgeScopeBlocker(edge, layout, { kind: "arrow" });
  const env = pictureEnv(d, pic);
  const docColors = documentColors(d, pic);
  const parse = (e: string) => {
    for (const c of docColors) if (c.name === e && c.rgb) return c.rgb;
    return env.colors.parse(e);
  };
  const apply = (edit: EdgeEdit, done: string, extra: Change[] = []) => {
    if (applyEdgeProperty(edge.id, scope, edit, extra, done)) open.value = null;
  };
  const stroke = edge.path.stroke;
  const colorShown = style ? (props.color ? parse(props.color) : null) : stroke;

  return (
    <section class="tf-props" data-testid="edge-properties">
      <div class="tf-scope" role="radiogroup" aria-label="Apply changes to">
        <label>
          <input type="radio" name="edge-scope" checked={!style} onChange={() => (scopeName.value = null)} />
          {several ? "This path" : "This edge"}
        </label>
        {styles.map((s) => {
          const editable = !!styleTarget(d.text, sites, s);
          return (
            <label title={editable ? `Edit the ${s} style, so every edge using it changes` : `The ${s} style isn't written in a form the editor can change`}>
              <input type="radio" name="edge-scope" checked={style === s} disabled={!editable} onChange={() => (scopeName.value = s)} />
              All {s} edges ({styleEdgeUsers(d, pic, layout, s)})
            </label>
          );
        })}
      </div>

      <div class="tf-prop">
        <span class="tf-prop-label">Arrow</span>
        <div class="tf-align" role="group" aria-label="Arrow direction">
          {DIRECTIONS.map((dir) => (
            <button
              class={`tf-toggle${props.direction === dir.value ? " on" : ""}`}
              aria-pressed={props.direction === dir.value}
              disabled={!!arrowBlock}
              title={arrowBlock ?? dir.title}
              data-testid={`edge-arrow-${dir.value}`}
              onClick={() => apply({ kind: "arrow", direction: dir.value }, "Changed the arrow of the edge")}
            >
              {dir.label}
            </button>
          ))}
        </div>
        <div class="tf-font">
          <select
            class="tf-wide"
            aria-label="Arrow tip"
            data-testid="edge-tip"
            disabled={!!arrowBlock || props.direction === "none"}
            title={arrowBlock ?? (props.direction === "none" ? "Choose a direction first" : "The shape of the tip. Default is the figure's own (>) tip.")}
            value={props.tip === "custom" ? "custom" : props.tip}
            onChange={(e) => apply({ kind: "arrow", tip: (e.target as HTMLSelectElement).value as TipName }, "Changed the arrow tip of the edge")}
          >
            {props.tip === "custom" && <option value="custom">Custom</option>}
            {TIPS.map((t) => (
              <option value={t}>{t === "default" ? "Default tip" : t}</option>
            ))}
          </select>
        </div>
        {props.arrowVia && <span class="tf-note">The arrow comes from the {props.arrowVia} style{style ? "" : "; a change here is written on the edge itself."}</span>}
        {arrowBlock && <span class="tf-note">{arrowBlock}</span>}
      </div>

      <div class="tf-prop">
        <span class="tf-prop-label">Line</span>
        <div class="tf-align" role="group" aria-label="Line style">
          {(["solid", "dashed", "dotted"] as const).map((v) => (
            <button
              class={`tf-toggle${props.dash === v ? " on" : ""}`}
              aria-pressed={props.dash === v}
              data-testid={`edge-dash-${v}`}
              onClick={() => apply({ kind: "dash", value: v }, `Made the edge ${v}`)}
            >
              {DASH_LABEL[v]}
            </button>
          ))}
        </div>
        {props.dashVia && !style && <span class="tf-note">Its dashes come from the {props.dashVia} style.</span>}
      </div>

      <div class="tf-prop">
        <span class="tf-prop-label">Colour</span>
        <button class={`tf-color-btn${open.value === "color" ? " open" : ""}`} data-testid="edge-color" onClick={() => (open.value = open.value === "color" ? null : "color")} aria-expanded={open.value === "color"}>
          <Swatch rgb={colorShown ?? undefined} />
          <span class="tf-value">{props.color ? `${props.color}${from(props.colorVia)}` : "Default"}</span>
        </button>
        {open.value === "color" && (
          <ColorPicker
            parse={parse}
            docColors={docColors}
            allowNone={false}
            defaultLabel="Default"
            current={colorShown ?? undefined}
            nameProblem={(n) => colorNameProblem(d, pic, n)}
            onPick={(value, define) =>
              apply(
                { kind: "color", value: value === "" ? null : value },
                define ? `Defined ${define.name} and used it for the colour of the edge` : "Set the colour of the edge",
                define ? [addColorDefinition(d, pic, define.name, define.rgb)] : [],
              )
            }
          />
        )}
      </div>

      <div class="tf-prop">
        <span class="tf-prop-label">Width</span>
        <div class="tf-font">
          <select
            aria-label="Line width"
            data-testid="edge-width"
            value={props.width}
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value;
              apply({ kind: "width", value: v === "thin" ? null : v }, "Set the line width of the edge");
            }}
          >
            {props.width === "custom" && <option value="custom">{`Custom (${props.widthText ?? ""})`}</option>}
            {WIDTHS.map((w) => (
              <option value={w.key}>{w.label}</option>
            ))}
          </select>
        </div>
        {props.widthVia && !style && <span class="tf-note">Its width comes from the {props.widthVia} style.</span>}
      </div>
    </section>
  );
}

export function EdgePanel() {
  const layout = baseLayout.value;
  const edge = selectedEdge.value;
  if (!layout || !edge) return null;
  const help = explainEdge(edge);
  return (
    <>
      <h2 class="tf-title" data-testid="edge-title">
        {edgeTitle(edge, layout)}
      </h2>
      {help && (
        <section class="tf-lock" data-testid="edge-lock-card">
          <h3>
            <span class="tf-lock-icon" aria-hidden="true">
              🔒
            </span>{" "}
            {help.title}
          </h3>
          <p>{help.body}</p>
        </section>
      )}
      <section class="tf-props">
        <div class="tf-prop" data-testid="edge-mode">
          <span class="tf-prop-label">Form</span>
          <span>{describeMode(edge.mode)}</span>
        </div>
        {edge.labels.length > 0 && (
          <div class="tf-prop">
            <span class="tf-prop-label">Labels</span>
            <ul class="tf-edge-labels">
              {edge.labels.map((n) => (
                <li>
                  <button class="link" onClick={() => startLabelEdit(n.id)} title="Edit this label">
                    {labelText(n.syntax.label?.inner ? doc.value.text.slice(n.syntax.label.inner.from, n.syntax.label.inner.to) : "") || "(empty)"}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!help && <p class="tf-note">{howTo(edge.mode)} Drag an end to another anchor or node. Right-click the edge for more (Add label here too). Drag a label to slide it along the edge; double-click it to edit it.</p>}
      </section>
      <EdgeProperties key={edge.id} edge={edge} />
    </>
  );
}

/** A selected path the editor doesn't treat as an edge. */
export function PathPanel() {
  const sel = selection.value;
  const path = sel?.kind === "path" ? baseLayout.value?.paths.find((p) => p.id === sel.id) : undefined;
  if (!path) return null;
  const help = explainPath(path);
  return (
    <section class="tf-lock" data-testid="path-card">
      <h3>{help.title}</h3>
      <p>{help.body}</p>
    </section>
  );
}
