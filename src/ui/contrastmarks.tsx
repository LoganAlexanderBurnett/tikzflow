// Contrast warnings on the canvas (M4 step 6, D85): a small marker at the
// corner of each node whose text fails WCAG AA, and the note with the one-click
// fixes in the properties panel and the summary's list.

import { type ContrastIssue, betterText, formatRatio } from "../edit/contrast.ts";
import { edgeOfLabel } from "../model/edges.ts";
import { baseLayout, contrast, edges, selectFromCanvas } from "./store.ts";

const f = (v: number) => Math.round(v * 1000) / 1000;

/** What a warning says: the ratio, what it sits on, what AA wants. */
export function contrastMessage(i: ContrastIssue): string {
  const on = i.on === "fill" ? "its fill" : i.on === "behind" ? "what is drawn behind it" : "the white page";
  return `The text is ${formatRatio(i.ratio)} against ${on}. WCAG AA asks for ${i.required}:1${i.large ? " for large text" : ""}.`;
}

/** Selects what a warning is about: the node, or the edge an edge label is on. */
export function selectContrastIssue(id: string): void {
  const owner = edgeOfLabel(edges.value, id);
  selectFromCanvas(owner ? { kind: "edge", id: owner.id } : { kind: "node", id });
}

/** The markers, in the canvas overlay (model coordinates, y up). */
export function ContrastMarks({ scale, hidden }: { scale: number; hidden: boolean }) {
  const l = baseLayout.value;
  const list = contrast.value;
  if (hidden || !l || !list.length) return null;
  const r = 5 / scale;
  return (
    <g class="tf-contrast-marks">
      {list.map((i) => {
        const n = l.nodes.find((x) => x.id === i.id) ?? l.pathNodes.find((x) => x.id === i.id);
        if (!n) return null;
        const x = n.shape.center.x - n.shape.hw - r * 0.6;
        const y = n.shape.center.y + n.shape.hh + r * 0.6;
        return (
          <g key={i.id} data-contrast-mark={i.id} data-testid="contrast-mark" class="tf-contrast-mark" transform={`translate(${f(x)} ${f(y)})`}>
            <circle r={f(r)} stroke-width={f(1 / scale)} />
            {/* A half-filled disc: the usual sign for contrast. */}
            <path d={`M0 ${f(-3 / scale)} A${f(3 / scale)} ${f(3 / scale)} 0 0 1 0 ${f(3 / scale)} Z`} />
            <title>{`Low contrast. ${contrastMessage(i)} Click to select it.`}</title>
          </g>
        );
      })}
    </g>
  );
}

/** For a selected node: the warning and a fix that sets the text color. */
export function ContrastNote({ issue, onFix, fixable }: { issue: ContrastIssue; onFix: (color: "black" | "white") => void; fixable: boolean }) {
  const best = betterText(issue.background);
  return (
    <div class="tf-contrast-note" data-testid="contrast-note">
      <p>
        <strong>Low contrast.</strong> {contrastMessage(issue)}
      </p>
      {fixable ? (
        <button onClick={() => onFix(best.name)} data-testid="contrast-fix" title={`Set the text color to ${best.name}, which is ${formatRatio(best.ratio)} against this`}>
          Use {best.name} text ({formatRatio(best.ratio)})
        </button>
      ) : (
        <p class="tf-note">Part of the label sets its own color (<code>\textcolor</code> or <code>\color</code>): change it in the code or the label.</p>
      )}
    </div>
  );
}
