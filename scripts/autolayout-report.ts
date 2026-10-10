// Runs auto-layout (D80) on every corpus picture and prints what it wrote.
// Usage: npm run autolayout:report [-- <name filter>] [-- --right] [-- --full] [-- --out=<dir>]
//   --right   lay out left to right (default: top to bottom)
//   --full    print the whole picture before and after, not only the changed lines
//   --out=dir write each result to <dir>/<name>.<picture>.tex
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeDocument } from "../src/model/document.ts";
import { autoLayoutMessage, planAutoLayout } from "../src/edit/autolayout.ts";
import { corpusNames, loadCorpusFile } from "../test/corpus.ts";

const args = process.argv.slice(2);
const filter = args.find((a) => !a.startsWith("--"));
const direction = args.includes("--right") ? "right" : "down";
const full = args.includes("--full");
const out = args.find((a) => a.startsWith("--out="))?.slice(6);
if (out) mkdirSync(out, { recursive: true });

/** The lines of `after` that differ from `before`, with the lines they replace (a plain line diff by common prefix and suffix). */
function changedLines(before: string, after: string): string {
  const a = before.split("\n");
  const b = after.split("\n");
  const lines: string[] = [];
  // Longest common subsequence on lines, small inputs only.
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      i++;
      j++;
    } else if (j < m && (i === n || dp[i]![j + 1]! >= dp[i + 1]![j]!)) lines.push(`+ ${b[j++]}`);
    else lines.push(`- ${a[i++]}`);
  }
  return lines.join("\n");
}

let failures = 0;
for (const name of corpusNames().filter((x) => !filter || x.includes(filter))) {
  const { text } = loadCorpusFile(name);
  const doc = analyzeDocument(text);
  for (let i = 0; i < doc.syntax.pictures.length; i++) {
    const t0 = performance.now();
    const r = await planAutoLayout(text, i, { direction });
    const ms = performance.now() - t0;
    if (!r.ok) {
      console.log(`${name} #${i}: refused: ${r.reason} (${ms.toFixed(0)} ms)`);
      if (!/fewer than two/i.test(r.reason)) failures++;
      continue;
    }
    console.log(`${name} #${i}: ${autoLayoutMessage(r)} (${ms.toFixed(0)} ms)`);
    const pic = doc.syntax.pictures[i]!;
    const after = analyzeDocument(r.text).syntax.pictures[i]!;
    if (full) {
      console.log("--- before\n" + text.slice(pic.from, pic.to) + "\n--- after\n" + r.text.slice(after.from, after.to) + "\n");
    } else if (r.changes.length) console.log(changedLines(text, r.text) + "\n");
    if (out) writeFileSync(join(out, `${name.replace(/\.tex$/, "")}.${i}.tex`), r.text);
  }
}
if (failures) {
  console.log(`${failures} picture(s) refused.`);
  process.exitCode = 1;
}
