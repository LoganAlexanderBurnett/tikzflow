// The accurate preview's state in the summary bar (M3 step 8, D68): compiling,
// TeX's errors with links to their lines, and notices (packages left out,
// fonts). And the toolbar switch between the accurate and the quick preview.

import { useSignal } from "@preact/signals";
import { compiled, compiling, engineState, freshCompiled, previewErrors, previewMode, previewNotices, setPreviewMode, shownErrors, showPreviewError } from "./preview.ts";

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
                    ) : e.preambleLine !== null ? (
                      <span class="where">In the imported preamble, line {e.preambleLine}</span>
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

/**
 * Over the canvas while TeX's picture is shown and TeX reported errors: the picture may be badly wrong
 * (undefined nodes sit at the origin, so lines shoot there), and the quick preview is one click away.
 */
export function TexBanner() {
  const errors = shownErrors.value;
  if (!errors.length) return null;
  const first = errors.find((e) => e.sourceLine !== null);
  return (
    <div class="tf-tex-banner" role="status" data-testid="tex-banner">
      <span>
        LaTeX found {errors.length} {errors.length === 1 ? "error" : "errors"} and would stop at the first; this picture shows what it drew anyway.
      </span>
      {first && (
        <button onClick={() => showPreviewError(first)} data-testid="tex-banner-first">
          Show the first error
        </button>
      )}
      <button onClick={() => setPreviewMode("quick", false)} data-testid="tex-banner-quick" title="Switch back to the editor's own drawing; the TeX preview box in the toolbar brings TeX's picture back">
        Show the quick preview
      </button>
    </div>
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
