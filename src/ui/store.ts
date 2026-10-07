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

/** What the pointer or the cursor is on. */
export type Hit = { kind: "node"; id: string } | { kind: "path"; id: string };
/** The selection: one or more nodes (the last one is the primary), or one path. */
export type Selection = { kind: "nodes"; ids: readonly string[] } | { kind: "path"; id: string } | null;

export function selectionOf(hit: Hit | null): Selection {
  if (!hit) return null;
  return hit.kind === "node" ? { kind: "nodes", ids: [hit.id] } : hit;
}

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
  selection.value = selectionOf(objectAt(l, pos));
  highlightSelection();
}

/** The smallest node or path whose source contains `pos`. */
export function objectAt(l: PictureLayout, pos: number): Hit | null {
  let best: { sel: Hit; size: number } | null = null;
  const consider = (sel: Hit, r: Range) => {
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
  return (best as { sel: Hit } | null)?.sel ?? null;
}

/** Ids of the selected nodes, primary last. */
export const selectedIds = computed<readonly string[]>(() => (selection.value?.kind === "nodes" ? selection.value.ids : []));

/** The selected nodes as laid out, primary last. */
export const selectedNodes = computed<LaidOutNode[]>(() => {
  const l = baseLayout.value;
  if (!l) return [];
  return selectedIds.value.flatMap((id) => l.nodes.find((n) => n.id === id) ?? []);
});

/** The code of the selected objects, primary last. */
function rangesOf(sel: Selection, l: PictureLayout): Range[] {
  if (!sel) return [];
  if (sel.kind === "nodes") return sel.ids.flatMap((id) => l.nodes.find((n) => n.id === id)?.statement ?? []);
  const p: LaidOutPath | undefined = l.paths.find((x) => x.id === sel.id);
  return p ? [p.range] : [];
}

/** Highlights the selected object's code. */
export function highlightSelection(): void {
  const l = baseLayout.value;
  if (!view || !l) return;
  view.dispatch({ effects: [setHighlight.of(rangesOf(selection.value, l)), fromCanvas.of(null)] });
}

/**
 * Selects an object from the canvas: highlights its code and scrolls to it.
 * With `add`, a node is added to the selected nodes, or taken out if it was
 * already in (Shift-click).
 */
export function selectFromCanvas(hit: Hit | null, add = false): void {
  const cur = selection.value;
  let sel = selectionOf(hit);
  if (add && hit?.kind === "node" && cur?.kind === "nodes") {
    const ids = cur.ids.includes(hit.id) ? cur.ids.filter((id) => id !== hit.id) : [...cur.ids, hit.id];
    sel = ids.length ? { kind: "nodes", ids } : null;
  }
  selection.value = sel;
  const l = baseLayout.value;
  if (!view || !l) return;
  const ranges = rangesOf(sel, l);
  const r = ranges[ranges.length - 1];
  view.dispatch({
    effects: [setHighlight.of(ranges), fromCanvas.of(null)],
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
