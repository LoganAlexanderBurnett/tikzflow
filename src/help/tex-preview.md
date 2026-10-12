---
title: The TeX preview
description: How TikZFlow's TeX preview compiles your picture in the browser, and how to read its errors, notes and markers.
order: 8
---
# The TeX preview

TikZFlow draws your picture twice:

- **The quick preview** is the editor's own drawing. It is instant, so it is what you see while you drag.
- **The TeX preview** is the picture as TeX draws it. A real TeX engine (TeX itself, with a current LaTeX, PGF/TikZ 3.1.12 and common packages) runs in your browser and compiles the picture a moment after you stop typing or dragging. Its picture then replaces the quick one.

Between the two, only what changed is drawn by the quick preview; the rest stays as TeX drew it, so the picture doesn't flicker as you work.

**TeX preview** in the toolbar switches between them. With it off, you see only the quick preview.

The engine is about 11 MB. It downloads on your first visit to the editor and is kept for next time, offline included. It stops while the browser tab is hidden for a while, to free memory, and starts again when you come back.

## Status and errors

Next to the summary, the preview says what it is doing: "Loading TeX…", "Compiling…", "TeX preview", "TeX preview: notes", or "TeX: 1 error". Click it for the details.

When TeX finds errors, a banner over the canvas says so. TeX carries on past errors, so its picture may be badly wrong (an undefined node is put at the origin and lines run to it). **Show the first error** takes you to its line in your code; **Show the quick preview** switches to the editor's own drawing.

## Notes

Notes are things worth knowing that aren't errors:

- a package the preview doesn't have, which it compiles without (your code still loads it);
- font packages: the preview always uses Computer Modern, so text widths may differ from your document;
- a document class the preview doesn't have, replaced by article's page;
- nodes TeX places elsewhere than the editor (below).

## Nodes TeX places elsewhere

After each compile, TeX reports where it put every named node, and the editor compares that with its own drawing. A node more than a point away, or a point bigger or smaller, gets a small amber marker; select it to see TeX's box, dashed. The notes list these nodes.

Such a node's outline on the canvas, and positions written when you drag it or attach other nodes to it, may be off by as much. A point or two usually comes from estimated text widths. If it is more, please [report it](https://github.com/LoganAlexanderBurnett/tikzflow/issues/new?template=problem.yml) with the code: it means the editor's geometry for that shape is wrong.

## Your paper's page

**Page** in the toolbar holds your paper's preamble and a width guide:

- Paste your paper's preamble (from `\documentclass` to `\begin{document}`). Its macros are defined for the TeX preview, and the editor reads the page widths from it: article, report, book, Beamer, elsarticle, IEEEtran, revtex4-2, acmart and llncs, with their options.
- Or type the widths yourself, and save them as a preset.
- **Show the width guide** draws the column (or text) width on the canvas, so you can see whether the figure fits. `\textwidth` and `\columnwidth` in your code take the same values.

The preamble and presets are kept in this browser, and aren't part of share links.
