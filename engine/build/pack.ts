// Packs the engine built in CI (D15, D66, D67) into <out>:
//   engine/            the folder the app serves, as it is:
//     tex.wasm.gz, core.dump.gz
//     tex_files/<name>.gz   every file TeX may read after the format
//     fonts/<name>.json.gz  the DVI converter's fonts
//     index.json            what is there (src/engine/protocol.ts EngineIndex)
//   engine.tar         the same folder, for the release
//   reference/         the comparison diagrams: our DVI, dvisvgm's SVG, logs
//   manifest.json      versions, timings, sizes and SHA-256 hashes
//
//   node engine/build/pack.ts <work dir> <out dir> [version]
//
// <work dir> holds tex.wasm, core.dump, dump-files.json, dump-timing.json,
// sample.files.json, sample.timing.json, versions.json, fonts-build/,
// packages/ and ref/. Build metadata comes from the environment (TL_IMAGE,
// WEB2JS_COMMIT, GITHUB_*). [version] names the build in index.json: the
// release tag, or ci-<run id>.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const [work, out, versionArg] = process.argv.slice(2);
if (!work || !out) throw new Error("usage: pack.ts <work dir> <out dir> [version]");
const version = versionArg ?? `ci-${process.env.GITHUB_RUN_ID ?? "local"}`;

interface FileEntry {
  name: string;
  bytes: number;
  gzBytes: number;
  sha256: string;
}

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const readJson = (name: string): unknown => JSON.parse(readFileSync(join(work, name), "utf8"));

/** Writes `source` gzipped to `target`. Gzip without a file name or time, so the same input gives the same bytes. */
function packFile(source: string, target: string, name: string): FileEntry {
  const raw = readFileSync(source);
  const gz = gzipSync(raw, { level: 9 });
  writeFileSync(target, gz);
  return { name, bytes: raw.length, gzBytes: gz.length, sha256: sha256(gz) };
}

const engineDir = join(out, "engine");
mkdirSync(join(engineDir, "tex_files"), { recursive: true });
mkdirSync(join(engineDir, "fonts"), { recursive: true });

const engine = ["tex.wasm", "core.dump"].map((name) => packFile(join(work, name), join(engineDir, `${name}.gz`), `${name}.gz`));

// Brotli sizes, for comparison with the M0 measurements (quality 11).
const brotli: Record<string, number> = {};
for (const name of ["tex.wasm", "core.dump"]) {
  brotli[name] = brotliCompressSync(readFileSync(join(work, name)), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: 0 },
  }).length;
}

// TeX's files: the curated packages (packages.ts), and anything else the sample read.
const sources = new Map<string, string>();
const packagesDir = join(work, "packages");
if (existsSync(packagesDir)) for (const n of readdirSync(packagesDir)) sources.set(n, join(packagesDir, n));
for (const [n, p] of Object.entries(readJson("sample.files.json") as Record<string, string>)) if (!sources.has(n)) sources.set(n, p);
const texFiles = [...sources.keys()].sort().map((n) => packFile(sources.get(n)!, join(engineDir, "tex_files", `${n}.gz`), n));

// The converter's fonts (fonts.ts wrote them to <work>/fonts-build).
const fontsBuild = join(work, "fonts-build", "fonts");
const fonts = existsSync(fontsBuild)
  ? readdirSync(fontsBuild)
      .sort()
      .map((n) => packFile(join(fontsBuild, n), join(engineDir, "fonts", `${n}.gz`), n.replace(/\.json$/, "")))
  : [];

const versions = readJson("versions.json") as { latex?: string; l3kernel?: string; pgf?: string };
const index = {
  version,
  versions: { latex: versions.latex ?? null, l3kernel: versions.l3kernel ?? null, pgf: versions.pgf ?? null },
  texFiles: texFiles.map((f) => f.name),
  fonts: fonts.map((f) => f.name),
};
writeFileSync(join(engineDir, "index.json"), JSON.stringify(index) + "\n");

// One file for the release; files sorted, owners and times fixed, so a rebuild gives the same tar.
execFileSync("tar", ["--sort=name", "--owner=0", "--group=0", "--numeric-owner", "--mtime=@0", "-cf", join(out, "engine.tar"), "-C", engineDir, "."]);
const tar = readFileSync(join(out, "engine.tar"));

// The reference diagrams: our engine's DVI and log, and the real dvisvgm's SVG of that DVI.
const refDir = join(work, "ref");
const references: string[] = [];
if (existsSync(refDir)) {
  mkdirSync(join(out, "reference"), { recursive: true });
  for (const name of readdirSync(refDir).sort()) {
    if (!/\.(tex|dvi|log|svg|txt)$/.test(name)) continue;
    copyFileSync(join(refDir, name), join(out, "reference", name));
    references.push(name);
  }
}

// The wasm's interface, which src/engine/texlib.ts must match.
const wasmModule = new WebAssembly.Module(readFileSync(join(work, "tex.wasm")));
const abi = {
  imports: WebAssembly.Module.imports(wasmModule).map((i) => `${i.module}.${i.name}`),
  exports: WebAssembly.Module.exports(wasmModule).map((e) => e.name),
};

const total = (fs: FileEntry[]) => ({
  count: fs.length,
  bytes: fs.reduce((s, f) => s + f.bytes, 0),
  gzBytes: fs.reduce((s, f) => s + f.gzBytes, 0),
});
const manifest = {
  version,
  builtAt: new Date().toISOString(),
  build: {
    texliveImage: process.env.TL_IMAGE ?? null,
    web2jsCommit: process.env.WEB2JS_COMMIT ?? null,
    node: process.version,
    repository: process.env.GITHUB_REPOSITORY ?? null,
    commit: process.env.GITHUB_SHA ?? null,
    runId: process.env.GITHUB_RUN_ID ?? null,
    sourceDateEpoch: process.env.SOURCE_DATE_EPOCH ?? null,
  },
  versions,
  timing: { dump: readJson("dump-timing.json"), sample: readJson("sample.timing.json") },
  engine,
  brotli,
  abi,
  tar: { name: "engine.tar", bytes: tar.length, sha256: sha256(tar) },
  texFiles: total(texFiles),
  largestTexFile: texFiles.reduce((a, b) => (b.gzBytes > a.gzBytes ? b : a), texFiles[0]!),
  fonts: total(fonts),
  packages: existsSync(join(work, "packages.json")) ? readJson("packages.json") : null,
  references,
  formatFiles: Object.keys(readJson("dump-files.json") as Record<string, string>).sort(),
};
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

const mb = (n: number) => `${(n / 1e6).toFixed(2)} MB`;
for (const f of engine) console.log(`${f.name.padEnd(14)} ${mb(f.bytes)} raw, ${mb(f.gzBytes)} gz, ${f.sha256}`);
console.log(`brotli: tex.wasm ${mb(brotli["tex.wasm"] ?? 0)}, core.dump ${mb(brotli["core.dump"] ?? 0)}`);
console.log(`tex_files: ${texFiles.length} files, ${mb(manifest.texFiles.gzBytes)} gz; fonts: ${fonts.length} files, ${mb(manifest.fonts.gzBytes)} gz`);
console.log(`engine.tar: ${mb(tar.length)}, ${manifest.tar.sha256}; reference files: ${references.length}; version ${version}`);
