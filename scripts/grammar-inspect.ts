// Prints coverage, byte breakdown, and error locations for each corpus file.
// Usage: npm run grammar:inspect [-- --tree] [-- <name filter>]
import { breakdown, checkCoverage, leaves, parser } from "../src/parser/analyze.ts";
import { corpusNames, loadCorpusFile } from "../test/corpus.ts";

const showTree = process.argv.includes("--tree");
const filter = process.argv.slice(2).find((a) => !a.startsWith("--"));
let totals = { modelled: 0, opaque: 0, error: 0 };
for (const name of corpusNames().filter((n) => !filter || n.includes(filter))) {
  const { text, encoding } = loadCorpusFile(name);
  const tree = parser.parse(text);
  const cov = checkCoverage(tree, text);
  const { bytes, errorNodes } = breakdown(tree, text);
  const picture = bytes.modelled + bytes.opaque + bytes.error;
  totals = { modelled: totals.modelled + bytes.modelled, opaque: totals.opaque + bytes.opaque, error: totals.error + bytes.error };
  const pct = (n: number) => ((100 * n) / (picture || 1)).toFixed(1).padStart(5) + "%";
  console.log(
    `${name.padEnd(36)} ${String(text.length).padStart(5)} chars ${encoding.padEnd(8)} coverage ${cov.ok ? "OK" : "FAILED"}` +
      `  modelled ${pct(bytes.modelled)} opaque ${pct(bytes.opaque)} error ${pct(bytes.error)}  error nodes ${errorNodes}`,
  );
  if (!cov.ok) console.log(cov);
  for (const leaf of leaves(tree)) {
    let n: typeof leaf.node | null = leaf.node;
    while (n && !n.type.isError) n = n.parent;
    if (n) {
      const line = text.slice(0, leaf.from).split("\n").length;
      console.log(`    error at line ${line}: ${JSON.stringify(text.slice(leaf.from, leaf.to))} (${leaf.name})`);
    }
  }
  if (showTree) console.log(tree.toString());
}
const all = totals.modelled + totals.opaque + totals.error;
console.log(
  `\nAll files: modelled ${((100 * totals.modelled) / all).toFixed(1)}%, opaque ${((100 * totals.opaque) / all).toFixed(1)}%, ` +
    `error ${((100 * totals.error) / all).toFixed(1)}% of TikZ bytes`,
);
