// Prints coverage, byte breakdown, and error locations for each fixture.
// Usage: node spike/grammar/inspect.ts [--tree]
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { breakdown, checkCoverage, leaves, parser } from "./analyze.ts";

const dir = join(import.meta.dirname, "fixtures");
const showTree = process.argv.includes("--tree");
for (const file of readdirSync(dir).filter((f) => f.endsWith(".tex"))) {
  const text = readFileSync(join(dir, file), "utf8");
  const tree = parser.parse(text);
  const cov = checkCoverage(tree, text);
  const { bytes, errorNodes } = breakdown(tree);
  const picture = bytes.modelled + bytes.opaque + bytes.error;
  const pct = (n: number) => ((100 * n) / picture).toFixed(1) + "%";
  console.log(`\n${file}: ${text.length} bytes, coverage ${cov.ok ? "OK" : "FAILED"}`);
  if (!cov.ok) console.log(cov);
  console.log(
    `  TikZ bytes ${picture}: modelled ${pct(bytes.modelled)}, opaque ${pct(bytes.opaque)}, ` +
      `error ${pct(bytes.error)}; document text ${bytes.document}; error nodes ${errorNodes}`,
  );
  for (const leaf of leaves(tree)) {
    let n: typeof leaf.node | null = leaf.node;
    while (n && !n.type.isError) n = n.parent;
    if (n) {
      const line = text.slice(0, leaf.from).split("\n").length;
      console.log(`  error at line ${line}: ${JSON.stringify(text.slice(leaf.from, leaf.to))} (${leaf.name})`);
    }
  }
  if (showTree) console.log(tree.toString());
}
