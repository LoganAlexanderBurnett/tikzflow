// The sample flowchart every engine compiles. It uses each library from the
// spec, so a compile only succeeds if they all load. The probe also reports
// the pgf version and each library's loaded flag, both in the log (\typeout)
// and as visible text in the output.

export const LIBRARIES = [
  "positioning",
  "shapes.geometric",
  "arrows.meta",
  "fit",
  "backgrounds",
  "calc",
  "matrix",
] as const;

const flag = (lib: string) =>
  String.raw`${lib}=\ifcsname tikz@library@${lib}@loaded\endcsname yes\else NO\fi`;

export const PROBE = String.raw`\makeatletter
\edef\tikzflowprobe{pgf=\pgfversion; ${LIBRARIES.map(flag).join("; ")}}
\makeatother
\typeout{TIKZFLOW-PROBE: \tikzflowprobe}
`;

export const PICTURE = String.raw`\begin{tikzpicture}[node distance=8mm and 12mm, >={Stealth[length=2mm]}]
  \node[draw, rounded corners] (start) {Start};
  \node[draw, diamond, aspect=2, below=of start] (dec) {$x \le \sqrt{n}$?};
  \node[draw, below left=of dec] (yes) {$\begin{aligned} a &= 1 \\ b &= 2 \end{aligned}$};
  \node[draw, below right=of dec] (no) {No};
  \matrix[matrix of nodes, nodes={draw}, column sep=2mm, below=of no] (m) {A & B \\};
  \draw[->] (start) -- (dec);
  \draw[->] (dec) -| node[pos=0.25, above] {yes} (yes);
  \draw[->] (dec) -| node[pos=0.25, above] {no} (no);
  \draw[->] (no) -- (m);
  \coordinate (mid) at ($(yes)!0.5!(no)$);
  \fill[red] (mid) circle (1pt);
  \begin{scope}[on background layer]
    \node[fill=yellow!25, rounded corners, fit=(yes) (no)] {};
  \end{scope}
  \node[below=4mm of m.south -| dec, font=\tiny, text width=7cm, align=left] {\hyphenpenalty=10000 \tikzflowprobe\par};
\end{tikzpicture}
`;

/** A full standalone document, for engines that run a whole LaTeX file. */
export function standaloneDocument(classOptions = "tikz,border=2pt"): string {
  return String.raw`\documentclass[${classOptions}]{standalone}
\usepackage{amsmath}
\usetikzlibrary{${LIBRARIES.join(",")}}
\begin{document}
${PROBE}${PICTURE}\end{document}
`;
}

export interface Probe {
  pgf: string;
  libraries: Record<string, boolean>;
}

/** Reads the probe line from a TeX log. */
export function readProbe(log: string): Probe | null {
  const m = /TIKZFLOW-PROBE: ([^\n]*(?:\n(?!\S*:)[^\n]*)*)/.exec(log);
  if (!m) return null;
  const text = m[1]!.replace(/\s*\n\s*/g, "");
  const pgf = /pgf=([^;]+)/.exec(text)?.[1]?.trim() ?? "?";
  const libraries: Record<string, boolean> = {};
  for (const lib of LIBRARIES) libraries[lib] = new RegExp(`${lib.replace(".", "\\.")}=yes`).test(text);
  return { pgf, libraries };
}
