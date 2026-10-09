// Collects the TeX files the accurate preview can load (D67): every file the
// packages in engine/build/packages.txt install under texmf-dist/tex, found
// by name with kpsewhich as TeX would find it, and the TFMs fonts.ts copied.
//
//   node engine/build/packages.ts <packages.txt> <fonts dir> <out dir>
//
// Writes <out>/<name> for each file (a flat folder: TeX looks files up by
// name) and <out>/../packages.json (package → file names, and what was left
// out). Needs tlmgr and kpsewhich (the TeX Live image).

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const [listPath, fontsDir, out] = process.argv.slice(2);
if (!listPath || !fontsDir || !out) throw new Error("usage: packages.ts <packages.txt> <fonts dir> <out dir>");

const packages = readFileSync(listPath, "utf8")
  .split("\n")
  .map((l) => l.replace(/#.*/, "").trim())
  .filter(Boolean);

/** Files the preview never reads: other engines' and drivers' code, documentation sources. */
const SKIP = /\.(lua|dtx|ins|pdf|md|txt|html|py|pl|sh|bat)$|^pgfsys-(?!common-|tikzflow|dvisvgm\.def)|README|LICENSE/i;

const byPackage: Record<string, string[]> = {};
const names = new Set<string>();
const notInstalled: string[] = [];
for (const pkg of packages) {
  let listing = "";
  try {
    listing = execFileSync("tlmgr", ["info", "--list", "--only-installed", pkg], { encoding: "utf8", maxBuffer: 64 << 20 });
  } catch {
    notInstalled.push(pkg);
    continue;
  }
  const files = listing
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("texmf-dist/tex/"))
    .map((l) => basename(l))
    .filter((n) => !SKIP.test(n));
  if (!files.length) notInstalled.push(pkg);
  byPackage[pkg] = files;
  for (const n of files) names.add(n);
}

// Where TeX would find each name (the first match in kpathsea's search order).
const resolved = new Map<string, string>();
const all = [...names];
for (let i = 0; i < all.length; i += 200) {
  const batch = all.slice(i, i + 200);
  let found = "";
  try {
    found = execFileSync("kpsewhich", batch, { encoding: "utf8", maxBuffer: 64 << 20 });
  } catch (e) {
    // kpsewhich exits 1 when some name isn't found, after printing the others.
    found = String((e as { stdout?: string }).stdout ?? "");
  }
  for (const path of found.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const n = basename(path);
    if (!resolved.has(n)) resolved.set(n, path);
  }
}

mkdirSync(out, { recursive: true });
let bytes = 0;
for (const [n, path] of resolved) {
  copyFileSync(path, join(out, n));
  bytes += readFileSync(path).length;
}
// TFMs, for fonts a document uses that the format didn't load.
let tfms = 0;
const tfmDir = join(fontsDir, "tfm");
if (existsSync(tfmDir)) {
  for (const n of readdirSync(tfmDir)) {
    if (!existsSync(join(out, n))) {
      copyFileSync(join(tfmDir, n), join(out, n));
      tfms++;
    }
  }
}
const unresolved = all.filter((n) => !resolved.has(n));
writeFileSync(
  join(dirname(out), "packages.json"),
  JSON.stringify({ packages: byPackage, notInstalled, unresolved, files: resolved.size, bytes, tfms }, null, 1) + "\n",
);
console.log(`packages: ${packages.length} (${notInstalled.length} not installed: ${notInstalled.join(" ") || "none"})`);
console.log(`files: ${resolved.size}, ${(bytes / 1e6).toFixed(2)} MB raw; TFMs: ${tfms}; names kpsewhich didn't find: ${unresolved.length}`);
