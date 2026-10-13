// Times parsing, layout, snapping, a move and auto-layout on a generated picture: by default the
// 200-node, 250-edge one of the drag target (D102); also the 500-node one and the dense 4-16-16-4 network.
// Usage: npm run layout:bench [-- --picture=200|500|dense]
import { planAutoLayout } from "../src/edit/autolayout.ts";
import { planMove } from "../src/edit/move.ts";
import { snapNode } from "../src/edit/snap.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import { pictureEdges } from "../src/model/edges.ts";
import { BENCH_200, BENCH_500, DENSE_4_16_16_4 } from "./lib/benchpictures.ts";

const which = process.argv.find((a) => a.startsWith("--picture="))?.slice(10) ?? "200";
const text = { "200": BENCH_200, "500": BENCH_500, dense: DENSE_4_16_16_4 }[which];
if (!text) throw new Error(`unknown picture ${which}: 200, 500 or dense`);
console.log(`Picture: ${which}`);

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
// The node the drag bench drags: in the middle of the flow, or a hidden neuron.
const n = layout.nodes.find((x) => x.name === { "200": "n100", "500": "n250", dense: "l1n7" }[which])!;
time("layout with drag override", () => layoutDocumentPicture(doc, 0, new Map([[n.id, { x: n.shape.center.x + 10, y: n.shape.center.y }]])));
time("snap", () => snapNode(layout, n, { x: n.shape.center.x + 10, y: n.shape.center.y }, 3));
// pictureEdges is kept per layout, so time it as a drag frame does: on a layout it hasn't seen.
time("drag frame: layout + edges", () => pictureEdges(layoutDocumentPicture(doc, 0, new Map([[n.id, { x: n.shape.center.x + 10, y: n.shape.center.y }]]))!));
time("plan move (drop)", () => planMove(text, 0, n.id, { x: n.shape.center.x + 40, y: n.shape.center.y - 20 }), 5);

// Auto-layout (D80): ELK plus writing every node's relation, on the same picture.
for (const direction of ["down", "right"] as const) {
  const t = performance.now();
  const r = await planAutoLayout(text, 0, { direction });
  console.log(`${`auto-layout (${direction})`.padEnd(28)} ${(performance.now() - t).toFixed(0)} ms${r.ok ? `, ${r.written.length} written` : `: ${r.reason}`}`);
}
