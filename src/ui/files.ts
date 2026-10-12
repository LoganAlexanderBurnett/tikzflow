// Save and open (M3 step 12, D74): the work is kept in the browser as you type
// (IndexedDB, one record per tab: tabs.ts), a file can be opened and saved in
// place with the File System Access API where the browser has it (Chromium),
// and everywhere else Open is a file chooser and Save a download. Opening a
// file, an import, a share link or a template opens a new tab (D86 item 5, D97),
// unless the tab on screen is empty. Nothing leaves the computer.

import { LayoutCancelled, runImport } from "../edit/layoutjobs.ts";
import { detectFormat, IMPORT_EXTENSIONS, type ImportOptions, type ImportResult } from "../import/index.ts";
import { decode, encode, UnencodableError } from "../source/encoding.ts";
import { templateInfo, templateText } from "../templates/index.ts";
import type { FsHandle } from "./docs.ts";
import { decodeShare, isShareHash } from "./share.ts";
import { encoding, fileName, status, text, withProgress } from "./store.ts";
import { fileHandle, linkFile, loadTabs, type OpenDoc, openDocument, savedText, showStartTab, tabs } from "./tabs.ts";

export type { FsHandle } from "./docs.ts";
export { worthKeeping } from "./docs.ts";
export { fileHandle, savedText } from "./tabs.ts";

interface PickerWindow {
  showOpenFilePicker?(o: unknown): Promise<FsHandle[]>;
  showSaveFilePicker?(o: unknown): Promise<FsHandle>;
}
const picker = (): PickerWindow => window as unknown as PickerWindow;
const TEX_TYPES = [{ description: "TeX, Mermaid and DOT files", accept: { "text/x-tex": [".tex", ".tikz", ".pgf"], "text/plain": [".txt", ...IMPORT_EXTENSIONS] } }];

/** The browser can open and save files in place. */
export const canSaveInPlace = (): boolean => typeof picker().showSaveFilePicker === "function" && typeof picker().showOpenFilePicker === "function";

/** The work differs from what was last opened or saved. */
export const unsaved = (): boolean => text.value !== savedText.value;

/** " in a new tab" when it went into one. */
const where = (w: "here" | "new"): string => (w === "new" ? " in a new tab" : "");

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
function importMessage(r: ImportResult & { ok: true }, w: "here" | "new"): string {
  const what = r.format === "mermaid" ? "a Mermaid flowchart" : "a Graphviz graph";
  const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  let m = `Imported ${what}${where(w)}: ${count(r.nodes, "node")}, ${count(r.edges, "edge")}${r.groups ? `, ${count(r.groups, "group")}` : ""}, laid out ${r.direction === "down" ? "top to bottom" : "left to right"}.`;
  if (!r.laidOut) m = m.replace("laid out", "not laid out (placed in a loose grid),");
  for (const n of r.notes) m += ` Note: ${n}`;
  return m;
}

/**
 * Imports a Mermaid or DOT diagram like Open (D77 item 5): it opens as TikZ in a new tab. The text is read
 * and laid out in the browser (in the layout worker, D87, with its progress shown); nothing is sent
 * anywhere. Returns the result so the caller can show why it failed.
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
  // Not saved anywhere yet: the name only suggests where Save puts it.
  const w = await openDocument({ text: r.text, fileName: name ? texName(name) : null, encoding: "utf-8", savedText: "", title: r.format === "mermaid" ? "Mermaid import" : "DOT import" });
  status.value = importMessage(r, w);
  return r;
}

/** Puts pasted text on screen, from the start screen's Paste TikZ (D96): TikZ or a whole .tex file as it is, a Mermaid or DOT diagram imported. */
export async function openPasted(t: string): Promise<void> {
  if (detectFormat(t)) {
    await importSource(t, null);
    return;
  }
  const w = await openDocument({ text: t, fileName: null, encoding: "utf-8", savedText: "", title: "Pasted diagram" });
  const lines = t.split("\n").length;
  status.value = `Pasted ${lines} ${lines === 1 ? "line" : "lines"}${where(w)}.`;
}

/** Puts a file's text on the canvas, in a new tab. `handle` lets Save write back to it. */
export async function openBytes(bytes: Uint8Array, name: string, handle: FsHandle | null): Promise<void> {
  const { text: t, encoding: enc } = decode(bytes);
  if (isDiagramFile(name, t)) {
    await importSource(t, name);
    return;
  }
  const w = await openDocument({ text: t, fileName: name, encoding: enc, savedText: t, title: name, handle });
  status.value = `Opened ${name}${enc !== "utf-8" ? ` (${enc})` : ""}${where(w)}${handle ? "; Save writes to it" : ""}.`;
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
    linkFile(h);
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

/** Reads the link in the address bar, if it is a share link, and removes it from the address (D74: a reload must not reopen it). */
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

const linkDoc = (link: { text: string; picture: number }): OpenDoc => ({ text: link.text, fileName: null, encoding: "utf-8", savedText: link.text, title: "Shared diagram", pictureIndex: link.picture });

function templateDoc(id: string): OpenDoc | null {
  const t = templateText(id);
  if (t === undefined) return null;
  return { text: t, fileName: null, encoding: "utf-8", savedText: t, title: templateInfo(id)?.title ?? "Untitled" };
}

function templateStatus(id: string, w: "here" | "new"): string {
  const what = templateInfo(id) ? `the ${templateInfo(id)!.title} template` : "a blank diagram";
  return `Opened ${what}${where(w)}.`;
}

/** Opens a template (or the blank diagram) in a new tab (D95, D97). */
export async function openTemplate(id: string): Promise<void> {
  const d = templateDoc(id);
  if (!d) {
    status.value = "There is no such template.";
    return;
  }
  status.value = templateStatus(id, await openDocument(d));
}

/**
 * Chooses what the editor starts with (D97): a shared link or a template link in the address opens in a new
 * tab beside the kept ones; otherwise the tab this window showed before a reload, else the most recently
 * edited tab no other window has open, else an empty tab (the start screen, D96).
 */
export async function restoreOnStart(): Promise<void> {
  const recovered = await loadTabs().catch(() => [] as string[]);
  const link = await takeLink();
  const tpl = takeTemplate();
  const doc = link && link !== "damaged" ? linkDoc(link) : tpl ? templateDoc(tpl) : null;
  if (doc) await openDocument(doc);
  else await showStartTab();
  // "In a new tab" only when there are others.
  const w = tabs.peek().length > 1 ? "new" : "here";
  if (link && link !== "damaged") status.value = `Opened from a link${where(w)}.`;
  else if (tpl && doc) status.value = templateStatus(tpl, w);
  else if (tpl) status.value = "That template link names no template we have. Your own work is as you left it.";
  else if (link === "damaged") status.value = "That link couldn't be read: it may have been cut short. Your own work is as you left it.";
  if (recovered.length) status.value = `A window closed before its last changes were saved, and another window had changed the same diagram since. Both are kept: see the tab${recovered.length > 1 ? "s" : ""} ${recovered.map((r) => `“${r}”`).join(", ")}.`;
}

/** Opens a link pasted into the address bar of a page that is already open, in a new tab. */
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
      const w = await openDocument(linkDoc(link));
      status.value = `Opened from a link${where(w)}.`;
    });
  };
  window.addEventListener("hashchange", onHash);
  return () => window.removeEventListener("hashchange", onHash);
}
