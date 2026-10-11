// The page's side of the layout worker (D87): auto-layout and import run in
// a worker, so the page stays responsive however long they take, and report
// their progress. A job can be canceled: the worker is stopped and a new
// one started for the next job. Only the worker loads elk.js: the page has no
// copy of it to fall back on (module workers are needed by the engine too).

import { getPageSettings } from "../model/document.ts";
import type { ImportOptions, ImportResult } from "../import/index.ts";
import type { PageSettings } from "../tikz/page.ts";
import type { AutoLayoutOptions, AutoLayoutResult, LayoutProgress } from "./autolayout.ts";

type JobBody =
  | { kind: "layout"; text: string; picIndex: number; options: Omit<AutoLayoutOptions, "onProgress"> }
  | { kind: "import"; src: string; options: Omit<ImportOptions, "onProgress"> };

export type LayoutJob = { id: number; page: PageSettings } & JobBody;

export type LayoutWorkerMessage =
  | { id: number; kind: "progress"; progress: LayoutProgress }
  | { id: number; kind: "done"; result: AutoLayoutResult | ImportResult }
  | { id: number; kind: "failed"; message: string };

/** What a canceled job's promise rejects with. */
export class LayoutCancelled extends Error {
  constructor() {
    super("canceled");
  }
}

export interface RunningJob<T> {
  result: Promise<T>;
  cancel(): void;
}

let worker: Worker | null = null;
let nextId = 0;

function run<T>(job: JobBody, onProgress: (p: LayoutProgress) => void): RunningJob<T> {
  let w: Worker;
  try {
    w = worker ??= new Worker(new URL("./layoutworker.ts", import.meta.url), { type: "module", name: "tikzflow-layout" });
  } catch (e) {
    return { result: Promise.reject(new Error(`the layout worker couldn't start (${e instanceof Error ? e.message : String(e)})`)), cancel() {} };
  }
  const id = ++nextId;
  let cancel = () => {};
  const result = new Promise<T>((resolve, reject) => {
    const done = () => {
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
    };
    const onMessage = ({ data }: MessageEvent<LayoutWorkerMessage>) => {
      if (data.id !== id) return;
      if (data.kind === "progress") return onProgress(data.progress);
      done();
      if (data.kind === "done") resolve(data.result as T);
      else reject(new Error(data.message));
    };
    // The worker's script didn't load, or it crashed: the next job starts a new one.
    const onError = (e: ErrorEvent) => {
      e.preventDefault();
      done();
      w.terminate();
      if (worker === w) worker = null;
      reject(new Error(e.message || "the layout worker stopped"));
    };
    cancel = () => {
      done();
      w.terminate();
      if (worker === w) worker = null;
      reject(new LayoutCancelled());
    };
    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);
  });
  const message: LayoutJob = { ...job, id, page: getPageSettings() };
  w.postMessage(message);
  return { result, cancel: () => cancel() };
}

/** planAutoLayout, in the worker. */
export function runAutoLayout(text: string, picIndex: number, options: Omit<AutoLayoutOptions, "onProgress">, onProgress: (p: LayoutProgress) => void): RunningJob<AutoLayoutResult> {
  return run<AutoLayoutResult>({ kind: "layout", text, picIndex, options }, onProgress);
}

/** importDiagram, in the worker. */
export function runImport(src: string, options: Omit<ImportOptions, "onProgress">, onProgress: (p: LayoutProgress) => void): RunningJob<ImportResult> {
  return run<ImportResult>({ kind: "import", src, options }, onProgress);
}
