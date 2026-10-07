// Times parsing, layout, snapping and a move on a generated 200-node, 250-edge picture.
// Usage: npm run layout:bench
import { planMove } from "../src/edit/move.ts";
import { snapNode } from "../src/edit/snap.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";

const lines = ["\\begin{tikzpicture}[node distance=8mm, process/.style={draw, minimum width=2cm}]"];
for (let i = 0; i < 200; i++) {
  const pos = i === 0 ? "" : `, ${i % 5 === 0 ? "right" : "below"}=of n${i - 1}`;
  lines.push(`  \\node[process${pos}] (n${i}) {Step ${i}: $x_{${i}} = f(x_{${i - 1}})$};`);
}
for (let i = 0; i < 250; i++) {
  const a = i % 200;
  const b = (i * 7 + 3) % 200;
  lines.push(`  \\draw[->] (n${a}) ${i % 3 === 0 ? "|-" : "--"} node[pos=0.5, above] {e${i}} (n${b});`);
}
lines.push("\\end{tikzpicture}", "");
const text = lines.join("\n");

const time = (label: string, f: () => void, runs = 20) => {
  f();
  const t = performance.now();
  for (let i = 0; i < runs; i++) f();
  console.log(`${label.padEnd(28)} ${((performance.now() - t) / runs).toFixed(2)} ms`);
};
const doc = analyzeDocument(text);
time("parse + extract", () => analyzeDocument(text));
time("layout", () => layoutDocumentPicture(doc, 0));
const layout = layoutDocumentPicture(doc, 0)!;
const n = layout.nodes[100]!;
time("layout with drag override", () => layoutDocumentPicture(doc, 0, new Map([[n.id, { x: n.shape.center.x + 10, y: n.shape.center.y }]])));
time("snap", () => snapNode(layout, n, { x: n.shape.center.x + 10, y: n.shape.center.y }, 3));
time("plan move (drop)", () => planMove(text, 0, n.id, { x: n.shape.center.x + 40, y: n.shape.center.y - 20 }), 5);
