// Packs the engine built in CI into <out> (D15): tex.wasm.gz, core.dump.gz,
// tex_files/<name>.gz for every file the sample read after the format (from
// the same TeX Live snapshot as the format), and manifest.json with sizes,
// SHA-256 hashes, versions and timings.
//
//   node engine/build/pack.ts <work dir> <out dir>
//
// <work dir> holds tex.wasm, core.dump, dump-files.json, dump-timing.json,
// sample.files.json, sample.timing.json and versions.json. Build metadata
// comes from the environment (TL_IMAGE, WEB2JS_COMMIT, GITHUB_*).

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const [work, out] = process.argv.slice(2);
if (!work || !out) throw new Error("usage: pack.ts <work dir> <out dir>");

interface FileEntry {
  name: string;
  bytes: number;
  gzBytes: number;
  sha256: string;
}

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const readJson = (name: string): unknown => JSON.parse(readFileSync(join(work, name), "utf8"));

function packFile(source: string, target: string, name: string): FileEntry {
  const raw = readFileSync(source);
  const gz = gzipSync(raw, { level: 9 });
  writeFileSync(target, gz);
  return { name, bytes: raw.length, gzBytes: gz.length, sha256: sha256(gz) };
}

mkdirSync(join(out, "tex_files"), { recursive: true });

const engine = ["tex.wasm", "core.dump"].map((name) => packFile(join(work, name), join(out, `${name}.gz`), `${name}.gz`));

// Brotli sizes, for comparison with the M0 measurements (quality 11).
const brotli: Record<string, number> = {};
for (const name of ["tex.wasm", "core.dump"]) {
  brotli[name] = brotliCompressSync(readFileSync(join(work, name)), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: 0 },
  }).length;
}

const sampleFiles = readJson("sample.files.json") as Record<string, string>;
const texFiles = Object.entries(sampleFiles)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([name, path]) => packFile(path, join(out, "tex_files", `${name}.gz`), `${name}.gz`));

// The wasm's interface, which the browser worker must match (TikZJax
// 1.0.0-beta24's run-tex.js expects these imports and the asyncify exports).
const wasmModule = new WebAssembly.Module(readFileSync(join(work, "tex.wasm")));
const abi = {
  imports: WebAssembly.Module.imports(wasmModule).map((i) => `${i.module}.${i.name}`),
  exports: WebAssembly.Module.exports(wasmModule).map((e) => e.name),
};

const formatFiles = Object.keys(readJson("dump-files.json") as Record<string, string>).sort();

const manifest = {
  builtAt: new Date().toISOString(),
  build: {
    texliveImage: process.env.TL_IMAGE ?? null,
    web2jsCommit: process.env.WEB2JS_COMMIT ?? null,
    node: process.version,
    repository: process.env.GITHUB_REPOSITORY ?? null,
    commit: process.env.GITHUB_SHA ?? null,
    runId: process.env.GITHUB_RUN_ID ?? null,
  },
  versions: readJson("versions.json"),
  timing: { dump: readJson("dump-timing.json"), sample: readJson("sample.timing.json") },
  engine,
  brotli,
  abi,
  texFiles,
  texFilesTotal: {
    count: texFiles.length,
    bytes: texFiles.reduce((s, f) => s + f.bytes, 0),
    gzBytes: texFiles.reduce((s, f) => s + f.gzBytes, 0),
  },
  formatFiles,
};
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

const mb = (n: number) => `${(n / 1e6).toFixed(2)} MB`;
for (const f of engine) console.log(`${f.name.padEnd(14)} ${mb(f.bytes)} raw, ${mb(f.gzBytes)} gz, ${f.sha256}`);
console.log(`brotli: tex.wasm ${mb(brotli["tex.wasm"] ?? 0)}, core.dump ${mb(brotli["core.dump"] ?? 0)}`);
console.log(`tex_files: ${texFiles.length} files, ${mb(manifest.texFilesTotal.gzBytes)} gz; format read ${formatFiles.length} files`);
