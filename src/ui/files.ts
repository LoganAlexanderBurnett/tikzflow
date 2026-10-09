// Save and open (M3 step 12, D74): the work is kept in the browser as you type
// (IndexedDB), a file can be opened and saved in place with the File System
// Access API where the browser has it (Chromium), and everywhere else Open is a
// file chooser and Save a download. Nothing leaves the computer.

import { effect, signal } from "@preact/signals";
import { decode, encode, type Encoding, UnencodableError } from "../source/encoding.ts";
import { SAMPLE } from "./sample.ts";
import { decodeShare, isShareHash } from "./share.ts";
import { encoding, fileName, pictureIndex, replaceDocument, status, text } from "./store.ts";

/** The text the editor starts with: the work kept from the last visit, else the sample. Set by `restoreOnStart`. */
let startText = SAMPLE;
export const initialText = (): string => startText;
export function setInitialText(t: string): void {
  startText = t;
}

/** What is kept between visits. */
export interface Session {
  text: string;
  /** The text as last opened or saved: the work is unsaved while `text` differs. */
  savedText: string;
  fileName: string | null;
  encoding: Encoding;
  pictureIndex: number;
  savedAt: number;
}

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
const TEX_TYPES = [{ description: "TeX files", accept: { "text/x-tex": [".tex", ".tikz", ".pgf"], "text/plain": [".txt"] } }];

/** The browser can open and save files in place. */
export const canSaveInPlace = (): boolean => typeof picker().showSaveFilePicker === "function" && typeof picker().showOpenFilePicker === "function";

// ---- IndexedDB, a small key-value store ------------------------------------------------------

const DB_NAME = "tikzflow";
const STORE = "kv";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  try {
    const db = await openDb();
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = run(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // Private windows, blocked storage: the app works, it just doesn't remember.
    return undefined;
  }
}
const get = <T>(key: string) => idb<T>("readonly", (s) => s.get(key));
const put = (key: string, value: unknown) => idb("readwrite", (s) => s.put(value, key));
const del = (key: string) => idb("readwrite", (s) => s.delete(key));

// ---- State -----------------------------------------------------------------------------------

/** The text as last opened or saved. */
export const savedText = signal(SAMPLE);
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

/** Sets the work aside before something replaces it, unless there is nothing worth keeping. */
async function putAside(): Promise<void> {
  const s = currentSession();
  if (!s.text.trim() || s.text === SAMPLE) return;
  previousWork.value = s;
  await put("previous", s);
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

/** Puts a file's text on the canvas. `handle` lets Save write back to it. */
export async function openBytes(bytes: Uint8Array, name: string, handle: FsHandle | null): Promise<void> {
  const { text: t, encoding: enc } = decode(bytes);
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

/**
 * Chooses what the editor starts with: a shared link if the address has one (the work kept from the last
 * visit is put aside, not lost), else the work kept from the last visit, else the sample.
 */
export async function restoreOnStart(): Promise<void> {
  const session = await loadSession().catch(() => null);
  const link = await takeLink();
  if (link && link !== "damaged") {
    previousWork.value = session && session.text !== link.text && session.text.trim() && session.text !== SAMPLE ? session : previousWork.value;
    if (previousWork.value) void put("previous", previousWork.value);
    fileHandle.value = null;
    void del("handle");
    setInitialText(link.text);
    adoptSession({ text: link.text, savedText: link.text, fileName: null, encoding: "utf-8", pictureIndex: link.picture, savedAt: Date.now() });
    status.value = "Opened from a link. Your previous work is kept: Restore previous work brings it back.";
    return;
  }
  if (session) {
    setInitialText(session.text);
    adoptSession(session);
  }
  if (link === "damaged") status.value = "That link couldn't be read: it may have been cut short. Your own work is as you left it.";
}

/** Opens a link pasted into the address bar of a page that is already open. */
export function listenForLinks(): () => void {
  const onHash = () => {
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
