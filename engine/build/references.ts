// The comparison diagrams (spike/engines/diagrams/*.tex) as inputs for the
// engine built in CI (D66). CI compiles each with tex.wasm and core.dump, and
// converts the DVI with the real dvisvgm, so our own converter
// (src/engine/dvisvg.ts) can be checked against it on the same DVI files.
//
//   node engine/build/references.ts write <dir>
//     writes <dir>/<name>.tex: what follows the preamble saved in core.dump.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const [command, dir] = process.argv.slice(2);
if (command !== "write" || !dir) throw new Error("usage: references.ts write <dir>");

const diagrams = join(import.meta.dirname, "..", "..", "spike", "engines", "diagrams");
mkdirSync(dir, { recursive: true });
const names: string[] = [];
for (const file of readdirSync(diagrams).filter((f) => f.endsWith(".tex")).sort()) {
  const source = readFileSync(join(diagrams, file), "utf8");
  const libs = (/^% libraries:(.*)$/m.exec(source)?.[1] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const tex = [
    "\\usepackage{amsmath}\n",
    libs.length ? `\\usetikzlibrary{${libs.join(",")}}\n` : "",
    "\\begin{document}\n",
    source,
    "\\end{document}\n",
  ].join("");
  // TeX job names: no dots or dashes needed, but keep them readable.
  const name = basename(file, ".tex");
  writeFileSync(join(dir, `${name}.tex`), tex);
  names.push(name);
}
console.log(`wrote ${names.length} diagrams to ${dir}: ${names.join(", ")}`);
