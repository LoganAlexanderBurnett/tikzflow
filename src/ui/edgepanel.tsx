// The side panel for a selected edge (M2b): what it connects, how it is
// written, and why it is locked if it is. Its properties come in step 8.
import { edgeTitle } from "../model/edges.ts";
import { describeMode, explainEdge, explainPath } from "../model/explain.ts";
import { baseLayout, doc, selectedEdge, selection, startLabelEdit } from "./store.ts";

/** The label's TeX on one line, cut short. */
function labelText(source: string): string {
  const flat = source.replace(/%[^\n]*/g, "").replace(/\\\\/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > 32 ? `${flat.slice(0, 31)}…` : flat;
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
        {!help && <p class="tf-note">Double-click a label on the canvas to edit it.</p>}
      </section>
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
