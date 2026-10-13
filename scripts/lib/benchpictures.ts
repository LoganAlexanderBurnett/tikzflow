// The pictures the performance benches use (D102): the 200-node, 250-edge picture of the drag
// target (also npm run layout:bench's), a 500-node one, and a dense network written out in full,
// the kind Milestone 7 will edit as layers. The last two are measured, not held to the target.

/** `nodes` process nodes in a staircase (columns of five placed by relations), and `edges` edges between them with labels; a third of the edges are `|-`. */
export function flowPicture(nodes: number, edges: number): string {
  // The library line makes it a picture TeX compiles too (the drag bench runs the TeX preview).
  const lines = ["\\usetikzlibrary{positioning}", "\\begin{tikzpicture}[node distance=8mm, process/.style={draw, minimum width=2cm}]"];
  for (let i = 0; i < nodes; i++) {
    const pos = i === 0 ? "" : `, ${i % 5 === 0 ? "right" : "below"}=of n${i - 1}`;
    lines.push(`  \\node[process${pos}] (n${i}) {Step ${i}: $x_{${i}} = f(x_{${i - 1}})$};`);
  }
  for (let i = 0; i < edges; i++) {
    const a = i % nodes;
    const b = (i * 7 + 3) % nodes;
    lines.push(`  \\draw[->] (n${a}) ${i % 3 === 0 ? "|-" : "--"} node[pos=0.5, above] {e${i}} (n${b});`);
  }
  lines.push("\\end{tikzpicture}", "");
  return lines.join("\n");
}

/** The drag target's picture (D102 item 1). */
export const BENCH_200 = flowPicture(200, 250);
/** Measured only (D102 item 1). */
export const BENCH_500 = flowPicture(500, 600);

/**
 * A fully connected network with the given layer sizes, written out as the neural-network template
 * writes it (D100): circles `on grid`, each layer centered on the first, every weight its own \draw.
 * [4, 16, 16, 4] gives 40 nodes and 384 edges.
 */
export function densePicture(layers: readonly number[]): string {
  const step = 8; // mm between neurons
  const lines = ["\\usetikzlibrary{positioning}", "\\begin{tikzpicture}[neuron/.style={circle, draw, minimum size=6mm}, node distance=8mm and 24mm, on grid]"];
  layers.forEach((size, l) => {
    for (let k = 0; k < size; k++) {
      let pos = "";
      if (k > 0) pos = `, below=of l${l}n${k - 1}`;
      else if (l > 0) {
        const up = ((size - layers[l - 1]!) / 2) * step;
        pos = up > 0 ? `, above right=${up}mm and 24mm of l${l - 1}n0` : up < 0 ? `, below right=${-up}mm and 24mm of l${l - 1}n0` : `, right=of l${l - 1}n0`;
      }
      lines.push(`  \\node[neuron${pos}] (l${l}n${k}) {$a^{${l}}_{${k + 1}}$};`);
    }
  });
  for (let l = 1; l < layers.length; l++)
    for (let a = 0; a < layers[l - 1]!; a++)
      for (let b = 0; b < layers[l]!; b++) lines.push(`  \\draw[->] (l${l - 1}n${a}) -- (l${l}n${b});`);
  lines.push("\\end{tikzpicture}", "");
  return lines.join("\n");
}

export const DENSE_4_16_16_4 = densePicture([4, 16, 16, 4]);
