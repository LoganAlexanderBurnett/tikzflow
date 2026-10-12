// Writes the help site from src/help/*.md (M5 step 7, D99): help/**/index.html, the search index and
// public/sitemap.xml. Commit what it writes; test/help.test.ts fails when they are stale.
// Usage: npm run help:build

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildHelp } from "./lib/help.ts";

const root = join(import.meta.dirname, "..");
for (const [path, content] of buildHelp()) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
  console.log(path);
}
