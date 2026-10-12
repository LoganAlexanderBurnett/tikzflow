// The browser's own store of the work (M3 step 12, D74): one small IndexedDB key-value store. The
// editor keeps its session here; the home page only reads it, to offer "Continue your diagram" (D89).
// Nothing leaves the computer.

import type { Encoding } from "../source/encoding.ts";

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

export const get = <T>(key: string): Promise<T | undefined> => idb<T>("readonly", (s) => s.get(key));
export const put = (key: string, value: unknown): Promise<IDBValidKey | undefined> => idb("readwrite", (s) => s.put(value, key));
export const del = (key: string): Promise<undefined> => idb("readwrite", (s) => s.delete(key));

/**
 * The kept session, read without creating the database when this browser has none (a first visit to
 * the home page should leave nothing behind). Browsers without `indexedDB.databases` just open it.
 */
export async function peekSession(): Promise<Session | null> {
  try {
    if (typeof indexedDB.databases === "function" && !(await indexedDB.databases()).some((d) => d.name === DB_NAME)) return null;
  } catch {
    return null;
  }
  const s = await get<Session>("session");
  return s && typeof s.text === "string" ? s : null;
}
