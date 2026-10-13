---
title: Templates, pasting and importing
description: Starting a TikZFlow diagram from a template, from existing TikZ code, or from a Mermaid or Graphviz DOT diagram.
order: 7
---
# Templates, pasting and importing

Everything below opens in a new tab, so the diagram you were working on stays in its own. The one exception: when the tab on screen is empty, it is used.

## Templates

**New** in the toolbar offers a blank diagram and thirteen templates: Basic process, Decision flowchart, Algorithm with a loop, Swimlane process, Left-to-right pipeline, Feedback block diagram, PRISMA 2020, State machine, Hierarchy, three neural networks (a fully connected network, an LSTM cell and an encoder–decoder), and a Venn diagram under Other diagrams. The home page shows the same gallery.

Each template is plain, hand-written TikZ: named styles in `\tikzset`, positions written as relations, and nothing the editor can't edit. It compiles with pdfLaTeX as it is.

## Your own TikZ

Paste or open code in any of these forms:

- a bare `tikzpicture`;
- a whole `.tex` file. The editor works on its `tikzpicture` and keeps everything else as it is. With several pictures, **Picture** in the toolbar picks the one to edit;
- `\tikzset` styles, `\usetikzlibrary` lines and simple `\newcommand` macros are read from the file's preamble.

**Open…** reads a file (`.tex`, `.tikz`, `.pgf`, `.txt`); you can also drop a file anywhere on the page. On the start screen, **Paste TikZ** reads the clipboard.

After it is read, the summary says what the editor understood, for example "12 nodes and 14 edges editable; 1 block kept as-is". Anything it doesn't understand is kept exactly as written and drawn by TeX; see [When something can't be edited](troubleshooting.md).

## Mermaid and Graphviz DOT

**Import** turns a Mermaid flowchart or a Graphviz DOT graph into TikZ, in this browser. Paste the diagram or choose a file (`.mmd`, `.mermaid`, `.dot`, `.gv`); the format is recognized from its first line.

- Shapes, labels, edge kinds, arrow tips, subgraphs and clusters, styles, classes and colors are carried over. Subgraphs become boxes drawn with `fit`.
- The result is laid out top to bottom or left to right (choose with **Direction**), written as `below=of` and `right=of`, and every node can be dragged.
- Anything that couldn't be carried over is listed under "Left out or approximated", never dropped silently.

Opening or dropping a Mermaid or DOT file imports it the same way, and so does pasting one on the start screen.
