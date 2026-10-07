# Progress

## Current status
**Milestone 1 (core loop): done, awaiting the owner's review (2026-10-07).** It is pushed to `trunk`. The report is in the M1 section below. Decisions needed are under "M1: decisions for the owner".

Milestone 0 is done and was approved on 2026-10-07:
- **License:** GPL-3.0-or-later (D14).
- **Engine:** TikZJax, with our own build in Milestone 3 (D13, D15).
- **Preview fonts:** always Computer Modern (D16).

**Next:** Milestone 2, once the owner approves M1. Read the "Notes for later milestones" below first.

## Milestones
| Milestone | Status |
|---|---|
| M0: Technical spike | Done, approved 2026-10-07 |
| M1: Core loop | Done 2026-10-07, awaiting review |
| M2: Creating from scratch and editing edges | Not started |
| M3: Accurate preview and export | Not started |
| M4: Layout and import | Not started |
| M5: Polish and launch prep | Not started |

## M1: Core loop (2026-10-07)
### How to try it
- Run `npm install`, then `npm run dev`, and open http://localhost:5173.
- The app opens on a sample flowchart. You can:
  - paste your own code into the code pane;
  - use **Open…** or drop a `.tex` file on the window (try the files in `corpus/`);
  - drag nodes;
  - press Ctrl+Z or Ctrl+Y in either pane.
- **Download** saves the code in the file's own encoding.
- **Details** in the summary bar lists:
  - what was kept as-is;
  - locked nodes and why;
  - options the preview ignores.

### What works
**Split view.** CodeMirror with TikZ highlighting on the left, the SVG canvas on the right, with a draggable splitter. The canvas pans (drag the background) and zooms (wheel). **Fit** frames the picture.

**Open and paste.**
- A full document stays whole in the code pane (D27).
- The model reads from the preamble:
  - `\tikzset` and `\tikzstyle` styles, with arguments and defaults;
  - `\usetikzlibrary`;
  - `\definecolor` and `\colorlet`;
  - simple `\newcommand` and `\def` macros, used in labels and in KaTeX.
- The document class's font size is honoured.
- With several pictures, a picker chooses one.
- Files load and save byte-identically:
  - UTF-8 with or without a BOM;
  - UTF-16;
  - any other 8-bit encoding, read as ISO-8859-1 (D29).

**"What I understood" summary.** For example: "20 nodes and 23 edges editable; 1 block kept as-is". Details list the locked nodes with reasons, ignored options, things drawn approximately, and missing shape libraries.

**Native rendering.** `src/tikz/` is a small TikZ interpreter covering:
- **Styles:** pgfkeys-style keys and scoped styles; `every node`, `every path` and `every edge`.
- **Colours:** xcolor expressions.
- **Shapes:** rectangle, rounded corners, circle, ellipse, diamond, trapezium, rounded rectangle, cylinder, tape. Their anchors and borders follow PGF's definitions.
- **Placement:**
  - positioning, new and old syntax, including `on grid`;
  - `|-` and `-|`;
  - calc's `$(a)!t!(b)$` and sums;
  - `fit`, `label=`, local bounding boxes;
  - the chains library (`on chain`, `join`, `\chainin`).
- **Transforms:** `scale`, `x`/`y`, shifts, rotations and `transform shape`.
- **Path operations:** `--`, `|-`, `-|`, `to[bend/out/in]`, `.. controls ..`, `edge`, `cycle`, `rectangle`, `circle`, `arc`.
- **Path decoration:** nodes on paths (`pos`, `midway`, `auto`, `swap`, `sloped`); arrows.meta and old-style arrow tips with shortening; dashes, opacity, shadings and drop shadows; the background layer.
- **Labels** are typeset with Computer Modern metrics and KaTeX (D22): line breaking at `text width`, `align`, `\\`, font commands, accents, `\textbf` and friends, `\ref` shown as `??`.

**Fidelity against pdfTeX** (`npm run fidelity`, D23). Of 271 corpus nodes in the 22 pictures pdfTeX compiles:
- 200 centres are within 1 pt and 247 within 3 pt;
- 218 sizes are within 1 pt.

The check turned up seven TeX behaviours the interpreter had wrong. Probes pin each one down.

**Dragging.**
- Snapping to centre lines and to the node distance, with guides.
- Alt drags without snapping.
- Dependent nodes and edges follow live.
- On drop, the emitter writes the most relational form that reproduces the position, then verifies it by laying out the patched text (D24). Typical results:
  - `\node[process, below=of a]`
  - `right=1.5cm of a`
  - `at (a |- b)`
  - `below=1.3cm of d9, xshift=5mm` for a nudge
  - coordinates kept as numbers in TikZiT-style files
- Only the node's own placement items and `at` clause change. The `positioning` library is added if the document lacks it (D28).
- The status bar says what was written. If the drop lined up with a node defined later in the code, it explains that such a node can't be referenced.

**Selection sync.** Clicking a shape highlights its statement in the code and scrolls to it. Moving the cursor selects the shape, or the path for a cursor in an edge or its label.

**Undo and redo across both panes** through CodeMirror's history. Each drag is one undo step (D25).

**Locked nodes.** Locked nodes show why when clicked and refuse to move (D26). Blocks kept as-is are shaded in the code pane.

### Tests
**Vitest: 317 tests, `npm test`, about 9 s.**
- **Every corpus file** (25 files: 17 TeX.SE answers and 8 self-written):
  - byte-identical load and save;
  - byte coverage;
  - incremental and full parses agree (D17);
  - coverage holds under random mutation.
- **Interpreter geometry:** 61 tests against known TikZ behaviour.
- **Move planner:** 13 tests.
- **Golden minimal-diff tests:** 55 scripted moves across the corpus (D30).

**Playwright: 7 end-to-end tests in Edge, `npm run test:e2e`.** They cover:
- dragging writes positioning code;
- undo and redo from the canvas;
- selection sync both ways;
- typing updates the canvas;
- open a Latin-1 file and download it byte for byte;
- locked nodes don't move.

**Builds.** `npm run typecheck` and `npm run build` pass. The build is 2.0 MB in 62 files; the largest is the 790 kB app bundle (253 kB gzipped).

### Performance
Measured with `npm run layout:bench` on a generated 200-node, 250-edge picture:
- parse and extract: 11 ms;
- layout: 7 ms;
- snapping: about 1 ms;
- planning and verifying a drop: 38 ms.

In Edge, a drag frame at that size takes about 30–40 ms, roughly 25–30 fps. Most of it is style recalculation for 450 HTML labels and re-rendering. The M5 target is smooth dragging at 200 nodes. Likely steps:
- plain labels as SVG text;
- incremental layout of only the moved node's dependents.

### What doesn't work yet, or only approximately
- **Blocks kept as-is aren't drawn:** `\foreach` bodies, `\matrix` cells, `pic`, `\graph`, paths using `let`, `plot` or decorations. Edges that refer to nodes inside them are left out (and listed). The accurate preview (M3) will draw them.
- **Chain nodes are placed but locked.** Moving one would mean taking it off its chain.
- **Labels** don't hyphenate and don't break paragraphs with TeX's total-fit algorithm. Narrow `text width` nodes can end up one line taller or shorter than in TeX. Inline math doesn't break after relations. `\rotatebox` text is drawn unrotated.
- **Shapes drawn as rectangles:** `single arrow`, `rectangle split` (parts become lines), `star`, `regular polygon`, `signal`, `cloud` and custom `\pgfdeclareshape` shapes.
- **Relations only refer to earlier nodes,** as TikZ requires. A drop lined up with a later node is written relative to earlier ones, rounded to 1 mm, with a note in the status bar.
- **Not in M1:** editing edges and labels (M2), and creating nodes (M2).
- **TeX.SE files that pdfTeX itself rejects.** Six corpus pictures fail in the fidelity check: tikz-ext libraries, a custom shape, a pasted bare picture with CJK text, TikZiT styles defined elsewhere, a deliberately broken file, and `self-document.tex`, whose `rounded rectangle` needs `shapes.misc`. The summary now warns about that last case.

### M1: decisions for the owner
1. **Emitter order (D24).** A perpendicular coordinate (`at (a |- b)`) ranks above a relation with an arbitrary written distance when a node lines up with two nodes. A nudged node keeps its previous relation plus `xshift`/`yshift`. Is this ordering what you want?
2. **Locking (D26).** Unknown cosmetic options (`drop shadow`, decorations) don't lock a node; only placement it can't model does. SPEC.md says unknown options become locked blocks; this reads that as "the option is kept as-is", not "the node is frozen". Agree?
3. **Library management pulled forward (D28).** Moves add `positioning` to `\usetikzlibrary` when it's missing, because otherwise the written code wouldn't compile. Full library management stays in M2. OK?
4. **Chains (D23, D26).** I added the chains library, placed but locked, because it is common in TeX.SE flowcharts and stacked everything at the origin without it. Keep it in scope?

## M0 Track A: Lezer grammar (2026-10-07)
- The grammar was in `spike/grammar/tikz.grammar` (moved to `src/parser/` in M1). It generates with no conflicts.
- Three self-written samples were in `spike/grammar/fixtures/` (now `corpus/self-document.tex`, `self-bare-crlf.tex` and `self-broken.tex`): a full document, a bare picture with CRLF line endings and tabs, and a messy file with three deliberate errors. For all three, the tree's leaves cover every byte exactly once and joining them reproduces the input.
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

## M0 follow-up checks (2026-10-07)
The owner chose GPL-3.0 (D14) and approved TikZJax provisionally, pending two timeboxed checks. Both are done.

### Check 1: rendering, TikZJax vs busytex
Ran `npm run compare-engines` on 13 self-written diagrams in `spike/engines/diagrams/`, covering:
- fills and xcolor mixes;
- dash patterns, line caps and joins, double lines;
- opacity;
- 14 arrows.meta tips;
- fit on the background layer;
- clipping;
- rounded and chamfered corners;
- 12 node shapes;
- a full flowchart;
- text and math;
- transforms;
- curves, shadings, and a picture nested in a node.

busytex's PDF is the reference. Each composite PNG (reference | TikZJax | diffs) is saved to `spike/engines/results/compare/` (gitignored), and the summary to `compare.json`. All 13 diagrams compile in both engines.

**Every difference found:**
1. **`\matrix` cell borders missing** (the M0 defect). *Root cause:* `pgfsys-ximera.def` wraps every TeX box in `<g stroke="none">`, so glyphs aren't outlined. Matrix cells are drawn inside such boxes and never reset the stroke, so they inherit `none`. *Workaround:* `fixBoxStroke()` in `spike/engines/tikzjax.ts` brings the matrix diagram from 64% mismatch down to 0.5%.
2. **Pictures nested in node text (`\node{\tikz ...}`) lose every stroke.** *Root cause:* inside a box, the driver emits colour changes as text colour (fill plus `stroke="none"`), including the nested picture's initial colour. *Workaround:* the same post-process restores the strokes, but not their colour, which was never emitted, so they come out black. *Real fix:* patch the driver.
3. **Everything is uniformly 0.375% too large.** *Root cause:* the SVG's coordinates are TeX points (1/72.27 in), but its `width` and `height` are labelled CSS `pt` (1/72 in). *Fix:* scale the SVG by 72/72.27 when placing it. The comparison does this; the overlay must too.
4. **Hairlines: a renderer difference, not an engine one.** TikZJax does emit `ultra thin` (0.1 pt) lines. PDF viewers draw any line at least one device pixel wide, while browsers draw true width, so it's nearly invisible at normal zoom. The preview should enforce a minimum visible stroke width.
5. **Sub-pixel differences, not visible at normal zoom:**
   - two filled rectangles offset by up to 0.33 pt;
   - glyph edges and positions within about 0.3 pt (BaKoMa TrueType in the browser vs Type 1 in pdf.js);
   - pdf.js draws strokes slightly heavier.

**Matched:**
- fills, xcolor mixes and the even-odd rule;
- dash patterns, including dash phase;
- caps, joins and double lines;
- opacity (fill, draw and text);
- every arrows.meta tip tested: Stealth, Latex, `Triangle[open]`, Circle, Bar, Kite with fill, `Square[open]`, reversed, `sep`, bent, round, custom sizes and colours;
- fit on the background layer;
- clipping, including nested clips;
- rounded and chamfered corners;
- all 12 node shapes;
- the flowchart;
- display math, font sizes and weights, text-width wrapping;
- rotate, scale, slant and `transform shape`;
- `to[bend]`, `out`/`in`, `.. controls ..`, arcs and ellipses;
- linear and ball shadings.

After the unit fix and stroke fix, the residual mismatch is 0–2.6% of ink pixels. Text-heavy and dash-heavy diagrams reach 6%, all of it rasterisation noise.

### Check 2: runtime packages and user preamble
Test page: `/spike/engines/packages.html`.

**How loading works:** TikZJax looks for files missing from its format at `tex_files/<name>.gz`, next to its worker. The dev server serves CTAN files there, gzipped on the fly. TikZJax's uncompressed fallback (`fetch(name)`) is broken: it stores the response as a string and crashes. So production must ship extra packages as `tex_files/<name>.gz`.

| Case | Result |
|---|---|
| amssymb (bundled, not in the format) | ✅ |
| bm, from CTAN at compile time | ✅ |
| mathtools 2026, with calc and mhsetup | ✅ |
| siunitx 2026, with translations, pdftexcmds, infwarerr, ltxcmds | ❌ `! Undefined control sequence` inside siunitx: it needs a newer expl3 than the format's |
| User preamble (`\usepackage`, `\newcommand`, `\definecolor`, `\tikzset`), as structured fields | ✅ |
| The same preamble as raw lines | ✅ |
| Nonexistent package | ⚠️ "succeeds": TikZJax hands TeX an empty file, so the error surfaces later or never |
| Undefined macro | ❌ fatal: error-stop mode makes TeX stop with no output |
| Undefined macro with `\scrollmode` in the preamble | ✅ output, and the error is in the log with its line number |
| `lmodern` | ❌ "Could not find font rm-lmr10" |

In both preamble forms, the custom colour `#1F77B4` comes through as stroke and `brand!15` as fill.

**What the format contains:** e-TeX with a format dumped 2025-01-02, holding LaTeX 2023-11-01, expl3 2024-01-22, pgf 3.1.10 and xcolor 3.01.

**Log channel:** with `showConsole`, TikZJax posts each line of TeX's terminal output to the page as a string message. The adapter now collects them into `CompileResult.log`. Streaming the log has no measurable cost.

**What full user-preamble support would take:**
1. **Build our own format** from a pinned TeX Live snapshot, and host packages from the same snapshot. That removes version skew of the siunitx kind and moves us to pgf 3.1.12. The driver fixes above need this rebuild anyway.
2. **Patch the file loader** so a missing file is reported as missing, not handed over as an empty file.
3. **Inject `\scrollmode`** and parse errors from the log. Map their line numbers back through TikZJax's generated `input.tex` (preamble lines plus `\begin{document}`).
4. **Fonts.** Only Computer Modern and the AMS fonts have web fonts. Each extra font family needs TFMs plus web fonts converted per encoding. Proposal: the preview always uses Computer Modern; `.tex` export keeps the user's font packages.
5. **Curate the hosted packages.** With no backend, nothing can be fetched from CTAN at runtime, so we host a curated set of common packages. A few hundred gzipped files is well within the Pages file limit.

**Driver source:** `pgfsys-ximera.def` isn't in the TikZJax, web2js or ximeraLatex repositories (ximeraLatex is LPPL-1.3c). Fallback: start from pgf's own `pgfsys-dvisvgm.def` (LPPL, ships with pgf 3.1.12) and adapt `dvi2html` to it.

### Firefox spot check: not run
Playwright's Firefox 155, and an older Firefox 137 build, both fail to start on this machine. Windows reports "side-by-side configuration is incorrect: dependent assembly mozglue could not be found", although `mozglue.dll` is present. Edge runs fine. The cause looks environmental: the sandbox the agent's commands run in, or a system policy. To try it from your own terminal: `npx playwright install firefox`, then `npm run bench-engines -- tikzjax busytex --browser=firefox`. Non-Edge results get a browser suffix in their file names, so they don't overwrite the Edge ones.

### Timings after the follow-up (Edge, fresh context)
- **TikZJax:** load 0.81 s, cold compile 0.47 s, warm 0.41 s, with log streaming on.
- **busytex:** unchanged.

## Notes for later milestones
### Milestone 3: owner requirements on top of SPEC.md (2026-10-07)
These come from the M0 review. The full reasoning is in DECISIONS.md D15 and D16.
1. **First task: confirm the CI toolchain is feasible.** Build TikZJax's `tex.wasm` (web2js) and dump our own format from a pinned TeX Live snapshot in **GitHub Actions on Linux**, not locally on Windows. Do this before any other Milestone 3 work.
2. **Our own engine build** (D15): current LaTeX kernel, expl3 and pgf 3.1.12, with matching extra packages hosted as `tex_files/<name>.gz`.
3. **Replace `pgfsys-ximera.def`** (unknown origin and license) with a driver based on pgf's `pgfsys-dvisvgm.def` (LPPL). Fix box handling so that `\matrix` cell borders and pictures nested in node text keep their strokes and colours. Adapt `dvi2html` as needed.
4. **Use `\scrollmode` by default**, stream the TeX log, and map error lines back to the user's source.
5. **Missing packages:** show a visible warning when a package isn't available, rather than letting TikZJax load an empty file silently.
6. **Font notice:** the preview always uses Computer Modern (D16). When the preamble loads a font package, show a small notice that text widths in the preview may differ from the user's document. `.tex` export keeps the user's packages.
7. **Units and hairlines:** place the SVG with the 72/72.27 correction (or emit bp), and enforce a minimum visible stroke width in the preview.
8. **PDF export:** `.tex` export is the primary output. For quick PDF exports, prefer converting the preview SVG to PDF in the browser. Don't ship busytex for this. Decide the details in Milestone 3.

### Any time
- **Firefox spot check:** the owner will run it themselves:
  - `npx playwright install firefox`
  - `npm run bench-engines -- tikzjax busytex --browser=firefox`

  The extra Firefox 137 build downloaded during M0 was removed on 2026-10-07. Playwright's current Firefox 155 build is still installed.

## Known issues and limitations
**Grammar** (`src/parser/tikz.grammar`; D19 lists what M1 added)
- **Fixed in M1:**
  - picture options are a separate node;
  - brace scopes are parsed;
  - `\tikzstyle` is modelled;
  - `;` is allowed inside braced option values;
  - `-|` works without spaces;
  - pictures inside `\resizebox` are found.
- **`\foreach` and `\matrix` are always opaque,** by design.
- **Spaced environment names.** `\begin {tikzpicture}` (with a space) isn't recognised as a picture.
- **`;` inside `[...]`.** A `;` inside square-bracket options (outside braces) is an error node, so that an unclosed `[` stops at its statement. Its bytes are still covered.
- **Unclosed `[` or `{`.** Text runs to the next point where they can close. This matches TeX and loses no bytes.
- **Error recovery.** Bytes that no token matches during recovery belong to the error node itself (D18). Incremental parses can settle differently from full ones inside errors, which is why the model always uses a full parse (D17).
- **Positions are UTF-16 code units.** File load and save keep the encoding as-is, including any BOM (D29).

**Native preview and editing:** see "What doesn't work yet" in the M1 section.

**Engines and hosting**
- **TikZJax rendering defects.** Missing `\matrix` cell borders, lost strokes in nested pictures, and the 72.27/72 scale error are root-caused, with workarounds; see the M0 follow-up checks.
- **TikZJax refetches files on every compile.** It clears its virtual file system after each compile, so production needs good HTTP caching or a patched loader.
- **`.gz` assets get decompressed early.** Static servers may send `.gz` files with `Content-Encoding: gzip`, so the browser inflates them before the engine does. Vite's dev server did this. Cloudflare Pages behaviour needs checking in Milestone 3, or the assets should be renamed or recompressed with Brotli.
- **Cross-origin isolation needs headers on workers.** With COOP/COEP set, every worker script must also send COEP. In production that means a `_headers` file.
- **Firefox not yet tested.** Playwright's Firefox won't start in the agent's environment. The owner will run the check (see "Notes for later milestones").
