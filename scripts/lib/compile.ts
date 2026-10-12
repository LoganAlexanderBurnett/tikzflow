// SPDX-License-Identifier: GPL-3.0-or-later
// Compiles TikZ with the accurate preview's engine in Node, as the browser does (the same pipeline as
// test/engine-run.test.ts): the pinned engine from vendor/engine/<tag> (`npm run fetch-engines --
// engine`), or TIKZFLOW_ENGINE=<folder>. Used for the site's pictures (D89).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { dviFonts, dviToSvg } from "../../src/engine/dvisvg.ts";
import type { FontData } from "../../src/engine/fontdata.ts";
import { buildCompileInput } from "../../src/engine/input.ts";
import { parseTexLog, type TexError } from "../../src/engine/log.ts";
import type { EngineIndex } from "../../src/engine/protocol.ts";
import { PAGES, runTex } from "../../src/engine/texlib.ts";
import { tidySvg } from "../../src/export/svg.ts";
import { analyzeDocument } from "../../src/model/document.ts";

const root = join(import.meta.dirname, "..", "..");
export const engineTag = process.env.TIKZFLOW_ENGINE ?? (JSON.parse(readFileSync(join(root, "engine", "release.json"), "utf8")) as { tag: string }).tag;
const dir = join(root, "vendor", "engine", engineTag);
export const haveEngine = (): boolean => existsSync(join(dir, "index.json"));

export interface Compiled {
  /** TeX's picture, tidied as the SVG export makes it (D72). Null when TeX drew nothing. */
  svg: string | null;
  errors: TexError[];
  log: string;
}

export interface Compiler {
  compile(text: string, picture?: number, margin?: number): Promise<Compiled>;
}

/** Loads the engine once; each `compile` starts from the dumped format, as the worker does. */
export async function engine(): Promise<Compiler> {
  if (!haveEngine()) throw new Error(`The engine ${engineTag} isn't in vendor/engine: run npm run fetch-engines -- engine.`);
  const read = (p: string) => gunzipSync(readFileSync(join(dir, p)));
  const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as EngineIndex;
  const files = new Set(index.texFiles);
  const module = await WebAssembly.compile(read("tex.wasm.gz"));
  const dump = read("core.dump.gz");
  const memory = new WebAssembly.Memory({ initial: PAGES, maximum: PAGES });
  return {
    async compile(text, picture = 0, margin = 2) {
      const input = buildCompileInput(analyzeDocument(text), picture, (f) => files.has(f));
      if (!input) throw new Error("No picture to compile.");
      new Uint8Array(memory.buffer).set(dump);
      const run = await runTex(module, memory, {
        terminal: "input.tex\n\\end\n",
        files: new Map([["input.tex", new TextEncoder().encode(input.tex)]]),
        lookup: (name) => (files.has(name) ? Promise.resolve(read(`tex_files/${name}.gz`)) : null),
      });
      const log = new TextDecoder("latin1").decode(run.written.get("input.log"));
      const dvi = run.written.get("input.dvi");
      const fonts = new Map<string, FontData>();
      for (const f of dvi ? dviFonts(dvi) : []) fonts.set(f.name, JSON.parse(read(`fonts/${f.name}.json.gz`).toString()) as FontData);
      const raw = dvi ? dviToSvg(dvi, (n) => fonts.get(n)) : null;
      return { svg: raw ? tidySvg(raw.svg, margin).svg : null, errors: parseTexLog(log), log };
    },
  };
}
