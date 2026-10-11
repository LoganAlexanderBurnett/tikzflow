// The Import button (M4 step 5, D84): paste or choose a Mermaid flowchart or a
// Graphviz DOT graph; it is read, written as TikZ and laid out here, and
// replaces the work on screen, which is put aside like Open does (D77 item 5).

import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import type { LayoutDirection } from "../edit/autolayout.ts";
import { detectFormat, IMPORT_EXTENSIONS, type ImportResult } from "../import/index.ts";
import { importSource } from "./files.ts";

const EXAMPLE = "flowchart TD\n  start([Start]) --> check{In stock?}\n  check -->|yes| ship[Ship it]\n  check -->|no| wait[Back-order]\n  wait --> check";

type Choice = "source" | LayoutDirection;

export function ImportButton() {
  const open = useSignal(false);
  const source = useSignal("");
  const direction = useSignal<Choice>("source");
  const busy = useSignal(false);
  const failure = useSignal<string | null>(null);
  const done = useSignal<(ImportResult & { ok: true }) | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const at = useSignal({ top: 44, left: 10 });

  const format = source.value.trim() ? detectFormat(source.value) : null;

  const run = async (src: string, name: string | null) => {
    busy.value = true;
    failure.value = null;
    done.value = null;
    try {
      const r = await importSource(src, name, direction.value === "source" ? {} : { direction: direction.value });
      if (r.ok) done.value = r;
      else failure.value = r.reason;
    } catch (e) {
      failure.value = `The import failed: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      busy.value = false;
    }
  };

  return (
    <span class="tf-import">
      <button
        ref={button}
        onClick={() => {
          const r = button.current?.getBoundingClientRect();
          if (r) at.value = { top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 460)) };
          open.value = !open.value;
          if (open.value) {
            failure.value = null;
            done.value = null;
          }
        }}
        aria-expanded={open.value}
        data-testid="import-button"
        title="Import a Mermaid flowchart or a Graphviz DOT graph as TikZ"
      >
        Import
      </button>
      {open.value && (
        <div class="tf-page-panel tf-import-panel" data-testid="import-panel" style={{ top: `${at.value.top}px`, left: `${at.value.left}px` }} onKeyDown={(e) => e.key === "Escape" && (open.value = false)}>
          <div class="head">
            <h3>Import a diagram</h3>
            <button class="link" onClick={() => (open.value = false)} aria-label="Close">
              Close
            </button>
          </div>
          {done.value ? (
            <div data-testid="import-done">
              <p>
                Imported {done.value.format === "mermaid" ? "a Mermaid flowchart" : "a Graphviz graph"}: {done.value.nodes} node{done.value.nodes === 1 ? "" : "s"}, {done.value.edges} edge{done.value.edges === 1 ? "" : "s"}
                {done.value.groups ? `, ${done.value.groups} group${done.value.groups === 1 ? "" : "s"}` : ""}. {done.value.laidOut ? "Laid out and written as relative positions." : "The nodes couldn't be laid out automatically; use Layout in the toolbar."}
              </p>
              {done.value.notes.length > 0 && (
                <>
                  <h4>Left out or approximated</h4>
                  <ul data-testid="import-notes">
                    {done.value.notes.map((n) => (
                      <li>{n}</li>
                    ))}
                  </ul>
                </>
              )}
              <p class="note">The work that was on screen is kept: Restore previous work in the toolbar brings it back. Ctrl+Z undoes the import too.</p>
              <div class="row">
                <button onClick={() => (open.value = false)} data-testid="import-close">
                  Done
                </button>
                <button
                  class="link"
                  onClick={() => {
                    done.value = null;
                    source.value = "";
                  }}
                >
                  Import another
                </button>
              </div>
            </div>
          ) : (
            <>
              <p class="note">
                Paste a Mermaid flowchart (<code>graph TD</code>, <code>flowchart LR</code>) or a Graphviz graph (<code>digraph</code>, <code>graph</code>). It becomes TikZ in this browser, laid out with <code>below=of</code> and <code>right=of</code>, and replaces the code on screen. Nothing is uploaded.
              </p>
              <textarea
                data-testid="import-source"
                rows={9}
                spellcheck={false}
                placeholder={EXAMPLE}
                value={source.value}
                onInput={(e) => {
                  source.value = (e.target as HTMLTextAreaElement).value;
                  failure.value = null;
                }}
              />
              <p class="note" data-testid="import-format">
                {!source.value.trim() ? "Mermaid or DOT: the format is found from the first line." : format === "mermaid" ? "Looks like a Mermaid flowchart." : format === "dot" ? "Looks like a Graphviz DOT graph." : "This doesn't look like Mermaid or DOT yet."}
              </p>
              <div class="row">
                <label>
                  Direction{" "}
                  <select value={direction.value} onChange={(e) => (direction.value = (e.target as HTMLSelectElement).value as Choice)} data-testid="import-direction">
                    <option value="source">As in the diagram</option>
                    <option value="down">Top to bottom</option>
                    <option value="right">Left to right</option>
                  </select>
                </label>
              </div>
              {failure.value && (
                <p class="note bad" role="alert" data-testid="import-error">
                  {failure.value}
                </p>
              )}
              <div class="row">
                <button disabled={busy.value || !source.value.trim()} onClick={() => void run(source.value, null)} data-testid="import-run">
                  {busy.value ? "Importing…" : "Import"}
                </button>
                <button
                  disabled={busy.value}
                  onClick={() => picker.current?.click()}
                  title="Choose a .mmd, .mermaid, .dot or .gv file and import it"
                  data-testid="import-choose"
                >
                  Choose a file…
                </button>
                <input
                  ref={picker}
                  type="file"
                  accept={`${IMPORT_EXTENSIONS.join(",")},.txt`}
                  hidden
                  data-testid="import-file"
                  onChange={(e) => {
                    const f = (e.target as HTMLInputElement).files?.[0];
                    (e.target as HTMLInputElement).value = "";
                    if (f) void f.text().then((t) => run(t, f.name));
                  }}
                />
              </div>
              <p class="note">The work on screen is put aside, as Open does: Restore previous work brings it back, and Ctrl+Z undoes the import.</p>
            </>
          )}
        </div>
      )}
    </span>
  );
}
