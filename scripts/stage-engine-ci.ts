// Stages the engine from a CI run's artifact (D67) so the app and the
// comparison pages can use it before it is released:
//
//   gh run download <run id> --name engine --dir vendor/engine-ci/<folder>
//   node scripts/stage-engine-ci.ts vendor/engine-ci/<folder>
//
// Checks engine.tar against the artifact's manifest.json and unpacks it into
// vendor/engine/<version>/ (ci-<run id>), served as /engine/<version>/.
// Open the app with ?engine=ci-<run id>, or the comparison page with
// /spike/engines/compare.html?engine=ci-<run id>.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import * as tar from "tar";

const artifact = process.argv[2];
if (!artifact) throw new Error("usage: stage-engine-ci.ts <artifact dir>");
const manifest = JSON.parse(readFileSync(join(artifact, "manifest.json"), "utf8")) as {
  version: string;
  tar: { name: string; bytes: number; sha256: string };
};
const file = join(artifact, manifest.tar.name);
if (!existsSync(file)) throw new Error(`missing ${file}: is this an artifact from a run after M3 step 7?`);
const sha = createHash("sha256").update(readFileSync(file)).digest("hex");
if (sha !== manifest.tar.sha256) throw new Error(`${file}: SHA-256 ${sha}, manifest.json says ${manifest.tar.sha256}`);

const dest = join(import.meta.dirname, "..", "vendor", "engine", manifest.version);
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
await tar.x({ file, cwd: dest });
console.log(`staged vendor/engine/${manifest.version} (engine.tar hash matches); open the app with ?engine=${manifest.version}`);
