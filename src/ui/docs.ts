// Tabs (M5 step 6, D97): what a tab's kept diagram is, and the decisions about it that need no browser,
// so they can be tested on their own: which tab a window starts on, and what a write left in the journal by
// a page that was closed (or crashed) before its last save finished comes to on the next start.

import { isPristine } from "../templates/index.ts";
import type { Session } from "./kv.ts";

/** Work worth keeping when its tab is closed, or offering to continue: not empty, and not a template (or the sample) untouched. */
export function worthKeeping(text: string): boolean {
  return !!text.trim() && !isPristine(text);
}

// ---- File System Access API (not in TypeScript's DOM types) ----------------------------------

export interface FsWritable {
  write(data: BufferSource): Promise<void>;
  close(): Promise<void>;
}
/** A file the browser lets the page write back to (Chromium). */
export interface FsHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<FsWritable>;
  queryPermission?(d: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission?(d: { mode: "readwrite" }): Promise<PermissionState>;
}

/** A tab's diagram as kept in the browser. */
export interface DocRecord extends Session {
  id: string;
  /** What the tab is called when it has no file name: "Untitled", the template's title, "Shared diagram"… */
  title: string;
  /** When the tab was made: the tabs' order. */
  created: number;
  /** Goes up by one with every write; a write must name the revision it replaces (D97). */
  rev: number;
}

/** A tab closed with work in it, kept for Recently closed. */
export interface ClosedRecord extends DocRecord {
  closedAt: number;
  /** The file it was linked to, if any (a File System Access handle). */
  handle?: unknown;
}

/** How many closed tabs Recently closed keeps. */
export const CLOSED_KEPT = 20;

/** Most recently edited first. */
export const newestFirst = (a: { savedAt: number }, b: { savedAt: number }): number => (b.savedAt || 0) - (a.savedAt || 0);

/** A tab's name in the tab bar: its file's name, else its title. */
export const tabName = (d: { fileName: string | null; title: string }): string => d.fileName ?? d.title;

/**
 * A write in progress when the page was hidden, kept in localStorage until IndexedDB has it (D97): the
 * diagram as it was, and the revision it was to replace.
 */
export interface Journal {
  rec: DocRecord;
  baseRev: number | null;
}

/**
 * What to do with a journal entry on the next start, given the stored record:
 * - "apply": the write never landed; store the journal's version.
 * - "drop": the stored record already has it.
 * - "copy": both changed since (another window wrote after); keep the journal's version as a separate tab.
 */
export function journalAction(j: Journal, stored: DocRecord | undefined): "apply" | "drop" | "copy" {
  if (!stored) return "apply";
  if (stored.text === j.rec.text && stored.fileName === j.rec.fileName && stored.savedText === j.rec.savedText) return "drop";
  if (stored.rev === j.baseRev) return "apply";
  return "copy";
}

/**
 * The tab a window starts on: the one it showed before a reload (`remembered`, kept per window), unless
 * another window has it open; else the most recently edited one no other window has open; else none (a new
 * empty tab), so a second window doesn't open on top of the first one's diagram.
 */
export function startTab(docs: readonly DocRecord[], remembered: string | null, heldElsewhere: ReadonlySet<string>): string | null {
  if (remembered && docs.some((d) => d.id === remembered) && !heldElsewhere.has(remembered)) return remembered;
  const free = docs.filter((d) => !heldElsewhere.has(d.id)).sort(newestFirst);
  return free[0]?.id ?? null;
}

/** The title of a copy kept because two versions of one diagram met (D97). */
export function copyTitle(name: string, why: "conflict" | "recovered"): string {
  const base = name.replace(/\.(tex|tikz|pgf|txt)$/i, "");
  return why === "conflict" ? `${base} (your copy)` : `${base} (recovered)`;
}
