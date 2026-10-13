// The empty state (M5 step 5, D89 item 5, D96). When there is no code (a first visit, or every line
// deleted) the canvas offers three ways to start: Paste TikZ, Start blank and Start from a template.
// Pasting anywhere outside a text field while it shows does what Paste TikZ does.

import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { BLANK_ID } from "../templates/index.ts";
import { openPasted, openTemplate } from "./files.ts";
import { Icon } from "./icons.tsx";
import { TemplateGrid } from "./newpanel.tsx";
import { isMac, shortcutsOpen } from "./shortcuts.tsx";
import { editorView, status, text } from "./store.ts";

/** Paste TikZ: the clipboard's text, where the browser allows reading it; else the code pane, ready for Ctrl+V. */
async function pasteTikz(): Promise<void> {
  let t = "";
  try {
    t = (await navigator.clipboard?.readText?.()) ?? "";
  } catch {
    // Refused, or not offered here: the code pane takes a paste instead.
  }
  if (t.trim()) {
    await openPasted(t);
    return;
  }
  editorView()?.focus();
  status.value = `Paste with ${isMac() ? "⌘V" : "Ctrl+V"}: the code pane is ready.${t ? " The clipboard holds no text." : ""}`;
}

export function EmptyState() {
  const templates = useSignal(false);
  const empty = !text.value.trim();
  // While it shows, a paste outside the code pane and the fields is taken as Paste TikZ.
  useEffect(() => {
    if (!empty) return;
    const onPaste = (e: ClipboardEvent) => {
      if ((e.target as Element | null)?.closest?.(".cm-editor, textarea, input, select")) return;
      const t = e.clipboardData?.getData("text/plain") ?? "";
      if (!t.trim()) return;
      e.preventDefault();
      void openPasted(t);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [empty]);
  if (!empty) return null;
  return (
    <div class="tf-start" data-testid="empty-state">
      <div class="card" role="region" aria-labelledby="tf-empty-title">
        <h2 id="tf-empty-title">Start a diagram</h2>
        <p class="lead">Everything stays in this browser: nothing you draw is uploaded.</p>
        <div class="choices">
          <button class="choice" onClick={() => void pasteTikz()} data-testid="start-paste">
            <Icon name="paste" size={22} />
            <span class="name">Paste TikZ</span>
            <span class="blurb">A tikzpicture or a whole .tex file. Mermaid and DOT are imported.</span>
          </button>
          <button class="choice" onClick={() => void openTemplate(BLANK_ID)} data-testid="start-blank">
            <Icon name="file" size={22} />
            <span class="name">Start blank</span>
            <span class="blurb">An empty picture. Add shapes from the palette; Tab adds a connected one.</span>
          </button>
          <button class="choice" onClick={() => (templates.value = !templates.value)} aria-expanded={templates.value} data-testid="start-template">
            <Icon name="template" size={22} />
            <span class="name">Start from a template</span>
            <span class="blurb">Thirteen flowcharts and diagrams, ready to adapt.</span>
          </button>
        </div>
        {templates.value && <TemplateGrid onPick={(id) => void openTemplate(id)} prefix="start" blank={false} />}
        <p class="note">
          Or <b>Open…</b> a file, or drop one here.{" "}
          <button class="link" onClick={() => (shortcutsOpen.value = true)}>
            Keyboard shortcuts
          </button>{" "}
          (<kbd>?</kbd>)
        </p>
      </div>
    </div>
  );
}
