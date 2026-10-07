// Runtime-package and user-preamble checks for TikZJax (M0 follow-up).
// Packages TikZJax doesn't bundle are served from vendor/texmf by the dev
// server as tex_files/<name>.gz (see vite.config.ts).
// Usage: /spike/engines/packages.html — results also on window.__packages.

import type { Job } from "./engine.ts";
import { TikzJax } from "./tikzjax.ts";

interface Case {
  name: string;
  expect: string;
  job: Job;
}

const pic = (label: string) => String.raw`\begin{tikzpicture}\node[draw] {${label}};\end{tikzpicture}`;
const brandPreamble = String.raw`\newcommand{\R}{\mathbb{R}}
\definecolor{brand}{HTML}{1F77B4}
\tikzset{box/.style={draw=brand, fill=brand!15, thick}}`;

const CASES: Case[] = [
  { name: "amssymb (bundled in tex_files)", expect: "works", job: { body: pic(String.raw`$\mathbb{R}$`), libraries: [], packages: { amssymb: "" } } },
  { name: "bm (from CTAN at compile time)", expect: "works", job: { body: pic(String.raw`$\bm{x} + x$`), libraries: [], packages: { bm: "" } } },
  { name: "mathtools 2026 (+calc, mhsetup)", expect: "works", job: { body: pic(String.raw`$a \coloneqq b$`), libraries: [], packages: { mathtools: "" } } },
  { name: "siunitx 2026 (+translations, pdftexcmds, ...)", expect: "fails: needs newer expl3", job: { body: pic(String.raw`\qty{3.5}{\meter\per\second}`), libraries: [], packages: { siunitx: "" } } },
  {
    name: "user preamble as fields",
    expect: "works",
    job: { body: String.raw`\begin{tikzpicture}\node[box] {$x \in \R$};\end{tikzpicture}`, libraries: [], packages: { amssymb: "" }, preamble: brandPreamble },
  },
  {
    name: "user preamble as raw lines",
    expect: "works",
    job: { body: String.raw`\begin{tikzpicture}\node[box] {$x \in \R$};\end{tikzpicture}`, libraries: [], preamble: `\\usepackage{amssymb}\n${brandPreamble}` },
  },
  { name: "nonexistent package", expect: "silently treated as empty", job: { body: pic("x"), libraries: [], packages: { doesnotexist: "" } } },
  { name: "undefined macro", expect: "fatal: no output", job: { body: pic(String.raw`A \undefinedmacro{} B`), libraries: [] } },
  { name: "undefined macro with \\scrollmode", expect: "output + logged error", job: { body: pic(String.raw`A \undefinedmacro{} B`), libraries: [], preamble: String.raw`\scrollmode` } },
  { name: "lmodern", expect: "fails: no web font for Latin Modern", job: { body: pic("Latin Modern?"), libraries: [], packages: { lmodern: "" } } },
];

export interface PackageResult {
  name: string;
  expect: string;
  ok: boolean;
  ms: number;
  text: string;
  colours: string[];
  errors: string[];
}

declare global {
  interface Window {
    __packages?: PackageResult[];
  }
}

const decode = (s: string) =>
  [...s].map((ch) => { const c = ch.codePointAt(0)!; return c >= 0xf000 && c < 0xf100 ? String.fromCharCode(c - 0xf000) : ch; }).join("");

const tbody = document.querySelector("tbody")!;
const engine = new TikzJax();
await engine.load();
const results: PackageResult[] = [];
for (const c of CASES) {
  const t0 = performance.now();
  const r = await engine.compile(c.job);
  const svg = r.output.kind === "svg" ? r.output.svg : "";
  const doc = new DOMParser().parseFromString(svg || "<svg/>", "image/svg+xml");
  const result: PackageResult = {
    name: c.name,
    expect: c.expect,
    ok: r.ok,
    ms: Math.round(performance.now() - t0),
    text: decode(doc.documentElement.textContent ?? "").replace(/\s+/g, " ").trim(),
    colours: [...new Set([...svg.matchAll(/(?:stroke|fill)="(#[0-9a-f]+)"/gi)].map((m) => m[1]!))],
    errors: r.log.split("\n").filter((l) => /^!|^l\.\d|Could not find/.test(l)).slice(0, 4),
  };
  results.push(result);
  const row = document.createElement("tr");
  for (const v of [result.name, result.expect, result.ok ? "ok" : "FAILED", `${result.ms} ms`, result.text, result.colours.join(" "), result.errors.join("\n")]) {
    const td = document.createElement("td");
    td.textContent = v;
    row.append(td);
  }
  tbody.append(row);
}
window.__packages = results;
