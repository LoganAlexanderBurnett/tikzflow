import { breakdown, categorize, checkCoverage, leaves, parser } from "../parser/analyze.ts";
import sample from "../../corpus/self-document.tex?raw";

const input = document.querySelector<HTMLTextAreaElement>("#input")!;
const output = document.querySelector<HTMLPreElement>("#output")!;
const stats = document.querySelector<HTMLDivElement>("#stats")!;

function render() {
  const text = input.value;
  const t0 = performance.now();
  const tree = parser.parse(text);
  const ms = performance.now() - t0;
  const cov = checkCoverage(tree, text);
  const { bytes, errorNodes } = breakdown(tree, text);
  const picture = bytes.modelled + bytes.opaque + bytes.error || 1;
  const pct = (n: number) => `${((100 * n) / picture).toFixed(1)}%`;
  stats.textContent =
    `Coverage ${cov.ok ? "OK" : "FAILED"} · parsed in ${ms.toFixed(2)} ms · TikZ bytes: ` +
    `modelled ${pct(bytes.modelled)}, opaque ${pct(bytes.opaque)}, error ${pct(bytes.error)} · ` +
    `error nodes ${errorNodes}`;

  output.replaceChildren();
  for (const leaf of leaves(tree)) {
    const span = document.createElement("span");
    span.className = categorize(leaf, text);
    span.title = leaf.name;
    span.textContent = text.slice(leaf.from, leaf.to);
    output.append(span);
  }
}

input.value = sample;
input.addEventListener("input", render);
render();
