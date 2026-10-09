// SPDX-License-Identifier: GPL-3.0-or-later
// The service worker (M3 step 9, D70): after the first visit the app and its
// TeX engine work offline. vite.config.ts compiles this file to dist/sw.js
// and puts the build's file list, a version and the engine's tag in front of
// it (the three constants below).
//
// - The app (index.html, scripts, styles, fonts) is cached whole when the worker
//   installs, under a name with the build's version; older versions' caches are
//   deleted when a new one takes over. A page is fetched from the network
//   first, so a new deploy shows on the next load, and from the cache when the
//   network doesn't answer.
// - The engine's files (/engine/<tag>/…) are cached as they are fetched and
//   served from the cache first: the tag is in their path, so a file never
//   changes. Other tags' files are deleted when this build takes over.
//
// Nothing here talks to any other server, and nothing leaves the browser.

/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;
/** Files of the build to keep (paths relative to the worker's folder), set by vite.config.ts. */
declare const __SHELL__: string[];
declare const __VERSION__: string;
declare const __ENGINE_TAG__: string;

const SHELL_PREFIX = "tikzflow-shell-";
const SHELL = `${SHELL_PREFIX}${__VERSION__}`;
const ENGINE = "tikzflow-engine";
/** How long a page waits for the network before the cached copy is used. */
const NAVIGATION_TIMEOUT_MS = 4000;

const base = new URL("./", self.location.href);
const enginePath = `${base.pathname}engine/`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      // `reload`: the copy must come from the server, not from the browser's own cache.
      await Promise.all(__SHELL__.map((path) => cache.add(new Request(new URL(path, base), { cache: "reload" }))));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith(SHELL_PREFIX) && name !== SHELL) await caches.delete(name);
      }
      const engine = await caches.open(ENGINE);
      const current = `${enginePath}${__ENGINE_TAG__}/`;
      for (const request of await engine.keys()) {
        if (!new URL(request.url).pathname.startsWith(current)) await engine.delete(request);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(base.pathname)) return;
  if (url.pathname.startsWith(enginePath)) event.respondWith(engineFile(request));
  else if (request.mode === "navigate") event.respondWith(page(request));
  else event.respondWith(shellFile(request));
});

/** An engine file: the cached copy, else the network, kept for next time. */
async function engineFile(request: Request): Promise<Response> {
  const cache = await caches.open(ENGINE);
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit) return hit;
  const response = await fetch(request);
  // Only whole, successful answers: a missing file (404) is answered afresh each time.
  if (response.status === 200) await cache.put(request, response.clone());
  return response;
}

/** A file of the build: the cached copy, else the network. */
async function shellFile(request: Request): Promise<Response> {
  // ignoreVary: a server may answer `Vary: Origin`, and module scripts send an Origin header the stored request lacks.
  const hit = await caches.match(request, { cacheName: SHELL, ignoreVary: true });
  return hit ?? fetch(request);
}

/** A page: the network, unless it fails or takes too long, then the cached copy of the app. */
async function page(request: Request): Promise<Response> {
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), NAVIGATION_TIMEOUT_MS));
  try {
    return await Promise.race([fetch(request), timeout]);
  } catch {
    const cached = await caches.match(base.pathname, { cacheName: SHELL, ignoreSearch: true, ignoreVary: true });
    return cached ?? Response.error();
  }
}

export {};
