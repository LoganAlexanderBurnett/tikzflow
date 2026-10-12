// Tabs (M5 step 6, D97): several diagrams open at once, each with its own code, undo history, file, kept
// copy and TeX picture. One CodeMirror view shows the tab on screen; every other tab keeps its editor state
// (undo history included) in memory, and its diagram in IndexedDB (`doc:<id>`, see kv.ts).
//
// Never losing work is the rule this file is built around:
// - **One writer per diagram.** A window edits a tab only while it holds that tab's Web Lock, and it holds
//   one lock at a time: the tab it shows. A second window showing the same tab shows it read-only, follows
//   the first one's saves, and can take it over with Edit here (the first window saves, then lets go).
// - **No blind overwrites.** Every write names the revision it replaces (`writeDoc`). If another window wrote
//   meanwhile (a browser without Web Locks, a lock taken by force), nothing is overwritten: this window's
//   version is kept as a separate tab, "(your copy)".
// - **An interrupted close.** The tab on screen is saved half a second after each change, and when the page
//   is hidden or closed. IndexedDB may not finish a write that starts as the page goes, so the same data goes
//   synchronously into localStorage first (the journal). The next start stores what the journal has and
//   IndexedDB lacks, or keeps it as a "(recovered)" tab when both changed.
// - **Closing a tab** keeps its work in Recently closed (the last 20).

import { EditorState, type Extension, Transaction } from "@codemirror/state";
import { batch, effect, signal } from "@preact/signals";
import type { Encoding } from "../source/encoding.ts";
import { CLOSED_KEPT, type ClosedRecord, copyTitle, type DocRecord, type FsHandle, type Journal, journalAction, startTab, tabName, worthKeeping } from "./docs.ts";
import { editorExtensions, readOnlyCompartment, readOnlyWhile } from "./editor.ts";
import { closeDoc, del, docKey, get, handleKey, listClosed, listDocs, migrateLegacy, put, reopenDoc, writeDoc } from "./kv.ts";
import { type PictureStash, restorePictures, stashPictures } from "./preview.ts";
import { editLock, editorView, encoding, fileName, onEditorChange, onEditorCursor, pictureIndex, replaceDocument, status, swapEditorState, text } from "./store.ts";

/** A tab of this window. */
export interface Tab {
  id: string;
  /** The diagram as last read, written or left. For the tab on screen the live values are the store's signals. */
  rec: DocRecord;
  /** The editor state with its undo history, once the tab has been shown in this window. */
  state: EditorState | null;
  /** The file Save writes to. */
  handle: FsHandle | null;
  /** The stored revision this window's copy is based on; null when it was never stored. */
  base: number | null;
  /** What was last stored, to skip writes that change nothing (`fingerprint`). */
  written: string | null;
  /** TeX's pictures of it, while another tab is on screen. */
  pictures: PictureStash | null;
  /** Another window's saves were brought into its editor: its undo history no longer fits. */
  mirrored: boolean;
}

/** The text as last opened or saved, of the tab on screen. */
export const savedText = signal("");
/** The file the tab on screen is linked to, when the browser let us keep a handle to it. */
export const fileHandle = signal<FsHandle | null>(null);
/** What the tab on screen is called when it has no file name. */
export const activeTitle = signal("Untitled");
export const tabs = signal<readonly Tab[]>([]);
export const activeId = signal("");
/** Tabs closed with work in them, newest first. */
export const closedTabs = signal<readonly ClosedRecord[]>([]);
/** Tabs another window has on screen. */
export const elsewhere = signal<ReadonlySet<string>>(new Set());
/** Bumped when a tab not on screen changes (its name, its saved state), for the tab bar. */
export const tabsVersion = signal(0);
const touch = () => tabsVersion.value++;

/** The reason shown while another window edits the tab on screen. */
export const ELSEWHERE = "This diagram is open for editing in another window, so it is read-only here. Edit here takes it over.";

const SAVE_DELAY_MS = 500;
const TAKEOVER_WAIT_MS = 3000;
const ELSEWHERE_POLL_MS = 10_000;
const REMEMBER_KEY = "tikzflow.tab";
const JOURNAL = "tikzflow.journal.";
const LOCK = "tikzflow-tab:";

export const newId = (): string => (typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

/** What a write would change: two records with the same fingerprint store the same diagram. */
const fingerprint = (r: DocRecord): string => JSON.stringify([r.text, r.savedText, r.fileName, r.encoding, r.pictureIndex, r.title]);

const find = (id: string): Tab | undefined => tabs.peek().find((t) => t.id === id);
export const activeTab = (): Tab | undefined => find(activeId.peek());

/** The tab's diagram as it is now: from the signals for the tab on screen. */
function recordOf(tab: Tab): DocRecord {
  if (tab.id !== activeId.peek()) return tab.rec;
  return { ...tab.rec, text: text.peek(), savedText: savedText.peek(), fileName: fileName.peek(), encoding: encoding.peek(), pictureIndex: pictureIndex.peek(), title: activeTitle.peek() };
}

/** It has changes not yet stored (an empty tab that was never stored has nothing to store). */
function pending(tab: Tab): DocRecord | null {
  const rec = recordOf(tab);
  if (fingerprint(rec) === tab.written) return null;
  if (tab.base === null && !rec.text.trim()) return null;
  return rec;
}

function makeTab(rec: DocRecord, stored = false): Tab {
  return { id: rec.id, rec, state: null, handle: null, base: stored ? rec.rev : null, written: stored ? fingerprint(rec) : null, pictures: null, mirrored: false };
}

const emptyRecord = (): DocRecord => ({ id: newId(), title: "Untitled", text: "", savedText: "", fileName: null, encoding: "utf-8", pictureIndex: 0, created: Date.now(), rev: 0, savedAt: Date.now() });

let extensions: Extension[] | null = null;
function makeState(doc: string): EditorState {
  extensions ??= editorExtensions({ onChange: onEditorChange, onCursor: onEditorCursor });
  return EditorState.create({ doc, extensions });
}

/** The editor state the code pane starts with: the tab on screen's. */
export function currentState(): EditorState {
  const tab = activeTab();
  if (!tab) return makeState(text.peek());
  tab.state ??= makeState(tab.rec.text);
  return tab.state;
}

// ---- Running things one at a time ----------------------------------------------------------------

/** Tab operations (switching, opening, closing, taking over) run one after another. */
let ops: Promise<unknown> = Promise.resolve();
function serial<T>(run: () => Promise<T>): Promise<T> {
  const p = ops.then(run);
  ops = p.catch(() => {});
  return p;
}

/** Writes to IndexedDB run one after another, so two writes of a tab never race (and a close never overtakes a save). */
let writes: Promise<unknown> = Promise.resolve();
function inWrites<T>(run: () => Promise<T>): Promise<T> {
  const p = writes.then(run);
  writes = p.catch(() => {});
  return p;
}

// ---- Between windows: Web Locks and a broadcast channel ------------------------------------------------

type Message = { type: "changed"; id: string } | { type: "closed"; id: string } | { type: "release"; id: string } | { type: "released"; id: string } | { type: "shown"; id: string };
const channel: BroadcastChannel | null = typeof BroadcastChannel === "function" ? new BroadcastChannel("tikzflow-tabs") : null;
const post = (m: Message) => channel?.postMessage(m);

const lockManager = (): LockManager | null => (typeof navigator !== "undefined" && navigator.locks) || null;
/** The locks this window holds: the tab on screen's, and briefly a tab being closed. */
const held = new Map<string, () => void>();

/** Takes tab `id`'s lock: "try" only if it is free; "wait" up to `ms`; "steal" from the window that holds it. */
function acquire(id: string, how: "try" | "wait" | "steal", ms = 0): Promise<boolean> {
  const lm = lockManager();
  if (!lm || held.has(id)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let granted = false;
    const abort = how === "wait" ? new AbortController() : null;
    const timer = abort ? setTimeout(() => abort.abort(), ms) : null;
    const options: LockOptions = how === "try" ? { ifAvailable: true } : how === "steal" ? { steal: true } : { signal: abort!.signal };
    lm.request(LOCK + id, options, (lock) => {
      if (timer) clearTimeout(timer);
      if (!lock) {
        resolve(false);
        return;
      }
      granted = true;
      return new Promise<void>((release) => {
        held.set(id, release);
        resolve(true);
      });
    }).catch(() => {
      if (timer) clearTimeout(timer);
      if (!granted) resolve(false);
      else void lost(id);
    });
  });
}

/** Lets go of tab `id`'s lock; `announce` tells a window showing it read-only that it can take it. */
function letGo(id: string, announce = true): void {
  const release = held.get(id);
  if (!release) return;
  held.delete(id);
  release();
  if (announce) post({ type: "released", id });
}

/** Tabs other windows have on screen. */
async function refreshElsewhere(): Promise<void> {
  const lm = lockManager();
  if (!lm) return;
  try {
    const q = await lm.query();
    const ids = new Set((q.held ?? []).map((l) => l.name ?? "").filter((n) => n.startsWith(LOCK)).map((n) => n.slice(LOCK.length)));
    for (const id of held.keys()) ids.delete(id);
    const cur = elsewhere.peek();
    if (ids.size !== cur.size || [...ids].some((i) => !cur.has(i))) elsewhere.value = ids;
  } catch {
    // Not offered (an old browser): no markers.
  }
}

/** The tab on screen becomes read-only, or editable again. */
function setEditable(on: boolean): void {
  const v = editorView();
  if (v && v.state.facet(EditorState.readOnly) === on) v.dispatch({ effects: readOnlyCompartment.reconfigure(readOnlyWhile(!on)) });
  editLock.value = on ? null : ELSEWHERE;
}

/** Another window took the lock by force (it waited for this one and gave up): what wasn't saved is saved now, kept as a copy if needed. */
async function lost(id: string): Promise<void> {
  held.delete(id);
  const tab = find(id);
  if (!tab) return;
  await flush(tab);
  if (id === activeId.peek()) {
    setEditable(false);
    status.value = "Another window took over this diagram, so it is read-only here. Edit here takes it back.";
  }
  void refreshElsewhere();
}

// ---- Saving ------------------------------------------------------------------------------------------

/** Stores the tab's diagram if it changed. Never replaces a version this window hasn't seen (D97). */
export function flush(tab: Tab): Promise<void> {
  return inWrites(async () => {
    if (!tabs.peek().includes(tab)) return;
    // Read-only here: another window is the one that writes it.
    if (tab.id === activeId.peek() && editLock.peek()) return;
    const rec = pending(tab);
    if (!rec) return;
    const fp = fingerprint(rec);
    const out: DocRecord = { ...rec, rev: (tab.base ?? 0) + 1, savedAt: Date.now() };
    const r = await writeDoc(out, tab.base);
    if (r === "written") {
      tab.base = out.rev;
      tab.written = fp;
      tab.rec = out;
      clearJournal(tab.id, fp);
      post({ type: "changed", id: tab.id });
      touch();
    } else if (r === "conflict") {
      await keepConflict(tab, out);
    }
    // "failed": storage is refused (a private window); the work stays in this page.
  });
}

/**
 * Another window wrote this tab since this window last read it, and this window has changes of its own.
 * Both are kept: the tab takes the other window's version, and this window's goes to a new tab, "(your
 * copy)", with the editor's undo history, which is then shown. Runs inside the writes chain.
 */
async function keepConflict(tab: Tab, mine: DocRecord): Promise<void> {
  const stored = await get<DocRecord>(docKey(tab.id));
  if (!stored) {
    // Gone meanwhile (closed elsewhere): it is written back on the next save.
    tab.base = null;
    tab.written = null;
    return;
  }
  const now = Date.now();
  const rec: DocRecord = { ...mine, id: newId(), title: copyTitle(tabName(mine), "conflict"), fileName: null, created: now, rev: 1, savedAt: now };
  const copy = makeTab(rec);
  if ((await writeDoc(rec, null)) === "written") {
    copy.base = 1;
    copy.written = fingerprint(rec);
    post({ type: "changed", id: rec.id });
  }
  const onScreen = tab.id === activeId.peek();
  // The copy has no file: two tabs saving to one file would be the same race again.
  copy.state = onScreen ? (editorView()?.state ?? tab.state) : tab.state;
  tab.state = null;
  tabs.value = [...tabs.peek(), copy];
  adopt(tab, stored);
  status.value = `“${tabName(stored)}” was changed in another window at the same time. Both versions are kept: yours is in the tab “${rec.title}”.`;
  if (onScreen) void serial(() => activateNow(copy.id));
}

/** Takes another window's stored version of the tab: into its editor (without an undo step) when it is on screen. */
function adopt(tab: Tab, stored: DocRecord): void {
  tab.rec = stored;
  tab.base = stored.rev;
  tab.written = fingerprint(stored);
  if (tab.id !== activeId.peek()) {
    if (tab.state && tab.state.doc.toString() !== stored.text) tab.state = null;
    touch();
    return;
  }
  batch(() => {
    fileName.value = stored.fileName;
    encoding.value = stored.encoding;
    pictureIndex.value = stored.pictureIndex;
    savedText.value = stored.savedText;
    activeTitle.value = stored.title;
  });
  const v = editorView();
  if (v && v.state.doc.toString() !== stored.text) {
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: stored.text }, annotations: Transaction.addToHistory.of(false) });
    tab.mirrored = true;
  }
  touch();
}

// ---- The journal: the last changes, when the page goes before IndexedDB has them ------------------------

function writeJournals(): void {
  for (const tab of tabs.peek()) {
    const rec = pending(tab);
    if (!rec) continue;
    const entry: Journal & { fp: string } = { rec: { ...rec, savedAt: Date.now() }, baseRev: tab.base, fp: fingerprint(rec) };
    try {
      localStorage.setItem(JOURNAL + tab.id, JSON.stringify(entry));
    } catch {
      // Full or refused: IndexedDB's write is all there is.
    }
  }
}

/** Removes tab `id`'s journal entry, if it holds what was just stored (`fp`), or in any case without `fp`. */
function clearJournal(id: string, fp?: string): void {
  try {
    const raw = localStorage.getItem(JOURNAL + id);
    if (raw === null) return;
    if (fp !== undefined && (JSON.parse(raw) as { fp?: string }).fp !== fp) return;
    localStorage.removeItem(JOURNAL + id);
  } catch {
    // Nothing to do.
  }
}

/** Stores what journals hold that IndexedDB doesn't (not for tabs another window has open: it will). Says what was kept as a copy. */
async function recoverJournals(busy: ReadonlySet<string>): Promise<string[]> {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(JOURNAL)) keys.push(k);
    }
  } catch {
    return [];
  }
  const copies: string[] = [];
  for (const k of keys) {
    const id = k.slice(JOURNAL.length);
    if (busy.has(id)) continue;
    let j: Journal | null = null;
    try {
      j = JSON.parse(localStorage.getItem(k) ?? "null") as Journal | null;
    } catch {
      j = null;
    }
    if (!j?.rec || typeof j.rec.text !== "string") {
      localStorage.removeItem(k);
      continue;
    }
    const stored = await get<DocRecord>(docKey(id));
    const action = journalAction(j, stored);
    let done = action === "drop";
    if (action === "apply") done = (await writeDoc({ ...j.rec, id, rev: (stored?.rev ?? 0) + 1 }, stored?.rev ?? null)) === "written";
    if (action === "copy") {
      const title = copyTitle(tabName(j.rec), "recovered");
      done = (await writeDoc({ ...j.rec, id: newId(), title, fileName: null, created: Date.now(), rev: 1 }, null)) === "written";
      if (done) copies.push(title);
    }
    if (done) localStorage.removeItem(k);
  }
  return copies;
}

// ---- Showing a tab -------------------------------------------------------------------------------------

function remember(id: string): void {
  try {
    sessionStorage.setItem(REMEMBER_KEY, id);
  } catch {
    // Refused: a reload starts on the most recently edited tab instead.
  }
}
function remembered(): string | null {
  try {
    return sessionStorage.getItem(REMEMBER_KEY);
  } catch {
    return null;
  }
}

/** Puts the tab on screen; `own` says whether this window may edit it. */
function show(tab: Tab, own: boolean): void {
  let state = tab.state;
  // Another window's saves came in while it was read-only here: its undo history would undo across them.
  if (!state || (own && tab.mirrored)) state = makeState(tab.rec.text);
  tab.mirrored = false;
  if (state.facet(EditorState.readOnly) === own) state = state.update({ effects: readOnlyCompartment.reconfigure(readOnlyWhile(!own)) }).state;
  tab.state = state;
  batch(() => {
    activeId.value = tab.id;
    activeTitle.value = tab.rec.title;
    fileName.value = tab.rec.fileName;
    encoding.value = tab.rec.encoding;
    pictureIndex.value = tab.rec.pictureIndex;
    savedText.value = tab.rec.savedText;
    fileHandle.value = tab.handle;
    editLock.value = own ? null : ELSEWHERE;
    restorePictures(tab.pictures);
    swapEditorState(state);
  });
  remember(tab.id);
}

/** Leaves the tab on screen: keeps its editor state, file and pictures, stores it, and lets go of its lock. */
async function leave(tab: Tab): Promise<void> {
  const capture = () => {
    const v = editorView();
    if (v) tab.state = v.state;
    tab.rec = recordOf(tab);
    tab.handle = fileHandle.peek();
  };
  capture();
  tab.pictures = stashPictures();
  await flush(tab);
  // Typing that landed while it was being stored.
  capture();
  if (pending(tab)) await flush(tab);
  letGo(tab.id);
}

/** Shows tab `id`. Run inside `serial`. */
async function activateNow(id: string): Promise<void> {
  const next = find(id);
  if (!next) return;
  const cur = activeTab();
  if (cur?.id === id) return;
  if (cur) await leave(cur);
  const own = await acquire(id, "try");
  // Another window may have edited it since this window last had it.
  if (next.base !== null || !own) {
    const stored = await get<DocRecord>(docKey(id));
    if (stored && stored.rev !== next.base) {
      next.rec = stored;
      next.base = stored.rev;
      next.written = fingerprint(stored);
      if (next.state && next.state.doc.toString() !== stored.text) next.state = null;
    }
  }
  show(next, own);
  // Other windows mark the tab as open here.
  if (own) post({ type: "shown", id });
  void refreshElsewhere();
}

/** Shows tab `id`. */
export const switchTab = (id: string): Promise<void> => serial(() => activateNow(id));

/** A new, empty tab: the start screen. */
export function newTab(): Promise<void> {
  return serial(async () => {
    const tab = makeTab(emptyRecord());
    tabs.value = [...tabs.peek(), tab];
    await activateNow(tab.id);
    status.value = null;
  });
}

/** A diagram to open in a tab. */
export interface OpenDoc {
  text: string;
  fileName: string | null;
  encoding: Encoding;
  /** The text as last opened or saved ("" when it was never saved anywhere). */
  savedText: string;
  /** What the tab is called when there is no file name. */
  title: string;
  pictureIndex?: number;
  handle?: FsHandle | null;
}

function keepHandle(id: string, h: FsHandle | null): void {
  if (h) void put(handleKey(id), h);
  else void del(handleKey(id));
}

/**
 * Opens a diagram in a new tab (D86 item 5), or in the tab on screen when it is empty (as the start screen
 * is), undoably. Says which.
 */
export function openDocument(d: OpenDoc): Promise<"here" | "new"> {
  return serial(async () => {
    const cur = activeTab();
    if (cur && editorView() && !editLock.peek() && !text.peek().trim()) {
      replaceDocument(d.text, d.fileName, d.encoding);
      batch(() => {
        savedText.value = d.savedText;
        pictureIndex.value = d.pictureIndex ?? 0;
        activeTitle.value = d.title;
        fileHandle.value = d.handle ?? null;
      });
      keepHandle(cur.id, d.handle ?? null);
      void flush(cur);
      return "here";
    }
    const now = Date.now();
    const tab = makeTab({ id: newId(), title: d.title, text: d.text, savedText: d.savedText, fileName: d.fileName, encoding: d.encoding, pictureIndex: d.pictureIndex ?? 0, created: now, rev: 0, savedAt: now });
    tab.handle = d.handle ?? null;
    tabs.value = [...tabs.peek(), tab];
    keepHandle(tab.id, tab.handle);
    await activateNow(tab.id);
    void flush(tab);
    return "new";
  });
}

/** Links the tab on screen to a file (Save as…), or unlinks it. */
export function linkFile(h: FsHandle | null): void {
  fileHandle.value = h;
  const tab = activeTab();
  if (!tab) return;
  tab.handle = h;
  keepHandle(tab.id, h);
}

/** Closes tab `id`. Its work goes to Recently closed; the tab next to it is shown. */
export function closeTab(id: string): Promise<void> {
  return serial(async () => {
    const tab = find(id);
    if (!tab) return;
    const onScreen = id === activeId.peek();
    const own = onScreen ? !editLock.peek() : await acquire(id, "try");
    if (!own) {
      status.value = `“${tabName(recordOf(tab))}” is open in another window. Close it there${onScreen ? ", or use Edit here first" : ""}.`;
      return;
    }
    if (onScreen) tab.handle = fileHandle.peek();
    const rec = recordOf(tab);
    const keep: ClosedRecord | null = worthKeeping(rec.text) ? { ...rec, closedAt: Date.now(), ...(tab.handle ? { handle: tab.handle } : {}) } : null;
    const list = tabs.peek();
    const at = list.indexOf(tab);
    const rest = list.filter((t) => t !== tab);
    tabs.value = rest;
    await inWrites(() => closeDoc(id, keep));
    clearJournal(id);
    if (keep) closedTabs.value = [keep, ...closedTabs.peek().filter((c) => c.id !== id)].slice(0, CLOSED_KEPT);
    post({ type: "closed", id });
    letGo(id, false);
    if (onScreen) {
      const next = rest[at] ?? rest[at - 1];
      if (next) await activateNow(next.id);
      else {
        const blank = makeTab(emptyRecord());
        tabs.value = [blank];
        await activateNow(blank.id);
      }
    }
    status.value = keep ? `Closed “${tabName(rec)}”. Recently closed brings it back.` : `Closed “${tabName(rec)}”.`;
  });
}

/** Reads Recently closed again (another window may have closed tabs). */
export async function refreshClosed(): Promise<void> {
  const list = await listClosed();
  closedTabs.value = list;
}

/** Opens a closed tab again, in a new tab. */
export function reopenClosed(id: string): Promise<void> {
  return serial(async () => {
    const c = closedTabs.peek().find((x) => x.id === id);
    if (!c) return;
    const { closedAt: _closedAt, handle, ...data } = c;
    const now = Date.now();
    const rec: DocRecord = { ...data, id: newId(), created: now, rev: 1, savedAt: now };
    const stored = await inWrites(() => reopenDoc(c, rec));
    closedTabs.value = closedTabs.peek().filter((x) => x !== c);
    const tab = makeTab(rec, stored);
    tab.handle = (handle as FsHandle | undefined) ?? null;
    tabs.value = [...tabs.peek(), tab];
    if (stored) post({ type: "changed", id: rec.id });
    await activateNow(tab.id);
    status.value = `Reopened “${tabName(rec)}”.`;
  });
}

/**
 * Edit here: takes over the tab on screen from the window editing it. That window is asked to save and let
 * go; if it doesn't answer (frozen, say), the lock is taken anyway and whatever it hadn't saved is kept as a
 * copy there when it wakes.
 */
export function takeOver(): Promise<void> {
  return serial(async () => {
    const tab = activeTab();
    if (!tab || !editLock.peek()) return;
    post({ type: "release", id: tab.id });
    let own = await acquire(tab.id, "wait", TAKEOVER_WAIT_MS);
    if (!own) own = await acquire(tab.id, "steal");
    if (!own) {
      status.value = "The other window didn't let go of this diagram. Try again, or close it there.";
      return;
    }
    await gainedOnScreen(tab);
    status.value = "You are editing this diagram here now. The other window shows it read-only.";
  });
}

/** This window got the lock of the tab on screen: it reads what the other window stored, then becomes editable. */
async function gainedOnScreen(tab: Tab): Promise<void> {
  const stored = await get<DocRecord>(docKey(tab.id));
  if (stored && stored.rev !== tab.base) adopt(tab, stored);
  if (tab.mirrored) {
    // Its undo history predates the other window's edits.
    tab.state = makeState(text.peek());
    tab.mirrored = false;
    swapEditorState(tab.state);
  }
  setEditable(true);
  void refreshElsewhere();
}

/** The tab on screen is read-only here and the window that had it let go: take it, if this window is in front. */
function takeIfFree(): void {
  const tab = activeTab();
  if (!tab || !editLock.peek() || document.visibilityState !== "visible") return;
  void serial(async () => {
    if (!editLock.peek() || activeTab() !== tab) return;
    if (await acquire(tab.id, "try")) {
      await gainedOnScreen(tab);
      status.value = "The other window let go of this diagram: you can edit it here now.";
    }
  });
}

function onMessage(m: Message): void {
  void refreshElsewhere();
  if (m.type === "release") {
    if (!held.has(m.id)) return;
    void serial(async () => {
      const tab = find(m.id);
      if (!tab || !held.has(m.id)) return;
      await flush(tab);
      if (m.id === activeId.peek()) setEditable(false);
      letGo(m.id, false);
      post({ type: "released", id: m.id });
      if (m.id === activeId.peek()) status.value = "Another window is editing this diagram now, so it is read-only here. Edit here takes it back.";
    });
    return;
  }
  if (m.type === "released") {
    if (m.id === activeId.peek()) takeIfFree();
    return;
  }
  if (m.type === "shown") return;
  if (m.type === "closed") {
    void serial(async () => {
      const tab = find(m.id);
      if (!tab) return;
      if (pending(tab)) {
        // Changes of this window's own: written back as a new record on the next save.
        tab.base = null;
        tab.written = null;
        void flush(tab);
        return;
      }
      const list = tabs.peek();
      const at = list.indexOf(tab);
      const rest = list.filter((t) => t !== tab);
      tabs.value = rest;
      void refreshClosed();
      if (m.id !== activeId.peek()) return;
      const next = rest[at] ?? rest[at - 1];
      if (next) await activateNow(next.id);
      else {
        const blank = makeTab(emptyRecord());
        tabs.value = [blank];
        await activateNow(blank.id);
      }
    });
    return;
  }
  // "changed": another window stored a tab.
  void serial(async () => {
    const stored = await get<DocRecord>(docKey(m.id));
    if (!stored) return;
    const tab = find(m.id);
    if (!tab) {
      tabs.value = [...tabs.peek(), makeTab(stored, true)];
      return;
    }
    if (tab.base === stored.rev || pending(tab)) return;
    adopt(tab, stored);
  });
}

// ---- Starting --------------------------------------------------------------------------------------------

/**
 * Reads the tabs kept in this browser, before the editor renders: moves the single session of before tabs
 * into tabs, stores what journals of an interrupted close hold, drops empty tabs, and reads Recently closed.
 * Returns the names of tabs kept as "(recovered)" copies.
 */
export async function loadTabs(): Promise<string[]> {
  await migrateLegacy(newId, worthKeeping);
  await refreshElsewhere();
  const busy = elsewhere.peek();
  const recovered = await recoverJournals(busy);
  const docs = await listDocs();
  const kept: Tab[] = [];
  for (const d of docs) {
    if (!d.text.trim() && !busy.has(d.id)) {
      void del(docKey(d.id));
      void del(handleKey(d.id));
      continue;
    }
    const tab = makeTab(d, true);
    tab.handle = (await get<FsHandle>(handleKey(d.id))) ?? null;
    kept.push(tab);
  }
  tabs.value = kept;
  closedTabs.value = await listClosed();
  return recovered;
}

/** Shows the tab this window starts on (D97: `startTab`), or a new empty one. */
export function showStartTab(): Promise<void> {
  return serial(async () => {
    const list = tabs.peek();
    const id = startTab(list.map((t) => t.rec), remembered(), elsewhere.peek());
    if (id) return activateNow(id);
    const blank = makeTab(emptyRecord());
    tabs.value = [...list, blank];
    return activateNow(blank.id);
  });
}

/**
 * Saves as you type: the tab on screen half a second after its last change, every tab with changes when the
 * page is hidden or closed (into the journal first, synchronously). Also listens to the other windows.
 */
export function startAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const saveOnScreen = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const tab = activeTab();
    if (tab) void flush(tab);
  };
  const stop = effect(() => {
    void text.value;
    void fileName.value;
    void encoding.value;
    void pictureIndex.value;
    void savedText.value;
    void activeTitle.value;
    if (timer) clearTimeout(timer);
    timer = setTimeout(saveOnScreen, SAVE_DELAY_MS);
  });
  const saveAll = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    writeJournals();
    for (const tab of tabs.peek()) if (pending(tab)) void flush(tab);
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") saveAll();
    else {
      void refreshElsewhere();
      takeIfFree();
    }
  };
  const onFocus = () => {
    void refreshElsewhere();
    takeIfFree();
  };
  const onChannel = (e: MessageEvent<Message>) => onMessage(e.data);
  // A window that closes sends nothing: its tabs' markers go on the next look.
  const poll = setInterval(() => document.visibilityState === "visible" && void refreshElsewhere(), ELSEWHERE_POLL_MS);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", saveAll);
  window.addEventListener("focus", onFocus);
  channel?.addEventListener("message", onChannel);
  return () => {
    stop();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", saveAll);
    window.removeEventListener("focus", onFocus);
    channel?.removeEventListener("message", onChannel);
    clearInterval(poll);
    if (timer) clearTimeout(timer);
  };
}
