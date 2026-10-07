// Lays out every corpus picture and prints the "what I understood" summary.
// Usage: npm run corpus:report [-- <name filter>] [-- -v]
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import { summarize } from "../src/model/summary.ts";
import { corpusNames, loadCorpusFile } from "../test/corpus.ts";

const filter = process.argv[2];
const verbose = process.argv.includes("-v");
for (const name of corpusNames().filter((n) => !filter || n.includes(filter))) {
  const { text } = loadCorpusFile(name);
  const doc = analyzeDocument(text);
  doc.syntax.pictures.forEach((_, i) => {
    const t0 = performance.now();
    const layout = layoutDocumentPicture(doc, i)!;
    const ms = performance.now() - t0;
    const s = summarize(doc, layout, i);
    console.log(`${name} #${i}: ${s.headline} (${ms.toFixed(1)} ms)`);
    if (verbose) {
      for (const l of s.locked) console.log(`    locked ${l.id}: ${l.reason}`);
      for (const u of s.unresolved) console.log(`    ${u.kind === "later" ? "defined later" : "undefined"}: ${u.name} (${u.refs.length}×)`);
      if (s.unknownKeys.length) console.log(`    unknown keys: ${s.unknownKeys.map((k) => `${k.key}×${k.count}`).join(", ")}`);
      for (const n of s.notes) console.log(`    ${n}`);
      for (const n of layout.nodes) console.log(`      node ${n.id.padEnd(14)} ${n.shape.kind.padEnd(10)} c=(${n.shape.center.x.toFixed(1)},${n.shape.center.y.toFixed(1)}) ${(2 * n.shape.hw).toFixed(1)}x${(2 * n.shape.hh).toFixed(1)} ${n.position.kind} [${n.position.refs.join(",")}]`);
    }
  });
}
