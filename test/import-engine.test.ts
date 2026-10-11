// M4 step 5 (D84): what the importers write compiles in TeX without errors, with
// the engine folder the app serves (skipped when it isn't there, as in
// engine-run.test.ts). Every import fixture, and every arrow and shape the
// generator can write.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import { buildCompileInput } from "../src/engine/input.ts";
import { parseTexLog } from "../src/engine/log.ts";
import type { EngineIndex } from "../src/engine/protocol.ts";
import { PAGES, runTex } from "../src/engine/texlib.ts";
import { importDiagram } from "../src/import/index.ts";
import { analyzeDocument } from "../src/model/document.ts";

const tag = process.env.TIKZFLOW_ENGINE ?? (JSON.parse(readFileSync(join(import.meta.dirname, "..", "engine", "release.json"), "utf8")) as { tag: string }).tag;
const dir = join(import.meta.dirname, "..", "vendor", "engine", tag);
const have = existsSync(join(dir, "index.json"));
const fixtures = join(import.meta.dirname, "fixtures", "import");

describe.skipIf(!have)("imported diagrams in TeX", () => {
  let module: WebAssembly.Module;
  let dump: Uint8Array;
  let memory: WebAssembly.Memory;
  const files = new Set<string>();
  const read = (p: string) => gunzipSync(readFileSync(join(dir, p)));

  beforeAll(async () => {
    const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as EngineIndex;
    for (const f of index.texFiles) files.add(f);
    module = await WebAssembly.compile(read("tex.wasm.gz"));
    dump = read("core.dump.gz");
    memory = new WebAssembly.Memory({ initial: PAGES, maximum: PAGES });
  });

  async function compile(text: string) {
    const input = buildCompileInput(analyzeDocument(text), 0, (f) => files.has(f))!;
    new Uint8Array(memory.buffer).set(dump);
    const run = await runTex(module, memory, {
      terminal: "input.tex\n\\end\n",
      files: new Map([["input.tex", new TextEncoder().encode(input.tex)]]),
      lookup: (name) => (files.has(name) ? Promise.resolve(read(`tex_files/${name}.gz`)) : null),
    });
    const log = new TextDecoder("latin1").decode(run.written.get("input.log"));
    return { errors: parseTexLog(log), missing: run.missing, dvi: run.written.get("input.dvi") };
  }

  for (const name of existsSync(fixtures) ? readdirSync(fixtures).filter((f) => /\.(mmd|dot|gv)$/.test(f)) : []) {
    it(`${name} compiles without errors`, async () => {
      const r = await importDiagram(readFileSync(join(fixtures, name), "utf8"));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const c = await compile(r.text);
      expect(c.errors.map((e) => `${e.line}: ${e.message}`)).toEqual([]);
      expect(c.missing.filter((n) => n.endsWith(".sty"))).toEqual([]);
      expect(c.dvi).toBeDefined();
    }, 60_000);
  }

  it("every shape, tip and line the generator writes compiles", async () => {
    const mermaid = [
      "flowchart LR",
      "a[Rect] --> b(Round) --> c([Stadium]) --> d[[Sub]]",
      "e[(Db)] --> f((Circle)) --> g(((Double))) --> h{Dec}",
      "i{{Hex}} --> j[/Para/] --> k[\\Para alt\\] --> l[/Trap\\]",
      "m[\\Inv trap/] --> n>Flag]",
      "a --- e",
      "b --o f",
      "c --x g",
      "d <--> h",
      "i o--o j",
      "k x--x l",
      "m -.-> n",
      "a ==> n",
      "b -- text --> g",
      "c -->|pipe| h",
      "d --> d",
      "e --> f",
      "f --> e",
      "style a fill:#f96,stroke:#333,stroke-width:4px,color:#fff",
    ].join("\n");
    const r = await importDiagram(mermaid);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = await compile(r.text);
    expect(c.errors.map((e) => `${e.line}: ${e.message}`)).toEqual([]);
  }, 60_000);

  it("text with TeX's special characters compiles", async () => {
    // No "$": the engine has no TS1 font, so \$ is an error there (a limit of the preview, not of the TeX written).
    const r = await importDiagram('flowchart TD\n a["50% of x & y_z #35;1 {a} ~ ^ \\ <b> | >"] --> b["two<br/>lines"]');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = await compile(r.text);
    expect(c.errors.map((e) => `${e.line}: ${e.message}`)).toEqual([]);
  }, 60_000);
});
