// SPDX-License-Identifier: GPL-3.0-or-later
// Messages between the app and the engine worker (D67).

import type { PicturePlacement } from "./dvisvg.ts";
import type { TexError } from "./log.ts";

/** index.json, next to the engine's files: what this engine build has. */
export interface EngineIndex {
  /** The release tag the files came from. */
  version: string;
  versions: { latex?: string | null; l3kernel?: string | null; pgf?: string | null };
  /** Files TeX can read, by name (served as tex_files/<name>.gz). */
  texFiles: string[];
  /** Fonts the converter can draw (served as fonts/<name>.json.gz). */
  fonts: string[];
}

export interface CompileOutcome {
  /** TeX wrote a page. */
  ok: boolean;
  svg: string | null;
  viewBox: { x: number; y: number; width: number; height: number } | null;
  picture: PicturePlacement | null;
  /** input.log. */
  log: string;
  errors: TexError[];
  /** TeX gave up ("job aborted", "Emergency stop"). */
  aborted: boolean;
  /** Files TeX looked for that the engine doesn't have (packages a package needs, say). */
  missingFiles: string[];
  /** Fonts the page used that the converter can't draw. */
  missingFonts: string[];
  timing: { texMs: number; svgMs: number; totalMs: number };
}

export type ToWorker = { type: "init"; base: string } | { type: "compile"; id: number; tex: string };

export type FromWorker =
  | { type: "ready"; index: EngineIndex }
  | { type: "result"; id: number; outcome: CompileOutcome }
  | { type: "failed"; id: number | null; message: string };
