// Application state. The CodeMirror document is the source of truth; every
// visual edit is a CodeMirror transaction, so one history covers both panes.
import { isolateHistory, redo, undo } from "@codemirror/commands";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { batch, computed, effect, signal } from "@preact/signals";
import type { Change } from "../edit/changes.ts";
import { withLibraries } from "../edit/libraries.ts";
import { planAttach, planPin } from "../edit/move.ts";
import { type PropEdit, propertyChanges, type Scope, sharedStyles } from "../edit/properties.ts";
import type { GapMark, Guide } from "../edit/snap.ts";
import { analyzeDocument, layoutDocumentPicture } from "../model/document.ts";
import type { Range } from "../model/syntax.ts";
import { unusedCoordinates } from "../model/references.ts";
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

/** The picture as it would be laid out with the resize in progress applied. */
export const resizePreview = signal<PictureLayout | null>(null);

/** The layout shown, with any drag in progress applied. */
export const layout = computed<PictureLayout | null>(() => {
  const preview = resizePreview.value;
  if (preview) return preview;
  const o = overrides.value;
  if (!o.size) return baseLayout.value;
  return layoutDocumentPicture(doc.value, currentPicture.value, o);
});

export const summary = computed(() => {
  const l = baseLayout.value;
  return l ? summarize(doc.value, l, currentPicture.value) : null;
});

/** \coordinate nodes nothing refers to. */
export const unusedCoords = computed<ReadonlySet<string>>(() => {
  const l = baseLayout.value;
  const pic = doc.value.syntax.pictures[currentPicture.value];
  return l && pic ? unusedCoordinates(doc.value.text, pic, l) : new Set();
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

/**
 * The style the properties panel and resizing apply to, or null for the
 * selected nodes themselves (D34, D38). A new selection starts at null again.
 */
export const scopeStyle = signal<string | null>(null);
const selectionKey = computed(() => selectedIds.value.join("|"));
effect(() => {
  void selectionKey.value;
  scopeStyle.value = null;
});

/** What a change to the selection applies to: the chosen style if every selected node uses it, else the nodes. */
export const activeScope = computed<Scope | null>(() => {
  const nodes = selectedNodes.value.filter((n) => n.kind === "statement");
  if (!nodes.length) return null;
  const pic = doc.value.syntax.pictures[currentPicture.value];
  const style = scopeStyle.value;
  if (style && pic && sharedStyles(doc.value, pic, nodes).includes(style)) return { kind: "style", name: style };
  return { kind: "nodes", ids: nodes.map((n) => n.id) };
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

/** Selects `r` in the code pane, scrolls it into view, and focuses the code. */
export function revealInCode(r: Range): void {
  if (!view) return;
  const len = view.state.doc.length;
  const from = Math.min(r.from, len);
  view.dispatch({ selection: EditorSelection.range(from, Math.min(r.to, len)), effects: EditorView.scrollIntoView(from, { y: "center" }) });
  view.focus();
}

/** Which syntax error was shown last, for stepping through them. */
const errorCursor = signal(-1);

/** The line number (1-based) of `pos`. */
export function lineOf(t: string, pos: number): number {
  let n = 1;
  for (let i = t.indexOf("\n"); i >= 0 && i < pos; i = t.indexOf("\n", i + 1)) n++;
  return n;
}

/** What a syntax error is, in a few words. */
export function describeError(t: string, e: Range): string {
  if (e.to === e.from) return "something is missing here, such as a closing brace or a semicolon";
  const s = t.slice(e.from, e.to).replace(/\s+/g, " ").trim();
  return `"${s.length > 24 ? `${s.slice(0, 24)}…` : s}" isn't valid here`;
}

/** Jumps to syntax error `index`, or to the next one, and says where it is. */
export function showError(index?: number): void {
  const errors = doc.value.errors;
  if (!errors.length) return;
  const i = index ?? (errorCursor.value + 1) % errors.length;
  errorCursor.value = i;
  const e = errors[i]!;
  revealInCode(e);
  status.value = `Syntax error ${i + 1} of ${errors.length}, line ${lineOf(text.value, e.from)}: ${describeError(text.value, e)}.`;
}

/** Steps through the references to a name: each call shows the next one. */
const refCursor = new Map<string, number>();
export function showReference(name: string, ranges: readonly Range[]): void {
  if (!ranges.length) return;
  const i = ((refCursor.get(name) ?? -1) + 1) % ranges.length;
  refCursor.set(name, i);
  revealInCode(ranges[i]!);
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

/** Libraries an edit needs or made unused, with what to tell the user. */
function libraryNote(added: readonly string[], removed: readonly string[], notes: readonly string[]): string {
  const out: string[] = [];
  if (added.length) out.push(`Loaded ${added.join(", ")}.`);
  if (removed.length) out.push(`Removed the unused ${removed.join(", ")} library.`);
  for (const n of notes) out.push(`Note: ${n}.`);
  return out.length ? ` ${out.join(" ")}` : "";
}

/**
 * Applies a properties-panel edit to the selected nodes or a style, as one
 * undoable step. `extra` holds changes that go with it, such as a new
 * \definecolor. Returns false if the edit was refused.
 */
export function applyProperty(scope: Scope, edit: PropEdit, extra: Change[] = [], done?: string): boolean {
  const l = baseLayout.value;
  if (!l) return false;
  const r = propertyChanges(doc.value, currentPicture.value, l, scope, edit);
  if (!r.ok) {
    status.value = r.reason;
    return false;
  }
  const changes = [...extra, ...r.changes];
  if (!r.changes.length) {
    status.value = "Nothing to change: it already has that value.";
    return false;
  }
  if (extra.some((e) => r.changes.some((c) => e.from < c.to && c.from < e.to))) {
    status.value = "That edit would overlap another; make it in the code instead.";
    return false;
  }
  applyEdit(changes, "input.properties");
  const what = scope.kind === "style" ? `the ${scope.name} style` : scope.ids.length === 1 ? "the node" : `${scope.ids.length} nodes`;
  status.value = `${done ?? "Changed"} ${what}.${r.notes.map((n) => ` ${n}.`).join("")}`;
  return true;
}

/** Applies a finished resize drag as one undoable step, and says what was written. */
export function applyResize(changes: Change[], written: readonly string[], scope: Scope, notes: readonly string[], extra = ""): void {
  resizePreview.value = null;
  guides.value = { lines: [], gaps: [] };
  if (!changes.length) return;
  applyEdit(changes, "input.resize");
  const where = scope.kind === "style" ? ` in the ${scope.name} style` : "";
  status.value = `Wrote ${written.join(", ")}${where}.${extra}${notes.map((n) => ` Note: ${n}.`).join("")}`;
}

/**
 * "Pin at current position" for a locked node. With `center`, the node was
 * dragged there and is pinned at the drop position instead.
 */
export function pinNode(id: string, center?: Point): void {
  const r = planPin(text.value, currentPicture.value, id, center);
  if (!r) {
    status.value = center ? "That position couldn't be written; the node stays where it was." : "This node couldn't be pinned where it is.";
    return;
  }
  const lib = withLibraries(text.value, currentPicture.value, r.changes);
  applyEdit(lib.changes, "fix.pin");
  status.value = `${center ? "Pinned at the drop position" : "Pinned"} with plain coordinates, so LaTeX can place it. You can drag it with the usual snapping now.${libraryNote(lib.added, lib.removed, lib.notes)}`;
}

/** "Attach to another node" for a locked node: refers to `to` instead of `from`. */
export function attachNode(id: string, from: string, to: string): void {
  const r = planAttach(text.value, currentPicture.value, id, from, to);
  if (!r) {
    status.value = `Attaching to ${to} doesn't work here: the node would still be locked.`;
    return;
  }
  applyEdit(r.changes, "fix.attach");
  status.value = `Now placed relative to ${to} instead of ${from}. You can drag it now.`;
}

export function undoEdit(): void {
  if (view) undo(view);
}

export function redoEdit(): void {
  if (view) redo(view);
}
