// The keyboard shortcut reference (M5 step 5, D96): `?` anywhere outside a text field, or the
// app bar's keyboard button, shows every key the editor answers to, with Cmd for Ctrl on a Mac.

import { signal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { SHORTCUT_SECTIONS } from "./shortcutlist.ts";

export const shortcutsOpen = signal(false);

/** On a Mac, Ctrl in the editor's own shortcuts is Cmd (the code pane follows CodeMirror's rule, the same). */
export function isMac(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /mac|iphone|ipad/i.test(nav.userAgentData?.platform ?? navigator.platform ?? "");
}

/** "Mod" in a key list is Ctrl, or ⌘ on a Mac. */
const keyName = (k: string, mac: boolean) => (k === "Mod" ? (mac ? "⌘" : "Ctrl") : k === "Alt" && mac ? "Option" : k);

/** What the mouse does, written as words rather than keys. */
const MOUSE = new Set(["click", "drag", "Right-drag", "Middle-drag", "Wheel", "Right-click", "Double-click"]);

function Keys({ combo, mac }: { combo: string[]; mac: boolean }) {
  return (
    <span class="combo">
      {combo.map((k, i) => (
        <>
          {i > 0 && <span class="plus">+</span>}
          {MOUSE.has(k) ? <span class="act">{k}</span> : <kbd>{keyName(k, mac)}</kbd>}
        </>
      ))}
    </span>
  );
}

/** The list, as a dialog over the editor. Focus comes back to where it was when it closes. */
export function ShortcutsDialog() {
  const box = useRef<HTMLDivElement>(null);
  const open = shortcutsOpen.value;
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    box.current?.focus();
    return () => before?.focus?.({ preventScroll: true });
  }, [open]);
  if (!open) return null;
  const mac = isMac();
  const close = () => (shortcutsOpen.value = false);
  return (
    <div class="tf-shortcuts-backdrop" onClick={(e) => e.target === e.currentTarget && close()}>
      <div
        class="tf-shortcuts"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tf-shortcuts-title"
        tabindex={-1}
        ref={box}
        data-testid="shortcuts"
        onKeyDown={(e) => {
          if (e.key === "Escape" || (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey)) {
            e.preventDefault();
            e.stopPropagation();
            close();
          }
        }}
      >
        <div class="head">
          <h2 id="tf-shortcuts-title">Keyboard shortcuts</h2>
          <a class="link" href="/help/shortcuts/" target="_blank" rel="noopener" data-testid="shortcuts-help">In the help</a>
          <button class="link" onClick={close} data-testid="shortcuts-close">
            Close
          </button>
        </div>
        <div class="sections">
          {SHORTCUT_SECTIONS.map((s) => (
            <section>
              <h3>{s.title}</h3>
              {s.note && <p class="note">{s.note}</p>}
              <dl>
                {s.rows.map(([combos, what]) => (
                  <div class="row">
                    <dt>
                      {combos.map((c, i) => (
                        <>
                          {i > 0 && <span class="or">or</span>}
                          <Keys combo={c} mac={mac} />
                        </>
                      ))}
                    </dt>
                    <dd>{what}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A key press that should open the list: `?` typed outside a text field. */
export function isShortcutsKey(e: KeyboardEvent): boolean {
  if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey) return false;
  const t = e.target as Element | null;
  return !t?.closest?.(".cm-editor, textarea, input, select, [contenteditable=''], [contenteditable='true']");
}
