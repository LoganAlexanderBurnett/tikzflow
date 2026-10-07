// TikZJax adapter. Drives the package's own worker (run-tex.js) by speaking
// the threads.js message protocol directly, so no extra dependency is needed.

import type { CompileResult, Engine } from "./engine.ts";
import { LIBRARIES, PICTURE, PROBE, type Probe } from "./sample.ts";

const ROOT = "/vendor/tikzjax/package/dist";

type Reply =
  | { type: "init" }
  | { type: "running"; uid: number }
  | { type: "result"; uid: number; payload: unknown; complete?: boolean }
  | { type: "error"; uid: number; error: { message?: string } }
  | { type: "uncaughtError"; error: { message?: string } };

export class TikzJax implements Engine {
  name = "tikzjax";
  #worker: Worker | null = null;
  #ready: Promise<void> | null = null;
  #uid = 0;
  #pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  #start(): Promise<void> {
    if (this.#ready) return this.#ready;
    const worker = new Worker(`${ROOT}/run-tex.js`);
    this.#worker = worker;
    this.#ready = new Promise((resolve, reject) => {
      worker.onerror = (e) => reject(new Error(e.message));
      worker.onmessage = ({ data }: MessageEvent<Reply>) => {
        switch (data.type) {
          case "init":
            resolve();
            break;
          case "result":
            this.#pending.get(data.uid)?.resolve(data.payload);
            this.#pending.delete(data.uid);
            break;
          case "error":
            this.#pending.get(data.uid)?.reject(new Error(data.error.message ?? "worker error"));
            this.#pending.delete(data.uid);
            break;
          case "uncaughtError":
            for (const p of this.#pending.values()) p.reject(new Error(data.error.message ?? "uncaught"));
            this.#pending.clear();
            break;
        }
      };
    });
    return this.#ready;
  }

  #call(method: string, ...args: unknown[]): Promise<unknown> {
    const uid = ++this.#uid;
    return new Promise((resolve, reject) => {
      this.#pending.set(uid, { resolve, reject });
      this.#worker!.postMessage({ type: "run", uid, method, args });
    });
  }

  async load(): Promise<void> {
    // The SVG's <text> elements reference these web fonts by name.
    if (!document.querySelector(`link[href="${ROOT}/fonts.css"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `${ROOT}/fonts.css`;
      document.head.append(link);
    }
    await this.#start();
    await this.#call("load", new URL(ROOT, location.href).href);
  }

  async compile(): Promise<CompileResult> {
    const dataset = {
      tikzLibraries: LIBRARIES.join(","),
      texPackages: JSON.stringify({ amsmath: "" }),
    };
    try {
      const svg = String(await this.#call("texify", PROBE + PICTURE, dataset));
      return { ok: svg.includes("<svg"), output: { kind: "svg", svg }, log: "", probe: probeFromSvg(svg) };
    } catch (e) {
      return { ok: false, output: { kind: "none" }, log: String(e), probe: null };
    }
  }
}

/**
 * TikZJax has no log channel, so read the probe from the rendered text.
 * dvi2html writes each TeX character code c as U+F000 + c (for the BaKoMa
 * TrueType fonts), so map those back before matching.
 */
function probeFromSvg(svg: string): Probe | null {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const text = [...(doc.documentElement.textContent ?? "")]
    .map((ch) => {
      const code = ch.codePointAt(0)!;
      return code >= 0xf000 && code < 0xf100 ? String.fromCharCode(code - 0xf000) : ch;
    })
    .join("")
    .replace(/\s+/g, "");
  const pgf = /pgf=([\d.]+)/.exec(text)?.[1];
  if (!pgf) return null;
  const libraries: Record<string, boolean> = {};
  for (const lib of LIBRARIES) libraries[lib] = text.includes(`${lib}=yes`);
  return { pgf, libraries };
}
