# Corpus sources

The round-trip tests run on every `.tex` file in this folder. The files are byte-exact test inputs: `.gitattributes` marks them `-text`, so git never changes their line endings. Never edit them in place. If an input needs to change, add a new file.

## From TeX Stack Exchange
Each file is one code block from an answer, saved exactly as the answer shows it. Nothing was reformatted, so leading indentation and trailing spaces are kept. The code was fetched through the Stack Exchange API on 2026-10-07. The license is the one the API reports for that post. The "Block" column says which code block in the answer the file holds.

Every file here is licensed by its author under the CC BY-SA license shown. Each file in this table is a copy of the original, unchanged.

| File | Answer | Author | License | Block |
|---|---|---|---|---|
| `se-102785-foreach-scope.tex` | [TikZ flowchart child](https://tex.stackexchange.com/a/102785) | [Gonzalo Medina](https://tex.stackexchange.com/users/3954/gonzalo-medina) | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | first |
| `se-142618-ext-libraries.tex` | [TikZ: Complicated Flow Chart](https://tex.stackexchange.com/a/142618) | [Qrrbrbirlbel](https://tex.stackexchange.com/users/16595/qrrbrbirlbel) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | first |
| `se-178617-matrix-arrows.tex` | [Flowchart drawing (Complicated Arrows)](https://tex.stackexchange.com/a/178617) | [Peter Grill](https://tex.stackexchange.com/users/4301/peter-grill) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | third |
| `se-194593-styled-colors.tex` | [defining Style of flowchart tikz](https://tex.stackexchange.com/a/194593) | [Gonzalo Medina](https://tex.stackexchange.com/users/3954/gonzalo-medina) | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | first |
| `se-218730-arrow-labels.tex` | [Add text on arrow in flowchart](https://tex.stackexchange.com/a/218730) | [d-cmst](https://tex.stackexchange.com/users/24483/d-cmst) | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | second |
| `se-263754-chains.tex` | [Flowchart + Tikz](https://tex.stackexchange.com/a/263754) | [sergej](https://tex.stackexchange.com/users/18520/sergej) | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | first |
| `se-30929-mixed-absolute.tex` | [How to get started with drawing this flow chart in TikZ?](https://tex.stackexchange.com/a/30929) | [Tom Bombadil](https://tex.stackexchange.com/users/7279/tom-bombadil) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | eighth |
| `se-338616-positioning-edges.tex` | [unable to create a flow chart in Latex](https://tex.stackexchange.com/a/338616) | [Zarko](https://tex.stackexchange.com/users/18189/zarko) | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | first |
| `se-349800-wide-39-nodes.tex` | [Importing wide flowchart into twocolumn document](https://tex.stackexchange.com/a/349800) | [Ruben](https://tex.stackexchange.com/users/29639/ruben) | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | first |
| `se-350521-perp-coordinates.tex` | [Drawing a database flowchart in Latex](https://tex.stackexchange.com/a/350521) | [gernot](https://tex.stackexchange.com/users/110998/gernot) | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | first |
| `se-382997-chains-indented.tex` | [LaTeX Flowchart: Connect from diamond to far off rectangle](https://tex.stackexchange.com/a/382997) | [Ignasi](https://tex.stackexchange.com/users/1952/ignasi) | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | first |
| `se-421789-complicated-fit.tex` | [Complicated Flow Chart](https://tex.stackexchange.com/a/421789) | user121799 (account since deleted) | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | first |
| `se-503226-custom-shape-matrix.tex` | [How to draw a flow chart?](https://tex.stackexchange.com/a/503226) | user121799 (account since deleted) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | second |
| `se-62804-tikzstyle-resizebox.tex` | [Messy flowchart using tikz](https://tex.stackexchange.com/a/62804) | [Alain Matthes](https://tex.stackexchange.com/users/3144/alain-matthes) | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | first |
| `se-679521-decorations.tex` | [Starting out with a flow chart](https://tex.stackexchange.com/a/679521) | [Sandy G](https://tex.stackexchange.com/users/125871/sandy-g) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | first |
| `se-730217-algorithm.tex` | [Need Help Improving My ABC Algorithm Flowchart in TikZ (After Many Attempts)](https://tex.stackexchange.com/a/730217) | [Tom](https://tex.stackexchange.com/users/267375/tom) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | first |
| `se-78697-tikzset-classic.tex` | [Flowchart using Tikz](https://tex.stackexchange.com/a/78697) | [Gonzalo Medina](https://tex.stackexchange.com/users/3954/gonzalo-medina) | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | first |

### How the answers were chosen
- Questions tagged `flow-charts`, or tagged `tikz-pgf` with "flowchart" or "flow chart" in the title.
- Answers sorted by score.
- From the top-scoring answers, files were picked to cover the idioms seen most often:
  - `\tikzstyle` and `\tikzset` styles
  - the `positioning` library and the old `below of=` syntax
  - `chains`, `\matrix`, `fit` and scopes
  - `edge` paths, `-|`/`|-` and calc coordinates
  - custom shapes and decorations
  - pictures inside `\resizebox`

## Self-written
These were written for this project, or contributed by its owner, and are licensed like the rest of the repository (GPL-3.0-or-later).

| File | What it covers |
|---|---|
| `self-document.tex` | A full `standalone` document using all seven required libraries, `\tikzset` styles, `fit` on the background layer. |
| `self-bare-crlf.tex` | A bare picture with CRLF line endings and tabs, plus `\foreach`. |
| `self-broken.tex` | Three deliberate syntax errors, `\tikzstyle`, a macro and a `\matrix`. |
| `self-bom-crlf-unicode.tex` | A UTF-8 byte-order mark, CRLF, tabs, accented letters, CJK characters and an emoji. |
| `self-latin1.tex` | ISO-8859-1 bytes that aren't valid UTF-8. |
| `self-figure-multi.tex` | Two pictures in `figure` environments, one inside `\resizebox`. Also `\newcommand` macros with and without arguments, `\definecolor`, and both scope forms. |
| `self-tikzstyle-paths.tex` | `\tikzstyle` (with and without braces), `below of=`, `edge`, `to[bend]`, `out`/`in`, `.. controls ..`, `pos=`, `sloped` and `swap`. |
| `self-tikzit.tex` | TikZiT-style output: absolute coordinates, numeric node names and `pgfonlayer`. |
| `self-hybrid-surrogate.tex` | Contributed by the project owner: a real 27-node research figure (a `figure*` snippet with no preamble, CRLF line endings), saved as it was when tested with M1. Its own code errors are kept on purpose as a realistic case:<ul><li>references to undefined nodes (`model`, `prevkinleft`, `pkin`, `outkin`);</li><li>a label given as `\mbox{...}` instead of braces;</li><li>stray text and repeated nodes inside the picture;</li><li>leftover junk after `\end{figure*}`.</li></ul> |
