// The page panel and the width guide (M3 step 10, D71). The panel takes the
// preamble of the user's paper (for the TeX preview and the page widths) and
// chooses what the guide on the canvas shows; the guide is two dashed lines
// one column apart, centred on the figure, red when the figure is wider.

import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { describeWidth, type PageGeometry } from "../tikz/page.ts";
import { evalLength, PT_PER_UNIT } from "../tikz/units.ts";
import { customWidth, figureWidth, guide, guideOn, guideWidth, importedPreamble, pageInfo, pagePreamble, setGuide, setImportedPreamble } from "./page.ts";

const f = (v: number) => Math.round(v * 100) / 100;

/** The guide, drawn behind everything else on the canvas. `cx` is the figure's middle, `y0`..`y1` the visible rows (SVG coordinates). */
export function WidthGuide({ cx, y0, y1, scale }: { cx: number; y0: number; y1: number; scale: number }) {
  const g = guide.value;
  if (!g) return null;
  const fig = figureWidth.value;
  const over = fig !== null && fig > g.width + 0.5;
  const left = cx - g.width / 2;
  const right = cx + g.width / 2;
  const px = 1 / scale;
  const y = y1 - 10 * px;
  const label = `${g.name} ${describeWidth(g.width)}${over ? `: the figure is ${f(((fig ?? 0) - g.width) / PT_PER_UNIT.mm!)} mm too wide` : ""}`;
  return (
    <g class={`tf-width-guide${over ? " over" : ""}`} data-testid="width-guide" pointer-events="none">
      <line x1={f(left)} x2={f(left)} y1={f(y0)} y2={f(y1)} stroke-width={f(1.2 * px)} stroke-dasharray={`${f(6 * px)} ${f(4 * px)}`} />
      <line x1={f(right)} x2={f(right)} y1={f(y0)} y2={f(y1)} stroke-width={f(1.2 * px)} stroke-dasharray={`${f(6 * px)} ${f(4 * px)}`} />
      <line x1={f(left)} x2={f(right)} y1={f(y)} y2={f(y)} stroke-width={f(1 * px)} />
      <text x={f(cx)} y={f(y - 4 * px)} font-size={f(11 * px)} text-anchor="middle" stroke="none">
        {label}
      </text>
    </g>
  );
}

/** The toolbar's Page button and its panel. */
export function PageButton() {
  const open = useSignal(false);
  const button = useRef<HTMLButtonElement>(null);
  // The toolbar scrolls sideways, which clips what hangs below it: the panel is placed on the window instead.
  const at = useSignal({ top: 44, left: 10 });
  const info = pageInfo.value;
  const g = guide.value;
  return (
    <span class="tf-page">
      <button
        ref={button}
        onClick={() => {
          const r = button.current?.getBoundingClientRect();
          if (r) at.value = { top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 460)) };
          open.value = !open.value;
        }}
        data-testid="page-button" aria-expanded={open.value} title="The page your figure goes on: your paper's preamble and a column-width guide">
        Page{g ? `: ${describeWidth(g.width).split(" (")[0]}` : ""}
      </button>
      {open.value && <PagePanel onClose={() => (open.value = false)} info={info} at={at.value} />}
    </span>
  );
}

function PagePanel({ onClose, info, at }: { onClose: () => void; info: PageGeometry | null; at: { top: number; left: number } }) {
  const source = pagePreamble.value;
  const fig = figureWidth.value;
  const g = guide.value;
  const customOk = customWidth.value.trim() === "" || evalLength(customWidth.value) !== null;
  return (
    <div class="tf-page-panel" data-testid="page-panel" style={{ top: `${at.top}px`, left: `${at.left}px` }} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div class="head">
        <h3>The page</h3>
        <button class="link" onClick={onClose} aria-label="Close">
          Close
        </button>
      </div>

      <section>
        <h4>Your paper's preamble</h4>
        {source?.from === "code" ? (
          <p class="note" data-testid="page-source">
            The code in the code pane has its own preamble, so that one is used. Remove it to use an imported one.
          </p>
        ) : (
          <>
            <p class="note">
              Paste what comes before <code>\begin{"{document}"}</code> in your paper (or the whole file). The TeX preview uses it, so your macros, packages and lengths apply. It stays in this browser and is not part of the figure's code.
            </p>
            <textarea
              data-testid="page-preamble"
              rows={8}
              spellcheck={false}
              placeholder={"\\documentclass[twocolumn]{article}\n\\usepackage[margin=1in]{geometry}\n\\newcommand{\\state}[1]{\\mathbf{#1}}"}
              value={importedPreamble.value}
              onInput={(e) => setImportedPreamble((e.target as HTMLTextAreaElement).value)}
            />
            {importedPreamble.value && (
              <button class="link" onClick={() => setImportedPreamble("")} data-testid="page-clear">
                Clear the preamble
              </button>
            )}
            <p class="note">
              Styles and macros defined only here are used by the TeX preview, not by the quick preview or the editing tools. Fonts: the preview always uses Computer Modern.
            </p>
          </>
        )}
      </section>

      <section>
        <h4>What it says about the width</h4>
        {info && info.notes.length > 0 ? (
          <ul data-testid="page-notes">
            {info.notes.map((n) => (
              <li>{n}</li>
            ))}
          </ul>
        ) : (
          <p class="note">Nothing yet: there is no preamble. You can type a width below.</p>
        )}
        {info && (info.textWidth !== null || info.columnWidth !== null) && (
          <p data-testid="page-widths">
            {info.columnWidth !== null && (
              <>
                <code>\columnwidth</code> {describeWidth(info.columnWidth)}
                <br />
              </>
            )}
            {info.textWidth !== null && info.textWidth !== info.columnWidth && (
              <>
                <code>\textwidth</code> {describeWidth(info.textWidth)}
                <br />
              </>
            )}
            {info.estimated && <span class="note">Worked out from the class's defaults, as LaTeX would; check it against your paper.</span>}
          </p>
        )}
      </section>

      <section>
        <h4>Guide on the canvas</h4>
        <label class="row">
          <input type="checkbox" checked={guideOn.value} onChange={(e) => setGuide({ on: (e.target as HTMLInputElement).checked })} data-testid="guide-on" /> Show the width guide
        </label>
        <div class="choices" role="radiogroup" aria-label="Width to show">
          <label>
            <input type="radio" name="guide-width" checked={guideWidth.value === "column"} onChange={() => setGuide({ width: "column" })} data-testid="guide-column" /> Column <code>\columnwidth</code>
            {info?.columnWidth ? ` (${describeWidth(info.columnWidth).split(" (")[0]})` : " (unknown)"}
          </label>
          <label>
            <input type="radio" name="guide-width" checked={guideWidth.value === "text"} onChange={() => setGuide({ width: "text" })} data-testid="guide-text" /> Text <code>\textwidth</code>
            {info?.textWidth ? ` (${describeWidth(info.textWidth).split(" (")[0]})` : " (unknown)"}
          </label>
          <label>
            <input type="radio" name="guide-width" checked={guideWidth.value === "custom"} onChange={() => setGuide({ width: "custom" })} data-testid="guide-custom" /> Other:{" "}
            <input
              type="text"
              size={10}
              placeholder="3.4in, 8.5cm, 252pt"
              value={customWidth.value}
              class={customOk ? "" : "bad"}
              onFocus={() => setGuide({ width: "custom" })}
              onInput={(e) => setGuide({ width: "custom", custom: (e.target as HTMLInputElement).value })}
              data-testid="guide-custom-width"
            />
          </label>
        </div>
        {!customOk && <p class="note bad">That isn't a length TikZFlow reads (try 3.4in, 8.5cm or 252pt).</p>}
        {fig !== null && g && (
          <p data-testid="page-fit">
            The figure is {describeWidth(fig)} wide:{" "}
            {fig <= g.width + 0.5 ? `it fits ${g.name} (${describeWidth(g.width)}).` : `${describeWidth(fig - g.width)} wider than ${g.name}.`}
          </p>
        )}
      </section>
    </div>
  );
}
