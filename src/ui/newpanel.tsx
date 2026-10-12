// The toolbar's New menu (D95): a blank diagram or one of the templates, with the thumbnails the
// home page shows. What was on screen is put aside, as Open does (a new tab in step 6). The same
// cards are on the empty state's "Start from a template" (D96).

import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { BLANK_ID, TEMPLATES } from "../templates/index.ts";
import { openTemplate } from "./files.ts";
import { Icon } from "./icons.tsx";

const THUMBS = import.meta.glob("../site/thumbs/*.svg", { query: "?url", import: "default", eager: true }) as Record<string, string>;

/** A blurb with `code` in backticks, as text and <code>. */
function Blurb({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]*`)/).map((part) => (part.startsWith("`") && part.endsWith("`") && part.length > 1 ? <code>{part.slice(1, -1)}</code> : part))}
    </>
  );
}

/** The templates as cards, each with its thumbnail; the blank diagram first unless `blank` is false. Test ids are `<prefix>-<id>`. */
export function TemplateGrid({ onPick, prefix, blank = true }: { onPick: (id: string) => void; prefix: string; blank?: boolean }) {
  return (
    <div class="tf-new-grid">
      {blank && (
        <button class="tf-new-card" onClick={() => onPick(BLANK_ID)} data-testid={`${prefix}-blank`}>
          <span class="thumb blank" aria-hidden="true" />
          <span class="name">Blank diagram</span>
          <span class="blurb">An empty picture, ready for the palette.</span>
        </button>
      )}
      {TEMPLATES.map((t) => (
        <>
          {t.section && (
            <h4 class="tf-new-heading" data-testid={`${prefix}-section`}>
              {t.section}
            </h4>
          )}
          <button class="tf-new-card" onClick={() => onPick(t.id)} data-testid={`${prefix}-${t.id}`}>
            <span class="thumb">
              <img src={THUMBS[`../site/thumbs/${t.id}.svg`]} alt="" loading="lazy" />
            </span>
            <span class="name">{t.title}</span>
            <span class="blurb">
              <Blurb text={t.blurb} />
            </span>
          </button>
        </>
      ))}
    </div>
  );
}

export function NewButton() {
  const open = useSignal(false);
  const button = useRef<HTMLButtonElement>(null);
  const at = useSignal({ top: 44, left: 10 });
  const pick = (id: string) => {
    open.value = false;
    void openTemplate(id);
  };
  return (
    <span class="tf-new">
      <button
        ref={button}
        onClick={() => {
          const r = button.current?.getBoundingClientRect();
          if (r) at.value = { top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 660)) };
          open.value = !open.value;
        }}
        aria-expanded={open.value}
        data-testid="new-button"
        title="Start a blank diagram or one from a template"
      >
        <Icon name="file" />New
      </button>
      {open.value && (
        <div
          class="tf-page-panel tf-new-panel"
          role="dialog"
          aria-label="New diagram"
          data-testid="new-panel"
          style={{ top: `${at.value.top}px`, left: `${at.value.left}px` }}
          onKeyDown={(e) => e.key === "Escape" && (open.value = false)}
        >
          <div class="head">
            <h3>New diagram</h3>
            <button class="link" onClick={() => (open.value = false)} aria-label="Close">
              Close
            </button>
          </div>
          <p class="note">It opens in a new tab (or in this one, if it is empty).</p>
          <TemplateGrid onPick={pick} prefix="new" />
        </div>
      )}
    </span>
  );
}
