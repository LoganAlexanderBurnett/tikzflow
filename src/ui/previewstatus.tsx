// The accurate preview's state in the summary bar (M3 step 8, D68): compiling,
// TeX's errors with links to their lines, and notices (packages left out,
// fonts). And the toolbar switch between the accurate and the quick preview.

import { useSignal } from "@preact/signals";
import { compiled, compiling, engineState, freshCompiled, previewErrors, previewMode, previewNotices, setPreviewMode, showPreviewError } from "./preview.ts";

export function PreviewStatus() {
  const open = useSignal(false);
  if (previewMode.value !== "accurate") return null;
  const state = engineState.value;
  if (state.kind === "unavailable") {
    return (
      <span class="tf-preview-state off" data-testid="preview-state" title={state.reason}>
        Quick preview only: the TeX engine isn't available
      </span>
    );
  }
  const errors = previewErrors.value;
  const notices = previewNotices.value;
  const fresh = !!freshCompiled.value;
  const busy = state.kind === "loading" || compiling.value || (!fresh && !!compiled.value);
  const label = state.kind === "loading" ? "Loading TeX…" : busy ? "Compiling…" : errors.length ? `TeX: ${errors.length} ${errors.length === 1 ? "error" : "errors"}` : notices.length ? "TeX preview: notes" : "TeX preview";
  const ms = compiled.value?.outcome.timing.totalMs;
  return (
    <span class="tf-preview">
      <button
        class={`tf-preview-state${errors.length ? " errors" : ""}${busy ? " busy" : ""}`}
        data-testid="preview-state"
        disabled={!errors.length && !notices.length}
        onClick={() => (open.value = !open.value)}
        title={ms ? `The accurate preview, compiled by TeX in ${Math.round(ms)} ms` : "The accurate preview, compiled by TeX"}
      >
        {label}
      </button>
      {open.value && (errors.length > 0 || notices.length > 0) && (
        <div class="tf-preview-details" data-testid="preview-details">
          {errors.length > 0 && (
            <>
              <h3>TeX's errors</h3>
              <p>TeX carried on past them; what it could draw is shown.</p>
              <ul data-testid="tex-errors">
                {errors.map((e) => (
                  <li>
                    {e.sourceLine !== null ? (
                      <button class="link" onClick={() => showPreviewError(e)}>
                        Line {e.sourceLine}
                      </button>
                    ) : (
                      <span class="where">{e.file && e.file !== "input.tex" ? `In ${e.file}` : "In the preview's setup"}</span>
                    )}
                    : {e.message}
                    {e.context && <code>{e.context.trim()}</code>}
                  </li>
                ))}
              </ul>
            </>
          )}
          {notices.length > 0 && (
            <>
              <h3>Notes</h3>
              <ul data-testid="preview-notices">
                {notices.map((n) => (
                  <li>{n}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </span>
  );
}

export function PreviewToggle() {
  const accurate = previewMode.value === "accurate";
  return (
    <label class="tf-preview-toggle" title="Show the picture as TeX draws it (accurate), or only the editor's own drawing (quick)">
      <input type="checkbox" checked={accurate} onChange={(e) => setPreviewMode((e.target as HTMLInputElement).checked ? "accurate" : "quick")} data-testid="preview-toggle" />
      TeX preview
    </label>
  );
}
