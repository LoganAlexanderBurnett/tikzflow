// Working offline (M3 step 9, D70): registers the service worker (production
// builds only) and, once the engine is running, fetches the rest of its files
// in the background so the first visit leaves everything in the browser's
// cache. The service worker keeps each file as it goes by.

import { signal } from "@preact/signals";
import type { EngineIndex } from "../engine/protocol.ts";

/** What the toolbar says about offline use: nothing, how far the background fetch is, or done. */
export type OfflineState = { kind: "none" } | { kind: "preparing"; done: number; total: number } | { kind: "ready" };
export const offlineState = signal<OfflineState>({ kind: "none" });

/** Registers the service worker. Does nothing in development, where it would get in the way of hot reloads. */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const register = () => void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}

const CONCURRENCY = 4;
/** Wait before starting, so the first picture and the app's own requests come first. */
const START_DELAY_MS = 2000;

let started = false;

/**
 * Fetches every file of the engine at `base` that isn't cached yet (the
 * service worker stores what passes through it), a few at a time and at low
 * priority. Skipped when the browser asks for less data use, or when there is
 * no service worker to keep the files.
 */
export async function prefetchEngine(base: string, index: EngineIndex): Promise<void> {
  if (started || !import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return;
  started = true;
  try {
    await navigator.serviceWorker.ready;
    await new Promise((r) => setTimeout(r, START_DELAY_MS));
    // A page opened before the worker took over isn't controlled yet: its requests wouldn't be kept.
    if (!navigator.serviceWorker.controller) {
      started = false;
      return;
    }
    // index.json too: on the very first visit the page loads before the worker has taken control.
    const urls = ["index.json", "tex.wasm.gz", "core.dump.gz", ...index.texFiles.map((n) => `tex_files/${n}.gz`), ...index.fonts.map((n) => `fonts/${n}.json.gz`)];
    const total = urls.length;
    let done = 0;
    offlineState.value = { kind: "preparing", done, total };
    let failed = false;
    const next = async (): Promise<void> => {
      for (let url = urls.pop(); url !== undefined; url = urls.pop()) {
        try {
          const res = await fetch(`${base}${url}`, { priority: "low" } as RequestInit);
          // Read it through, so the worker has stored all of it.
          await res.arrayBuffer();
          if (!res.ok) failed = true;
        } catch {
          failed = true;
        }
        offlineState.value = { kind: "preparing", done: ++done, total };
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, next));
    offlineState.value = failed ? { kind: "none" } : { kind: "ready" };
    if (failed) started = false;
  } catch {
    started = false;
    offlineState.value = { kind: "none" };
  }
}
