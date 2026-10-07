// Prints, for each golden file, the line a scripted move changed: before and after.
// Usage: npm run golden:review
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { diffRange } from "../src/edit/changes.ts";
import { decode } from "../src/source/encoding.ts";
import { loadCorpusFile } from "../test/corpus.ts";

const dir = join(import.meta.dirname, "..", "test", "fixtures", "golden");
for (const f of readdirSync(dir)) {
  const base = f.replace(/\.\d+\.[a-z-]+\.tex$/, ".tex");
  const orig = loadCorpusFile(base).text;
  const after = decode(new Uint8Array(readFileSync(join(dir, f)))).text;
  const d = diffRange(orig, after)!;
  // Show the changed line(s) before and after.
  const ls = orig.lastIndexOf("\n", d.from - 1) + 1;
  const le = orig.indexOf("\n", d.to);
  const beforeLine = orig.slice(ls, le < 0 ? undefined : le);
  const afterLine = after.slice(ls, after.indexOf("\n", d.from + d.insert.length) < 0 ? undefined : after.indexOf("\n", d.from + d.insert.length));
  console.log(`${f}\n  - ${beforeLine.trim()}\n  + ${afterLine.trim()}`);
}
