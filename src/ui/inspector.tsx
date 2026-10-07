// The side panel for the selected nodes: why a node is locked and how to fix
// it, and (from step 3) its properties.
import { useSignal } from "@preact/signals";
import { attachCandidates } from "../edit/move.ts";
import { explainLock } from "../model/explain.ts";
import type { LaidOutNode, PictureLayout } from "../tikz/layout.ts";
import { attachNode, baseLayout, pinNode, selectedNodes } from "./store.ts";

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

export function Inspector() {
  const layout = baseLayout.value;
  const nodes = selectedNodes.value;
  const primary = nodes[nodes.length - 1];
  if (!layout || !primary?.lock) return null;
  return (
    <aside class="tf-inspector" data-testid="inspector">
      <LockCard key={primary.id} layout={layout} node={primary} />
    </aside>
  );
}
