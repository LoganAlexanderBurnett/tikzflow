// A minimal page that compiles one picture with our engine (D67), three times,
// for debugging the worker. Usage: /spike/engines/ours.html[?engine=ci-<run id>]
import { EngineClient } from "../../src/engine/client.ts";
import { engineBase } from "../../src/engine/release.ts";

const out = document.getElementById("out")!;
const log = (s: string) => {
  out.textContent += `\n${s}`;
  console.log(s);
};
const client = new EngineClient(engineBase(new URLSearchParams(location.search).get("engine")));
const index = await client.ready();
log(`ready: ${index.version}, ${index.texFiles.length} files`);
const tex = String.raw`\scrollmode
\begin{document}
\begin{tikzpicture}\node[draw] {Hello $x^2$};\end{tikzpicture}
\end{document}
`;
for (let i = 0; i < 3; i++) {
  const t = performance.now();
  const r = await client.compile(tex);
  log(`compile ${i}: ${Math.round(performance.now() - t)} ms (TeX ${Math.round(r?.timing.texMs ?? 0)} ms, SVG ${Math.round(r?.timing.svgMs ?? 0)} ms), ok ${r?.ok}, errors ${JSON.stringify(r?.errors)}, svg ${r?.svg?.length} chars`);
}
(window as unknown as { __ours: boolean }).__ours = true;
