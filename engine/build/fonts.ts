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
import { gzipSync } from "node:zlib";
import { buildFontData } from "../../src/engine/fontdata.ts";

const [root, out] = process.argv.slice(2);
if (!root || !out) throw new Error("usage: fonts.ts <texmf-dist> <out dir>");

/** The TFM folders whose fonts the preview draws. */
const TFM_DIRS = ["fonts/tfm/public/cm", "fonts/tfm/public/amsfonts", "fonts/tfm/public/latex-fonts", "fonts/tfm/jknappen/ec"];
/**
 * Of the EC fonts, only the TS1 ones that LaTeX's ts1cmr.fd, ts1cmss.fd and
 * ts1cmtt.fd name (D87): LaTeX takes \$ and \textdollar from TS1. Their
 * outlines are cm-super's, re-encoded with its TS1 vector.
 */
const EC = /^tc(rm|sl|ti|ui|bx|bl|bi|ss|si|sx|so|tt|st|it)\d{4}$/;

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
for (const d of ["fonts/type1/public/amsfonts", "fonts/type1/public/cm-super"]) {
  for (const p of walk(join(root, d))) if (p.endsWith(".pfb")) type1.set(basename(p), p);
}
const mapped = new Map<string, string>();
/** The encoding file of each TFM whose map line re-encodes its font (cm-super's TS1 fonts). */
const encoded = new Map<string, string>();
const maps = [...walk(join(root, "fonts/map/dvips/amsfonts")), ...walk(join(root, "fonts/map/dvips/cm")), join(root, "fonts/map/dvips/cm-super/cm-super-ts1.map")];
for (const p of maps) {
  if (!p.endsWith(".map") || !existsSync(p)) continue;
  for (const line of readFileSync(p, "latin1").split("\n")) {
    const m = /^(\S+)\s.*<(\S+\.pfb)/.exec(line);
    if (m && !mapped.has(m[1]!)) mapped.set(m[1]!, m[2]!);
    const e = /^(\S+)\s.*<\[?(\S+\.enc)/.exec(line);
    if (e && !encoded.has(e[1]!)) encoded.set(e[1]!, e[2]!);
  }
}
const encFiles = new Map<string, string>();
for (const p of walk(join(root, "fonts/enc/dvips/cm-super"))) if (p.endsWith(".enc")) encFiles.set(basename(p), p);

/** The glyph names of a dvips encoding file, by code. */
function readEnc(path: string): string[] {
  const body = readFileSync(path, "latin1").replace(/%[^\n]*/g, "");
  const list = body.slice(body.indexOf("[") + 1, body.lastIndexOf("]"));
  return [...list.matchAll(/\/([^\s/[\]{}()<>]+)/g)].map((m) => m[1]!);
}

mkdirSync(join(out, "fonts"), { recursive: true });
mkdirSync(join(out, "tfm"), { recursive: true });
const index: Record<string, { bytes: number; outlines: boolean; missing?: number[] }> = {};
const tfms = TFM_DIRS.flatMap((d) => walk(join(root, d))).filter((p) => p.endsWith(".tfm") && (!p.includes("jknappen") || EC.test(basename(p, ".tfm"))));
for (const tfmPath of tfms.sort()) {
  const name = basename(tfmPath, ".tfm");
  if (index[name]) continue;
  const tfm = readFileSync(tfmPath);
  const pfbPath = type1.get(mapped.get(name) ?? `${name}.pfb`);
  const encPath = encFiles.get(encoded.get(name) ?? "");
  const { font, missing } = buildFontData(name, tfm, pfbPath ? readFileSync(pfbPath) : undefined, encPath ? readEnc(encPath) : undefined);
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
const ts1 = names.filter((n) => EC.test(n));
const gz = (n: string) => gzipSync(readFileSync(join(out, "fonts", `${n}.json`))).length + gzipSync(readFileSync(join(out, "tfm", `${n}.tfm`))).length;
if (ts1.length) console.log(`TS1 fonts: ${ts1.length}, ${(ts1.reduce((s, n) => s + gz(n), 0) / 1e6).toFixed(2)} MB gzipped (outlines and TFMs); tcrm1000 ${gz("tcrm1000")} bytes`);
