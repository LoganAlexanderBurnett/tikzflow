# Progress

## Current status
**Milestone 0 (technical spike):** the plan was approved on 2026-10-07.
- **Track A (Lezer grammar):** done. Results are below.
- **Track B (WASM TeX engines: busytex, SwiftLaTeX, TikZJax):** started. The next step is to list each download's source and size before fetching anything.

## Milestones
| Milestone | Status |
|---|---|
| M0: Technical spike | In progress (Track A done, Track B started) |
| M1: Core loop | Not started |
| M2: Creating from scratch and editing edges | Not started |
| M3: Accurate preview and export | Not started |
| M4: Layout and import | Not started |
| M5: Polish and launch prep | Not started |

## M0 Track A results (2026-10-07)
- The grammar is in `spike/grammar/tikz.grammar`. It generates with no conflicts.
- Three self-written samples are in `spike/grammar/fixtures/`: a full document, a bare picture with CRLF line endings and tabs, and a messy file with three deliberate errors. For all three, the tree's leaves cover every byte exactly once and joining them reproduces the input.
- Share of TikZ bytes that is modelled structure, opaque, and error:

  | Sample | Modelled | Opaque | Error |
  |---|---|---|---|
  | `document.tex` | 94.2% | 5.8% | 0% |
  | `bare-crlf.tex` | 78.1% | 21.9% (`\foreach`) | 0% |
  | `broken.tex` | 80.2% | 19.8% (`\matrix`) | 0% |

  `broken.tex` recovers using four zero-length "missing token" markers, so no bytes count as error.
- Incremental reparse matches a full parse after 300 random single edits and after a chain of 200 edits, for each sample.
- Byte coverage still holds on 500 random mutations of each sample. The mutations include CRLF, non-ASCII characters, emoji, stray delimiters and keywords.
- On a generated 200-node, 250-edge picture (28 KB), a full parse takes about 2.6 ms and an incremental reparse after one keystroke about 0.16 ms.

## Known issues and limitations (grammar spike)
- **Opaque `\foreach` and brace scopes.** `\foreach` bodies and `{ ... }` scope groups inside a picture are opaque, so statements inside them aren't modelled. `\begin{scope}...\end{scope}` works, because those are just markers.
- **Picture options aren't separate.** `\begin{tikzpicture}[...]` options come out as a leading Opaque item, and the semantic layer has to recognise them.
- **Spaced environment names.** `\begin {tikzpicture}` (with a space) isn't recognised as a picture.
- **`;` inside option values.** A `;` inside an option value, such as `pic code={...;}`, produces an error node, though its bytes are still covered. This keeps an unclosed `[` from swallowing the rest of the file while the user is typing.
- **Unclosed `[` or `{`.** Text runs to the next point where they can close. This matches what TeX does and loses no bytes, but the statements involved are no longer modelled.
- **Positions are UTF-16 code units.** File load and save must keep the encoding as-is, including any BOM.
- **Old `\tikzstyle` syntax** is treated as document text. Milestone 1 could support it.
