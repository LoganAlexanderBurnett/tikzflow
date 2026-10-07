# Progress

## Current status
**Milestone 0 (technical spike): complete, awaiting review (2026-10-07).** The engine recommendation (DECISIONS.md D13) and the license direction need the owner's decision before Milestone 1 starts.

## Milestones
| Milestone | Status |
|---|---|
| M0: Technical spike | Done, awaiting review |
| M1: Core loop | Not started |
| M2: Creating from scratch and editing edges | Not started |
| M3: Accurate preview and export | Not started |
| M4: Layout and import | Not started |
| M5: Polish and launch prep | Not started |

## M0 Track A: Lezer grammar (2026-10-07)
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
- Byte coverage still holds on 500 random mutations of each sample, including CRLF, non-ASCII characters, emoji, stray delimiters and keywords.
- On a generated 200-node, 250-edge picture (28 KB), a full parse takes about 2.6 ms and an incremental reparse about 0.16 ms.

## M0 Track B: WASM TeX engines (2026-10-07)
Measured with `npm run bench-engines` in Edge 154 (Chromium) through Playwright. Each trial ran in a fresh browser context with an empty cache, against a localhost server. Download sizes come from the files on disk, with Brotli at quality 11. Every engine compiled the same sample, `spike/engines/sample.ts`, which uses all seven required libraries plus amsmath. Results are in `spike/engines/results/*.json`.

| | TikZJax (`@drgrice1/tikzjax` 1.0.0-beta24) | busytex (WASM build Feb 2024) | SwiftLaTeX (v20022022) |
|---|---|---|---|
| Compiles the sample | Yes | Yes | **No**: hangs after the format loads (timebox hit) |
| pgf version | 3.1.10 (baked into its dump) | 3.1.12 (our CTAN copy) | n/a |
| All 7 libraries load | Yes | Yes | n/a |
| Engine | Knuth TeX via web2js, LaTeX + TikZ pre-dumped | TeX Live 2023 pdfTeX, XeTeX, LuaTeX | pdfTeX 1.40.21 (TeX Live 2020) |
| Output | **SVG**, through its own driver and `dvi2html` | PDF only (no dvisvgm) | PDF |
| Download for the sample | 18 files, 6.4 MB raw, **3.8 MB Brotli** | 7 files, 135 MB raw, **63 MB Brotli** | Engine 1.9 MB, plus an 11.3 MB format and per-file fetches |
| Largest file | 5.7 MB (`core.dump.gz`) | **99.7 MB** data and 29 MB `.wasm`, both over 25 MB | 11.3 MB format |
| Load (fresh context) | 0.79 s | 2.98 s | 8.6 s to build the format once |
| Cold compile | 0.47 s | 0.49 s | n/a |
| Warm compile | 0.41 s | 0.38 s | n/a |
| Fonts | Computer Modern only (BaKoMa web fonts) | Latin Modern works | n/a |
| License | **GPL-3.0+**. Its `dvi2html` converter is GPL-3.0; upstream kisonecat/tikzjax is LPPL-1.3c. | MIT for scripts; binaries carry TeX Live licenses (pdfTeX is GPL) | **AGPL-3.0** |
| Last release | Jan 2025 (repository active June 2026) | Feb 2024 (WASM) | Feb 2022 |

**Curated package set from CTAN** (pgf/TikZ, standalone with xkeyval, amsmath, xcolor, and Latin Modern for pdfLaTeX): 1,162 files, 18.1 MB raw, 8.7 MB Brotli as one pack. Latin Modern's Type 1 fonts account for 8.1 MB of that, so subsetting them would shrink it a lot. pgf/TikZ alone is 3.6 MB raw, 0.47 MB Brotli.

**Fidelity check:** busytex's PDF and TikZJax's SVG match except in one place. TikZJax doesn't draw the borders of `\matrix` cells set with `nodes={draw}`. It's a real defect, cause not yet found; it's probably in TikZJax's SVG driver or `dvi2html`.

**SwiftLaTeX, what was tried within the timebox:**
- Got its worker running against a dev-server stand-in for its TeX Live file server (`vite.config.ts`). The server must send a `fileid` header; static hosting can't easily do that.
- Added 11 more CTAN packages to build a LaTeX format from scratch, plus an English-only `language.dat`.
- The format builds (11.3 MB), but every compile hangs after loading it, even a minimal `article`. The likely cause is its 2020 pdfTeX with a 2026 LaTeX kernel, or that it expects formats from SwiftLaTeX's own server tooling.

Stopped there, as agreed.

**SVG output:**
- TikZJax produces SVG directly, in TeX point coordinates. That suits overlaying on the native canvas.
- busytex has no dvisvgm. Two ways to get SVG from it, neither tested:
  - run pdfTeX in DVI mode with pgf's dvisvgm driver, then convert DVI to SVG in JavaScript;
  - render the PDF with pdf.js, which means bundling a PDF renderer and getting canvas, not SVG.
- Writing our own DVI-to-SVG converter (roughly a few thousand lines) would remove the GPL-3.0 `dvi2html` dependency.

## Known issues and limitations
**Grammar spike**
- **Opaque `\foreach` and brace scopes.** `\foreach` bodies and `{ ... }` scope groups inside a picture are opaque. `\begin{scope}...\end{scope}` works, because those are just markers.
- **Picture options aren't separate.** `\begin{tikzpicture}[...]` options come out as a leading Opaque item.
- **Spaced environment names.** `\begin {tikzpicture}` (with a space) isn't recognised as a picture.
- **`;` inside option values.** A `;` inside an option value, such as `pic code={...;}`, gives an error node, though its bytes are still covered.
- **Unclosed `[` or `{`.** Text runs to the next point where they can close. This matches TeX and loses no bytes.
- **Positions are UTF-16 code units.** File load and save must keep the encoding as-is, including any BOM.
- **Old `\tikzstyle` syntax** is treated as document text.

**Engines and hosting**
- **TikZJax's matrix-cell borders don't render.** See the fidelity check above.
- **TikZJax refetches files on every compile.** It clears its virtual file system after each compile, so production needs good HTTP caching or a patched loader.
- **`.gz` assets get decompressed early.** Static servers may send `.gz` files with `Content-Encoding: gzip`, so the browser inflates them before the engine does. Vite's dev server did this. Cloudflare Pages behaviour needs checking in Milestone 3, or the assets should be renamed or recompressed with Brotli.
- **Cross-origin isolation needs headers on workers.** With COOP/COEP set, every worker script must also send COEP. In production that means a `_headers` file.
- **Firefox not yet tested.** It needs Playwright's Firefox build, a separate download of about 100 MB.
