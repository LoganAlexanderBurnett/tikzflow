// D87: which TikZ keys need a value, as tikzkeys.ts says, checked with the
// engine: a style with the name of such a key is an error in TeX where it is
// used on its own; one with the name of another key isn't. Skipped without the
// engine folder, as in engine-run.test.ts.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { expect, it } from "vitest";
import { buildCompileInput } from "../src/engine/input.ts";
import { parseTexLog } from "../src/engine/log.ts";
import type { EngineIndex } from "../src/engine/protocol.ts";
import { PAGES, runTex } from "../src/engine/texlib.ts";
import { analyzeDocument } from "../src/model/document.ts";
import { TIKZ_KEY_NAMES, tikzKeyClash } from "../src/tikz/tikzkeys.ts";
const tag = (JSON.parse(readFileSync(join(import.meta.dirname, "..", "engine", "release.json"), "utf8")) as { tag: string }).tag;
const dir = join(import.meta.dirname, "..", "vendor", "engine", tag);
it.skipIf(!existsSync(join(dir, "index.json")))("a style named like a key that needs a value is an error in TeX, and only then", async () => {
  const read = (p: string) => gunzipSync(readFileSync(join(dir, p)));
  const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as EngineIndex;
  const files = new Set(index.texFiles);
  const module = await WebAssembly.compile(read("tex.wasm.gz"));
  const memory = new WebAssembly.Memory({ initial: PAGES, maximum: PAGES });
  const wrong: string[] = [];
  for (const k of TIKZ_KEY_NAMES) {
    const t = String.raw`\documentclass{standalone}
\usepackage{tikz}
\usetikzlibrary{positioning,fit,arrows.meta}
\tikzset{${k}/.style={blue}}
\begin{document}
\begin{tikzpicture}
\node[${k}] (a) {A};
\end{tikzpicture}
\end{document}
`;
    const input = buildCompileInput(analyzeDocument(t), 0, (x) => files.has(x))!;
    new Uint8Array(memory.buffer).set(read("core.dump.gz"));
    const run = await runTex(module, memory, { terminal: "input.tex\n\\end\n", files: new Map([["input.tex", new TextEncoder().encode(input.tex)]]), lookup: (name) => (files.has(name) ? Promise.resolve(read(`tex_files/${name}.gz`)) : null) });
    const log = new TextDecoder("latin1").decode(run.written.get("input.log"));
    const errors = parseTexLog(log).length > 0;
    if (errors !== tikzKeyClash(k)!.needsValue) wrong.push(`${k}: ${errors ? "an error in TeX" : "no error"}`);
  }
  expect(wrong).toEqual([]);
}, 300_000);
