// Assembles vendor/engine-ci/dist for the Edge check of the engine built in CI
// (M3 step 1, D15): TikZJax 1.0.0-beta24's worker and fonts, with our
// tex.wasm.gz, core.dump.gz and tex_files from the CI artifact.
//
//   gh run download <run id> --name engine --dir vendor/engine-ci/artifact
//   node scripts/stage-engine-ci.ts
//   npm run bench-engines -- tikzjax --query=build=ci --tag=ci
//
// The worker gets the same loader fix as web2js's library.js in CI
// (engine/build/patch-web2js.cjs): a file it can't fetch is missing, whatever
// its extension. Without it, the 2026 kernel's quoted retry TeXinputs:"x.tex"
// comes back as an empty file. Spike only: our own worker replaces this one
// in Milestone 3 step 7.

import { createHash } from "node:crypto";
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const vendor = join(import.meta.dirname, "..", "vendor");
const beta = join(vendor, "tikzjax", "package", "dist");
const artifact = join(vendor, "engine-ci", "artifact");
const dist = join(vendor, "engine-ci", "dist");

for (const dir of [beta, artifact]) if (!existsSync(dir)) throw new Error(`missing ${dir}`);

interface Entry {
  name: string;
  sha256: string;
}
const manifest = JSON.parse(readFileSync(join(artifact, "manifest.json"), "utf8")) as {
  engine: Entry[];
  texFiles: Entry[];
};
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
for (const f of manifest.engine) {
  if (sha256(join(artifact, f.name)) !== f.sha256) throw new Error(`${f.name}: hash differs from manifest.json`);
}
for (const f of manifest.texFiles) {
  if (sha256(join(artifact, "tex_files", f.name)) !== f.sha256) throw new Error(`tex_files/${f.name}: hash differs`);
}

rmSync(dist, { recursive: true, force: true });
const ours = new Set(["tex.wasm.gz", "core.dump.gz", "tex_files"]);
for (const name of readdirSync(beta)) {
  if (!ours.has(name)) cpSync(join(beta, name), join(dist, name), { recursive: true });
}
for (const name of ours) cpSync(join(artifact, name), join(dist, name), { recursive: true });

// The same fixes as engine/build/patch-web2js.cjs, in the minified worker: a
// file that can't be fetched is missing, and getfilesize (\filesize) strips
// TeXinputs: and quotes and returns -1 for a missing file, which our tex.wasm
// prints as nothing.
const worker = join(dist, "run-tex.js");
let source = readFileSync(worker, "utf8");
const edits: [string, string][] = [
  ["erstat:/\\.(aux|log|dvi|tex|sty|def|cls)$/.test(A)?1:0", "erstat:1"],
  [
    'r=r.replace(/^\\*/,""),"TeXformats:TEX.POOL"==r&&(r="tex.pool"),-1!==I(r,"r")?s[r]?.length??0:0',
    'r=r.replace(/^\\*/,""),r=r.replace(/^TeXinputs:/,""),r.startsWith(\'"\')&&(r=r.replace(/^"/,"").replace(/".*/,"")),"TeXformats:TEX.POOL"==r&&(r="tex.pool"),-1!==I(r,"r")?s[r]?.length??-1:0',
  ],
];
for (const [from, to] of edits) {
  const count = source.split(from).length - 1;
  if (count !== 1) throw new Error(`run-tex.js: expected ${JSON.stringify(from)} once, found it ${count} times`);
  source = source.replace(from, to);
}
writeFileSync(worker, source);

console.log(
  `staged ${dist}: ${manifest.engine.map((f) => f.name).join(", ")}, ${manifest.texFiles.length} tex_files (hashes match); worker loader patched`,
);
