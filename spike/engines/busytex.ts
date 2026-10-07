// busytex adapter. Uses the release's own worker (busytex_worker.js) with
// pdfLaTeX from the texlive-basic bundle, plus the pgf/TikZ, standalone,
// xkeyval and xcolor files busytex lacks, from vendor/packs/tikz-flat.json
// (see scripts/pack-texmf.ts). Output is PDF; busytex has no dvisvgm.

import type { CompileResult, Engine } from "./engine.ts";
import { readProbe, standaloneDocument } from "./sample.ts";

const ROOT = "/vendor/busytex";

type Reply =
  | { initialized: unknown }
  | { print: string }
  | { exception: string }
  | { pdf: Uint8Array | null; log: string; exit_code: number };

export class Busytex implements Engine {
  name = "busytex";
  #worker: Worker | null = null;
  #pack: Array<{ path: string; contents: string }> = [];
  #waiting: ((r: Reply) => void) | null = null;
  #prints: string[] = [];

  #next(): Promise<Reply> {
    return new Promise((resolve) => (this.#waiting = resolve));
  }

  async load(): Promise<void> {
    const packPromise = fetch("/vendor/packs/tikz-flat.json").then((r) => r.json());
    const worker = new Worker(`${ROOT}/busytex_worker.js`);
    this.#worker = worker;
    worker.onmessage = ({ data }: MessageEvent<Reply>) => {
      if ("print" in data) {
        this.#prints.push(data.print);
        return;
      }
      const w = this.#waiting;
      this.#waiting = null;
      w?.(data);
    };
    const abs = (p: string) => new URL(`${ROOT}/${p}`, location.href).href;
    const ready = this.#next();
    worker.postMessage({
      busytex_js: abs("busytex.js"),
      busytex_wasm: abs("busytex.wasm"),
      preload_data_packages_js: [abs("texlive-basic.js")],
      data_packages_js: [abs("texlive-basic.js")],
      texmf_local: [],
      preload: true,
    });
    const reply = await ready;
    if ("exception" in reply) throw new Error(reply.exception);
    const pack = (await packPromise) as Array<{ name: string; text: string }>;
    this.#pack = pack.map(({ name, text }) => ({ path: name, contents: text }));
  }

  async compile(): Promise<CompileResult> {
    const done = this.#next();
    this.#prints = [];
    this.#worker!.postMessage({
      files: [{ path: "main.tex", contents: standaloneDocument() }, ...this.#pack],
      main_tex_path: "main.tex",
      bibtex: false,
      verbose: "silent",
      driver: "pdftex_bibtex8",
    });
    const reply = await done;
    if ("exception" in reply) {
      return { ok: false, output: { kind: "none" }, log: reply.exception + "\n" + this.#prints.join("\n"), probe: null };
    }
    if (!("exit_code" in reply)) return { ok: false, output: { kind: "none" }, log: "unexpected reply", probe: null };
    const ok = reply.exit_code === 0 && reply.pdf !== null;
    return {
      ok,
      output: ok ? { kind: "pdf", pdf: reply.pdf! } : { kind: "none" },
      log: reply.log,
      probe: readProbe(reply.log),
    };
  }
}
