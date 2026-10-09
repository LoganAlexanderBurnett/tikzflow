// SPDX-License-Identifier: GPL-3.0-or-later
// The app's side of the engine worker (D67): starts it, and compiles one
// input at a time. A compile asked for while another runs waits, and only the
// latest waiting one is run: an edit in between makes the older one stale.

import type { CompileOutcome, EngineIndex, FromWorker, ToWorker } from "./protocol.ts";

export type EngineState = { kind: "loading" } | { kind: "ready"; index: EngineIndex } | { kind: "unavailable"; reason: string };

export class EngineClient {
  #worker: Worker;
  #state: EngineState = { kind: "loading" };
  #ready: Promise<EngineIndex>;
  #nextId = 0;
  #running: { id: number; resolve: (o: CompileOutcome | null) => void; reject: (e: Error) => void } | null = null;
  #waiting: { tex: string; resolve: (o: CompileOutcome | null) => void; reject: (e: Error) => void } | null = null;
  onState: ((s: EngineState) => void) | null = null;

  constructor(base: string) {
    this.#worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "tikzflow-engine" });
    this.#ready = new Promise((resolve, reject) => {
      this.#worker.onmessage = ({ data }: MessageEvent<FromWorker>) => {
        if (data.type === "ready") {
          this.#setState({ kind: "ready", index: data.index });
          resolve(data.index);
        } else if (data.type === "failed" && data.id === null) {
          this.#setState({ kind: "unavailable", reason: data.message });
          reject(new Error(data.message));
        } else if (data.type === "result" || data.type === "failed") {
          const r = this.#running;
          if (!r || r.id !== data.id) return;
          this.#running = null;
          if (data.type === "result") r.resolve(data.outcome);
          else r.reject(new Error(data.message));
          this.#next();
        }
      };
      this.#worker.onerror = (e) => {
        const reason = e.message || "The engine worker failed to start.";
        this.#setState({ kind: "unavailable", reason });
        reject(new Error(reason));
      };
    });
    this.#ready.catch(() => {});
    this.#post({ type: "init", base });
  }

  get state(): EngineState {
    return this.#state;
  }

  /** The engine's index, once it has loaded. */
  ready(): Promise<EngineIndex> {
    return this.#ready;
  }

  /**
   * Compiles `tex` (input.tex). Resolves with null when a later compile
   * replaced this one before it started.
   */
  compile(tex: string): Promise<CompileOutcome | null> {
    return new Promise((resolve, reject) => {
      this.#waiting?.resolve(null);
      this.#waiting = { tex, resolve, reject };
      if (!this.#running) this.#next();
    });
  }

  dispose(): void {
    this.#worker.terminate();
    this.#running?.resolve(null);
    this.#waiting?.resolve(null);
  }

  #next() {
    const w = this.#waiting;
    if (!w) return;
    this.#waiting = null;
    const id = ++this.#nextId;
    this.#running = { id, resolve: w.resolve, reject: w.reject };
    this.#post({ type: "compile", id, tex: w.tex });
  }

  #post(m: ToWorker) {
    this.#worker.postMessage(m);
  }

  #setState(s: EngineState) {
    this.#state = s;
    this.onState?.(s);
  }
}
