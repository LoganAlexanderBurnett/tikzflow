// The tab bar (M5 step 6, D97): one tab per open diagram, a + for a new one, and Recently closed. Also the
// banner shown over the canvas while another window is editing the diagram on screen.

import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { tabName } from "./docs.ts";
import { Icon } from "./icons.tsx";
import { editLock, fileName, text } from "./store.ts";
import { activeId, activeTitle, closedTabs, closeTab, elsewhere, newTab, refreshClosed, reopenClosed, savedText, switchTab, type Tab, tabs, tabsVersion, takeOver } from "./tabs.ts";

/** "5 minutes ago". */
function ago(ms: number): string {
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  let v = (ms - Date.now()) / 1000;
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [["second", 60], ["minute", 60], ["hour", 24], ["day", 7], ["week", 4.35], ["month", 12], ["year", Infinity]];
  for (const [unit, size] of steps) {
    if (Math.abs(v) < size) return rtf.format(Math.round(v), unit);
    v /= size;
  }
  return "";
}

function TabItem({ tab, active }: { tab: Tab; active: boolean }) {
  const name = active ? (fileName.value ?? activeTitle.value) : tabName(tab.rec);
  const file = active ? fileName.value : tab.rec.fileName;
  const changed = active ? text.value !== savedText.value : tab.rec.text !== tab.rec.savedText;
  const away = elsewhere.value.has(tab.id);
  const tip = [
    file ? (changed ? `${file}: changed since it was opened or saved` : `${file}: saved`) : `${name}: kept in this browser as you type; Save writes a file`,
    away ? "Open in another window too" : "",
  ]
    .filter(Boolean)
    .join(". ");
  return (
    <div class={`tf-tab${active ? " active" : ""}${away ? " away" : ""}`} data-testid="tab" data-tab={tab.id}>
      <button
        class="name"
        role="tab"
        aria-selected={active}
        tabIndex={active ? 0 : -1}
        title={tip}
        onClick={() => void switchTab(tab.id)}
        onAuxClick={(e) => {
          if (e.button === 1) {
            e.preventDefault();
            void closeTab(tab.id);
          }
        }}
        {...(active ? { "data-testid": "file-name" } : {})}
      >
        {away && <span class="away-dot" aria-label="open in another window" />}
        {name}
        {changed && file ? " ●" : ""}
      </button>
      <button class="close" aria-label={`Close ${name}`} title="Close this tab (its work goes to Recently closed)" onClick={() => void closeTab(tab.id)} data-testid="tab-close">
        ×
      </button>
    </div>
  );
}

function ClosedMenu() {
  const open = useSignal(false);
  const button = useRef<HTMLButtonElement>(null);
  const at = useSignal({ top: 44, left: 10 });
  useEffect(() => {
    if (!open.value) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as Element).closest?.(".tf-closed-panel, .tf-closed-button")) open.value = false;
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open.value]);
  const list = closedTabs.value;
  if (!list.length && !open.value) return null;
  return (
    <>
      <button
        ref={button}
        class="tf-icon-button tf-closed-button"
        aria-label="Recently closed"
        title="Recently closed tabs"
        aria-expanded={open.value}
        data-testid="closed-button"
        onClick={() => {
          const r = button.current?.getBoundingClientRect();
          if (r) at.value = { top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 340)) };
          if (!open.value) void refreshClosed();
          open.value = !open.value;
        }}
      >
        <Icon name="restore" size={16} />
      </button>
      {open.value && (
        <div class="tf-page-panel tf-closed-panel" role="dialog" aria-label="Recently closed" data-testid="closed-panel" style={{ top: `${at.value.top}px`, left: `${at.value.left}px` }} onKeyDown={(e) => e.key === "Escape" && (open.value = false)}>
          <div class="head">
            <h3>Recently closed</h3>
            <button class="link" onClick={() => (open.value = false)} aria-label="Close">
              Close
            </button>
          </div>
          {list.length ? (
            <ul>
              {list.map((c) => (
                <li>
                  <button
                    class="link"
                    data-testid="closed-item"
                    onClick={() => {
                      open.value = false;
                      void reopenClosed(c.id);
                    }}
                  >
                    {tabName(c)}
                  </button>{" "}
                  <span class="when">closed {ago(c.closedAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p class="note">Nothing closed yet.</p>
          )}
          <p class="note">The last 20 tabs closed with work in them are kept in this browser. Reopening one opens it in a new tab.</p>
        </div>
      )}
    </>
  );
}

export function TabBar() {
  void tabsVersion.value;
  const list = tabs.value;
  const active = activeId.value;
  return (
    <div class="tf-tabs" data-testid="tabs">
      <div
        class="list"
        role="tablist"
        aria-label="Open diagrams"
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          const i = list.findIndex((t) => t.id === active);
          const next = list[(i + (e.key === "ArrowRight" ? 1 : list.length - 1)) % list.length];
          if (!next) return;
          e.preventDefault();
          void switchTab(next.id).then(() => (document.querySelector(`[data-tab="${next.id}"] .name`) as HTMLElement | null)?.focus());
        }}
      >
        {list.map((t) => (
          <TabItem key={t.id} tab={t} active={t.id === active} />
        ))}
      </div>
      <button class="tf-icon-button tf-tab-new" aria-label="New tab" title="New tab" onClick={() => void newTab()} data-testid="tab-new">
        +
      </button>
      <ClosedMenu />
    </div>
  );
}

/** Over the canvas while another window is editing the diagram on screen. */
export function LockBanner() {
  if (!editLock.value) return null;
  return (
    <div class="tf-tex-banner tf-lock-banner" role="status" data-testid="lock-banner">
      <span>This diagram is open for editing in another window, so it is read-only here. Changes made there show here as they are saved.</span>
      <button onClick={() => void takeOver()} data-testid="edit-here">
        Edit here
      </button>
    </div>
  );
}
