// The application shell: toolbar, code pane, canvas, and summary.
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { decode, encode, UnencodableError } from "../source/encoding.ts";
import { Canvas } from "./canvas.tsx";
import { Inspector } from "./inspector.tsx";
import { Palette } from "./palette.tsx";
import { editorExtensions } from "./editor.ts";
import { SAMPLE } from "./sample.ts";
import {
  attachEditor,
  currentPicture,
  doc,
  encoding,
  fileName,
  fitRequests,
  onEditorChange,
  onEditorCursor,
  pictureCount,
  pictureIndex,
  redoEdit,
  replaceDocument,
  selectFromCanvas,
  showError,
  showReference,
  describeError,
  lineOf,
  status,
  summary,
  text,
  undoEdit,
} from "./store.ts";

function CodePane() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: SAMPLE,
        extensions: editorExtensions({ onChange: onEditorChange, onCursor: onEditorCursor }),
      }),
    });
    attachEditor(view);
    fitRequests.value++;
    return () => view.destroy();
  }, []);
  return <div class="tf-code" ref={host} data-testid="code" />;
}

async function openFile(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { text: t, encoding: enc } = decode(bytes);
  replaceDocument(t, file.name, enc);
  status.value = `Opened ${file.name}${enc !== "utf-8" ? ` (${enc})` : ""}.`;
}

function download() {
  let bytes: Uint8Array;
  try {
    bytes = encode(text.value, encoding.value);
  } catch (e) {
    if (!(e instanceof UnencodableError)) throw e;
    status.value = `This file is ${e.encoding}, which can't hold a character at offset ${e.offset}. Saved as UTF-8 instead.`;
    bytes = encode(text.value, "utf-8");
  }
  const blob = new Blob([bytes as BlobPart], { type: "application/x-tex" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName.value ?? "diagram.tex";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function Summary() {
  const s = summary.value;
  const open = useSignal(false);
  if (!s) {
    return (
      <div class="tf-summary" data-testid="summary">
        <span class="headline">No tikzpicture found. Paste TikZ code or open a .tex file.</span>
      </div>
    );
  }
  const kept = Object.entries(s.kept);
  const details = s.locked.length + s.unknownKeys.length + s.notes.length + kept.length + s.unresolved.length + s.parseErrors;
  const t = text.value;
  const errors = doc.value.errors;
  return (
    <div class={`tf-summary${open.value ? " open" : ""}`} data-testid="summary">
      <div class="bar">
        <button class="headline" onClick={() => (open.value = !open.value)} disabled={!details} title="What the editor understood">
          <span data-testid="summary-headline">{s.main}</span>
        </button>
        {s.parseErrors > 0 && (
          <button class="tf-errors" data-testid="error-count" onClick={() => showError()} title="Jump to the next syntax error in the code">
            {s.parseErrors} syntax {s.parseErrors === 1 ? "error" : "errors"}
          </button>
        )}
        {s.unresolved.length > 0 && (
          <button class="tf-undefined" onClick={() => (open.value = true)} title="Names the code refers to that aren't defined">
            {s.unresolved.length} undefined {s.unresolved.length === 1 ? "name" : "names"}
          </button>
        )}
        {details > 0 && (
          <button class="more" onClick={() => (open.value = !open.value)}>
            {open.value ? "Hide details" : "Details"}
          </button>
        )}
      </div>
      {open.value && (
        <div class="details">
          {errors.length > 0 && (
            <section>
              <h3>Syntax errors</h3>
              <p>LaTeX would stop on these too. The editor keeps the code around them as-is.</p>
              <ul data-testid="error-list">
                {errors.map((e, i) => (
                  <li>
                    <button class="link" onClick={() => showError(i)}>
                      Line {lineOf(t, e.from)}
                    </button>
                    : {describeError(t, e)}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {s.unresolved.length > 0 && (
            <section>
              <h3>Undefined references</h3>
              <p>LaTeX would stop with "No shape named … is known" on these too.</p>
              <ul data-testid="undefined-list">
                {s.unresolved.map((u) => (
                  <li>
                    <button class="link" onClick={() => showReference(u.name, u.refs.map((r) => r.nameRange ?? r.range))} title="Show where it's used">
                      {u.name}
                    </button>
                    : {u.kind === "later" ? "defined only later in the code" : "not defined anywhere"}, used{" "}
                    {u.refs.length === 1 ? "once" : `${u.refs.length} times`}
                    {u.refs.some((r) => r.in === "path") && u.refs.some((r) => r.in === "node") ? " (by nodes and paths)" : u.refs[0]!.in === "path" ? " in paths" : " to place nodes"}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {kept.length > 0 && (
            <section>
              <h3>Kept as-is</h3>
              <p>These blocks stay exactly as written. The native preview doesn't draw them yet; the accurate TeX preview will.</p>
              <ul>
                {kept.map(([k, n]) => (
                  <li>
                    {n} × {k}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {s.locked.length > 0 && (
            <section>
              <h3>Locked nodes</h3>
              <ul>
                {s.locked.map((l) => (
                  <li>
                    <button class="link" onClick={() => selectFromCanvas({ kind: "node", id: l.id })}>
                      {l.id}
                    </button>
                    : {l.reason}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {s.unknownKeys.length > 0 && (
            <section>
              <h3>Options the preview ignores</h3>
              <p>They are kept in the code and will show in the accurate preview.</p>
              <p class="keys">{s.unknownKeys.map((k) => `${k.key}${k.count > 1 ? ` ×${k.count}` : ""}`).join(", ")}</p>
            </section>
          )}
          {s.notes.length > 0 && (
            <section>
              <h3>Shown approximately</h3>
              <ul>
                {s.notes.slice(0, 12).map((n) => (
                  <li>{n}</li>
                ))}
                {s.notes.length > 12 && <li>…and {s.notes.length - 12} more.</li>}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function Toolbar() {
  const input = useRef<HTMLInputElement>(null);
  const count = pictureCount.value;
  return (
    <header class="tf-toolbar">
      <span class="brand">TikZFlow</span>
      <button onClick={() => input.current?.click()} title="Open a .tex file">
        Open…
      </button>
      <input
        ref={input}
        type="file"
        accept=".tex,.tikz,.txt,.pgf"
        hidden
        onChange={(e) => {
          const f = (e.target as HTMLInputElement).files?.[0];
          if (f) void openFile(f);
          (e.target as HTMLInputElement).value = "";
        }}
      />
      <button onClick={download} title="Download the code as a .tex file">
        Download
      </button>
      <button onClick={() => replaceDocument(SAMPLE, null, "utf-8")} title="Replace the code with the sample flowchart">
        Sample
      </button>
      <span class="sep" />
      <button onClick={undoEdit} title="Undo (Ctrl+Z)" aria-label="Undo">
        ↶ Undo
      </button>
      <button onClick={redoEdit} title="Redo (Ctrl+Y)" aria-label="Redo">
        ↷ Redo
      </button>
      <span class="sep" />
      {count > 1 && (
        <label class="picker">
          Picture{" "}
          <select
            value={currentPicture.value}
            onChange={(e) => {
              pictureIndex.value = Number((e.target as HTMLSelectElement).value);
              fitRequests.value++;
            }}
          >
            {doc.value.syntax.pictures.map((_, i) => (
              <option value={i}>
                {i + 1} of {count}
              </option>
            ))}
          </select>
        </label>
      )}
      <button onClick={() => fitRequests.value++} title="Fit the picture to the canvas">
        Fit
      </button>
      <span class="file">{fileName.value ?? ""}</span>
    </header>
  );
}

export function App() {
  const split = useSignal(42);
  const dragging = useRef(false);

  // Undo and redo work when the canvas has focus too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inEditor = (e.target as Element | null)?.closest?.(".cm-editor, textarea, input, select");
      if (inEditor || !(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        undoEdit();
      } else if (k === "y" || (k === "z" && e.shiftKey)) {
        e.preventDefault();
        redoEdit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Drop a file anywhere to open it.
  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      const f = e.dataTransfer?.files?.[0];
      if (!f) return;
      e.preventDefault();
      void openFile(f);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);

  return (
    <div
      class="tf-app"
      onPointerMove={(e) => {
        if (!dragging.current) return;
        split.value = Math.min(75, Math.max(20, (e.clientX / window.innerWidth) * 100));
      }}
      onPointerUp={() => (dragging.current = false)}
    >
      <Toolbar />
      <main class="tf-main" style={{ gridTemplateColumns: `${split.value}% 6px 1fr` }}>
        <CodePane />
        <div
          class="tf-splitter"
          onPointerDown={(e) => {
            dragging.current = true;
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (dragging.current) split.value = Math.min(75, Math.max(20, (e.clientX / window.innerWidth) * 100));
          }}
          onPointerUp={() => (dragging.current = false)}
        />
        <section class="tf-canvas-pane">
          <Summary />
          <Palette />
          <div class="tf-stage">
            <Canvas />
            <Inspector />
          </div>
          <footer class="tf-status" data-testid="status">
            {status.value ?? "Drag nodes to move them. Hold Alt to drag without snapping. Tab adds a connected node. Scroll to zoom, drag the background to pan."}
          </footer>
        </section>
      </main>
    </div>
  );
}
