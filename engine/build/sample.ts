// The Milestone 0 sample, compiled by the engine built in CI (D15).
//
//   node engine/build/sample.ts write <dir>
//     writes <dir>/sample.tex: what follows the preamble saved in core.dump.
//   node engine/build/sample.ts check <sample.log> <format log> <pgf version> <versions.json>
//     checks the probe (pgf version, every library loaded) and writes the
//     versions found for the manifest. Exits non-zero if anything is off.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LIBRARIES, PICTURE, PROBE, readProbe } from "../../spike/engines/sample.ts";

const [command, ...args] = process.argv.slice(2);

if (command === "write") {
  const dir = args[0] ?? ".";
  const tex = [
    "\\usepackage{amsmath}\n",
    `\\usetikzlibrary{${LIBRARIES.join(",")}}\n`,
    "\\begin{document}\n",
    PROBE,
    PICTURE,
    "\\end{document}\n",
  ].join("");
  writeFileSync(join(dir, "sample.tex"), tex);
  console.log(`wrote ${join(dir, "sample.tex")}`);
} else if (command === "check") {
  const [samplePath, formatLogPath, expectedPgf, versionsPath] = args;
  if (!samplePath || !formatLogPath || !expectedPgf || !versionsPath) {
    throw new Error("usage: check <sample.log> <format log> <pgf> <versions.json>");
  }
  const log = readFileSync(samplePath, "latin1");
  const formatLog = readFileSync(formatLogPath, "latin1");
  const probe = readProbe(log);
  const versions = {
    latex: /LaTeX2e <([^>]+)>/.exec(formatLog)?.[1] ?? null,
    // INITEX's latex.log doesn't print this line; every run on the format does.
    l3kernel: /L3 programming layer <([^>]+)>/.exec(formatLog + log)?.[1] ?? null,
    engine: /^This is ([^,\n]+(?:, Version [^\s]+)?)/m.exec(formatLog)?.[1] ?? null,
    pgf: probe?.pgf ?? null,
    libraries: probe?.libraries ?? null,
  };
  writeFileSync(versionsPath, JSON.stringify(versions, null, 2) + "\n");
  console.log(JSON.stringify(versions, null, 2));
  const problems: string[] = [];
  if (!probe) problems.push("no TIKZFLOW-PROBE line in the log");
  else {
    if (probe.pgf !== expectedPgf) problems.push(`pgf is ${probe.pgf}, expected ${expectedPgf}`);
    for (const [lib, loaded] of Object.entries(probe.libraries)) if (!loaded) problems.push(`library ${lib} not loaded`);
  }
  if (problems.length) {
    console.error(`CHECK FAILED:\n${problems.join("\n")}`);
    process.exit(1);
  }
  console.log(`CHECK OK: pgf ${probe?.pgf}, ${LIBRARIES.length} libraries loaded`);
} else {
  throw new Error("usage: sample.ts write <dir> | check <sample.log> <format log> <pgf> <versions.json>");
}
