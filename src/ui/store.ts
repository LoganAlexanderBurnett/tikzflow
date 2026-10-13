// Application state. The CodeMirror document is the source of truth; every
// visual edit is a CodeMirror transaction, so one history covers both panes.
import { isolateHistory, redo, undo } from "@codemirror/commands";
import { EditorSelection, type EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { batch, computed, effect, signal } from "@preact/signals";
import { autoLayoutMessage, type LayoutDirection, type LayoutProgress } from "../edit/autolayout.ts";
import { LayoutCancelled, runAutoLayout } from "../edit/layoutjobs.ts";
import { type KeyNamedStyle, keyNamedStyles } from "../edit/stylekeys.ts";
import { applyChanges, type Change, composeChanges } from "../edit/changes.ts";
import { type ContrastIssue, contrastIssues } from "../edit/contrast.ts";
import { defaultEntry, edgeHead, type PaletteEntry, paletteEntries, planCreate, type Placement } from "../edit/create.ts";
import { type EndTarget, findEdge, planConnect, planEnd } from "../edit/edges.ts";
import { planMakeCurved } from "../edit/curves.ts";
import { planMakeOrthogonal } from "../edit/orthogonal.ts";
import { planSplit } from "../edit/split.ts";
import { planAddVertex, planRemoveVertex, planStraighten } from "../edit/vertices.ts";
import { fixLabelSides, labelsOnTheirLine, planAddLabel, planFlipLabel, planLabelBesideLine } from "../edit/labels.ts";
import { type DeleteTarget, planDelete } from "../edit/delete.ts";
import { type EdgeEdit, type EdgeScope, planEdgeProperty, planSplitAndApply } from "../edit/edgeprops.ts";
import { draftOf, labelBlocker, labelledNode, labelProblem, planLabelEdit } from "../edit/label.ts";
import { withLibraries } from "../edit/libraries.ts";
import { formatDistance, planAttach, planPin } from "../edit/move.ts";
import { type Kept, keepInPlace, keptMessage, planDetach, planUnlink } from "../edit/links.ts";
import { planDetachStyle } from "../edit/detachstyle.ts";
import { type LaneOutcome, laneAt, planGroup, planJoin, planLane, planLeave, planTitle, withLaneUpkeep } from "../edit/lanes.ts";
import { type PropEdit, propertyChanges, type Scope, sharedStyles } from "../edit/properties.ts";
import { planMatch } from "../edit/resize.ts";
import type { GapMark, Guide } from "../edit/snap.ts";
import { planFactor, planStyleEdit, type Repeat } from "../edit/styleedit.ts";
import { analyzeDocument, layoutDocumentPicture } from "../model/document.ts";
import { type Drag, dragLayout, recordedLayout, startDrag } from "../model/drag.ts";
import { type Edge, edgeOfLabel, edgeTitle, pictureEdges } from "../model/edges.ts";
import type { Range } from "../model/syntax.ts";
import { unusedCoordinates } from "../model/references.ts";
import { summarize } from "../model/summary.ts";
import type { Encoding } from "../source/encoding.ts";
import type { LaidOutNode, LaidOutPath, PictureLayout } from "../tikz/layout.ts";
import type { Point } from "../tikz/shapes.ts";
import { fromCanvas, setHighlight, setOpaque } from "./editor.ts";
import { pageSettings } from "./pagesettings.ts";

/** What the pointer or the cursor is on: a node, an edge, or a path that has no edges the editor models. */
export type Hit = { kind: "node"; id: string } | { kind: "edge"; id: string } | { kind: "path"; id: string };
/** The selection: one or more nodes (the last one is the primary), one edge, or one path. */
export type Selection = { kind: "nodes"; ids: readonly string[] } | { kind: "edge"; id: string } | { kind: "path"; id: string } | null;

export function selectionOf(hit: Hit | null): Selection {
  if (!hit) return null;
  return hit.kind === "node" ? { kind: "nodes", ids: [hit.id] } : hit;
}

export const text = signal("");
export const pictureIndex = signal(0);
export const selection = signal<Selection>(null);
/** Node centers pinned while dragging. */
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

/** The layout as the text describes it, recorded so that a drag lays out only what it changes (D108). */
export const baseLayout = computed<PictureLayout | null>(() => {
  // The page the figure goes on sets what \textwidth means (D73): a change of settings draws it again.
  void pageSettings.value;
  return recordedLayout(doc.value, currentPicture.value);
});

/** The drag of the layout as it is (D108): kept from frame to frame, started again when the code changes. */
let drag: Drag | null = null;

/** The picture as it would be laid out with the resize or creation in progress applied. */
export const previewLayout = signal<PictureLayout | null>(null);

/** The layout shown, with any drag in progress applied. */
export const layout = computed<PictureLayout | null>(() => {
  const preview = previewLayout.value;
  if (preview) return preview;
  const o = overrides.value;
  const base = baseLayout.value;
  if (!o.size) return base;
  void pageSettings.value;
  if (!drag || drag.session.base !== base || drag.doc !== doc.value || drag.index !== currentPicture.value) drag = startDrag(doc.value, currentPicture.value, base);
  return dragLayout(drag, o);
});

/**
 * What a drag moved (D108): the ids of the nodes, path nodes and paths of the shown layout that aren't
 * the base layout's own objects. The same object from frame to frame while the same things move, so the
 * canvas draws everything else once, as a layer that doesn't change, and only these on top. Empty when
 * nothing is dragged, and when most of the picture changed (a full layout, a resize's preview).
 */
export interface Moved {
  key: string;
  ids: ReadonlySet<string>;
}
export const NOTHING_MOVED: Moved = { key: "", ids: new Set() };
let lastMoved: Moved = NOTHING_MOVED;
export const dragMoved = computed<Moved>(() => {
  const base = baseLayout.value;
  const now = layout.value;
  if (!base || !now || now === base || previewLayout.value) return (lastMoved = NOTHING_MOVED);
  const own = new Map<string, object>();
  for (const n of base.nodes) own.set(n.id, n);
  for (const n of base.pathNodes) own.set(n.id, n);
  for (const p of base.paths) own.set(p.id, p);
  const ids = new Set<string>();
  for (const n of now.nodes) if (own.get(n.id) !== n) ids.add(n.id);
  for (const n of now.pathNodes) if (own.get(n.id) !== n) ids.add(n.id);
  for (const p of now.paths) if (own.get(p.id) !== p) ids.add(p.id);
  if (ids.size > own.size / 2) return (lastMoved = NOTHING_MOVED);
  const key = [...ids].join("\n");
  if (key !== lastMoved.key) lastMoved = { key, ids };
  return lastMoved;
});

/** `base` without what moved: what a drag leaves where it was (the TeX preview's patch during a drag, D108). */
const withoutCache = new WeakMap<Moved, { base: PictureLayout; layout: PictureLayout }>();
export function withoutMoved(base: PictureLayout, moved: Moved): PictureLayout {
  const known = withoutCache.get(moved);
  if (known?.base === base) return known.layout;
  const keep = <T extends { id: string }>(xs: T[]) => xs.filter((x) => !moved.ids.has(x.id));
  const out: PictureLayout = { ...base, nodes: keep(base.nodes), pathNodes: keep(base.pathNodes), paths: keep(base.paths) };
  withoutCache.set(moved, { base, layout: out });
  return out;
}

/** The work the last drag frame did (for the drag bench): full layouts so far, and paths and nodes laid out again. */
export function dragWork(): { frames: number; full: number; paths: number; nodes: number; why: string | null } | null {
  return drag ? { ...drag.session.stats } : null;
}

/** The edges of the picture as the text describes it (M2b). */
export const edges = computed<Edge[]>(() => {
  const l = baseLayout.value;
  return l ? pictureEdges(l) : [];
});

/** The edges as shown, with any drag in progress applied. */
export const shownEdges = computed<Edge[]>(() => {
  const l = layout.value;
  return l === baseLayout.value ? edges.value : l ? pictureEdges(l) : [];
});

export const summary = computed(() => {
  const l = baseLayout.value;
  return l ? summarize(doc.value, l, currentPicture.value) : null;
});

/** Text that fails WCAG AA against its fill or what is behind it (D85), in drawing order. */
export const contrast = computed<ContrastIssue[]>(() => {
  const l = baseLayout.value;
  return l ? contrastIssues(l) : [];
});

/** Styles named like one of TikZ's own keys (D83 item 3, D87). */
export const keyStyles = computed<KeyNamedStyle[]>(() => {
  const pic = doc.value.syntax.pictures[currentPicture.value];
  return pic ? keyNamedStyles(doc.value, pic) : [];
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

/**
 * Why the diagram on screen can't be edited here, or null when it can: another window is editing it (D97).
 * Every visual edit checks it; the code pane is read-only meanwhile.
 */
export const editLock = signal<string | null>(null);

/** Whether an edit may go ahead; says why not in the status bar. */
export function canEdit(): boolean {
  const why = editLock.peek();
  if (why) {
    status.value = why;
    // The caller may go on to say what it did; the reason it did nothing is what stays.
    queueMicrotask(() => (status.value = why));
  }
  return !why;
}

/**
 * Shows another tab's editor state (D97): its code, undo history and cursor. What belonged to the tab that
 * was shown (the selection, a drag, a label being typed) is dropped. Before the code pane exists, only the
 * text is taken; the pane starts with the state.
 */
export function swapEditorState(state: EditorState): void {
  batch(() => {
    selection.value = null;
    overrides.value = new Map();
    previewLayout.value = null;
    guides.value = { lines: [], gaps: [] };
    labelEdit.value = null;
    pickedLabel.value = null;
    text.value = state.doc.toString();
  });
  if (!view) return;
  view.setState(state);
  syncOpaque();
  queueMicrotask(() => fitRequests.value++);
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
  selection.value = selectionOf(objectAt(l, pos, edges.value));
  highlightSelection();
}

/** The smallest node, edge or path whose source contains `pos`. */
export function objectAt(l: PictureLayout, pos: number, edgeList: readonly Edge[] = pictureEdges(l)): Hit | null {
  let best: { sel: Hit; size: number } | null = null;
  const consider = (sel: Hit, r: Range) => {
    if (pos < r.from || pos > r.to) return;
    const size = r.to - r.from;
    if (!best || size < best.size) best = { sel, size };
  };
  for (const n of l.nodes) consider({ kind: "node", id: n.id }, n.statement);
  // A path with edges selects the edge the cursor is in; other paths select the path.
  for (const p of l.paths) if (!edgeList.some((e) => e.path === p)) consider({ kind: "path", id: p.id }, p.range);
  for (const e of edgeList) consider({ kind: "edge", id: e.id }, e.range);
  // Labels on a path select their edge, or the path.
  for (const n of l.pathNodes) {
    const e = edgeOfLabel(edgeList, n.id);
    const p = l.paths.find((x) => x.syntax.from === n.statement.from);
    if (e) consider({ kind: "edge", id: e.id }, { from: n.syntax.from, to: n.syntax.to });
    else if (p) consider({ kind: "path", id: p.id }, { from: n.syntax.from, to: n.syntax.to });
  }
  return (best as { sel: Hit } | null)?.sel ?? null;
}

/** The selected edge, if one is. */
export const selectedEdge = computed<Edge | null>(() => {
  const sel = selection.value;
  return sel?.kind === "edge" ? (edges.value.find((e) => e.id === sel.id) ?? null) : null;
});

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
  if (sel.kind === "edge") {
    const e = edges.value.find((x) => x.id === sel.id);
    return e ? [e.range] : [];
  }
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

/**
 * An edge or path id after `changes`: ids hold the path's position in the
 * text ("path@120:0"), which text inserted or removed before it moves.
 */
export function mapPathId(id: string, changes: readonly Change[]): string {
  return id.replace(/^(path@)(\d+)/, (_m, pre: string, n: string) => {
    const at = Number(n);
    let shift = 0;
    for (const c of changes) if (c.to <= at && !(c.from === at && c.to === at)) shift += c.insert.length - (c.to - c.from);
    return `${pre}${at + shift}`;
  });
}

/**
 * Applies a visual edit as one undoable step. A selected edge or path stays
 * selected. Lanes keep their shared top and bottom at the members' extremes
 * (D81), in the same step.
 */
export function applyEdit(edit: Change[], label: string): void {
  if (!view || !edit.length || !canEdit()) return;
  const { changes } = withLaneUpkeep(text.value, currentPicture.value, edit);
  const sel = selection.peek();
  if (sel?.kind === "edge" || sel?.kind === "path") selection.value = { kind: sel.kind, id: mapPathId(sel.id, changes) };
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
  if (!view || !canEdit()) return;
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
export function applyResize(
  changes: Change[],
  written: readonly string[],
  scope: Scope,
  notes: readonly string[],
  position?: string,
  extra = "",
): void {
  previewLayout.value = null;
  guides.value = { lines: [], gaps: [] };
  if (!changes.length) return;
  applyEdit(changes, "input.resize");
  const where = scope.kind === "style" ? ` in the ${scope.name} style` : "";
  const held = position ? ` Moved the node to keep the opposite edge in place: ${position}.` : "";
  status.value = `Wrote ${written.join(", ")}${where}.${held}${extra}${notes.map((n) => ` Note: ${n}.`).join("")}`;
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

// ---------------------------------------------------------------- placement links (M6 step 1, D102, D104)

const FOLLOWERS_KEY = "tikzflow.moveFollowers";

function loadMoveFollowers(): boolean {
  try {
    return localStorage.getItem(FOLLOWERS_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The toolbar's "Move followers too" (D104): whether dragging a node also moves the nodes placed
 * against it. Off by default, so only the dragged node moves; remembered in this browser. Holding
 * Ctrl (⌘ on a Mac) during a drag does the opposite of this for that drag.
 */
export const moveFollowers = signal(loadMoveFollowers());

export function setMoveFollowers(v: boolean): void {
  moveFollowers.value = v;
  try {
    localStorage.setItem(FOLLOWERS_KEY, v ? "1" : "0");
  } catch {
    // Storage can be blocked; the switch still works for this visit.
  }
}

/**
 * After a drag's own edit `moved` (of the nodes `allowed`), the edit that keeps every other node
 * where it was (D104), as one set of changes against the text now. `prefer`: what the dragged
 * nodes were placed against, tried first for their followers.
 */
export function keepFollowers(
  moved: readonly Change[],
  allowed: ReadonlySet<string>,
  prefer: ReadonlySet<string>,
  renamed?: ReadonlyMap<string, string>,
): { ok: true; changes: Change[]; kept: Kept[]; ids: Map<string, string> } | { ok: false; reason: string } {
  const base = baseLayout.value;
  if (!base) return { ok: false, reason: "There is no picture." };
  const k = keepInPlace(applyChanges(text.value, moved), currentPicture.value, base, allowed, prefer, renamed);
  if (!k.ok) return k;
  return { ok: true, changes: composeChanges(text.value, [...moved], k.changes), kept: k.kept, ids: k.ids };
}

/** Unlink in the properties panel: node `id` stops following `other`, or `other` stops following it. Nothing moves. */
export function unlinkNode(id: string, other: string, direction: "follows" | "follower"): void {
  const r = planUnlink(text.value, currentPicture.value, id, other, direction);
  if (!r.ok) {
    status.value = r.reason;
    return;
  }
  const lib = withLibraries(text.value, currentPicture.value, r.changes);
  applyEdit(lib.changes, "links.unlink");
  const k = r.kept[0]!;
  const l = baseLayout.value;
  const name = (x: string) => l?.nodes.find((n) => n.id === x)?.name ?? x;
  status.value = `${k.name} no longer follows ${direction === "follows" ? name(other) : name(id)}: it is ${k.how === "pinned with coordinates" ? "pinned with coordinates where it is" : `placed ${k.how}`}, and nothing moved.${libraryNote(lib.added, lib.removed, lib.notes)}`;
}

/** Detach the selected nodes (D102): no placement links in either direction, nothing moving. */
export function detachSelection(): void {
  const ids = selectedIds.value;
  if (!ids.length) return;
  const r = planDetach(text.value, currentPicture.value, ids);
  if (!r.ok) {
    status.value = r.reason;
    return;
  }
  const l = baseLayout.value;
  const names = ids.map((id) => l?.nodes.find((n) => n.id === id)?.name ?? id);
  const lib = withLibraries(text.value, currentPicture.value, r.changes);
  applyEdit(lib.changes, "links.detach");
  if (r.ids.size) selectNodes(ids.map((id) => r.ids.get(id) ?? id));
  const who = names.length === 1 ? names[0] : `${names.length} nodes`;
  status.value = `Detached ${who}: ${names.length === 1 ? "it stays" : "they stay"} where ${names.length === 1 ? "it is" : "they are"}, with coordinates, and nothing is placed against ${names.length === 1 ? "it" : "them"} now.${keptMessage(r.kept, "Re-attached")}${libraryNote(lib.added, lib.removed, lib.notes)}`;
}

/** Detach from style (D102): the selected nodes get style `name`'s options written into their own. */
export function detachFromStyle(name: string): void {
  const ids = selectedIds.value;
  const r = planDetachStyle(text.value, currentPicture.value, ids, name);
  if (!r.ok) {
    status.value = r.reason;
    return;
  }
  applyEdit(r.changes, "links.style");
  scopeStyle.value = null;
  status.value = `Copied the ${name} style's options into ${r.nodes === 1 ? "the node" : `${r.nodes} nodes`}: later edits of ${name} won't change ${r.nodes === 1 ? "it" : "them"}.`;
}

/** Whether an auto-layout is being worked out (in the layout worker, D87). */
export const layoutBusy = signal(false);
/** The Layout panel's "Allow reordering statements" (D81 item 4): off until the user turns it on; not kept between visits. */
export const layoutReorder = signal(false);
/** How far the running layout or import is; shown once it has taken a moment (D83 item 4). */
export const layoutProgress = signal<LayoutProgress | null>(null);
let cancelJob: (() => void) | null = null;

/** Stops the running layout or import; nothing is written. */
export function cancelLayout(): void {
  cancelJob?.();
}

/** Progress shown only after this long, so quick layouts don't flash a bar. */
const PROGRESS_DELAY_MS = 250;

/**
 * Runs a job of the layout worker with its progress shown (after a moment)
 * in `layoutProgress` and the status bar, and Cancel wired to it.
 */
export async function withProgress<T>(start: (onProgress: (p: LayoutProgress) => void) => { result: Promise<T>; cancel(): void }, doing: string): Promise<T> {
  let last: LayoutProgress | null = null;
  let shown = false;
  const show = () => {
    shown = true;
    layoutProgress.value = last ?? { step: 0, steps: 1, what: "starting" };
    status.value = `${doing}… ${progressText(layoutProgress.value)}`;
  };
  const timer = setTimeout(show, PROGRESS_DELAY_MS);
  const job = start((p) => {
    last = p;
    if (shown) show();
  });
  cancelJob = job.cancel;
  try {
    return await job.result;
  } finally {
    clearTimeout(timer);
    cancelJob = null;
    layoutProgress.value = null;
  }
}

/** "Step 3 of 9: choosing each node's relation". */
export function progressText(p: LayoutProgress): string {
  return p.step ? `Step ${p.step} of ${p.steps}: ${p.what}.` : "Starting.";
}

/**
 * Auto-layout (D80): the whole picture, or the selection when two or more
 * nodes are selected, as one undoable step. It runs in the layout worker
 * (D87), so the page stays responsive; nothing is written if the code changed
 * meanwhile, or if it was canceled.
 */
export async function autoLayout(direction: LayoutDirection): Promise<boolean> {
  const before = text.value;
  const pic = currentPicture.value;
  const ids = selectedIds.value.length >= 2 ? [...selectedIds.value] : undefined;
  if (!canEdit()) return false;
  layoutBusy.value = true;
  status.value = "Laying out…";
  try {
    const reorder = layoutReorder.value;
    const r = await withProgress((onProgress) => runAutoLayout(before, pic, { direction, ...(ids ? { ids } : {}), ...(reorder ? { reorder } : {}) }, onProgress), "Laying out");
    if (text.value !== before) {
      status.value = "The code changed while the layout was worked out, so nothing was written. Try again.";
      return false;
    }
    if (!r.ok) {
      status.value = r.reason;
      return false;
    }
    if (r.changes.length) applyEdit(r.changes, "input.layout");
    status.value = autoLayoutMessage(r);
    fitRequests.value++;
    return true;
  } catch (e) {
    status.value = e instanceof LayoutCancelled ? "Layout canceled; nothing was changed." : `The layout engine failed: ${e instanceof Error ? e.message : String(e)}. Nothing was changed.`;
    return false;
  } finally {
    layoutBusy.value = false;
  }
}

// ---------------------------------------------------------------- groups and lanes (D81)

/** Applies a group or lane edit, selects what it is about, and says what was written. */
function applyLaneEdit(r: LaneOutcome, label: string, select?: readonly string[]): boolean {
  if (!r.ok) {
    status.value = r.reason;
    return false;
  }
  applyEdit(r.changes, label);
  if (select) selectNodes(select.filter((id) => baseLayout.value?.nodes.some((n) => n.id === id)));
  status.value = `${r.message}.${alsoNotes(r.notes)}`;
  return true;
}

/** "Group": a box around the selected nodes, with an optional title. */
export function groupSelection(title: string): boolean {
  const r = planGroup(text.value, currentPicture.value, selectedIds.value, title);
  return applyLaneEdit(r, "input.group", r.ok && r.id ? [r.id] : undefined);
}

/** "New lane": a lane holding the selected nodes. */
export function laneFromSelection(title: string): boolean {
  const r = planLane(text.value, currentPicture.value, selectedIds.value, title);
  return applyLaneEdit(r, "input.lane", r.ok && r.id ? [r.id] : undefined);
}

/** Puts the selected nodes (other than `boxId`) into group or lane `boxId`. */
export function joinBox(ids: readonly string[], boxId: string): boolean {
  const keep = [...ids];
  return applyLaneEdit(planJoin(text.value, currentPicture.value, ids.filter((id) => id !== boxId), boxId), "input.group.join", keep);
}

/** Takes the nodes out of every group and lane that lists them. */
export function leaveBoxes(ids: readonly string[]): boolean {
  return applyLaneEdit(planLeave(text.value, currentPicture.value, ids), "input.group.leave", [...ids]);
}

/** Sets or removes the title of a group or lane. */
export function setBoxTitle(boxId: string, title: string): boolean {
  return applyLaneEdit(planTitle(text.value, currentPicture.value, boxId, title), "input.group.title", [boxId]);
}

/**
 * A node dropped inside another lane of its set joins that lane, in the same
 * step as the move (D81). `moved` is the move's changes; returns the changes to
 * apply and what to add to the message.
 */
export function dropIntoLane(moved: Change[], nodeId: string, at: Point): { changes: Change[]; note: string } {
  const l = baseLayout.value;
  const lane = l && laneAt(text.value, l, at, nodeId);
  if (!lane?.node.name) return { changes: moved, note: "" };
  const after = applyChanges(text.value, moved);
  const r = planJoin(after, currentPicture.value, [nodeId], lane.node.id);
  if (!r.ok) return { changes: moved, note: ` It stays in its lane: ${r.reason}` };
  return { changes: composeChanges(text.value, moved, r.changes), note: ` ${r.message}.` };
}

export function undoEdit(): void {
  if (view) undo(view);
}

export function redoEdit(): void {
  if (view) redo(view);
}

// ---------------------------------------------------------------- label editing

/**
 * A label being edited in place: the node, the TeX as it was, and as it is
 * now. For a node that doesn't exist yet (`creating`), nothing has been
 * written: the node is a preview, and it is added when the label is applied.
 */
export interface LabelEdit {
  /** Tells one editing session from the next, even for the same node id. */
  session: number;
  id: string;
  original: string;
  draft: string;
  creating?: { entry: PaletteEntry; placement: Placement };
  /** A label being added to an edge: nothing is written until it is applied, like a new node. */
  adding?: { edgeId: string; at: Point };
}

export const labelEdit = signal<LabelEdit | null>(null);
let sessions = 0;

/** Why the draft can't be applied, or null. */
export const labelEditProblem = computed(() => {
  const e = labelEdit.value;
  return e ? labelProblem(e.draft) : null;
});

/** Starts editing the label of node `id`, or of a label on an edge. Says why in the status bar if it can't. */
export function startLabelEdit(id: string): boolean {
  if (!canEdit()) return false;
  const l = baseLayout.value;
  const n = labelledNode(l, id);
  const why = labelBlocker(text.value, currentPicture.value, id);
  if (!n || why) {
    status.value = why ?? "There is no such node.";
    return false;
  }
  const original = draftOf(n.syntax.label!.text);
  if (n.kind === "path") {
    const e = edgeOfLabel(edges.value, id);
    selectFromCanvas(e ? { kind: "edge", id: e.id } : null);
  } else selectFromCanvas({ kind: "node", id });
  labelEdit.value = { session: ++sessions, id, original, draft: original };
  return true;
}

export function setLabelDraft(draft: string): void {
  const e = labelEdit.value;
  if (e) labelEdit.value = { ...e, draft };
}

export function cancelLabelEdit(): void {
  if (labelEdit.value?.creating || labelEdit.value?.adding) previewLayout.value = null;
  labelEdit.value = null;
}

/** Applies the label being edited. Returns false (and keeps editing) if the text can't be used. */
export function commitLabelEdit(): boolean {
  const e = labelEdit.value;
  if (!e) return true;
  if (e.creating) return commitCreate(e, e.creating);
  if (e.adding) return commitAddLabel(e, e.adding);
  if (e.draft === e.original) {
    labelEdit.value = null;
    return true;
  }
  const r = planLabelEdit(text.value, currentPicture.value, e.id, e.draft);
  if (!r.ok) {
    status.value = r.reason;
    return false;
  }
  labelEdit.value = null;
  const n = labelledNode(baseLayout.value, e.id);
  applyEdit(r.changes, "input.label");
  status.value = n?.kind === "path" ? "Changed the edge label." : `Changed the label of ${n?.name ?? e.id}.`;
  return true;
}

/** "Add label here": a label on the edge at `at`, shown with its text ready to type over. Escape leaves the code as it was. */
export function startAddLabel(edgeId: string, at: Point): boolean {
  if (!canEdit()) return false;
  const r =planAddLabel(text.value, currentPicture.value, edgeId, at, ADD_LABEL_PLACEHOLDER);
  if (!r.ok) {
    status.value = r.reason;
    return false;
  }
  previewLayout.value = r.layout;
  selection.value = { kind: "edge", id: edgeId };
  labelEdit.value = { session: ++sessions, id: r.labelId, original: ADD_LABEL_PLACEHOLDER, draft: ADD_LABEL_PLACEHOLDER, adding: { edgeId, at } };
  status.value = "New label. Type its text, then press Enter. Esc cancels. Drag it afterwards to slide it along the edge.";
  return true;
}

const ADD_LABEL_PLACEHOLDER = "label";

/** The label picked on the canvas, on the selected edge: flipping its side acts on it (D57). */
const pickedLabel = signal<{ edgeId: string; labelId: string } | null>(null);

/** Picks a label of an edge, or none. */
export function pickLabel(edgeId: string | null, labelId: string | null): void {
  pickedLabel.value = edgeId && labelId ? { edgeId, labelId } : null;
}

/** The picked label, while its edge is the selected one. */
export const selectedLabelId = computed<string | null>(() => {
  const sel = selection.value;
  const p = pickedLabel.value;
  if (!p || sel?.kind !== "edge" || sel.id !== p.edgeId) return null;
  return baseLayout.value?.pathNodes.some((n) => n.id === p.labelId) ? p.labelId : null;
});

/** "Flip side": the label goes to the other side of its edge (D57). */
export function flipLabel(labelId: string): boolean {
  const r = planFlipLabel(text.value, currentPicture.value, labelId);
  if (!r.ok) {
    status.value = r.reason;
    return false;
  }
  pickedLabel.value = { edgeId: r.edgeId, labelId: r.labelId };
  applyEdgeEdit(r.changes, "input.edge.label.flip", r.placed ? `The label sat on the line; it is beside it now: ${r.written}` : `Flipped the label to the other side of the edge: ${r.written}`, r.edgeId);
  return true;
}

/** Labels their own line cuts through (after a node move, say): the canvas marks them (D65). */
export const labelWarnings = computed(() => {
  const l = baseLayout.value;
  return l ? labelsOnTheirLine(l) : [];
});

/** The marker's fix that keeps the label's side: its side key becomes auto (D65). */
export function putLabelBesideLine(labelId: string): boolean {
  const r = planLabelBesideLine(text.value, currentPicture.value, labelId);
  if (!r.ok) {
    status.value = r.reason;
    return false;
  }
  pickedLabel.value = { edgeId: r.edgeId, labelId: r.labelId };
  applyEdgeEdit(r.changes, "input.edge.label.beside", `The label is beside the line now: ${r.written}.`, r.edgeId);
  return true;
}

/** Writes the label being added, with the text typed. An empty label adds nothing. */
function commitAddLabel(e: LabelEdit, adding: NonNullable<LabelEdit["adding"]>): boolean {
  if (e.draft.trim() === "") {
    labelEdit.value = null;
    previewLayout.value = null;
    status.value = "No label added.";
    return true;
  }
  const r = planAddLabel(text.value, currentPicture.value, adding.edgeId, adding.at, e.draft);
  if (!r.ok) {
    status.value = r.reason;
    return false;
  }
  labelEdit.value = null;
  previewLayout.value = null;
  applyEdgeEdit(r.changes, "input.edge.label", `Added the label: ${r.written}`, adding.edgeId);
  return true;
}

// ---------------------------------------------------------------- creating nodes

/** The drag-and-drop type a palette shape carries. */
export const PALETTE_DRAG = "application/x-tikzflow-shape";

/** The palette for the current picture. */
export const palette = computed<PaletteEntry[]>(() => {
  const pic = doc.value.syntax.pictures[currentPicture.value];
  const l = baseLayout.value;
  return pic && l ? paletteEntries(doc.value, pic, l) : [];
});

/** The palette entry the user picked last; new nodes from the keyboard use it. */
export const activeEntryId = signal<string | null>(null);

export const activeEntry = computed<PaletteEntry | null>(() => {
  const list = palette.value;
  const picked = list.find((e) => e.id === activeEntryId.value);
  if (picked) return picked;
  const pic = doc.value.syntax.pictures[currentPicture.value];
  const l = baseLayout.value;
  return pic && l && list.length ? defaultEntry(list, doc.value, pic, l) : null;
});

/** Asks the canvas to pan, if it has to, until this node (and the label box over it) is in view. */
export const revealRequest = signal<{ center: Point; hw: number; hh: number; seq: number } | null>(null);
let revealSeq = 0;

/** Where the canvas is centered, set by the canvas. */
export const viewCentre: { get: () => Point } = { get: () => ({ x: 0, y: 0 }) };

/**
 * Starts adding a node of `entry`: it is shown where it would go, with its
 * label ready to type over. Nothing is written until the label is applied;
 * Escape leaves the code as it was.
 */
export function startCreate(entry: PaletteEntry, placement: Placement): boolean {
  if (!canEdit()) return false;
  const r =planCreate(text.value, currentPicture.value, { entry, label: entry.placeholder, placement });
  if (!r.ok) {
    status.value = r.reason;
    return false;
  }
  previewLayout.value = r.layout;
  const made = r.layout.nodes.find((n) => n.id === r.id);
  if (made) revealRequest.value = { center: made.shape.center, hw: made.shape.hw, hh: made.shape.hh, seq: ++revealSeq };
  labelEdit.value = { session: ++sessions, id: r.id, original: entry.placeholder, draft: entry.placeholder, creating: { entry, placement } };
  status.value = `New ${entry.label.toLowerCase()} ${r.written}. Type its label, then press Enter. Esc cancels, Tab adds the next one.`;
  return true;
}

/** Writes the node being created with the label typed. Returns false (and keeps editing) if it can't be. */
function commitCreate(e: LabelEdit, creating: NonNullable<LabelEdit["creating"]>): boolean {
  const label = e.draft.trim() === "" ? e.original : e.draft;
  const r = planCreate(text.value, currentPicture.value, { entry: creating.entry, label, placement: creating.placement });
  if (!r.ok) {
    status.value = r.reason;
    return false;
  }
  labelEdit.value = null;
  previewLayout.value = null;
  const wasEmpty = !baseLayout.value?.nodes.some((n) => n.kind === "statement");
  applyEdit(r.changes, "input.create");
  selectFromCanvas({ kind: "node", id: r.id });
  // The first node of an empty picture may be off screen: bring the view to it.
  if (wasEmpty) fitRequests.value++;
  status.value = `Added ${r.name}: ${r.written}.${r.notes.map((n) => ` Also ${n}.`).join("")}`;
  return true;
}

/** Tab (a connected child) and Enter (a sibling) on the selected node. */
export function createFromKeyboard(kind: "child" | "sibling"): boolean {
  const entry = activeEntry.value;
  const l = baseLayout.value;
  if (!entry || !l) return false;
  if (!l.nodes.some((n) => n.kind === "statement")) return startCreate(entry, { kind: "at", center: viewCentre.get(), threshold: 0 });
  const primary = selectedNodes.value.at(-1);
  if (!primary || primary.kind !== "statement") {
    status.value = "Select a node first: Tab adds a connected node after it, Enter adds one beside it.";
    return false;
  }
  return startCreate(entry, { kind, of: primary.id });
}

/** A palette button: after the selected node, connected to it, or at the middle of the view. */
export function addFromPalette(entry: PaletteEntry): boolean {
  activeEntryId.value = entry.id;
  const primary = selectedNodes.value.at(-1);
  if (primary?.kind === "statement") return startCreate(entry, { kind: "child", of: primary.id });
  return startCreate(entry, { kind: "at", center: viewCentre.get(), threshold: 4 });
}

/** A palette shape dropped on the canvas at `center` (canvas pt). */
export function dropFromPalette(entry: PaletteEntry, center: Point, threshold: number): boolean {
  activeEntryId.value = entry.id;
  return startCreate(entry, { kind: "at", center, threshold });
}

// ---------------------------------------------------------------- styles and sizes

/** Selects these nodes, highlighting their code and scrolling to the first. */
export function selectNodes(ids: readonly string[]): void {
  const l = baseLayout.value;
  selection.value = ids.length ? { kind: "nodes", ids } : null;
  if (!view || !l) return;
  const ranges = rangesOf(selection.value, l);
  const r = ranges[0];
  view.dispatch({
    effects: [setHighlight.of(ranges), fromCanvas.of(null)],
    ...(r ? { selection: EditorSelection.cursor(r.from), scrollIntoView: true } : {}),
  });
}

/** Gives style `name` the body `draft`, so every node using it changes. Returns false if it was refused. */
export function applyStyleBody(name: string, draft: string): boolean {
  const r = planStyleEdit(text.value, currentPicture.value, name, draft);
  if (!r.ok) {
    status.value = r.reason;
    return false;
  }
  if (!r.changes.length) {
    status.value = "Nothing to change: the style already reads that way.";
    return false;
  }
  // Taking the last shape of a library out of a style may leave the library unused (D34).
  const lib = withLibraries(text.value, currentPicture.value, r.changes);
  applyEdit(lib.changes, "input.style");
  status.value = `Changed the ${name} style. ${r.users === 1 ? "1 node uses" : `${r.users} nodes use`} it.${libraryNote(lib.added, lib.removed, lib.notes)}`;
  return true;
}

/** Moves options several nodes repeat into a new style called `name`. Returns false if it was refused. */
export function factorOptions(repeat: Pick<Repeat, "items" | "nodes">, name: string): boolean {
  const r = planFactor(text.value, currentPicture.value, repeat, name);
  if (!r.ok) {
    status.value = r.reason;
    return false;
  }
  applyEdit(r.changes, "input.factor");
  status.value = `Added the ${name} style (${repeat.items.join(", ")}) and used it in ${r.nodes} nodes. They look exactly as before.`;
  return true;
}

/** "Match width" and "Match height": the other selected nodes get the first selected node's size. */
export function matchSize(axis: "w" | "h"): boolean {
  const l = baseLayout.value;
  const scope = activeScope.value;
  if (!l || !scope) return false;
  const ids = selectedNodes.value.filter((n) => n.kind === "statement").map((n) => n.id);
  const r = planMatch(doc.value, currentPicture.value, l, ids, axis, scope);
  if (!r.ok) {
    status.value = r.reason;
    return false;
  }
  applyEdit(r.changes, "input.match");
  const what = axis === "w" ? "width" : "height";
  const first = l.nodes.find((n) => n.id === ids[0]);
  const where = scope.kind === "style" ? ` in the ${scope.name} style, so every node using it matches` : "";
  const count = scope.kind === "style" ? "" : ` for ${r.changed.length === 1 ? "1 node" : `${r.changed.length} nodes`}`;
  status.value = `Matched the ${what} to ${first?.name ?? "the first node"} (${formatDistance(r.size)})${count}${where}.${r.notes.map((n) => ` Note: ${n}.`).join("")}`;
  return true;
}

// ---------------------------------------------------------------- edges

/** What an end is called in messages: "b.west", or "b" for the border. */
function targetName(t: EndTarget): string {
  const n = baseLayout.value?.nodes.find((x) => x.id === t.node);
  const name = n?.name ?? "the node";
  return t.anchor ? `${name}.${t.anchor}` : `the border of ${name}`;
}

/**
 * Shows edge `edgeId` with its `which` end at `target` while it is dragged
 * there, or as it is with null. Returns why it can't go there, or null.
 */
export function previewEnd(edgeId: string, which: "from" | "to", target: EndTarget | null): string | null {
  if (!target) {
    previewLayout.value = null;
    return null;
  }
  const r = planEndWithLabels(edgeId, which, target);
  previewLayout.value = r.ok ? r.layout : null;
  return r.ok ? null : r.reason;
}

/** An end moved, with labels the new line would cut through put beside it in the same edit (D65). */
function planEndWithLabels(edgeId: string, which: "from" | "to", target: EndTarget) {
  return fixLabelSides(text.value, currentPicture.value, edgeId, planEnd(text.value, currentPicture.value, edgeId, which, target));
}

/** " Also …." for each note of an edit, for the status bar. */
export function alsoNotes(notes: readonly string[]): string {
  return notes.map((n) => ` Also ${n}.`).join("");
}

/** Attaches an end of edge `edgeId` to `target` (another anchor, the border, or another node), as one undoable step. */
export function moveEnd(edgeId: string, which: "from" | "to", target: EndTarget): boolean {
  previewLayout.value = null;
  const edge = edges.value.find((e) => e.id === edgeId);
  const r = planEndWithLabels(edgeId, which, target);
  if (!r.ok) {
    status.value = r.reason;
    return false;
  }
  const other = which === "from" ? edge?.source : edge?.target;
  const name = targetName(target);
  const what = which === "from" ? "start" : "end";
  const done = other && other !== target.node ? `Reconnected the ${what} to ${name}.` : `Moved the ${what} to ${name}.`;
  applyEdgeEdit(r.changes, "input.edge.end", `${done}${alsoNotes(r.notes)}`, r.edgeId);
  return true;
}

/** Draws a new edge between two nodes, written like the picture's other connections, and selects it. */
export function connectNodes(from: EndTarget, to: EndTarget): boolean {
  const l = baseLayout.value;
  if (!l) return false;
  const r = planConnect(text.value, currentPicture.value, from, to, edgeHead(doc.value, l));
  if (!r.ok) {
    status.value = r.reason;
    return false;
  }
  applyEdit(r.changes, "input.edge.new");
  selection.value = { kind: "edge", id: r.edgeId };
  queueMicrotask(highlightSelection);
  const edge = edges.value.find((e) => e.id === r.edgeId);
  status.value = `Added an edge${edge ? ` ${edgeTitle(edge, baseLayout.value!)}` : ""}.${r.notes.map((n) => ` Also ${n}.`).join("")}`;
  return true;
}

/** How a point of an edge is written now, for messages: "++(2cm,5mm)", "(b |- a)". */
function stopText(l: PictureLayout, edgeId: string, stop: number): string {
  const s = findEdge(l, edgeId)?.route.stops[stop];
  return s ? `${s.relative ?? ""}(${s.text.trim()})` : "";
}

/** Applies an edge edit as one undoable step. The edge stays selected, as `edgeId` when the edit gave it a new id. */
export function applyEdgeEdit(changes: Change[], label: string, message: string, edgeId?: string): void {
  previewLayout.value = null;
  guides.value = { lines: [], gaps: [] };
  applyEdit(changes, label);
  if (edgeId) {
    selection.value = { kind: "edge", id: edgeId };
    queueMicrotask(highlightSelection);
  }
  status.value = message;
}

/** The message for a corner written at stop `stop` of edge `edgeId`. */
export function cornerMessage(l: PictureLayout, edgeId: string, stop: number, verb: string): string {
  return `${verb} the corner: ${stopText(l, edgeId, stop)}.`;
}

/** "Add vertex here": a corner on segment `seg` of the edge at `p`. */
export function addVertex(edgeId: string, seg: number, p: Point): boolean {
  const r = fixLabelSides(text.value, currentPicture.value, edgeId, planAddVertex(text.value, currentPicture.value, edgeId, seg, p));
  if (!r.ok) {
    status.value = r.reason;
    return false;
  }
  applyEdgeEdit(r.changes, "input.edge.vertex", `${cornerMessage(r.layout, r.edgeId ?? edgeId, r.stop, "Added")}${alsoNotes(r.notes)}`, r.edgeId);
  return true;
}

/** "Remove vertex", or a double-click on a corner. */
export function removeVertex(edgeId: string, stop: number): boolean {
  const r = fixLabelSides(text.value, currentPicture.value, edgeId, planRemoveVertex(text.value, currentPicture.value, edgeId, stop));
  if (!r.ok) {
    status.value = r.reason;
    return false;
  }
  applyEdgeEdit(r.changes, "input.edge.vertex", `Removed the corner.${alsoNotes(r.notes)}`);
  return true;
}

/** "Straighten": a plain "--" from end to end. */
export function straightenEdge(edgeId: string): boolean {
  const r = planStraighten(text.value, currentPicture.value, edgeId);
  if (!r.ok) {
    status.value = r.reason;
    return false;
  }
  applyEdgeEdit(r.changes, "input.edge.straighten", `Straightened the edge.${r.notes.map((n) => ` Also ${n}.`).join("")}`);
  return true;
}

/** The code of the statement holding edge `edgeId`, on one line and cut short, for messages. */
export function edgeCode(t: string, l: PictureLayout, edgeId: string): string {
  const e = findEdge(l, edgeId);
  if (!e) return "";
  const flat = t.slice(e.path.syntax.from, e.path.syntax.to).replace(/%[^\n]*/g, "").replace(/\s+/g, " ").trim();
  return flat.length > 90 ? `${flat.slice(0, 89)}…` : flat;
}

/** "Make orthogonal": a single corner where it can (D45). */
export function makeOrthogonal(edgeId: string): boolean {
  const r = planMakeOrthogonal(text.value, currentPicture.value, edgeId);
  if (!r.ok) {
    status.value = r.reason;
    return false;
  }
  applyEdgeEdit(r.changes, "input.edge.orthogonal", `Made the edge orthogonal: ${edgeCode(r.text, r.layout, r.edgeId ?? edgeId)}${r.notes.map((n) => ` Also ${n}.`).join("")}`, r.edgeId);
  return true;
}

/** "Make curved": a plain bend left (D45). */
export function makeCurved(edgeId: string): boolean {
  const r = planMakeCurved(text.value, currentPicture.value, edgeId);
  if (!r.ok) {
    status.value = r.reason;
    return false;
  }
  applyEdgeEdit(r.changes, "input.edge.curved", `Made the edge curved: ${edgeCode(r.text, r.layout, edgeId)}${r.notes.map((n) => ` Also ${n}.`).join("")}`);
  return true;
}

/** "Split into separate edges": one \draw per edge, arrow tips kept where they were. The same edge stays selected. */
export function splitEdge(edgeId: string): boolean {
  const r = planSplit(text.value, currentPicture.value, edgeId);
  if (!r.ok) {
    status.value = r.reason;
    return false;
  }
  const index = Number(/:(\d+)$/.exec(edgeId)?.[1] ?? 0);
  applyEdgeEdit(r.changes, "input.edge.split", `Split the \\draw into ${r.edgeIds.length} statements, one per edge. Each end can be moved on its own now.`, r.edgeIds[index]);
  return true;
}

/**
 * Applies an edge-properties edit (arrow, dash, color, width) to the edge or
 * to a style it uses, as one undoable step. `extra` holds changes that go with
 * it, such as a new \definecolor. Returns false if it was refused.
 */
export function applyEdgeProperty(edgeId: string, scope: EdgeScope, edit: EdgeEdit, extra: Change[] = [], done = "Changed the edge"): boolean {
  const r = planEdgeProperty(text.value, currentPicture.value, edgeId, scope, edit, extra);
  if (!r.ok) {
    status.value = r.reason;
    return false;
  }
  if (!r.changes.length) {
    status.value = "Nothing to change: it already looks that way.";
    return false;
  }
  applyEdgeEdit(r.changes, "input.edge.props", `${done}${scope.kind === "style" ? ` through the ${scope.name} style` : ""}.${r.notes.map((n) => ` Note: ${n}.`).join("")}`);
  return true;
}

/**
 * "Split and apply" (D58 item 5): an arrow edit for one edge of a `\draw` with
 * several edges. The path is split and the tip set on this edge's own statement,
 * as one undoable step. The same edge stays selected.
 */
export function splitAndApplyArrow(edgeId: string, edit: EdgeEdit, done = "Changed the arrow of the edge"): boolean {
  const r = planSplitAndApply(text.value, currentPicture.value, edgeId, edit);
  if (!r.ok) {
    status.value = r.reason;
    return false;
  }
  applyEdgeEdit(r.changes, "input.edge.splitapply", `${done}, after splitting the path.${r.notes.map((n) => ` Note: ${n}.`).join("")}`, r.edgeId);
  return true;
}

/**
 * Deletes the selected nodes, edge or path as one undoable step (D56). Nodes
 * placed relative to a deleted node are re-attached or pinned, and edges that
 * would be left dangling go too. Returns false if it was refused, with the
 * reason in the status bar.
 */
export function deleteSelection(): boolean {
  const sel = selection.peek();
  if (!sel || !view) return false;
  const target: DeleteTarget = sel.kind === "nodes" ? { kind: "nodes", ids: sel.ids } : sel;
  const r = planDelete(text.value, currentPicture.value, target);
  if (!r.ok) {
    status.value = r.reason;
    return false;
  }
  previewLayout.value = null;
  guides.value = { lines: [], gaps: [] };
  selection.value = null;
  applyEdit(r.changes, "delete.selection");
  status.value = `${r.message}.${r.notes.map((n) => ` Also: ${n}.`).join("")}`;
  return true;
}
