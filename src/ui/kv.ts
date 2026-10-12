// The browser's own store of the work (M3 step 12, D74; tabs in M5 step 6, D97): one small IndexedDB
// key-value store. The editor keeps each tab's diagram here; the home page only reads it, to offer
// "Continue your diagram" (D89). Nothing leaves the computer.
//
// Keys:
// - `doc:<id>`: a tab's diagram (`DocRecord`), written by the one window that is editing it, with a
//   revision number checked in the same transaction, so a write never replaces one it hasn't seen (D97).
// - `closed:<id>`: a tab closed with work in it (`ClosedRecord`), for Recently closed.
// - `handle:<id>`: the file a tab is linked to, so Save writes back to it after a reload.
// - `session`, `previous`, `handle`: the single session of before tabs, moved into tabs once (`migrateLegacy`).

import type { Encoding } from "../source/encoding.ts";
import { type ClosedRecord, CLOSED_KEPT, type DocRecord, newestFirst } from "./docs.ts";

/** What was kept between visits before tabs (D74): one session, and the work put aside. */
export interface Session {
  text: string;
  /** The text as last opened or saved: the work is unsaved while `text` differs. */
  savedText: string;
  fileName: string | null;
  encoding: Encoding;
  pictureIndex: number;
  savedAt: number;
}

const DB_NAME = "tikzflow";
const STORE = "kv";

export const docKey = (id: string): string => `doc:${id}`;
export const closedKey = (id: string): string => `closed:${id}`;
export const handleKey = (id: string): string => `handle:${id}`;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Runs `run` in one transaction. It issues its requests on the store and calls `done` with the result, which
 * the promise gives once the transaction has committed. Undefined when storage is refused or the transaction failed.
 */
function transact<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore, done: (v: T) => void) => void): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        let result: T | undefined;
        try {
          const tx = db.transaction(STORE, mode);
          tx.oncomplete = () => {
            db.close();
            resolve(result);
          };
          tx.onerror = tx.onabort = () => {
            db.close();
            resolve(undefined);
          };
          run(tx.objectStore(STORE), (v) => (result = v));
        } catch {
          db.close();
          resolve(undefined);
        }
      }),
    // Private windows, blocked storage: the app works, it just doesn't remember.
    () => undefined,
  );
}

export const get = <T>(key: string): Promise<T | undefined> =>
  transact<T>("readonly", (s, done) => {
    const r = s.get(key);
    r.onsuccess = () => done(r.result as T);
  });
export const put = (key: string, value: unknown): Promise<true | undefined> =>
  transact<true>("readwrite", (s, done) => {
    s.put(value, key).onsuccess = () => done(true);
  });
export const del = (key: string): Promise<true | undefined> =>
  transact<true>("readwrite", (s, done) => {
    s.delete(key).onsuccess = () => done(true);
  });

/** Every value whose key starts with `prefix`. */
function list<T>(prefix: string): Promise<T[]> {
  return transact<T[]>("readonly", (s, done) => {
    const r = s.getAll(IDBKeyRange.bound(prefix, `${prefix}￿`));
    r.onsuccess = () => done(r.result as T[]);
  }).then((v) => v ?? []);
}

const isDoc = (d: unknown): d is DocRecord => !!d && typeof (d as DocRecord).id === "string" && typeof (d as DocRecord).text === "string";

/** The tabs kept in this browser, in tab order. */
export const listDocs = (): Promise<DocRecord[]> => list<DocRecord>("doc:").then((ds) => ds.filter(isDoc).sort((a, b) => a.created - b.created || a.id.localeCompare(b.id)));
/** Tabs closed with work in them, newest first. */
export const listClosed = (): Promise<ClosedRecord[]> => list<ClosedRecord>("closed:").then((ds) => ds.filter(isDoc).sort((a, b) => b.closedAt - a.closedAt));

/** What a write of a tab came to: written, refused because another window wrote it since (D97), or storage failed. */
export type WriteResult = "written" | "conflict" | "failed";

/**
 * Writes a tab's diagram, if the stored one is still revision `baseRev` (null: none was stored yet), as
 * `rec.rev`. A record written meanwhile by another window is left alone: the caller keeps its own version
 * as a copy. A record that is gone (closed elsewhere without locks) is written back, since it holds work.
 */
export function writeDoc(rec: DocRecord, baseRev: number | null): Promise<WriteResult> {
  return transact<WriteResult>("readwrite", (s, done) => {
    const g = s.get(docKey(rec.id));
    g.onsuccess = () => {
      const cur = g.result as DocRecord | undefined;
      if (cur && cur.rev !== baseRev) {
        done("conflict");
        return;
      }
      s.put(rec, docKey(rec.id)).onsuccess = () => done("written");
    };
  }).then((r) => r ?? "failed");
}

/**
 * Closes a tab: its record goes, and when it holds work it is kept in Recently closed (with its file's
 * handle), of which only the newest `CLOSED_KEPT` stay. All in one transaction.
 */
export function closeDoc(id: string, keep: ClosedRecord | null): Promise<boolean> {
  return transact<boolean>("readwrite", (s, done) => {
    s.delete(docKey(id));
    s.delete(handleKey(id));
    if (!keep) {
      done(true);
      return;
    }
    s.put(keep, closedKey(id));
    const all = s.getAll(IDBKeyRange.bound("closed:", "closed:￿"));
    all.onsuccess = () => {
      const kept = (all.result as ClosedRecord[]).filter(isDoc).filter((c) => c.id !== id);
      for (const old of kept.sort((a, b) => b.closedAt - a.closedAt).slice(CLOSED_KEPT - 1)) s.delete(closedKey(old.id));
      done(true);
    };
  }).then((r) => r === true);
}

/** Takes a closed tab out of Recently closed and back in as a tab, with its file's handle. */
export function reopenDoc(closed: ClosedRecord, rec: DocRecord): Promise<boolean> {
  return transact<boolean>("readwrite", (s, done) => {
    s.delete(closedKey(closed.id));
    s.put(rec, docKey(rec.id));
    if (closed.handle) s.put(closed.handle, handleKey(rec.id));
    done(true);
  }).then((r) => r === true);
}

/**
 * Moves the single session of before tabs (D74) into tabs, once: the session becomes the first tab, and
 * the work that was put aside goes to Recently closed. The old keys go in the same transaction.
 */
export function migrateLegacy(newId: () => string, keep: (text: string) => boolean): Promise<void> {
  return transact<true>("readwrite", (s, done) => {
    const sess = s.get("session");
    const prev = s.get("previous");
    const handle = s.get("handle");
    handle.onsuccess = () => {
      const session = sess.result as Session | undefined;
      const previous = prev.result as Session | undefined;
      if (!session && !previous) {
        done(true);
        return;
      }
      const now = Date.now();
      if (session && typeof session.text === "string" && session.text.trim()) {
        const id = newId();
        const rec: DocRecord = { ...session, id, title: "Untitled", created: now, rev: 1 };
        s.put(rec, docKey(id));
        const h = handle.result as { name?: string } | undefined;
        if (h && h.name === session.fileName) s.put(h, handleKey(id));
      }
      if (previous && typeof previous.text === "string" && keep(previous.text)) {
        const id = newId();
        const rec: ClosedRecord = { ...previous, id, title: "Previous work", created: now - 1, rev: 1, closedAt: previous.savedAt || now };
        s.put(rec, closedKey(id));
      }
      s.delete("session");
      s.delete("previous");
      s.delete("handle");
      done(true);
    };
  }).then(() => undefined);
}

/**
 * The most recently edited diagram, read without creating the database when this browser has none (a first
 * visit to the home page should leave nothing behind), with how many tabs hold work. Browsers without
 * `indexedDB.databases` just open it.
 */
export async function peekSession(keep: (text: string) => boolean): Promise<{ latest: DocRecord | Session; count: number } | null> {
  try {
    if (typeof indexedDB.databases === "function" && !(await indexedDB.databases()).some((d) => d.name === DB_NAME)) return null;
  } catch {
    return null;
  }
  const docs = (await listDocs()).filter((d) => keep(d.text)).sort(newestFirst);
  if (docs.length) return { latest: docs[0]!, count: docs.length };
  // Not yet moved into tabs: the editor does that on its next start.
  const s = await get<Session>("session");
  return s && typeof s.text === "string" && keep(s.text) ? { latest: s, count: 1 } : null;
}
