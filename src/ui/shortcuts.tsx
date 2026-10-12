// The keyboard shortcut reference (M5 step 5, D96): `?` anywhere outside a text field, or the
// app bar's keyboard button, shows every key the editor answers to, with Cmd for Ctrl on a Mac.

import { signal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";

export const shortcutsOpen = signal(false);

/** On a Mac, Ctrl in the editor's own shortcuts is Cmd (the code pane follows CodeMirror's rule, the same). */
export function isMac(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /mac|iphone|ipad/i.test(nav.userAgentData?.platform ?? navigator.platform ?? "");
}

/** "Mod" in a key list is Ctrl, or ⌘ on a Mac. */
const keyName = (k: string, mac: boolean) => (k === "Mod" ? (mac ? "⌘" : "Ctrl") : k === "Alt" && mac ? "Option" : k);

/** A row: one or more key combinations (each a list of keys pressed together), and what they do. */
type Row = [combos: string[][], what: string];

const SECTIONS: Array<{ title: string; note?: string; rows: Row[] }> = [
  {
    title: "Anywhere",
    rows: [
      [[["?"]], "Show or hide this list"],
      [[["Mod", "S"]], "Save (to the file, else a download)"],
      [[["Mod", "Z"]], "Undo, in the code and on the canvas"],
      [[["Mod", "Y"], ["Mod", "Shift", "Z"]], "Redo"],
      [[["Esc"]], "Close a menu, panel or this list"],
    ],
  },
  {
    title: "Canvas",
    note: "Click the canvas first.",
    rows: [
      [[["Tab"]], "Add a node connected after the selected one (in an empty picture, the first node)"],
      [[["Enter"]], "Add a node beside the selected one"],
      [[["F2"]], "Edit the selected node's label (or double-click it)"],
      [[["Delete"], ["Backspace"]], "Delete the selection; what depended on it is re-attached or pinned"],
      [[["Menu"], ["Shift", "F10"]], "Open the selected edge's menu"],
      [[["Space", "drag"]], "Pan"],
    ],
  },
  {
    title: "Mouse",
    rows: [
      [[["Shift", "click"]], "Add to the selection, or take out of it"],
      [[["Alt", "drag"]], "Move or resize without snapping"],
      [[["Mod", "drag"]], "Resize from the center (on a resize handle)"],
      [[["Right-drag"], ["Middle-drag"]], "Pan (dragging the background does too)"],
      [[["Wheel"]], "Zoom, about the pointer"],
      [[["Right-click"]], "An edge's menu"],
      [[["Double-click"]], "Edit a label; on an edge's corner, remove it"],
      [[["Middle-click"]], "On a tab, close it"],
    ],
  },
  {
    title: "Tabs",
    note: "With a tab focused.",
    rows: [[[["←"], ["→"]], "Show the tab before or after"]],
  },
  {
    title: "Editing a label",
    rows: [
      [[["Enter"]], "Apply"],
      [[["Shift", "Enter"]], "New line"],
      [[["Tab"]], "Apply and add the next connected node"],
      [[["Esc"]], "Cancel"],
    ],
  },
  {
    title: "Edge menu",
    rows: [
      [[["↑"], ["↓"]], "Move between items"],
      [[["Enter"], ["Space"]], "Choose"],
      [[["→"], ["←"]], "Open or leave a submenu (the anchors)"],
    ],
  },
  {
    title: "Code",
    rows: [
      [[["Mod", "F"]], "Find and replace"],
      [[["Tab"], ["Shift", "Tab"]], "Indent, outdent"],
      [[["Esc"]], "Then Tab: leave the code pane by keyboard (Tab alone indents)"],
    ],
  },
];

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
          <button class="link" onClick={close} data-testid="shortcuts-close">
            Close
          </button>
        </div>
        <div class="sections">
          {SECTIONS.map((s) => (
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
