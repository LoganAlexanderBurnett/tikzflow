// Save and open (M3 step 12, D74): the work is kept in the browser as you type
// (IndexedDB), a file can be opened and saved in place with the File System
// Access API where the browser has it (Chromium), and everywhere else Open is a
// file chooser and Save a download. Nothing leaves the computer.

import { effect, signal } from "@preact/signals";
import { LayoutCancelled, runImport } from "../edit/layoutjobs.ts";
import { detectFormat, IMPORT_EXTENSIONS, type ImportOptions, type ImportResult } from "../import/index.ts";
import { decode, encode, type Encoding, UnencodableError } from "../source/encoding.ts";
import { del, get, put, type Session } from "./kv.ts";
import { isPristine, templateInfo, templateText } from "../templates/index.ts";
import { decodeShare, isShareHash } from "./share.ts";
import { encoding, fileName, pictureIndex, replaceDocument, status, text, withProgress } from "./store.ts";

/** The text the editor starts with: the work kept from the last visit, else nothing, which shows the empty state (D96). Set by `restoreOnStart`. */
let startText = "";
export const initialText = (): string => startText;
export function setInitialText(t: string): void {
  startText = t;
}

export type { Session };

// ---- File System Access API (not in TypeScript's DOM types) ----------------------------------

interface FsWritable {
  write(data: BufferSource): Promise<void>;
  close(): Promise<void>;
}
export interface FsHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<FsWritable>;
  queryPermission?(d: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission?(d: { mode: "readwrite" }): Promise<PermissionState>;
}
interface PickerWindow {
  showOpenFilePicker?(o: unknown): Promise<FsHandle[]>;
  showSaveFilePicker?(o: unknown): Promise<FsHandle>;
}
const picker = (): PickerWindow => window as unknown as PickerWindow;
const TEX_TYPES = [{ description: "TeX, Mermaid and DOT files", accept: { "text/x-tex": [".tex", ".tikz", ".pgf"], "text/plain": [".txt", ...IMPORT_EXTENSIONS] } }];

/** The browser can open and save files in place. */
export const canSaveInPlace = (): boolean => typeof picker().showSaveFilePicker === "function" && typeof picker().showOpenFilePicker === "function";

// ---- State -----------------------------------------------------------------------------------

/** The text as last opened or saved. */
export const savedText = signal("");
/** The file being edited, when the browser let us keep a handle to it. */
export const fileHandle = signal<FsHandle | null>(null);
/** Work that was put aside when something else was opened (a file, a link), to be got back. */
export const previousWork = signal<Session | null>(null);
/** The work differs from what was last opened or saved. */
export const unsaved = (): boolean => text.value !== savedText.value;

/** Reads the session kept in this browser, if any, and the handle of its file. */
export async function loadSession(): Promise<Session | null> {
  const s = await get<Session>("session");
  const h = await get<FsHandle>("handle");
  fileHandle.value = h && s?.fileName === h.name ? h : null;
  previousWork.value = (await get<Session>("previous")) ?? null;
  return s && typeof s.text === "string" ? s : null;
}

/** Puts a restored session on screen's state (the text itself is the editor's initial document). */
export function adoptSession(s: Session): void {
  fileName.value = s.fileName;
  encoding.value = s.encoding;
  pictureIndex.value = s.pictureIndex;
  savedText.value = s.savedText;
}

function currentSession(): Session {
  return { text: text.peek(), savedText: savedText.peek(), fileName: fileName.peek(), encoding: encoding.peek(), pictureIndex: pictureIndex.peek(), savedAt: Date.now() };
}

/** Keeps the work as it changes: a moment after the last change, and when the page is hidden or closed. */
export function startAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    void put("session", currentSession());
  };
  const stop = effect(() => {
    void text.value;
    void fileName.value;
    void encoding.value;
    void pictureIndex.value;
    void savedText.value;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 500);
  });
  const hide = () => document.visibilityState === "hidden" && flush();
  document.addEventListener("visibilitychange", hide);
  window.addEventListener("pagehide", flush);
  return () => {
    stop();
    document.removeEventListener("visibilitychange", hide);
    window.removeEventListener("pagehide", flush);
    if (timer) clearTimeout(timer);
  };
}

/** Sets the work aside before something replaces it, unless there is nothing worth keeping (empty, or a template as it comes). Says whether it did. */
async function putAside(): Promise<boolean> {
  const s = currentSession();
  if (!worthKeeping(s.text)) return false;
  previousWork.value = s;
  await put("previous", s);
  return true;
}

/** Work worth putting aside or continuing: not empty, and not a template (or the sample) untouched. */
export function worthKeeping(text: string): boolean {
  return !!text.trim() && !isPristine(text);
}

/** Brings back the work that was put aside. */
export async function restorePrevious(): Promise<void> {
  const p = previousWork.value;
  if (!p) return;
  await putAside();
  fileHandle.value = null;
  void del("handle");
  replaceDocument(p.text, p.fileName, p.encoding);
  savedText.value = p.savedText;
  status.value = "Brought back your previous work.";
}

// ---- Open ------------------------------------------------------------------------------------

/** Whether a file is a Mermaid or DOT diagram rather than TikZ: by its extension, or by how its text starts. */
export function isDiagramFile(name: string, t: string): boolean {
  const lower = name.toLowerCase();
  if (IMPORT_EXTENSIONS.some((e) => lower.endsWith(e))) return true;
  return /\.(txt|md)$/.test(lower) && detectFormat(t) !== null;
}

/** The name an imported diagram is saved under: its own, as .tex. */
function texName(name: string): string {
  return name.replace(/\.[^.]*$/, "") + ".tex";
}

/** What the status bar says after an import. */
function importMessage(r: ImportResult & { ok: true }, kept: boolean): string {
  const what = r.format === "mermaid" ? "a Mermaid flowchart" : "a Graphviz graph";
  const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  let m = `Imported ${what}: ${count(r.nodes, "node")}, ${count(r.edges, "edge")}${r.groups ? `, ${count(r.groups, "group")}` : ""}, laid out ${r.direction === "down" ? "top to bottom" : "left to right"}.`;
  if (!r.laidOut) m = m.replace("laid out", "not laid out (placed in a loose grid),");
  if (kept) m += " Your previous work is kept: Restore previous work brings it back.";
  for (const n of r.notes) m += ` Note: ${n}`;
  return m;
}

/**
 * Imports a Mermaid or DOT diagram like Open (D77 item 5): the work on screen
 * is put aside and can be restored, and the diagram replaces it as TikZ. The
 * text is read and laid out in the browser (in the layout worker, D87, with
 * its progress shown); nothing is sent anywhere. Returns the result so the
 * caller can show why it failed.
 */
export async function importSource(src: string, name: string | null, options: Omit<ImportOptions, "onProgress"> = {}): Promise<ImportResult> {
  let r: ImportResult;
  try {
    r = await withProgress((onProgress) => runImport(src, options, onProgress), "Importing");
  } catch (e) {
    if (!(e instanceof LayoutCancelled)) throw e;
    status.value = "Import canceled; nothing was changed.";
    return { ok: false, reason: "Import canceled; nothing was changed." };
  }
  if (!r.ok) {
    status.value = `Couldn't import: ${r.reason}`;
    return r;
  }
  await putAside();
  fileHandle.value = null;
  void del("handle");
  replaceDocument(r.text, name ? texName(name) : null, "utf-8");
  // Not saved anywhere yet: the name only suggests where Save puts it.
  savedText.value = "";
  status.value = importMessage(r, previousWork.value !== null);
  return r;
}

/**
 * Puts pasted text on screen, from the empty state's Paste TikZ (D96): TikZ or a whole .tex file as it
 * is, a Mermaid or DOT diagram imported. What was there is put aside first, as Open does.
 */
export async function openPasted(t: string): Promise<void> {
  if (detectFormat(t)) {
    await importSource(t, null);
    return;
  }
  await putAside();
  fileHandle.value = null;
  void del("handle");
  replaceDocument(t, null, "utf-8");
  savedText.value = "";
  const lines = t.split("\n").length;
  status.value = `Pasted ${lines} ${lines === 1 ? "line" : "lines"}.`;
}

/** Puts a file's text on the canvas. `handle` lets Save write back to it. */
export async function openBytes(bytes: Uint8Array, name: string, handle: FsHandle | null): Promise<void> {
  const { text: t, encoding: enc } = decode(bytes);
  if (isDiagramFile(name, t)) {
    await importSource(t, name);
    return;
  }
  await putAside();
  replaceDocument(t, name, enc);
  savedText.value = t;
  fileHandle.value = handle;
  if (handle) void put("handle", handle);
  else void del("handle");
  status.value = `Opened ${name}${enc !== "utf-8" ? ` (${enc})` : ""}${handle ? "; Save writes to it" : ""}.`;
}

export async function openFile(file: File): Promise<void> {
  await openBytes(new Uint8Array(await file.arrayBuffer()), file.name, null);
}

/** Open with the system's file chooser (in place, where possible); returns false when the choice was left to a file input. */
export async function openWithPicker(): Promise<boolean> {
  const show = picker().showOpenFilePicker;
  if (!show) return false;
  try {
    const [h] = await show.call(window, { types: TEX_TYPES, multiple: false });
    if (!h) return true;
    await openBytes(new Uint8Array(await (await h.getFile()).arrayBuffer()), h.name, h);
  } catch (e) {
    if ((e as DOMException).name !== "AbortError") status.value = `Couldn't open the file: ${(e as Error).message}`;
  }
  return true;
}

// ---- Save ------------------------------------------------------------------------------------

/** The text as bytes in the file's encoding; falls back to UTF-8 (and says so) for a character it can't hold. */
function bytesToSave(): { bytes: Uint8Array; note: string } {
  try {
    return { bytes: encode(text.peek(), encoding.peek()), note: "" };
  } catch (e) {
    if (!(e instanceof UnencodableError)) throw e;
    return { bytes: encode(text.peek(), "utf-8"), note: ` The file is ${e.encoding}, which can't hold a character at offset ${e.offset}, so it was saved as UTF-8.` };
  }
}

/** Saves with a download (every browser). */
export function download(): void {
  const { bytes, note } = bytesToSave();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/x-tex" }));
  a.download = fileName.peek() ?? "diagram.tex";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  savedText.value = text.peek();
  status.value = `Downloaded ${a.download}.${note}`;
}

async function writeTo(h: FsHandle): Promise<void> {
  const { bytes, note } = bytesToSave();
  const w = await h.createWritable();
  await w.write(bytes as BufferSource);
  await w.close();
  savedText.value = text.peek();
  fileName.value = h.name;
  status.value = `Saved ${h.name}.${note}`;
}

/** Save as…: choose where, then write. Falls back to a download. */
export async function saveFileAs(): Promise<void> {
  const show = picker().showSaveFilePicker;
  if (!show) return download();
  try {
    const h = await show.call(window, { suggestedName: fileName.peek() ?? "diagram.tex", types: TEX_TYPES });
    await writeTo(h);
    fileHandle.value = h;
    void put("handle", h);
  } catch (e) {
    if ((e as DOMException).name !== "AbortError") status.value = `Couldn't save: ${(e as Error).message}`;
  }
}

/** Save: back to the file that was opened or saved, else Save as…, else a download. */
export async function saveFile(): Promise<void> {
  const h = fileHandle.peek();
  if (!h) return canSaveInPlace() ? saveFileAs() : download();
  try {
    // A handle kept from an earlier visit needs the permission again, and the click is the gesture it needs.
    if (h.queryPermission && (await h.queryPermission({ mode: "readwrite" })) !== "granted" && h.requestPermission && (await h.requestPermission({ mode: "readwrite" })) !== "granted") {
      status.value = `The browser didn't allow writing to ${h.name}. Use Save as… to choose where.`;
      return;
    }
    await writeTo(h);
  } catch (e) {
    if ((e as DOMException).name === "AbortError") return;
    status.value = `Couldn't write to ${h.name} (${(e as Error).message}). Use Save as… to choose where.`;
  }
}

// ---- Links -----------------------------------------------------------------------------------

/** Reads the link in the address bar, if it is a share link, and removes it from the address (D74: a reload must not reopen it over later work). */
async function takeLink(): Promise<{ text: string; picture: number } | "damaged" | null> {
  if (!isShareHash(location.hash)) return null;
  const shared = await decodeShare(location.hash);
  history.replaceState(null, "", location.pathname + location.search);
  return shared ?? "damaged";
}

/** "#template=<id>" in the address, as the home page's gallery links: the template's id, removed from the address like a share link. */
function takeTemplate(): string | null {
  const m = /^#template=([a-z0-9-]+)$/.exec(location.hash);
  if (!m) return null;
  history.replaceState(null, "", location.pathname + location.search);
  return m[1]!;
}

function templateStatus(id: string, kept: boolean): string {
  const what = templateInfo(id) ? `the ${templateInfo(id)!.title} template` : "a blank diagram";
  return `Opened ${what}.${kept ? " Your previous work is kept: Restore previous work brings it back." : ""}`;
}

/** Opens a template (or the blank diagram) in place of the work on screen, which is put aside (D95; a new tab in step 6). */
export async function openTemplate(id: string): Promise<void> {
  const t = templateText(id);
  if (t === undefined) {
    status.value = "There is no such template.";
    return;
  }
  const kept = text.peek() !== t && (await putAside());
  fileHandle.value = null;
  void del("handle");
  replaceDocument(t, null, "utf-8");
  savedText.value = t;
  pictureIndex.value = 0;
  status.value = templateStatus(id, kept);
}

/**
 * Chooses what the editor starts with: a shared link if the address has one (the work kept from the last
 * visit is put aside, not lost), else the work kept from the last visit, else nothing (the empty state, D96).
 */
export async function restoreOnStart(): Promise<void> {
  const session = await loadSession().catch(() => null);
  const link = await takeLink();
  if (link && link !== "damaged") {
    previousWork.value = session && session.text !== link.text && worthKeeping(session.text) ? session : previousWork.value;
    if (previousWork.value) void put("previous", previousWork.value);
    fileHandle.value = null;
    void del("handle");
    setInitialText(link.text);
    adoptSession({ text: link.text, savedText: link.text, fileName: null, encoding: "utf-8", pictureIndex: link.picture, savedAt: Date.now() });
    status.value = "Opened from a link. Your previous work is kept: Restore previous work brings it back.";
    return;
  }
  const tpl = takeTemplate();
  const tplText = tpl ? templateText(tpl) : undefined;
  if (tpl && tplText) {
    const kept = !!session && session.text !== tplText && worthKeeping(session.text);
    if (kept) {
      previousWork.value = session;
      void put("previous", session);
    }
    fileHandle.value = null;
    void del("handle");
    setInitialText(tplText);
    adoptSession({ text: tplText, savedText: tplText, fileName: null, encoding: "utf-8", pictureIndex: 0, savedAt: Date.now() });
    status.value = templateStatus(tpl, kept);
    return;
  }
  if (session) {
    setInitialText(session.text);
    adoptSession(session);
  }
  if (tpl) status.value = "That template link names no template we have. Your own work is as you left it.";
  if (link === "damaged") status.value = "That link couldn't be read: it may have been cut short. Your own work is as you left it.";
}

/** Opens a link pasted into the address bar of a page that is already open. */
export function listenForLinks(): () => void {
  const onHash = () => {
    const tpl = takeTemplate();
    if (tpl) {
      void openTemplate(tpl);
      return;
    }
    void takeLink().then(async (link) => {
      if (!link) return;
      if (link === "damaged") {
        status.value = "That link couldn't be read: it may have been cut short.";
        return;
      }
      await putAside();
      fileHandle.value = null;
      void del("handle");
      replaceDocument(link.text, null, "utf-8");
      savedText.value = link.text;
      pictureIndex.value = link.picture;
      status.value = "Opened from a link. Restore previous work brings back what was here.";
    });
  };
  window.addEventListener("hashchange", onHash);
  return () => window.removeEventListener("hashchange", onHash);
}
