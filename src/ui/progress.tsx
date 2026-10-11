// Over the canvas while an auto-layout or an import runs for more than a
// moment (D83 item 4, D87): which stage it is at, and Cancel. The work runs in
// the layout worker, so the page stays responsive meanwhile.

import { cancelLayout, layoutProgress, progressText } from "./store.ts";

export function LayoutProgressBadge() {
  const p = layoutProgress.value;
  if (!p) return null;
  return (
    <div class="tf-progress-badge" role="status" aria-live="polite" data-testid="layout-progress">
      <progress value={p.step} max={p.steps} aria-label="Layout progress" />
      <span data-testid="layout-progress-text">{progressText(p)}</span>
      <button onClick={cancelLayout} data-testid="layout-cancel">
        Cancel
      </button>
    </div>
  );
}
