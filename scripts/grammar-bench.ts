// Parse-time benchmark on a generated 200-node, 250-edge flowchart.
// Usage: npm run grammar:bench
import { TreeFragment } from "@lezer/common";
import { checkCoverage, parser } from "../src/parser/analyze.ts";

const lines = ["\begin{tikzpicture}[node distance=8mm]"];
for (let i = 0; i < 200; i++) {
  const pos = i === 0 ? "" : `, ${i % 5 === 0 ? "right" : "below"}=of n${i - 1}`;
  lines.push(`  \node[process${pos}] (n${i}) {Step ${i}: $x_{${i}} = f(x_{${i - 1}})$};`);
}
for (let i = 0; i < 250; i++) {
  const a = i % 200, b = (i * 7 + 3) % 200;
  lines.push(`  \draw[->] (n${a}) ${i % 3 === 0 ? "|-" : "--"} node[pos=0.5, above] {e${i}} (n${b});`);
}
lines.push("\end{tikzpicture}", "");
const text = lines.join("\n");

const time = (f: () => void, runs = 50) => {
  for (let i = 0; i < 5; i++) f();
  const t = performance.now();
  for (let i = 0; i < runs; i++) f();
  return (performance.now() - t) / runs;
};

const tree = parser.parse(text);
if (!checkCoverage(tree, text).ok) throw new Error("coverage failed on benchmark input");
const mid = text.indexOf("(n100)") + 2; // inside a node name in the middle
const changed = text.slice(0, mid) + "x" + text.slice(mid);
const fragments = TreeFragment.applyChanges(TreeFragment.addTree(tree), [
  { fromA: mid, toA: mid, fromB: mid, toB: mid + 1 },
]);

console.log(`input: ${text.length} chars, ${lines.length} lines`);
console.log(`full parse:        ${time(() => parser.parse(changed)).toFixed(2)} ms`);
console.log(`incremental parse: ${time(() => parser.parse(changed, fragments)).toFixed(3)} ms`);
