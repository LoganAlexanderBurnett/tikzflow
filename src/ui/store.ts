// Application state. The CodeMirror document is the source of truth; every
// visual edit is a CodeMirror transaction, so one history covers both panes.
import { isolateHistory, redo, undo } from "@codemirror/commands";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { batch, computed, signal } from "@preact/signals";
import type { Change } from "../edit/changes.ts";
import type { GapMark, Guide } from "../edit/snap.ts";
import { analyzeDocument, layoutDocumentPicture } from "../model/document.ts";
import type { Range } from "../model/syntax.ts";
import { summarize } from "../model/summary.ts";
import type { Encoding } from "../source/encoding.ts";
import type { LaidOutNode, LaidOutPath, PictureLayout } from "../tikz/layout.ts";
import type { Point } from "../tikz/shapes.ts";
import { fromCanvas, setHighlight, setOpaque } from "./editor.ts";

export type Selection = { kind: "node"; id: string } | { kind: "path"; id: string } | null;

export const text = signal("");
export const pictureIndex = signal(0);
export const selection = signal<Selection>(null);
/** Node centres pinned while dragging. */
export const overrides = signal<ReadonlyMap<string, Point>>(new Map());
export const guides = signal<{ lines: Guide[]; gaps: GapMark[] }>({ lines: [], gaps: [] });
export const fileName = signal<string | null>(null);
export const encoding = signal<Encoding>("utf-8");
/** Incremented to ask the canvas to fit the picture to the view. */
export const fitRequests = signal(0);
/** A short message shown in the status bar. */
export const status = signal<string | null>(null);

export const doc = computed(() => analyzeDocument(text.value));
export const pictureCount = computed(() => doc.value.syntax.pictures.length);
export const currentPicture = computed(() => Math.min(pictureIndex.value, Math.max(0, pictureCount.value - 1)));

/** The layout as the text describes it. */
export const baseLayout = computed<PictureLayout | null>(() => layoutDocumentPicture(doc.value, currentPicture.value));

/** The layout shown, with any drag in progress applied. */
export const layout = computed<PictureLayout | null>(() => {
  const o = overrides.value;
  if (!o.size) return baseLayout.value;
  return layoutDocumentPicture(doc.value, currentPicture.value, o);
});

export const summary = computed(() => {
  const l = baseLayout.value;
  return l ? summarize(doc.value, l) : null;
});

let view: EditorView | null = null;

export function attachEditor(v: EditorView): void {
  view = v;
  text.value = v.state.doc.toString();
  syncOpaque();
}

export function editorView(): EditorView | null {
  return view;
}

/** Called by the editor on every document change. */
export function onEditorChange(t: string): void {
  text.value = t;
  queueMicrotask(syncOpaque);
}

function syncOpaque() {
  const l = baseLayout.value;
  if (!view || !l) return;
  view.dispatch({ effects: setOpaque.of(l.opaque.filter((o) => o.reason !== "environment").map((o) => o.range)) });
}

/** Called when the user moves the cursor in the code pane. */
export function onEditorCursor(pos: number): void {
  const l = baseLayout.value;
  if (!l) return;
  const found = objectAt(l, pos);
  selection.value = found;
  highlightSelection();
}

/** The smallest node or path whose source contains `pos`. */
export function objectAt(l: PictureLayout, pos: number): Selection {
  let best: { sel: Selection; size: number } | null = null;
  const consider = (sel: Selection, r: Range) => {
    if (pos < r.from || pos > r.to) return;
    const size = r.to - r.from;
    if (!best || size < best.size) best = { sel, size };
  };
  for (const n of l.nodes) consider({ kind: "node", id: n.id }, n.statement);
  for (const p of l.paths) consider({ kind: "path", id: p.id }, p.range);
  // Labels on a path select the path.
  for (const n of l.pathNodes) {
    const p = l.paths.find((x) => x.syntax.from === n.statement.from);
    if (p) consider({ kind: "path", id: p.id }, { from: n.syntax.from, to: n.syntax.to });
  }
  return (best as { sel: Selection } | null)?.sel ?? null;
}

export function selectedNode(): LaidOutNode | null {
  const s = selection.value;
  if (s?.kind !== "node") return null;
  return baseLayout.value?.nodes.find((n) => n.id === s.id) ?? null;
}

function rangeOf(sel: Selection, l: PictureLayout): Range | null {
  if (!sel) return null;
  if (sel.kind === "node") return l.nodes.find((n) => n.id === sel.id)?.statement ?? null;
  const p: LaidOutPath | undefined = l.paths.find((x) => x.id === sel.id);
  return p?.range ?? null;
}

/** Highlights the selected object's code. */
export function highlightSelection(): void {
  const l = baseLayout.value;
  if (!view || !l) return;
  const r = rangeOf(selection.value, l);
  view.dispatch({ effects: [setHighlight.of(r ? [r] : []), fromCanvas.of(null)] });
}

/** Selects an object from the canvas: highlights its code and scrolls to it. */
export function selectFromCanvas(sel: Selection): void {
  selection.value = sel;
  const l = baseLayout.value;
  if (!view || !l) return;
  const r = rangeOf(sel, l);
  view.dispatch({
    effects: [setHighlight.of(r ? [r] : []), fromCanvas.of(null)],
    ...(r ? { selection: EditorSelection.cursor(r.from), scrollIntoView: true } : {}),
  });
}

/** Applies a visual edit as one undoable step. */
export function applyEdit(changes: Change[], label: string): void {
  if (!view || !changes.length) return;
  view.dispatch({
    changes,
    annotations: isolateHistory.of("full"),
    userEvent: label,
    effects: fromCanvas.of(null),
  });
  queueMicrotask(highlightSelection);
}

/** Replaces the whole document (open, paste), undoably. */
export function replaceDocument(t: string, name: string | null, enc: Encoding): void {
  if (!view) return;
  batch(() => {
    fileName.value = name;
    encoding.value = enc;
    selection.value = null;
    pictureIndex.value = 0;
  });
  queueMicrotask(() => fitRequests.value++);
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: t },
    annotations: isolateHistory.of("full"),
    userEvent: "input.replace",
    selection: EditorSelection.cursor(0),
  });
}

export function undoEdit(): void {
  if (view) undo(view);
}

export function redoEdit(): void {
  if (view) redo(view);
}
