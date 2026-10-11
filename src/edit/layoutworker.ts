// The auto-layout and import worker (D87): planAutoLayout and importDiagram
// run here, off the page's thread, so a long layout never freezes the page,
// and tell the page how far they are. The worker has its own copy of the
// model's module state, so the page sends its page settings with each job.

import { setPageSettings } from "../model/document.ts";
import { importDiagram } from "../import/index.ts";
import type { LayoutJob, LayoutWorkerMessage } from "./layoutjobs.ts";
import { planAutoLayout } from "./autolayout.ts";

const post = (m: LayoutWorkerMessage) => postMessage(m);

onmessage = async ({ data: job }: MessageEvent<LayoutJob>) => {
  setPageSettings(job.page);
  const onProgress = (p: { step: number; steps: number; what: string }) => post({ id: job.id, kind: "progress", progress: p });
  try {
    const result =
      job.kind === "layout"
        ? await planAutoLayout(job.text, job.picIndex, { ...job.options, onProgress })
        : await importDiagram(job.src, { ...job.options, onProgress });
    post({ id: job.id, kind: "done", result });
  } catch (e) {
    post({ id: job.id, kind: "failed", message: e instanceof Error ? e.message : String(e) });
  }
};
