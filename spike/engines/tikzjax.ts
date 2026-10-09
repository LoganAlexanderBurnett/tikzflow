// TikZJax adapter. Drives the package's own worker (run-tex.js) by speaking
// the threads.js message protocol directly, so no extra dependency is needed.

import type { CompileResult, Engine, Job } from "./engine.ts";
import { LIBRARIES, SAMPLE_JOB, readProbe, type Probe } from "./sample.ts";

// The published package. (M3 step 1 also ran our CI build through this
// worker; since step 6 our engine has its own, src/engine/worker.ts, D67.)
const ROOT = "/vendor/tikzjax/package/dist";

type Reply =
  | { type: "init" }
  | { type: "running"; uid: number }
  | { type: "result"; uid: number; payload: unknown; complete?: boolean }
  | { type: "error"; uid: number; error: { message?: string } }
  | { type: "uncaughtError"; error: { message?: string } };

export class TikzJax implements Engine {
  name = "tikzjax";
  /**
   * Ask TikZJax for TeX's terminal output. The worker posts each line as a
   * plain string message; it becomes CompileResult.log. Without it, TeX errors
   * are invisible: a missing package still "succeeds".
   */
  showConsole = true;
  #consoleLines: string[] = [];
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
      worker.onmessage = ({ data }: MessageEvent<Reply | string>) => {
        if (typeof data === "string") {
          this.#consoleLines.push(data);
          return;
        }
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

  async compile(job: Job = SAMPLE_JOB): Promise<CompileResult> {
    // TikZJax builds the preamble itself from these fields (see run-tex.js).
    // It has no Latin Modern, so job.lmodern is ignored.
    const dataset: Record<string, string> = {
      tikzLibraries: job.libraries.join(","),
      texPackages: JSON.stringify({ amsmath: "", ...job.packages }),
    };
    if (job.preamble) dataset.addToPreamble = job.preamble;
    if (this.showConsole) dataset.showConsole = "true";
    this.#consoleLines = [];
    try {
      const svg = String(await this.#call("texify", job.body, dataset));
      const log = this.#consoleLines.join("\n");
      const ok = svg.includes("<svg");
      return { ok, output: { kind: "svg", svg }, log, probe: probeFromSvg(svg) ?? readProbe(log) };
    } catch (e) {
      return { ok: false, output: { kind: "none" }, log: [...this.#consoleLines, String(e)].join("\n"), probe: null };
    }
  }
}

/**
 * Works around TikZJax's missing strokes inside TeX boxes.
 *
 * pgfsys-ximera.def treats everything inside a TeX box as text. It wraps each
 * box in <g stroke="none"> so glyphs aren't outlined, and inside a box it
 * emits colour changes as text colour (fill + stroke="none"). Two things break:
 * - \matrix cells: their borders inherit stroke="none" from the box wrapper.
 * - Pictures nested in node text (\node{\tikz ...}): every stroke becomes "none".
 *
 * Removing stroke="none" from all groups and putting it on <text> restores the
 * strokes. That's safe because fill-only paths carry their own stroke="none".
 * It can't restore a nested picture's stroke *colour*, which was never emitted,
 * so those strokes come out black. The proper fix is in the driver, when we
 * build our own format (PROGRESS.md, M0 follow-up).
 */
export function fixBoxStroke(svg: string): string {
  return svg.replace(/<g stroke="none"/g, "<g").replace(/<text /g, '<text stroke="none" ');
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
