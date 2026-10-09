// The Export panel (M3 step 11, D72): the picture as a standalone .tex
// document, as a snippet for a paper, and, from TeX's own drawing of it, as SVG,
// PDF and PNG. The picture formats compile the code as it is now (or reuse the
// compile on the canvas) and say when TeX reported errors.

import { signal, useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { tidySvg, svgToPng } from "../export/svg.ts";
import { svgToPdf } from "../export/svg2pdf.ts";
import { snippetTex, standaloneTex, type TexExport } from "../export/tex.ts";
import { importedPreamble } from "./page.ts";
import { compileForExport } from "./preview.ts";
import { currentPicture, doc, fileName, pictureCount } from "./store.ts";

/** What the last export did or why it didn't; shown in the panel. */
const message = signal<{ kind: "ok" | "warn" | "error"; text: string } | null>(null);
const busy = signal(false);

/** The file name without its extension, for the exported files. */
function baseName(): string {
  const base = (fileName.value ?? "").replace(/\.[^.]*$/, "").replace(/[^\w.-]+/g, "-");
  const n = pictureCount.value;
  return `${base || "figure"}${n > 1 ? `-${currentPicture.value + 1}` : ""}`;
}

function save(blob: Blob, name: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const size = (bytes: number) => (bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 102.4) / 10} kB` : `${Math.round(bytes / 104857.6) / 10} MB`);

function saveTex(x: TexExport | null, name: string): void {
  if (!x) return void (message.value = { kind: "error", text: "There is no picture to export." });
  save(new Blob([x.text], { type: "application/x-tex" }), name);
  message.value = { kind: "ok", text: `Saved ${name} (${size(x.text.length)}).${x.notes.map((n) => ` ${n}`).join("")}` };
}

async function copyTex(x: TexExport | null, what: string): Promise<void> {
  if (!x) return void (message.value = { kind: "error", text: "There is no picture to export." });
  try {
    await navigator.clipboard.writeText(x.text);
    message.value = { kind: "ok", text: `Copied the ${what}.${x.notes.map((n) => ` ${n}`).join("")}` };
  } catch {
    message.value = { kind: "error", text: "The browser wouldn't let the page copy. Download it instead." };
  }
}

type Format = "svg" | "pdf" | "png";

async function exportPicture(format: Format, margin: number, dpi: number, transparent: boolean): Promise<void> {
  busy.value = true;
  message.value = null;
  try {
    const compiled = await compileForExport();
    if ("error" in compiled) {
      message.value = { kind: "error", text: compiled.error };
      return;
    }
    const tidy = tidySvg(compiled.outcome.svg!, margin);
    const notes: string[] = [];
    const errors = compiled.outcome.errors.length;
    if (errors) notes.push(`TeX reported ${errors} ${errors === 1 ? "error" : "errors"}; the file shows what it drew anyway.`);
    if (tidy.repairs.length) notes.push("TeX stopped before the end of the picture, so it may be incomplete.");
    let blob: Blob;
    let name: string;
    if (format === "svg") {
      blob = new Blob([tidy.svg], { type: "image/svg+xml" });
      name = `${baseName()}.svg`;
    } else if (format === "pdf") {
      const pdf = await svgToPdf(tidy.svg);
      blob = new Blob([pdf.pdf as BlobPart], { type: "application/pdf" });
      name = `${baseName()}.pdf`;
      if (pdf.warnings.length) notes.push(`Not everything could be converted: ${pdf.warnings.filter((w) => !w.startsWith("The SVG's tags")).join("; ")}.`.replace(": .", "."));
    } else {
      const png = await svgToPng(tidy.svg, tidy, { dpi, transparent });
      blob = png.blob;
      name = `${baseName()}.png`;
      notes.push(`${png.width} × ${png.height} px at ${png.dpi} dpi.${png.dpi < dpi ? " (Lower than asked: the picture is too large for the browser's canvas.)" : ""}`);
    }
    save(blob, name);
    message.value = { kind: errors || tidy.repairs.length ? "warn" : "ok", text: `Saved ${name} (${size(blob.size)}). ${notes.join(" ")}`.trim() };
  } catch (e) {
    message.value = { kind: "error", text: e instanceof Error ? e.message : String(e) };
  } finally {
    busy.value = false;
  }
}

/** The toolbar's Export button and its panel. */
export function ExportButton() {
  const open = useSignal(false);
  const button = useRef<HTMLButtonElement>(null);
  // The toolbar scrolls sideways, which clips what hangs below it: the panel is placed on the window instead.
  const at = useSignal({ top: 44, left: 10 });
  return (
    <span class="tf-export">
      <button
        ref={button}
        data-testid="export-button"
        aria-expanded={open.value}
        title="Save the picture as .tex, SVG, PDF or PNG"
        onClick={() => {
          const r = button.current?.getBoundingClientRect();
          if (r) at.value = { top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 400)) };
          open.value = !open.value;
        }}
      >
        Export
      </button>
      {open.value && <ExportPanel onClose={() => (open.value = false)} at={at.value} />}
    </span>
  );
}

function ExportPanel({ onClose, at }: { onClose: () => void; at: { top: number; left: number } }) {
  const margin = useSignal("2");
  const dpi = useSignal("300");
  const transparent = useSignal(false);
  const index = currentPicture.value;
  const has = doc.value.syntax.pictures.length > 0;
  const m = Number(margin.value);
  const marginOk = margin.value.trim() !== "" && Number.isFinite(m) && m >= 0 && m <= 200;
  const msg = message.value;
  // Built when asked, from the code as it is then.
  const standalone = () => standaloneTex(doc.peek(), index, importedPreamble.peek() || null);
  const snippet = () => snippetTex(doc.peek(), index);
  const run = (format: Format) => void exportPicture(format, m, Number(dpi.value), transparent.value);
  const off = !has || busy.value || !marginOk;
  return (
    <div class="tf-export-panel" data-testid="export-panel" style={{ top: `${at.top}px`, left: `${at.left}px` }} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div class="head">
        <h3>Export{pictureCount.value > 1 ? ` picture ${index + 1} of ${pictureCount.value}` : ""}</h3>
        <button class="link" onClick={onClose} aria-label="Close">
          Close
        </button>
      </div>
      {!has && <p class="note">There is no picture in the code to export.</p>}

      <section>
        <h4>LaTeX</h4>
        <div class="row">
          <span class="what">
            <b>Standalone document</b>
            <span class="note">Compiles by itself: the <code>standalone</code> class, your preamble, the picture.</span>
          </span>
          <button disabled={!has} onClick={() => saveTex(standalone(), `${baseName()}-figure.tex`)} data-testid="export-standalone-download">
            Download
          </button>
          <button disabled={!has} onClick={() => void copyTex(standalone(), "standalone document")} data-testid="export-standalone-copy">
            Copy
          </button>
        </div>
        <div class="row">
          <span class="what">
            <b>Snippet for a paper</b>
            <span class="note">The picture, with the preamble lines it needs in a comment above it.</span>
          </span>
          <button disabled={!has} onClick={() => saveTex(snippet(), `${baseName()}-snippet.tex`)} data-testid="export-snippet-download">
            Download
          </button>
          <button disabled={!has} onClick={() => void copyTex(snippet(), "snippet")} data-testid="export-snippet-copy">
            Copy
          </button>
        </div>
      </section>

      <section>
        <h4>Picture, as TeX draws it</h4>
        <p class="note">Compiled by the TeX engine from the code as it is now. Text is outlines, so the files need no fonts.</p>
        <label class="row">
          Margin around the picture{" "}
          <input type="text" size={4} value={margin.value} class={marginOk ? "" : "bad"} onInput={(e) => (margin.value = (e.target as HTMLInputElement).value)} data-testid="export-margin" /> bp
        </label>
        <div class="row">
          <button disabled={off} onClick={() => run("svg")} data-testid="export-svg">
            SVG
          </button>
          <button disabled={off} onClick={() => run("pdf")} data-testid="export-pdf">
            PDF
          </button>
          <button disabled={off} onClick={() => run("png")} data-testid="export-png">
            PNG
          </button>
          <label>
            at{" "}
            <select value={dpi.value} onChange={(e) => (dpi.value = (e.target as HTMLSelectElement).value)} data-testid="export-dpi">
              <option value="72">72 dpi</option>
              <option value="150">150 dpi</option>
              <option value="300">300 dpi</option>
              <option value="600">600 dpi</option>
            </select>
          </label>
          <label>
            <input type="checkbox" checked={transparent.value} onChange={(e) => (transparent.value = (e.target as HTMLInputElement).checked)} data-testid="export-transparent" /> transparent
          </label>
        </div>
      </section>

      <p class={`status ${msg?.kind ?? ""}`} role="status" aria-live="polite" data-testid="export-status">
        {busy.value ? "Compiling with TeX…" : (msg?.text ?? "")}
      </p>
    </div>
  );
}
