// The Share button (M3 step 13, D74): a link that carries the code in its
// fragment. Nothing is uploaded and nothing is stored: the link is the picture.

import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { canShare, shareLink } from "./share.ts";
import { currentPicture, text } from "./store.ts";

/** Links longer than this get cut by some chat and mail programs. */
const LONG_LINK = 8000;

export function ShareButton() {
  const open = useSignal(false);
  const link = useSignal("");
  const message = useSignal<{ kind: "ok" | "error"; text: string } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const at = useSignal({ top: 44, left: 10 });
  const field = useRef<HTMLInputElement>(null);
  if (!canShare()) return null;

  const make = async () => {
    link.value = await shareLink(text.value, currentPicture.value);
    message.value = null;
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link.value);
      message.value = { kind: "ok", text: "Copied the link." };
    } catch {
      field.current?.select();
      message.value = { kind: "error", text: "The browser wouldn't let the page copy. The link is selected: press Ctrl+C." };
    }
  };
  return (
    <span class="tf-share">
      <button
        ref={button}
        onClick={() => {
          const r = button.current?.getBoundingClientRect();
          if (r) at.value = { top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 440)) };
          open.value = !open.value;
          if (open.value) void make();
        }}
        aria-expanded={open.value}
        data-testid="share-button"
        title="A link that carries your code in the address itself, with no upload"
      >
        Share
      </button>
      {open.value && (
        <div class="tf-page-panel tf-share-panel" data-testid="share-panel" style={{ top: `${at.value.top}px`, left: `${at.value.left}px` }} onKeyDown={(e) => e.key === "Escape" && (open.value = false)}>
          <div class="head">
            <h3>Share a link</h3>
            <button class="link" onClick={() => (open.value = false)} aria-label="Close">
              Close
            </button>
          </div>
          <p class="note">
            The link holds your code itself, compressed, in the part of the address after the #. Browsers never send that part to a server, so nothing is uploaded or stored. Anyone with the link can read the code; your pasted preamble and page settings are not included.
          </p>
          <input ref={field} type="text" readOnly value={link.value} onFocus={(e) => (e.target as HTMLInputElement).select()} data-testid="share-link" aria-label="Link" style={{ width: "100%", boxSizing: "border-box" }} />
          <div class="row">
            <button onClick={() => void copy()} disabled={!link.value} data-testid="share-copy">
              Copy link
            </button>
            <span class="note" data-testid="share-size">
              {link.value ? `${link.value.length.toLocaleString("en")} characters` : ""}
            </span>
          </div>
          {link.value.length > LONG_LINK && <p class="note bad">This link is long. Some chat and mail programs cut long links; send the file instead if the picture doesn't open.</p>}
          {message.value && (
            <p class={message.value.kind === "error" ? "note bad" : "note"} data-testid="share-message">
              {message.value.text}
            </p>
          )}
        </div>
      )}
    </span>
  );
}
