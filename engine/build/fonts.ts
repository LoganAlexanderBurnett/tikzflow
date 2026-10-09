// Builds the font files of the accurate preview (D66): for every TFM of
// Computer Modern, the AMS fonts and LaTeX's own fonts, fonts/<name>.json
// with its metrics and its Type 1 outlines (see src/engine/fontdata.ts), and
// a copy of the TFM itself, which TeX reads when a document uses the font.
//
//   node engine/build/fonts.ts <texmf-dist> <out dir>
//
// Writes <out>/fonts/<name>.json, <out>/tfm/<name>.tfm and <out>/fonts.json
// (name → bytes, and the characters that have no outline). Locally,
// <texmf-dist> can be vendor/texmf.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { buildFontData } from "../../src/engine/fontdata.ts";

const [root, out] = process.argv.slice(2);
if (!root || !out) throw new Error("usage: fonts.ts <texmf-dist> <out dir>");

/** The TFM folders whose fonts the preview draws. */
const TFM_DIRS = ["fonts/tfm/public/cm", "fonts/tfm/public/amsfonts", "fonts/tfm/public/latex-fonts"];

function walk(dir: string, found: string[] = []): string[] {
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, found);
    else found.push(path);
  }
  return found;
}

// Type 1 files by name, and the dvips maps that say which file a TFM uses
// (LaTeX's lcircle10 is drawn from lcircle1.pfb).
const type1 = new Map<string, string>();
for (const p of walk(join(root, "fonts/type1/public/amsfonts"))) if (p.endsWith(".pfb")) type1.set(basename(p), p);
const mapped = new Map<string, string>();
for (const p of [...walk(join(root, "fonts/map/dvips/amsfonts")), ...walk(join(root, "fonts/map/dvips/cm"))]) {
  if (!p.endsWith(".map")) continue;
  for (const line of readFileSync(p, "latin1").split("\n")) {
    const m = /^(\S+)\s.*<(\S+\.pfb)/.exec(line);
    if (m && !mapped.has(m[1]!)) mapped.set(m[1]!, m[2]!);
  }
}

mkdirSync(join(out, "fonts"), { recursive: true });
mkdirSync(join(out, "tfm"), { recursive: true });
const index: Record<string, { bytes: number; outlines: boolean; missing?: number[] }> = {};
const tfms = TFM_DIRS.flatMap((d) => walk(join(root, d))).filter((p) => p.endsWith(".tfm"));
for (const tfmPath of tfms.sort()) {
  const name = basename(tfmPath, ".tfm");
  if (index[name]) continue;
  const tfm = readFileSync(tfmPath);
  const pfbPath = type1.get(mapped.get(name) ?? `${name}.pfb`);
  const { font, missing } = buildFontData(name, tfm, pfbPath ? readFileSync(pfbPath) : undefined);
  const json = JSON.stringify(font);
  writeFileSync(join(out, "fonts", `${name}.json`), json);
  writeFileSync(join(out, "tfm", `${name}.tfm`), tfm);
  index[name] = { bytes: json.length, outlines: !!pfbPath, ...(missing.length ? { missing } : {}) };
}
writeFileSync(join(out, "fonts.json"), JSON.stringify(index, null, 1) + "\n");
const names = Object.keys(index);
const without = names.filter((n) => !index[n]!.outlines);
console.log(`fonts: ${names.length} TFMs, ${names.length - without.length} with outlines; without: ${without.join(" ") || "none"}`);
const partial = names.filter((n) => index[n]!.missing);
if (partial.length) console.log(`characters without outlines in: ${partial.map((n) => `${n} (${index[n]!.missing!.length})`).join(", ")}`);
