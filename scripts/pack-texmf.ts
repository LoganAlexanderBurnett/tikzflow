// Packs selected TeX package directories from vendor/texmf into one JSON file
// of { name, text } entries, flattened to bare file names. Engines whose file
// lookup only indexes their own trees (busytex uses ls-R) can still find
// files written into the working directory.
//
// Usage: node scripts/pack-texmf.ts

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";

const texmf = join(import.meta.dirname, "..", "vendor", "texmf");
const out = join(import.meta.dirname, "..", "vendor", "packs");

const PACKS: Record<string, string[]> = {
  // Packages busytex's texlive-basic bundle lacks.
  "tikz-flat": [
    "tex/generic/pgf",
    "tex/latex/pgf",
    "tex/latex/standalone",
    "tex/latex/xkeyval",
    "tex/generic/xkeyval",
    "tex/latex/xcolor",
  ],
};

// Lua files are LuaTeX-only and their names collide once flattened.
const SKIP = new Set([".lua"]);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

mkdirSync(out, { recursive: true });
const decoder = new TextDecoder("utf-8", { fatal: true });
for (const [name, dirs] of Object.entries(PACKS)) {
  const files = new Map<string, string>();
  for (const dir of dirs) {
    for (const path of walk(join(texmf, dir))) {
      if (SKIP.has(extname(path))) continue;
      const file = basename(path);
      if (files.has(file)) throw new Error(`duplicate file name after flattening: ${file}`);
      files.set(file, decoder.decode(readFileSync(path)));
    }
  }
  const json = JSON.stringify([...files].map(([n, text]) => ({ name: n, text })));
  writeFileSync(join(out, `${name}.json`), json);
  console.log(`${name}: ${files.size} files, ${(json.length / 1048576).toFixed(2)} MB`);
}
