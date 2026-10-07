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

/** What to compile: a document body plus what its preamble needs. */
export interface Job {
  /** Document body: usually one tikzpicture, optionally preceded by other commands. */
  body: string;
  /** TikZ libraries to load with \usetikzlibrary. */
  libraries: readonly string[];
  /** Packages to load, mapped to their options ("" for none). amsmath is always loaded. */
  packages?: Record<string, string>;
  /** Extra preamble lines (\newcommand, \definecolor, \tikzset, ...). */
  preamble?: string;
  /** Load Latin Modern (engines that support it). */
  lmodern?: boolean;
  /** standalone class options for engines that compile a full document. */
  classOptions?: string;
}

export interface Engine {
  name: string;
  /** Download and initialise everything needed before the first compile. */
  load(): Promise<void>;
  /** Compile a job (default: the shared sample in sample.ts). */
  compile(job?: Job): Promise<CompileResult>;
}
