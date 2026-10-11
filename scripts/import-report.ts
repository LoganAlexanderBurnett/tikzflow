// Imports Mermaid and DOT files and prints the TikZ they become (D84).
// Usage: npm run import:report [-- <file or folder>…] [-- --right] [-- --out=<dir>]
// With no file, every .mmd, .mermaid, .dot and .gv under test/fixtures/import.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { importDiagram } from "../src/import/index.ts";

const args = process.argv.slice(2);
const paths = args.filter((a) => !a.startsWith("--"));
const out = args.find((a) => a.startsWith("--out="))?.slice(6);
const direction = args.includes("--right") ? "right" : args.includes("--down") ? "down" : undefined;
if (out) mkdirSync(out, { recursive: true });

const EXT = /\.(mmd|mermaid|dot|gv)$/;
const files: string[] = [];
for (const p of paths.length ? paths : [join(import.meta.dirname, "..", "test", "fixtures", "import")]) {
  if (statSync(p).isDirectory()) files.push(...readdirSync(p).filter((f) => EXT.test(f)).map((f) => join(p, f)));
  else files.push(p);
}

for (const file of files.sort()) {
  const src = readFileSync(file, "utf8");
  const started = performance.now();
  const r = await importDiagram(src, direction ? { direction } : {});
  const ms = Math.round(performance.now() - started);
  console.log(`\n=== ${basename(file)} (${ms} ms)`);
  if (!r.ok) {
    console.log(`Not imported: ${r.reason}`);
    continue;
  }
  console.log(`${r.format}, ${r.nodes} nodes, ${r.edges} edges, ${r.groups} groups, ${r.direction === "down" ? "top to bottom" : "left to right"}${r.laidOut ? "" : " (not laid out)"}`);
  for (const n of r.notes) console.log(`note: ${n}`);
  console.log(r.text);
  if (out) writeFileSync(join(out, `${basename(file).replace(EXT, "")}.tex`), r.text);
}
