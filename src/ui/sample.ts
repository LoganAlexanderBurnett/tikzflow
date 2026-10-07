// The diagram the editor starts with.
export const SAMPLE = String.raw`\documentclass[tikz,border=4pt]{standalone}
\usetikzlibrary{positioning, shapes.geometric, arrows.meta}

\tikzset{
  base/.style     = {draw, thick, minimum width=28mm, minimum height=9mm, align=center},
  terminal/.style = {base, rounded corners=4.5mm, fill=teal!15},
  process/.style  = {base, fill=blue!8},
  decision/.style = {base, diamond, aspect=2.2, inner sep=1pt, fill=orange!15},
  io/.style       = {base, trapezium, trapezium left angle=70,
                     trapezium right angle=110, fill=gray!12},
  >={Stealth[length=2.5mm]},
}

\begin{document}
\begin{tikzpicture}[node distance=8mm and 16mm]
  % Drag a node: guides show alignments, and the code gets
  % positioning keys rather than coordinates.
  \node[terminal]                (start) {Start};
  \node[io, below=of start]      (read)  {Read $n$};
  \node[decision, below=of read] (small) {$n \le 1$?};
  \node[process, right=of small] (base)  {Answer $1$};
  \node[process, below=of small] (rec)   {Return\\ $n \cdot f(n-1)$};
  \node[terminal, below=of rec]  (stop)  {Stop};

  \draw[->] (start) -- (read);
  \draw[->] (read)  -- (small);
  \draw[->] (small) -- node[above] {yes} (base);
  \draw[->] (small) -- node[right] {no}  (rec);
  \draw[->] (rec)   -- (stop);
  \draw[->] (base)  |- (stop);
\end{tikzpicture}
\end{document}
`;
