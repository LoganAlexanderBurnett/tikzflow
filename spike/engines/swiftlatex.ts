// SwiftLaTeX adapter (pdfTeX engine). Talks to the release's worker directly,
// because its wrapper resolves the worker path relative to the page. TeX files
// come from the dev-only /swiftlatex-texlive endpoint (see vite.config.ts)
// instead of SwiftLaTeX's own server. SwiftLaTeX ships no format, so the first
// load builds swiftlatexpdftex.fmt from pdflatex.ini and stores it.

import type { CompileResult, Engine } from "./engine.ts";
import { readProbe, standaloneDocument } from "./sample.ts";

const WORKER = "/vendor/swiftlatex/swiftlatexpdftex.js";
const ENDPOINT = "/swiftlatex-texlive/";

interface Reply {
  result?: string;
  cmd?: string;
  log?: string;
  status?: number;
  pdf?: ArrayBuffer;
}

export class SwiftLatex implements Engine {
  name = "swiftlatex";
  #worker: Worker | null = null;
  /** Time spent building the format during load(), if it had to be built. */
  formatBuildMs = 0;

  #reply(match: (r: Reply) => boolean): Promise<Reply> {
    return new Promise((resolve, reject) => {
      this.#worker!.onerror = (e) => reject(new Error(e.message || "worker error"));
      this.#worker!.onmessage = ({ data }: MessageEvent<Reply>) => {
        if (match(data)) resolve(data);
      };
    });
  }

  async #startWorker(): Promise<void> {
    this.#worker?.terminate();
    this.#worker = new Worker(WORKER);
    const ready = await this.#reply((r) => r.result !== undefined && r.cmd === undefined);
    if (ready.result !== "ok") throw new Error("SwiftLaTeX worker failed to start");
    this.#worker.postMessage({ cmd: "settexliveurl", url: new URL(ENDPOINT, location.href).href });
  }

  async load(): Promise<void> {
    await this.#startWorker();
    const head = await fetch(`${ENDPOINT}pdftex/10/swiftlatexpdftex.fmt`, { method: "HEAD" });
    if (head.status !== 200) {
      const t = performance.now();
      const done = this.#reply((r) => r.cmd === "compile");
      this.#worker!.postMessage({ cmd: "compileformat" });
      const r = await done;
      if (r.result !== "ok" || !r.pdf) throw new Error(`format build failed (status ${r.status}):\n${r.log ?? ""}`);
      await fetch(`${ENDPOINT}fmt`, { method: "POST", body: r.pdf });
      this.formatBuildMs = performance.now() - t;
      // Restart so the engine loads the stored format like a normal visit.
      await this.#startWorker();
    }
  }

  async compile(): Promise<CompileResult> {
    const done = this.#reply((r) => r.cmd === "compile");
    this.#worker!.postMessage({ cmd: "writefile", url: "main.tex", src: standaloneDocument() });
    this.#worker!.postMessage({ cmd: "setmainfile", url: "main.tex" });
    this.#worker!.postMessage({ cmd: "compilelatex" });
    const r = await done;
    const ok = r.result === "ok" && !!r.pdf;
    return {
      ok,
      output: ok ? { kind: "pdf", pdf: new Uint8Array(r.pdf!) } : { kind: "none" },
      log: r.log ?? "",
      probe: readProbe(r.log ?? ""),
    };
  }
}
