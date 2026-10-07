import type { Probe } from "./sample.ts";

export type Output =
  | { kind: "svg"; svg: string }
  | { kind: "pdf"; pdf: Uint8Array }
  | { kind: "none" };

export interface CompileResult {
  ok: boolean;
  output: Output;
  log: string;
  probe: Probe | null;
}

export interface Engine {
  name: string;
  /** Download and initialise everything needed before the first compile. */
  load(): Promise<void>;
  /** Compile the shared sample (see sample.ts). */
  compile(): Promise<CompileResult>;
}
