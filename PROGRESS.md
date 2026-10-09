# Progress

## Current status
**Milestone 1 (core loop): done and approved (2026-10-07).** The owner's answers and refinements are in DECISIONS.md D31.

Milestone 0 is done and was approved on 2026-10-07:
- **License:** GPL-3.0-or-later (D14).
- **Engine:** TikZJax, with our own build in Milestone 3 (D13, D15).
- **Preview fonts:** always Computer Modern (D16).

**Milestone 2a (nodes and styles): done and approved (2026-10-07).** The owner tested it by hand; their answers are in DECISIONS.md D44 and "M2a review" below.

**Milestone 2b (edges): done and approved (2026-10-08).** The owner tested all of it, and the fixes of D57, by hand. Their answers are in DECISIONS.md D58 and "M2b review" below. SPEC.md's revisions log now covers D53–D58.

**Milestone 3 (accurate preview and export): done, awaiting review (merged into `trunk` on 2026-10-09).** Step 1, the CI feasibility check (D15, D59), passed and the owner approved it (D60). Steps 2–5, the four fixes from the M2b review (D58 items 4–7), are done (D61–D64). The owner's decision on step 4's limit is D65. Steps 6–8 are done (D66–D68): the TeX preview works in the app; see "M3 steps 6–8" below. Steps 9–11 are done (D70–D72, with D69's fixes): offline use, the page, and export; see "M3 steps 9–11" below. The owner answered the step 9–11 questions (D73) and steps 12–14 followed (D74, D75): **Milestone 3 is done, merged into `trunk`, and waiting for the owner's review**; see "Milestone 3 report" below. The owner's standing answers:
- `gh` is logged in with a token for this repo only (Contents, Actions, Workflows: read/write). Report any missing permission instead of working around it.
- Engine files are published as GitHub Releases and fetched by hash. The TL2026 Docker image is pinned by digest.
- Push the `m3-engine-ci` branch when needed. Show the download list before CI downloads anything new.
- All of Milestone 3 is done on `m3-engine-ci` and merged into `trunk` at the end of the milestone (D60).

Also read "Notes for later milestones" below.

## M3 plan and status
| Step | Content | Status |
|---|---|---|
| 1 | CI feasibility: build `tex.wasm` and dump a TL2026 format in GitHub Actions (D15, D59) | Done, approved (D60) |
| 2 | Deleting a node in a `fit` removes it from the list (D58 item 4, D61) | Done |
| 3 | "Split and apply" for arrow tips (D58 item 5, D62) | Done |
| 4 | Form changes turn overlapping side keys into `auto` (D58 item 6, D63) | Done |
| 5 | Flip label side on a label with no side key writes `auto` (D58 item 7, D64) | Done |
| 6 | Our own driver from `pgfsys-dvisvgm.def`; ~~`dvi2html` adapted~~ our own DVI-to-SVG converter (D66, a departure to review); boxes, bp units | Done |
| 7 | Our worker and files: missing-package warning, bytes, caching, `\scrollmode`, log, error lines, packages, `_headers`, `.gz` serving, fetch the release by hash | Done (D67) |
| 8 | Accurate preview in the app; locked blocks drawn and selectable; errors; font notice; minimum stroke; label marker (D65) | Done (D68) |
| 9 | Service worker, offline | Done (D70) |
| 10 | Importing the preamble, column-width guide | Done (D71) |
| 11 | Export: `.tex`, snippet, SVG, PNG, PDF | Done (D72) |
| 12 | Save and open: IndexedDB autosave, File System Access API, fallback | Done (D74) |
| 13 | Share links in the URL hash | Done (D74) |
| 14 | End-to-end tests, goldens, docs, report, push, Cloudflare Pages checks | Done (D75) |

## Milestone 3 report: accurate preview and export (2026-10-09)
All of Milestone 3 is done on `m3-engine-ci` and merged into `trunk` (D60). This section covers the last stretch: the owner's answers to the step 9–11 questions (D73), and steps 12–14 (D74, D75). Steps 1–11 are reported below, in "M3 steps 9–11", "M3 steps 6–8", "M3 steps 2–5" and "M3 step 1".

### How to try it
`npm run fetch-engines -- engine` once (10.8 MB from this repo's release, checked by hash), then `npm run dev`, open http://localhost:5173.
- **Page widths for your classes (D73).** Toolbar **Page**. Paste `\documentclass[5p]{elsarticle}`: column 252 pt, text 522 pt, and the guide is one column wide; a node with `text width=0.5\columnwidth` is 126 pt wide in **both** the quick and the TeX preview. Try `\documentclass[3p,twocolumn]{elsarticle}` (222 pt columns), IEEEtran, revtex4-2 (`reprint`, `preprint`), llncs and the one-column acmart formats.
- **Your own class (ANS).** Paste a preamble with `\documentclass{ans}` and a macro the class defines, say `\journal{…}`. The TeX preview still draws: the bar says **TeX preview: notes**, with "The ans class isn't available in the preview, so it uses article's page (or the widths you typed) and keeps your packages and macros" and the line of the unknown macro. Under **Type the widths yourself** enter `\textwidth` and `\columnwidth`, type a name (ANS) and **Save as preset**; next time choose it from the list. Typed widths win over the preamble everywhere and are kept per viewer in this browser.
- **Save and open (D74).** Type something, reload: it is still there (kept in IndexedDB as you type). **Open…** (Chromium) opens a file and links it; edit and press **Ctrl+S**: it is written back (a `●` after the name says the file differs). **Save as…** writes a new file. In Firefox and Safari Open is a file chooser and Save a download. Opening a file or a link puts the work on screen aside; **Restore previous work** brings it back.
- **Share (D74).** Toolbar **Share**: a link with your code compressed into the part after the `#`. Open it in a private window: the same picture. Nothing is uploaded; the link holds the code only, not your preamble or settings.
- **Metered connections (D73).** In Chromium's developer tools, Network conditions can't fake `saveData`, but `navigator.connection` reports it on devices that have a data-saver: the toolbar then says "Offline: kept as used" instead of fetching the whole engine.
- **Production headers (D75).** `npm run build:pages` (fetches the pinned engine, builds, checks `dist/`), then `npx vite preview` serves the build with the headers Cloudflare Pages will send, including a Content-Security-Policy that allows only this site's own files.

### What works
- **Class presets (D73).** `src/tikz/classes.ts`: article, report, book, elsarticle (`1p` 384 pt; `3p` 468 pt, 24 pt gap; `5p` 522 pt, two columns, 18 pt gap; else article's), IEEEtran (516 pt; `compsoc`; `conference,compsoc`; one column; `draftcls`), revtex4-2 (10 pt 510 pt, 11/12 pt 468 pt; `reprint`/`preprint`/`aip`; columns and gaps), llncs (12.2 cm), and acmart's single-column formats. **They are tested against LaTeX itself:** `.github/workflows/page-widths.yml` compiles a document that prints `\textwidth` and `\columnwidth` for 130 class-and-option lists in the pinned TL2026 image, the result is committed (`engine/page-widths/measured.jsonl`), and `test/page.test.ts` runs every case through the code. That also confirmed the previous session's reading of elsarticle.dtx.
- **The page goes through the interpreter (D73).** `\textwidth`, `\columnwidth`, `\linewidth` and `\paperwidth` in the quick preview follow the same page as the TeX preview (`effectivePage` is the one source), including in the planners that check their edits by drawing.
- **Unknown classes (D73).** Substituted by article's page with a note, errors in their preamble shown as notes, typed widths and named presets.
- **Steps 12 and 13 (D74), step 14 (D75):** as above. `npm run check:dist`: 1,235 files, 11.6 MiB, the largest file 2.85 MiB, `_headers` valid, every file the engine index and the service worker list present.

### Tests
- **Vitest:** 1,130 tests in 35 files (was 992 in 33). New: 144 in `test/page.test.ts` (130 of them are the measured class cases), `test/page-layout.test.ts` (5: the page through the interpreter), `test/share.test.ts` (4), and imported-preamble, typed-width and substituted-class cases in `test/engine-input.test.ts`.
- **Playwright:** 126 tests in Edge (was 117), all passing: `test/e2e/files.spec.ts` (6), `test/e2e/pagepresets.spec.ts` (2), and an unknown-class case in `page.spec.ts`. `npm run test:offline`: 4 tests (was 3), the new one runs the TeX picture, the three exports, a share link and the Page panel under the production Content-Security-Policy and fails on a violation (checked by forbidding workers).
- All end-to-end specs now import `test` from `test/e2e/base.ts`: the app starts once the kept work has been read, so a page counts as loaded when the code pane exists.
- `npm run typecheck`, `npm run build` and `npm run layout:bench` (unchanged: parse 7.3 ms, layout 7.4 ms, drop 28 ms) pass.

### Cloudflare Pages: what to do and what to look at
1. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git → this repo, production branch `trunk`.
2. Build command `npm run build:pages`; build output directory `dist`; Node 24 is picked up from `.node-version`. (The engine is not in git: `build:pages` downloads the pinned release from this repo's GitHub Releases, checks its SHA-256 and unpacks it. The repo must be public, or the release asset reachable without a token.)
3. After the first deploy, open the site and check: the toolbar says "Works offline" after a few seconds on the first visit; the browser's console shows no Content-Security-Policy messages; **TeX preview** appears; the response for `/engine/engine-2026-10-09/core.dump.gz` has `Cache-Control: immutable` (Network tab). If Cloudflare adds `Content-Encoding: gzip` to the `.gz` files the engine still works (the worker accepts them inflated or not, D67), but then the transfer is a little larger than it needs to be: tell me and we rename or recompress them.
4. Custom domain, if wanted: the Pages project's Custom domains tab.

### Decisions for you
1. **The Content-Security-Policy (D75).** I added it (nothing in the spec asks for it): it makes the browser refuse any request to another host, which is the hard rule "client-side only" enforced rather than promised. It is tested under `vite preview` but not on Cloudflare itself. It is one line in `public/_headers` to remove or loosen. Keep?
2. **acmart's two-column formats** (see "Known limits").
3. **Metered connections (D73).** The Network Information API has no "metered" flag; I use `saveData`, a cellular connection type, or a 2G effective type. On desktop Chrome neither is reported, so the engine is always fetched there. Enough?

### Known limits
- **Presets cover what was measured.** Classes and options not in `engine/page-widths/cases.txt` follow the same rules but are unverified; add a line to the cases and re-run the workflow (Docker Hub's anonymous pull limit makes it fail now and then; re-run it).
- **File System Access API** works in Chromium browsers only; the fakes in `files.spec.ts` stand in for the pickers, so the real pickers were not driven by a test. A file handle kept from an earlier visit asks for permission again at the first Save.
- **Share links** need `CompressionStream` (every current browser). The link holds the code only. Very long code makes a long link (a warning appears past 8,000 characters).
- **Everything about Cloudflare Pages itself** is untested until the first deploy (headers, `.gz`, caching): see above.
- **Still from before:** styles and macros defined only in an imported preamble aren't known to the quick preview or the editing tools (D71); PDF export limits (D72); fonts are Computer Modern only (D16); Firefox is untested.

## M3 steps 9–11: offline, the page, export (2026-10-09)
Done in one go on `m3-engine-ci`, as the owner asked, with a commit after each step. The owner's answers on steps 6–8 and two bugs from their testing are in too (D69). No new engine release was published: the pinned one is still `engine-2026-10-09`. Old releases are untouched.

### How to try it
`npm run dev`, open http://localhost:5173. (Offline use only exists in a built app: see the last item.)
- **Banner over a TeX picture with errors (D69).** Write `{\oops B}` in a node's text: a banner says "LaTeX found 1 error and would stop at the first; this picture shows what it drew anyway", with **Show the first error** and **Show the quick preview** (this visit only; the toolbar's TeX preview box brings TeX's picture back).
- **Beamer note (D69).** Paste a document with `\documentclass{beamer}`: the bar says "TeX preview: notes".
- **Page (step 10, D71).** Toolbar **Page**. Paste a paper's preamble, say `\documentclass[twocolumn,a4paper]{article}`: it lists what it says about the width (column 221 pt, text 452 pt), and the canvas shows two dashed lines one column apart, centred on the figure, red with "the figure is N mm too wide" when it doesn't fit. Try a bare picture using `\state{A}` with `\newcommand{\state}[1]{\mathbf{#1}}` in the preamble: TeX's picture needs the import. A full document's own preamble is used when the code has one. A typed width ("3.4in") works with no preamble.
- **Export (step 11, D72).** Toolbar **Export**: standalone `.tex`, snippet (Download or Copy), and SVG, PDF and PNG of TeX's picture (margin, 72–600 dpi, transparent). Open the PDF and SVG in any viewer.
- **Offline (step 9, D70).** `npm run build`, `npx vite preview`, open the app, wait for "Works offline" in the toolbar (about 7 MB of the engine is fetched in the background), then switch the network off and reload. Or `npm run test:offline`.

### What works
- **Step 9, offline (D70).** A service worker (`src/sw/sw.ts`, compiled by a Vite plugin) caches the app whole at install and the engine's files as they are fetched; the rest of the engine is fetched in the background after the first picture, so after one visit every package and font is there. Pages load network-first (4 s) so a deploy shows on the next load. Caches of old builds and old engine tags are deleted. Only in production builds.
- **Step 10, the page (D71).** Imported preamble for the TeX preview (errors placed on its lines), page widths worked out like TeX does for article, report, book, Beamer, geometry and `\setlength` (`src/tikz/page.ts`), the guide, and the TeX preview getting the same `\textwidth`/`\columnwidth` (so `text width=\columnwidth` is a column wide).
- **Step 11, export (D72).** The two `.tex` forms, and SVG, PDF and PNG from TeX's drawing. The PDF converter is ours: against pdf.js's drawing of the PDF, the 13 comparison diagrams and 25 corpus pictures differ from the SVG by 0–2% of ink pixels (`npm run pdfcheck`).
- **Fixes (D69).** The banner; the Beamer note; a new node never lands on another node: the search for a free spot now steps by the node's own size and tries 24 places, and a last check refuses a result exactly on another node.

### Tests
- **Vitest:** 992 tests in 33 files (was 932 in 29). New: `test/page.test.ts` (16), `test/svg2pdf.test.ts` (15), `test/export.test.ts` (13), `test/create-overlap.test.ts` (7), imported-preamble and page-length cases in `test/engine-input.test.ts` and `test/engine-run.test.ts` (the standalone export compiled by TeX gives the same picture).
- **Playwright:** 117 tests in Edge (was 101), all passing: `test/e2e/page.spec.ts` (6), `test/e2e/export.spec.ts` (8), banner and Beamer cases in `preview.spec.ts` (2). Plus `npm run test:offline`: 3 tests against a production build (not part of `npm run test:e2e`).
- `npm run typecheck` and `npm run build` pass; `npm run pdfcheck` (diagrams and corpus) is above.

### Decisions for you
1. **The background fetch of the whole engine (D70).** After the first visit the app fetches the other ~7 MB of the engine so that every package works offline, not only those the first visit used. The alternative is lazy only (a package not used on the first visit would fail offline). It is one call, `prefetchEngine`, in `startPreview`. Keep?
2. **Classes whose width is unknown (D71).** Page widths are worked out for article, report, book and Beamer; for IEEEtran, acmart, revtex and the like the panel says it doesn't know and asks for a typed width. I would rather show nothing than a guess. Do you want presets for particular classes (give me the ones you use)?
3. **Quick preview and `\textwidth` (D71).** The quick preview still reads `\textwidth` and `\columnwidth` inside the picture as 345 pt; the TeX preview now uses the page's values. Fixing it means passing the page through the interpreter. Worth doing in this milestone?
4. **The Enter-sibling bug (D69).** I couldn't reproduce stacking with the current code (the seven `right=6mm of latent` nodes are in `corpus/self-hybrid-surrogate.tex` as committed with the M1 review, before Tab and Enter existed). I fixed what I found (a search that ran out and jumped in oversized steps) and added a last check. If you still see stacking, tell me the exact steps (which node was selected, what was typed).

### Known limits
- **PDF:** `<image>`, patterns, filters and masks aren't converted (the engine can't produce them anyway); group opacity is applied to each shape. One picture per file.
- **Export of a figure whose TeX run had errors** shows what TeX drew; the status says so.
- **Imported preamble:** styles and macros defined only there aren't known to the quick preview or the editing tools (D71).
- **Service worker:** Cloudflare Pages behaviour (headers, `.gz`) is untested until step 14. Updates show on the next load, not live.

## M3 steps 6–8: the TeX preview (2026-10-09)
Done in one go on `m3-engine-ci`, as the owner asked, with commits along the way. The owner's decision on step 4's limit (D65) is in too: dragging a corner, curve handle, segment or end converts overlapping label sides like a form change; moving a node doesn't, and a marker shows instead.

### How to try it
1. `npm run fetch-engines -- engine`: downloads the engine release `engine-2026-10-09` from this repo's GitHub Releases (one file, `engine.tar`, 10.8 MB), checks its SHA-256 against `engine/release.json` and unpacks it into `vendor/engine/`.
2. `npm run dev`, open http://localhost:5173. After about half a second the picture is TeX's own (Computer Modern text, pgf's real shapes and arrows). The summary bar says **TeX preview**; the toolbar's **TeX preview** box turns it off and on.
3. Things to try:
   - **Edit or drag:** while the code and TeX's picture differ (during a drag, and for 0.1–0.3 s after an edit), the native drawing shows; then TeX's picture replaces it. Everything is clicked and dragged as before.
   - **A locked block:** add `\foreach \i in {0,1,2} \fill[red] (\i,-1.5) circle (3pt);` to a picture. TeX draws the dots; hover them for an outline, click to select the loop's code.
   - **Errors:** write `{\oops B}` in a node's text. The bar says **TeX: 1 error**; click it for "Line n: Undefined control sequence." with a link to the line. TeX carries on, so the rest is still drawn.
   - **Notes:** in a full document, `\usepackage{lmodern}` gives the Computer Modern notice (D16), and `\usepackage{nosuchpackage}` says the preview compiles without it. `\matrix`, `\usepackage{amssymb,siunitx}`, `pgfplots`, `tikz-cd` and every TikZ library load.
   - **Label marker (D65):** paste `\node[draw] (a) at (0,0) {A};`, `\node[draw] (b) at (0,-3) {B};`, `\draw[->] (a) -- node[above] {x} (b);`. A small amber marker sits by the "x": click it for **Beside the line (auto)** or **Flip side**, one undo step each. The same happens after dragging `b` below `a` in a horizontal pair.
   - **Corner drags (D65):** `\draw (a) -- node[pos=0.5, above] {x} (4,0) -- (b);` with two nodes; drag the corner so the first segment turns upright: the status bar says the label was written as `auto`.

### What works
- **Step 6, driver and converter (D66).** `pgfsys-tikzflow.def` loads pgf's dvisvgm driver and fixes box handling (no lost strokes in boxes), text colour, and writes where the picture sits. Our own DVI-to-SVG converter draws text as paths from the AMS Type 1 fonts, so the SVG needs no web fonts. Against pdfTeX (busytex) on the 13 comparison diagrams: 0–1.9% of ink pixels differ (antialiasing and the 0.1pt hairline); `\matrix` cell borders 0%, pictures nested in nodes 0.4%, where TikZJax lost them. Against the real dvisvgm on the same DVIs: 0% on 12, and on the 13th dvisvgm's fraction bar is the one that's off.
- **Step 7, worker and files (D67).** Our TeX runtime (missing files are missing, bytes, files cached for the session, asyncify pauses for fetches), `\scrollmode`, the log read for errors with the user's line, 44 TeX Live packages (979 files, 3.6 MB gzipped), 188 fonts (3.2 MB gzipped), all fetched on demand. CI publishes `engine.tar` as a release; `engine/release.json` pins it by hash. The format is now byte-reproducible (same `core.dump` hash from two runs of one commit). `_headers` caches the engine; the worker accepts `.gz` files whether or not a server inflated them (`vite preview` does).
- **Step 8, the app (D68).** TeX's picture under a transparent native drawing, placed by TikZ's origin (checked to within 2 px on screen); the native drawing shows whenever the two differ. Locked blocks outlined and clickable. Errors with line links; notes for packages, fonts and missing files. Hairlines at least 0.75 px. The label marker of D65.
- **Speed (Edge, local server, fresh context):** the engine is ready 0.1 s after the page opens; the first picture takes 0.32 s more; later compiles take about 55 ms (TikZJax beta24: about 400 ms), plus the 250 ms wait after the last keystroke. The engine downloads 3.1 MB (wasm and format) plus about 0.1–0.3 MB of packages and fonts for a typical figure.

### Tests
- **Vitest:** 932 tests in 29 files (was 900 in 25). New: `test/dvisvg.test.ts` (10, hand-written DVI files), `test/engine-fonts.test.ts` (4, CTAN fonts), `test/engine-input.test.ts` (7: input, line map, block markers, log, file names), `test/engine-run.test.ts` (5: the whole pipeline in Node with the released engine: a flowchart, an error mapped to its line, packages and libraries on demand, a missing package, block markers), and 6 in `test/labelforms.test.ts` (D65: corner and end drags, the marker's list and fixes). The engine tests skip without `vendor/engine`.
- **Playwright:** 101 tests in Edge (was 95), all passing with the TeX preview on. New: `test/e2e/preview.spec.ts` (6: TeX's picture lined up with the native one, native while stale, a locked block clicked, errors and notes, the switch, the label marker).
- **Engine checks:** `npm run compare-engines -- --engines=ours` (above) and `npm run dvicheck`.
- `npm run typecheck` and `npm run build` pass; the build is 1,234 files, 15 MB, the largest 2.98 MB (`core.dump.gz`), within Cloudflare Pages' limits. I didn't re-run `npm run fidelity` or `layout:bench`: the native interpreter and layout didn't change.
- Screenshots and checks in the app's browser pane, which works this session.

### Decisions for you
1. **Our own DVI-to-SVG converter instead of adapting dvi2html (D66 item 2).** The plan said "dvi2html adapted". I wrote our own (about 800 lines with the font readers): dvi2html was only available minified, depends on Node polyfills, targets the ximera driver, and draws text with BaKoMa web fonts whose licence the M5 audit would have to clear and that exports would have to embed. Ours draws text as paths from the AMS fonts (OFL-1.1). dvi2html is no longer used. OK, or do you want dvi2html adapted after all?
2. **The engine release.** I published `engine-2026-10-09` as a GitHub prerelease of this repo (the plan's "fetch the release by hash"); D59 recorded approval for one prerelease, in step 1. Fine to publish engine releases this way from now on?
3. **What is compiled.** The user's preamble and the picture, not the document's other text. Font packages are left out (D16), and so are `hyperref`, `geometry`, `babel` and similar ones that only affect pages. `11pt`/`12pt` are honoured; other class options aren't (the format is `standalone`). Is that the right line?

### Known limits
- **Fonts:** only Computer Modern, the AMS fonts and LaTeX's own; `\usepackage[T1]{fontenc}` is left out with the font notice (the T1 fonts, cm-super, would be about 60 MB).
- **Packages:** only the 44 in `engine/build/packages.txt`; others are left out with a note. Adding one is a line there and an engine release.
- **The switch to the native drawing on every edit** is a visible flicker of 0.1–0.3 s while TeX catches up.
- **Memory:** the worker holds TeX's 164 MB memory and a 164 MB copy of the format to reset it from.
- **Locked-block outlines** are the bounding box of what TeX drew between the block's markers.
- **The canvas fits the native layout's bounds,** so parts only TeX draws (a loop's output) can be outside the fitted view.
- **No offline use yet:** files are cached for the session only; the service worker is step 9.
- **Errors in packages** show the package's file name, not a line of the user's code.
- **Cloudflare Pages behaviour** (`.gz` headers, caching) is untested until step 14; the worker handles either.

## M3 steps 2–5: the four fixes from the M2b review (2026-10-08)
Done in one go on `m3-engine-ci`, as the owner asked (D60), with a commit after each step. The owner's decisions on step 1 are recorded in D60: the `\filesize` change to web2js is approved, and the whole of Milestone 3 is merged into `trunk` at its end.

### How to try it
`npm run dev`, open http://localhost:5173, and paste the code shown in each item into the code pane.
- **Step 2, delete from a fit (D61).** Paste `\begin{tikzpicture}`, `\node[draw] (a) at (0,0) {A};`, `\node[draw] (b) at (2,0) {B};`, `\node[draw] (c) at (4,0) {C};`, `\node[draw, fit=(a) (b) (c)] (box) {};`, `\end{tikzpicture}`. Select `a` and press Delete: the code now says `fit=(b) (c)` and the box shrinks. The status bar says "a left the fit of box…". Ctrl+Z brings it back. Select `b` and `c` as well: the last member is refused with the reason.
- **Step 3, Split and apply (D62).** Paste two or three nodes and `\draw[thick] (a) -- (b) -- (c);`. Click the first edge and click the `→` arrow in the panel. Nothing is written yet: a card explains that tips belong to the whole path and offers **Split and apply** or **Cancel**. Split and apply gives `\draw[thick, ->] (a) -- (b);` and `\draw[thick] (b) -- (c);` in one undo step, and the edge stays selected.
- **Step 4, form changes (D63).** Paste `\node[draw] (a) at (0,0) {A};`, `\node[draw] (b) at (4,-3) {B};` and `\draw[->] (a) -- node[pos=0.8, above] {x} (b);`. Right-click the edge and choose **Orthogonal**: the result is `(a) -| node[pos=0.8, auto] {x} (b)`, and the status bar says the label was written as `auto` instead of `above`. One Ctrl+Z undoes both. Straight and Curved do the same.
- **Step 5, Flip on a bare label (D64).** Paste `\draw[->] (a) -- node[pos=0.3] {x} (b);`. The label sits on the line. Right-click it, **Flip label side** (or the panel's **Flip side**): `node[pos=0.3, auto] {x}`, beside the line. A second click gives `auto, swap`.

### What works
- **Delete in a fit.** `fit=` lists lose the deleted nodes, with the spacing that separated them; braces, several nodes at once, and coordinates that reach a deleted node (`(a |- b)`) are handled. Only the fit's last member is refused (naming the nodes). The fitted node may move while it shrinks, so the "no other node moved" check skips it; a node placed against the fitted node still counts.
- **Split and apply.** The refusal of D55 stays, with its message pointing at the button. The panel's direction buttons and tip menu stay enabled and ask first. The split (D49, D50) and the edit are one set of changes against the original text. If the split alone already gives the asked tip, only the split is written and the note says so. If the split is refused, nothing is written.
- **Form changes.** Straight, Orthogonal and Curved (and the `edge`-operation conversion inside Orthogonal) turn a label side key that the new line cuts through, and the old one didn't, into `auto` or `auto, swap`, by the rule used for sliding. Labels with a distance, with no side key, that already overlapped, or that are `sloped` are left alone. The status bar says what was written.
- **Flip.** A label with no side key gets `auto` (or `auto, swap`), checked to sit beside the line.

### Tests
- **Vitest:** 900 tests in 25 files (was 871 in 23). New: `test/splitapply.test.ts` (8), `test/labelforms.test.ts` (13, including a sweep of every corpus edge with labels through all three forms), five fit tests in `test/delete.test.ts`, three flip tests in `test/labels.test.ts`. One expectation changed on purpose: Straighten of `(a) -- ++(1,0) |- node[right] {no} (b)` now gives `node[auto]` (D63). No golden file changed.
- **Playwright:** 95 tests in Edge (was 93). New: a fit deletion with its refusal (replacing the old refusal test), Split and apply, Make orthogonal with a label, and the flip of a bare label (replacing the old refusal check).
- `npm run typecheck` and `npm run build` pass. I didn't re-run `npm run fidelity` or `layout:bench`: the interpreter and layout didn't change.

### Found along the way
- **`sloped` labels** aren't turned with the line by the layout (only drawn rotated), so where they sit can't be judged. The first version of step 4 converted `above, sloped` labels wrongly, which the corpus golden `self-tikzstyle-paths.0.orthogonal.tex` caught. Now `planAutoSide` skips them. This also fixes the same fault for sliding such a label, which was latent since D57.
- **No Python in this environment.** Scripted edits to files with TeX or backslashes go through the editor tools, as CLAUDE.md says; shell heredocs lose the backslashes.

### Known limits (new)
- **Form changes only.** Dragging a corner, sliding a segment, dragging a curve handle or moving a node can still leave a hand-written `above` label on the line. The owner's item names the three forms.
- **After Orthogonal, an overlapping label has no side to keep.** On an upright or level piece, `above` or `left` runs along the line, so the label gets plain `auto` (the default side of D57), not necessarily the side it was on.
- **A fitted node's own dependents.** Deleting a member moves the fitted node, and a node placed relative to it would move with it, which refuses the deletion with that node's name.

## M3 step 1: engine CI feasibility (2026-10-08)
**Passed.** GitHub Actions on Ubuntu 24.04 does the whole build from pinned inputs (D59): it builds `tex.wasm` with web2js, dumps a format with the 2026 LaTeX kernel, and compiles the M0 sample. The sample also compiles in Edge with the result.

### How to try it
- Look at the runs: https://github.com/LoganAlexanderBurnett/tikzflow/actions/workflows/engine.yml (branch `m3-engine-ci`). The passing run is 37842560730.
- Locally, in Edge:
  1. Download the artifact: `gh run download 37842560730 --name engine --dir vendor/engine-ci/artifact` (3.1 MB).
  2. Stage it: `node scripts/stage-engine-ci.ts`.
  3. Run the bench: `npm run bench-engines -- tikzjax --query=build=ci --tag=ci`.

  Or open `/spike/engines/bench.html?engine=tikzjax&build=ci` with `npm run dev`.

  *(Superseded in step 7: the staging script now unpacks a run's `engine.tar` for our own worker, and `?build=ci` is gone; see CLAUDE.md.)*

### Results
| | Our CI build | TikZJax 1.0.0-beta24 |
|---|---|---|
| LaTeX kernel / expl3 | 2026-06-01 / 2026-09-09 | 2023-11-01 / 2024-01-22 |
| pgf | **3.1.12** | 3.1.10 |
| All 7 libraries load | Yes | Yes |
| `tex.wasm` | 526 kB, 0.12 MB gz | 526 kB |
| `core.dump` | 163.8 MB raw, **2.98 MB gz**, 2.05 MB Brotli | 5.73 MB gz |
| Download in Edge (22 files) | **2.94 MB Brotli** | 3.88 MB Brotli |
| Edge 154, 3 fresh contexts: load / cold / warm compile | 776 / 500 / **435 ms** | 795 / 434 / 399 ms |
| Compiles OK | 18 of 18, each the same 9,176-byte DVI as CI's | — |

**The release:** the tag `engine-feasibility-1` published the prerelease https://github.com/LoganAlexanderBurnett/tikzflow/releases/tag/engine-feasibility-1 (run 37843255339). It holds `core.dump.gz` (2.98 MB), `tex.wasm.gz` (122 kB), `tex_files.tar` (82 kB) and `manifest.json`. Downloaded with `gh release download`, every hash matched its manifest, and the Edge bench gave the same results: 18 of 18 compiles, load 769 ms, cold 483 ms, warm 439 ms. `tex.wasm.gz` has the same SHA-256 as run 37842560730's (`f63698e3…`): the wasm build is reproducible, only the format isn't.

**CI timings:** `tie`, `tangle` and the Pascal compile take 4 s; `wasm-opt` (asyncify) 34 s; the format dump 36 s + 6 s. The sample compiles in 1.8 s in Node. A whole run takes about 5 minutes, most of it pulling the 2.7 GB image.

**The engine itself needed no fallback.** Memory and string-pool sizes are enough, and web2js's change files already provide the primitives the 2026 kernel needs. The wasm's interface is the same as beta24's (19 imports plus memory, the same asyncify exports), so beta24's worker loads it unchanged.

### What had to be fixed: missing files (D15 item 4, D59)
Three runs failed before the fourth passed, each on how a missing file looks to TeX:
1. **Run 37840910012:** the format dumped, but the sample said "Unknown arrow tip kind 'Stealth'". `\usetikzlibrary{arrows.meta}` had loaded an empty `tikzlibraryarrows.meta.code.tex`, a file that doesn't exist. The cause was web2js's loader. The 2026 kernel quotes file names, and TeX's retry `TeXinputs:"name"` was answered as present but empty.
2. **Run 37841548298:** with the loader fixed, the format build stopped at `omlenc.dfu`. web2js's `\filesize` printed `0` for a missing file, where pdfTeX prints nothing, so expl3's existence test said every file existed. The same fault had been loading empty files silently in run 1.
3. **Run 37842161043:** my kpsewhich stand-in had cached `sample.aux` as missing before TeX wrote it.

The fixes are a checked patch script for web2js (`engine/build/patch-web2js.cjs`: four lines in `library.js` and one in `changes/filesize.ch`) and the same two fixes in the staged worker. TikZJax's 2023 format hid all of this: that kernel neither quoted names nor tested existence with `\filesize`.

### Known limits
- **No drawing yet.** The format uses pgf's own `pgfsys-dvisvgm.def`. `dvi2html` draws its paths, but without the ximera driver's page wrapper it gives no `<svg>` root and writes text as HTML. That is step 6 (our driver). Until then, the bench counts a CI-build compile as OK when TeX writes the DVI without errors.
- **expl3 loads `l3backend-dvips.def`**, not the dvisvgm backend. To settle in step 6.
- **Warm compiles are about 9% slower** than beta24 (435 vs 399 ms), presumably the larger 2026 kernel. To watch in step 7.
- **The format isn't byte-reproducible.** The dump records when it was made, so every build has new hashes. Pinning is by the hash of the published file. Fixing the clock during the dump would make rebuilds identical (step 7).
- **`npm run fetch-engines` doesn't fetch the release yet** (step 7). The staged worker is TikZJax's, edited in two places for the spike only.
- `tex_files` holds only the 15 files the sample needs. The curated package set comes in step 7.

## M2b review (2026-10-08)
The owner tested all of 2b and the follow-up fixes by hand: everything works well. Answers (D58):
1. **Unlabelled first branch:** no Yes/No on the next branch (as built).
2. **Automatic label placement:** approved, with `auto`/`swap` (D57).
3. **Delete re-attaches, else pins:** approved.
4. **A deleted node in a `fit`:** remove it from the `fit=` list; refuse only if it is the last member. *Early M3 step.*
5. **Arrow tips on a multi-edge `\draw`:** keep the refusal, and add a **Split and apply** button in the edge panel. *Early M3 step.*
6. **Form changes** (Straight, Orthogonal, Curved): a side key that would overlap the line becomes `auto`, as for drags. *Early M3 step.*
7. **Flip label side** on a label with no side key: write `auto`. *Early M3 step.*
8. **SPEC.md revisions** for D53–D57: added, with these answers.

## Fixes after the owner's testing of M2b (2026-10-08)
Three problems from the owner's hands-on test, each fixed and committed on its own (D57). Nothing of Milestone 3 has been started.

### How to try it
`npm run dev`, open http://localhost:5173, and:
- **The menu.** Right-click any edge: the items are always the same ten, in the same order. Hover a greyed one for the reason (try *Add vertex here* on the sample's `base |- stop` edge). The edge's form (Straight, Orthogonal, Curved) has a tick. Make the window short, or right-click the lowest edge: the menu opens upward and its flyouts stay on screen.
- **Label sides.** Paste `\draw[->] (a) |- (b);` with two nodes, right-click on the level piece, *Add label here*: you get `node[pos=0.8, auto]`, beside the line, and the same on the upright piece. Try `node[pos=0.2, left] {x}` on the upright piece and drag the label onto the level piece: the status bar says `left → auto` and the label stays beside the line. Right-click a label (or click it, then use the panel's **Flip side** button) to put it on the other side: `auto` becomes `auto, swap`.

### What was done
1. **Edge menu (D57 item 1).** Same items, same order; *Split* is always listed; a reason on every disabled item; the current form ticked instead of offered.
2. **Menu position (item 2).** Menus and the anchor flyout stay inside the window. While testing it I found that right-clicking an edge on top of a node's connection handle opened nothing; that works now.
3. **Label sides (items 3 and 4).** New labels, including Yes/No on decisions, are written with `auto` or `auto, swap`; *Flip label side* in the menu and the panel; dragging a side key onto a part of the line that would cut through the label turns it into `auto`.
4. **Interpreter (checked with pdfTeX).** The native layout placed `auto` labels on tilted and curved segments up to 14 pt off pdfTeX: TikZ takes the corner anchor unless the line is within about 3° of level or upright. Fixed, with probes p6 (the label cases) and p7 (an angle sweep): all 82 labels are within 0.05 pt of pdfTeX.
5. **A latent bug** surfaced by writing `auto` labels: the layout gave them a synthetic option list at offset 0, so sliding an `auto` label without `pos=` would have written at the start of the file. Fixed, with a test.

### Tests
- **Vitest:** 871 tests in 23 files. `test/labels.test.ts` grew from 21 to 37: label side on every kind of segment, `auto`/`swap` choice, conversion on slide, flipping, branch labels per direction, and the numbers pdfTeX gives for `auto` labels. 27 of the label goldens in `test/fixtures/golden/edges/` changed, each only in the side key (`right`/`above`/`left`/`below` became `auto`, `auto, swap`).
- **Playwright:** 93 tests in Edge. New: `test/e2e/menu.spec.ts` (6: same items, reasons, ticked form, inside the window at three sizes, the flyout) and `test/e2e/labelsides.spec.ts` (4: add on both pieces, flip from the menu and the panel, why it can't, drag turns `left` into `auto`). Three older tests expected `above`/`right` and now expect `auto`.
- **Fidelity:** `npm run fidelity` now compares labels inside paths too: 324 of 414 nodes within 1 pt of pdfTeX (was 235 of 331 without labels). Compared with the previous results, no node got worse, and the 89 nodes it now includes (the labels of probes p6 and p7, and a few named labels in corpus pictures) are all within 1 pt.
- `npm run typecheck` and `npm run build` pass. `npm run layout:bench` is unchanged (parse 7.8 ms, layout 7.4 ms, drop 29 ms).

### Known limits (new)
- **A label still slides along its own segment only.** It can't be dragged onto another segment of the edge, so "dragged to a segment" means to another part of the same segment (the pieces of `|-`, a curve).
- **Making an edge orthogonal, straight or curved keeps the label's keys.** A label written `above` can end up on the line after that; Flip side or a drag fixes it. New `auto` labels follow the line.
- **A side key with a distance** (`left=2mm`) isn't turned into `auto` by a drag, and a label whose line already cut through it before the drag is left as the author wrote it.
- **Flip side** needs the label to have a side: a label with no side key and no `auto` sits on the line and is refused with that reason.

## Milestone 2b report (2026-10-08)
Steps 7–10 were done in one go, as the owner asked, with a commit after each. The work that was half-finished when the last session stopped (decision 4 of D53) is finished too.

### How to try it
`npm install && npm run dev`, open http://localhost:5173 (the sample), and:
- **Edge operations (D53 item 4).** Paste `\path[->] (a) edge (b);` with two nodes, right-click the edge and choose **Make orthogonal**, or drag its ghost handle to add a corner. It becomes `\draw[->] (a) -| (b);` (in its own `\draw` if the statement held other code), in one undo step, and the status bar says so.
- **Edge labels (step 7).**
  - Right-click an edge, **Add label here**: a box opens on the edge where you clicked. Type, press Enter: `\draw[->] (a) -- node[pos=0.25, above] {text} (b);`. Esc writes nothing.
  - **Drag a label** along its edge: `pos=` is written (quarters snap; Alt gives hundredths).
  - Select the sample's `small` decision and press **Tab**: the new branch gets `node[near start, right] {Yes}`, the next one `{No}`. The sample's own `yes` and `no` lower-case labels are followed when the figure already has them.
- **Edge properties (step 8).** Click an edge. The panel has **Arrow** (none, end, start, both, and a tip: the figure's own, Stealth, Latex, To, Triangle), **Line** (solid, dashed, dotted), **Colour** (the same picker as nodes, plus "Default") and **Width** (the named TikZ widths). A "This edge / All *style* edges (N)" choice at the top works as for nodes. Try it on a figure with `\tikzset{flow/.style={->, thick}}` and `\draw[flow]`.
- **Delete (step 9).** Select a node and press **Delete** (or Backspace, or the button in the panel). In the sample, delete `rec`: its two edges go, and `stop`, which hung below it, becomes `below=2.6cm of small` and stays where it was. Ctrl+Z brings everything back. Delete also works on a selected edge (key, panel button, or **Delete edge** in the edge menu). Deleting a node that sits in another node's `fit` is refused with the reason.

### What works
- **Decision 4 finished (D53).** `src/edit/edgeop.ts`: the menu, the ghost handles and the status bar offer Make orthogonal and corners for `edge` operations. The CRLF bug in `composeChanges` is fixed by composing without CodeMirror's ChangeSet; it is covered by new unit tests. The vertices test for edge operations was updated.
- **Step 7, labels (D54).** Add label here, sliding with `pos=` on lines, orthogonal pieces and curves (the interpreter's `pos` on curves was already checked against pdfTeX by probe `p5`), and Yes/No on branches out of decisions, for Tab, Enter and drawing an edge from a decision. The layout now records where a path label is attached (`pathPos`).
- **Step 8, edge properties (D55).** `src/edit/edgeprops.ts`. Items are replaced or removed in place, the form the edge already uses is kept (`red` stays `red`, `draw=red` stays `draw=`), a value the edge inherits is not repeated, and `arrows.meta` is loaded when a tip needs it. Every edit is checked by drawing the result: the edge must come out as asked.
- **Step 9, delete (D56).** `src/edit/delete.ts`. Dependents are re-attached or pinned where they are (the move planner with the deleted names excluded), corners written relative to the node are rewritten, dangling edges go (splitting a multi-edge `\draw` or converting an `edge` operation first), then the statements. Everything is checked by drawing the result: no new syntax errors, no node more than 1.5 mm from where it was, no new undefined names, every other edge still joining the same nodes.
- **Step 10.** Edge menu: Add label here and Delete edge added, Escape and the arrow keys work as before. A new end-to-end scenario builds a flowchart with a decision and Yes/No branches, restyles an edge, slides its label and deletes a node. Golden minimal-diff tests now cover five edge edits per corpus picture.

### Tests
- **Vitest:** 855 tests in 23 files, about 13 s. New since steps 4–6:
  - `test/labels.test.ts` (21): positions, sides, segments, sliding, Yes/No wording and creation from a decision;
  - `test/edgeprops.test.ts` (19): reading, arrows and tips, dashes, colour, width, styles, refusals, and a corpus sweep (about 1,600 edits);
  - `test/delete.test.ts` (20): statements, edges, dependents, corners, refusals, and two corpus sweeps. 228 of 292 named corpus nodes can be deleted (78%); the rest are refused with a reason (loops and matrices, fits, chains);
  - `test/golden-edges.test.ts` (116): minimal-diff goldens, `test/fixtures/golden/edges/` (115 files). Each edit stays inside its statement and moves no node;
  - three `composeChanges` tests in `test/edit-core.test.ts`, and the `edgeop` tests from before (13).
  The existing golden move files did not change.
- **Playwright:** 83 tests in Edge, about 55 s. New: 10 in `test/e2e/edges.spec.ts` (edge operations 2, labels 3, properties 2, delete 3) and `test/e2e/flowchart.spec.ts` (the scenario).
- **Fidelity:** `npm run fidelity` still gives 235 of 331 nodes within 1 pt of pdfTeX (the interpreter only gained `pathPos`).
- `npm run typecheck` and `npm run build` pass. `npm run layout:bench`: parse 8.1 ms, layout 8.3 ms, edge model 0.8 ms, drop 33 ms: unchanged.
- I checked the edge panel, the label box and the result of Delete in screenshots from Playwright's Edge. The app's browser pane still can't take screenshots in this environment.

### Known limits
- **Labels.** A label slides along its own segment only: it can't move to another segment of the edge. Straighten, Make orthogonal and the like keep a label's `pos=` as it is. "Add label here" writes `auto` or `auto, swap` from the side of the line you clicked on (D57; it was above/below/left/right in D54). Flipping a label to the other side is in the menu and the panel. Labels of locked edges can't be added or slid.
- **Yes/No.** Nothing is added for a third branch, for a first branch that is unlabelled, or when the figure's decisions use other wording.
- **Edge properties.**
  - Arrow tips of one edge in a `\draw` with several edges are refused (Split first), because TikZ gives them to the whole path. Dashes, colour and width go to the whole path and the panel says "This path".
  - Only styles named directly in the edge's options are offered as scopes, not `every edge`/`every path`.
  - Custom tips (`Stealth[length=3mm]`) are kept and shown as "Custom"; they can be replaced but not created. The text colour of labels isn't edited.
  - A bare picture has no preamble, so a Stealth/Latex/To/Triangle tip there only gets a note that `arrows.meta` must be loaded.
- **Delete.**
  - Refused: names used in code kept as written (loops, matrices, pics), a node in another node's `fit`, a node written inside a path, chain nodes, and edges kept as written. The reason is shown.
  - A re-attached node is written to whole millimetres (D44), so it may sit up to about 1 mm from where it was.
  - Styles and libraries that nothing uses any more stay (D34's conservative rule). A path label that was on a deleted edge goes with it.
  - Deleting an edge in a `\draw` with several edges splits the statement, so the remaining edges end up as separate `\draw`s.
- **Still from steps 1–6:** see "Known limits (steps 1–6)" below, in particular that corners go on straight segments only, `.. controls ..` is never introduced, and Split is refused for paths with `edge` operations. Firefox is still untested.

### Decisions for you (answered 2026-10-08, D58)
1. **Yes/No when the first branch is unlabelled.** I add nothing (an unlabelled first branch gives no clue which wording the figure uses). The alternative is to write "No" anyway, as the plan's wording says, which leaves a half-labelled decision. Which?
2. **Where the automatic labels sit.** `node[near start, right]` for a branch leaving downwards or upwards, `node[near start, above]` for sideways. Hand-written flowcharts differ; is this the style you want?
3. **Delete re-attaches with whole-millimetre distances,** e.g. `below=2.6cm of small`, and pins with plain coordinates when nothing fits. The alternative is to always pin, or to refuse when the position would need a number. Is re-attaching what you meant?
4. **Delete refuses a node in another node's `fit`.** Removing it from the `fit=` list would change the fitted node's size, so I refused. Do you want that done automatically?
5. **Arrow tips in a `\draw` with several edges** can't be set per edge (the panel points to Split). OK, or should the panel split the statement itself?
6. **SPEC.md revisions.** D53–D56 (edge operations converted to `--`; Split writes `[-]` only when needed; labels, properties and delete rules) aren't in SPEC.md's "Spec revisions" yet. May I add them?

## M2b plan and status
| Step | Content | Status |
|---|---|---|
| 1 | Edge model and selection; Tab names an unnamed parent (D44, D46) | Done |
| 2 | Edge-editing core and waypoint emitter (D47) | Done |
| 3 | Anchors: endpoint handles, reconnecting, change anchor, drawing new edges (D48) | Done |
| 4 | Vertices: ghost handles, add/remove, Straighten; split a \draw, move an edge below a later node (D49, D50) | Done |
| 5 | Orthogonal mode: Make orthogonal, sliding segments (D51) | Done |
| 6 | Curved mode: Make curved, control points (D52) | Done |
| 7 | Edge labels: add, slide (`pos=`), yes/no on decisions (D54) | Done |
| 8 | Edge properties panel with edge-or-style scope (D55) | Done |
| 9 | Delete nodes and edges (re-attach or pin dependents, drop dangling edges) (D56) | Done |
| 10 | Context menu polish, end-to-end tests, goldens, sweep, docs, report, push | Done |

## M2b steps 4–6 (2026-10-08, approved with D53)
Done in one go, as the owner asked, with a commit after each step. The owner's answers on steps 1–3 (D49) are in too: "Split into separate edges" and moving an edge's code below a later node.

### How to try it
- `npm run dev`, open http://localhost:5173, and click the `rec → stop` edge.
- **Corners (step 4).** A faint ghost handle sits in the middle of each straight segment. Drag it to add a corner: `\draw[->] (rec) -- ++(9mm,-9mm) -- (stop);`. Drag the diamond-shaped corner to move it (it snaps level and plumb with nodes and its neighbours, e.g. `(b |- a)`); double-click it to remove it.
- **Right-click the edge** (or Shift+F10): Add vertex here, Remove vertex, Straighten, Make orthogonal, Make curved, Change start/end anchor, and, for a `\draw` with several edges, Split into separate edges. Disabled items say why on hover.
- **Orthogonal (step 5).** "Make orthogonal" on a diagonal edge writes `(a) -| (b)` or `(a) |- (b)`, whichever crosses no node. Click the sample's `base |- stop` edge: each segment has a small bar. Drag the horizontal one up a little and the edge meets Stop higher, `([yshift=2mm]stop.east)`; drag it beyond Stop's top and a short piece out of Stop is added. Alt turns snapping off.
- **Curves (step 6).** "Make curved" writes `to[bend left]`. Drag a control point: `to[bend left=50, looseness=1.7]`, both handles moving together. Hold Alt to drag one end on its own: `to[out=60, in=180]`.
- **Split.** Paste `\draw[->] (a) -- (b) -- (c);` with three nodes. Dragging the shared end is refused, and the message points to "Split into separate edges", which writes `\draw[-] (a) -- (b);` and `\draw[->] (b) -- (c);`.
- **Later nodes.** Drop an end on a node defined below the edge's code: the `\draw` moves below that node in the same undo step, and the status bar says so.

### What works
- **The edit core takes edits that add or remove points** (`editPath`, D50). Every edge edit is still checked by laying out the result: nothing else moves, points it leaves alone stay put (relative points after it are held), and points it writes land where they were dropped.
- **Step 4: corners and Straighten (D50).** New corners are written in emitter order: perpendicular, `++(…)` from the point before, or plain numbers in plain pictures. A segment's labels stay on the half they were nearer. Straighten keeps labels, comments, spacing and a `to`'s other keys.
- **Split into separate edges (D49, D50).** Arrow tips stay where they were: `<->` becomes `<-` on the first piece and `->` on the last; tips from a style are turned off with `-` where needed. The split is checked edge by edge: same segments, tips, labels, colour and line.
- **Moving an edge below a later node (D49, D50),** with its trailing comment, when the statement is at the top level and defines no name other code uses.
- **Step 5: orthogonal mode (D51).** Single corner where it can; two corners through the middle when both single corners would cross a node; anchors on a side decide which way the route leaves. Sliding writes the route again as a `|-`/`-|` chain. An end piece moves along the node's side: `([yshift=2mm]a.east)`, `(a.east |- c)` when it lines up with another node, a border angle `(a.34)` on diamonds and ellipses, and back to `(a)` on the centre line.
- **Step 6: curved mode (D52).** Bends stay symmetric while dragged; free curves are written as `out`/`in` with one or two loosenesses and turn back into a bend when dragged symmetric; `.. controls ..` curves keep their form.
- **Interpreter, checked with pdfTeX.** Bends now measure their control points from the line between the border points, as `tikzlibrarytopaths` does: they were up to 0.6 pt off and are now within 0.1 pt (new probe `p5-curves.tex`, 12 curve points). Also read now: `out looseness`, `in looseness`, `relative`, `bend angle`. A shifted anchor, `([yshift=2mm]a.east)`, counts as an end on `a`.
- **Fixed:** an edge's selection didn't follow edits before it in the code (`mapPathId` had lost a backslash); Escape didn't close the menu if pressed before it took the focus.

### Tests
- **Vitest:** 657 tests in 18 files, about 11 s. New:
  - `test/vertices.test.ts` (14): adding, removing, Straighten, label halves, held points, and a corpus sweep that straightens every bent or curved edge;
  - `test/orthogonal.test.ts` (15): single and double corners, anchors, sliding middle and end pieces, border angles, stubs, snapping, and a corpus sweep;
  - `test/curves.test.ts` (11): Make curved, symmetric bends, out/in, two loosenesses, back to a bend, Alt, controls, `edge` operations, and a corpus sweep;
  - `test/edge-ends.test.ts` (+7): moving the code below a later node and its refusals, and Split (tips, styles, refusals, kinds of operation).

  The corpus has no `\draw` with more than one edge, so Split is tested on written examples. The golden minimal-diff files didn't change.
- **Playwright:** 72 tests in Edge, about 47 s. `test/e2e/edges.spec.ts` has 10 new: ghost drag and double-click, moving a corner to `(b |- a)`, Straighten, Add/Remove vertex from the menu, Split then moving the freed end, Make orthogonal, sliding a middle segment, sliding the sample's `|-` along Stop, Make curved and dragging a bend, and Alt-dragging to `out`/`in`.
- **Fidelity:** 235 of 331 nodes within 1 pt of pdfTeX: M2a's 204 plus the 31 probe points of `p4` and `p5`. No corpus node changed.
- `npm run typecheck` and `npm run build` pass. `npm run layout:bench` is unchanged (parse 7.8 ms, layout 7.8 ms, edge model 1.0 ms, drop 35 ms).
- I checked the ghost drag, the new corner, sliding and the curve drag in screenshots from Playwright's Edge. The app's browser pane still can't take screenshots in this environment.

### Known limits (steps 4–6; the `edge` operation limit is lifted by D53 item 4)
- **Corners go on straight segments only.** A curved segment is straightened first; orthogonal edges slide their segments instead of showing corners.
- **`edge` operations** (`(a) edge (b)`) join their ends directly. Make orthogonal and a new corner convert them to `--` first (D53), in place or in a `\draw` of its own, in the same undo step; the status bar says so. Refused for relative ends, statements other than `\draw`/`\path`, and a `\node ... edge` start.
- **Rewriting the code between two ends** (Straighten, Make orthogonal, Make curved, sliding) is refused when the path has options in the middle (they apply to all of it) or an `edge` operation there.
- **Labels on a rewritten edge** go after the piece they are nearest; their `pos=` isn't adjusted (step 7 only adds and slides labels).
- **Make orthogonal** checks only node boxes for crossings, not labels or other edges, and its fallback is two corners through the middle.
- **Rounding:** corners and shifts in whole millimetres; bend angles to 5°, `out`/`in` to 1°, looseness to 0.1. A border angle (`(a.34)`) can sit up to about 0.3 pt off the line it was slid to.
- **`rounded corners`** don't change a rectangle's border in TikZ, so a slid edge meets a terminal's side where the sharp rectangle would be, a fraction of a millimetre outside the drawn curve. pdfTeX draws it the same way.
- **A dragged curve replaces the curve keys it finds** (`distance`, `min distance` and the like, which the preview doesn't draw yet) with what it writes. Other keys stay.
- **`.. controls ..` is never introduced,** only kept.
- **Split** is refused when tips on both ends come from a style, when the arrow key is set in the middle of the path, and for paths with `edge` operations.
- **Moving an edge below a later node** is refused inside a scope and for `\node ... edge` statements.

### Decisions for you (answered 2026-10-08, D53)
1. **Bend angles snap to 5°** while dragging (`bend left=45`), `out`/`in` to whole degrees. Is 5° right for bends, or should they be whole degrees too?
2. **Alt frees a bend** (drags one control point on its own, writing `out`/`in`). Alt already means "no snapping" elsewhere. OK, or would you prefer another key?
3. **Sliding an end segment along a node** writes `([yshift=2mm]a.east)`. The alternative is to always add a short piece out of the node and keep `(a)`. Is the shifted anchor readable enough?
4. **`edge` operations:** should "Make orthogonal" and corners convert `(a) edge (b)` into `(a) -- (b)` (a different operation, which also changes how its options apply), or keep refusing?

## M2b steps 1–3 (2026-10-07)
### How to try it
- `npm run dev`, open http://localhost:5173.
- **Click an edge** (or one of its labels). It gets a halo, its code is highlighted, and the panel names it ("rec → stop") with its form (straight, orthogonal, …). Moving the cursor into an edge's code selects it too.
- **Double-click an edge label** ("yes", "no") to edit it in place, like a node label.
- **Drag an end** of the selected edge:
  - onto one of a node's anchor dots: `(stop.east)`;
  - onto a node's middle: the border, `(stop)`;
  - onto another node: the edge is reconnected.

  The edge follows live, and one Ctrl+Z undoes it.
- **Right-click an edge** (or press Shift+F10 with one selected) for "Change start anchor" and "Change end anchor": a compass of the node's anchors.
- **Hover a node**: four small handles appear just outside its sides. Drag one to another node to draw an edge, `\draw[->] (base) -- (rec);`, or drop it on an anchor dot for `(read.east) -- (base.north)`.
- **Tab on an unnamed node** now names it, e.g. `\node[draw] (readInput) at (0,0) {Read input};`, and adds the child in the same undo step.

### What works
- **Edge model (D46).** Paths are split into node-to-node edges: `\draw (a) -- (b) -- (c);` is two edges, waypoints and `\coordinate`s stay inside one, and each `edge` operation is its own. Each edge knows its form, labels and code.
  - **Corpus:** 261 edges across 29 pictures. The only locked one is the research figure's dashed frame, a closed shape.
  - **Locked edges** say why in plain language. These are shapes (`rectangle`, `cycle`, …) and code the editor can't follow.
- **Edge-editing core (D47).** Points are written in emitter order:
  - perpendicular coordinates (`(b |- a)`) when they line up with two nodes;
  - relative points in the picture's own style (`++(8mm,0)` or `++(0.8,0)`);
  - plain coordinates last.

  All in the path's own frame, so `scale` is accounted for. Later relative points are held where they were. Every edit is checked by laying it out again. The UI for moving waypoints comes with vertices in step 4; the core moves 32 of the corpus's 34 first waypoints, and refuses the other two with the reason (a coordinate another path uses).
- **Anchors (D48):** end handles, live preview, reconnecting, the anchor compass in the context menu, and drawing edges from connection handles. Only the end's text changes.
- **Unnamed parents (D44)** get a name from their label, style or shape, written as ` (name)` after their options.
- **Interpreter fix:** `\draw (a) -- (b) (c) -- (d);` no longer draws b to c. pdfTeX confirmed it with the new probe.

### Tests
- **Vitest:** 610 tests in 15 files, about 10 s. New:
  - `test/edges.test.ts` (16): routes, edge splitting, labels, locks, and a corpus check that every connection is an edge;
  - `test/edge-edit.test.ts` (14): emitter order, plain vs. `mm` style, holding points, `+` vs `++`, scaled paths, snapping, and a corpus waypoint sweep;
  - `test/edge-ends.test.ts` (12): anchors, borders, reconnecting, refusals, new edges, unnamed nodes, and a corpus sweep that moves every editable edge's end to another anchor;
  - two unnamed-parent tests in `test/create.test.ts`.

  The golden minimal-diff files didn't change.
- **Playwright:** 62 tests in Edge, about 39 s. New: `test/e2e/edges.spec.ts` (11): selection, labels, cursor sync, lock card, end drags, reconnecting, the context menu and Shift+F10, and drawing edges.
- **Fidelity:** the new probe `spike/engines/probes/p4-edge-waypoints.tex` puts 16 path points within 0.01 pt of pdfTeX.
- `npm run typecheck` and `npm run build` pass. `npm run layout:bench`: the edge model takes 1.0 ms on the 200-node picture; the rest is unchanged.
- I checked the edge halo, the end drag, the menu and the connection drag in screenshots from Playwright's Edge. The app's own browser pane couldn't take screenshots this session.

### Known limits (steps 1–3)
- **Shared ends aren't moved.** In `(a) -- (b) -- (c)`, the `b` end of either edge is refused with the reason, because moving it would move the other edge too.
- **An end can't attach to a node defined after the edge's code.** It is refused with the reason; moving the edge's code below that node would be a small addition.
- **The start of a `\node (a) {...} edge (b);` path** is the node statement itself and can't be moved.
- **Ends attach to the eight compass anchors and the border.** Angle anchors (`a.30`) and shape-specific ones are kept when written by hand, but not offered.
- **A waypoint the editor writes is never a node anchor.** The path would pass through that node and read as two edges, so perpendicular coordinates are used instead.
- **A path that defines a coordinate another path uses** refuses edits that would move that coordinate.
- **Edges inside `\foreach` or other blocks kept as-is** aren't edges; they still aren't drawn natively (M3).

### Decisions for you (answered 2026-10-07, D49)
1. **Shared ends:** should dropping the shared end of `(a) -- (b) -- (c)` split the statement into two `\draw`s? It would change a single `->` tip into two. Or keep refusing?
2. **Ends on later nodes:** should the editor move the edge's code below the node it is dropped on, instead of refusing?
3. **New edges:** dropping on a node's middle gives `(a) -- (b)`, and on an anchor dot gives both anchors. Is that the rule you want?
4. **Connection handles** show on whichever node the pointer is over. Is that too busy? The alternative is to show them only on the selected node.

## M2a review (2026-10-07)
The owner tested all of 2a by hand: palette and keyboard creation, corner resizing, Match width and the style panel all work well. Answers to the report's questions (D44):
1. **Held-edge precision:** keep whole millimetres. Readability beats sub-millimetre accuracy.
2. **Enter in the label box:** keep as is (it applies the label).
3. **Tab on an unnamed parent:** name it automatically with the existing naming rules, in the same undo step. To be done at the start of 2b.
4. **Factoring threshold:** keep.
5. **Style editing as text:** sufficient.

Not answered yet: whether a palette click with nothing selected should continue after the last node instead of using the view's centre. It stays as it is for now.

## Milestone 2a report (2026-10-07)
### How to try it
- `npm install && npm run dev`, open http://localhost:5173. The sample opens with the palette above the canvas ("Add: Process, Decision, Terminal, I/O, Connector, Document") and a "Styles" section at the bottom of the properties panel.
- **Build from nothing:** replace the code with an empty picture, click **Terminal**, type "Start", press Enter. Press **Tab** and type "Read input", Tab again and type "Valid?", Enter. You get three connected nodes, and the `terminal` style and its libraries are added to the preamble. Esc at any point leaves the code untouched.
- **Enter** on a selected node adds a sibling, wired from the node that leads to it. Click a palette shape with a node selected to add that shape after it; **drag** a shape onto the canvas to drop it with snapping.
- **Resize** a node by a handle: the opposite edge stays put. Hold **Ctrl** to resize from the centre.
- **Shift-click** several nodes, then **Match width** or **Match height** in the panel.
- In **Styles**: Edit a style's options (every node using it follows), or factor out options that several nodes repeat (paste a few identical `\node[draw, fill=blue!10, rounded corners]` lines to see it).
- Open `corpus/self-hybrid-surrogate.tex`: the palette's "This figure" row shows its own `state`, `control` and `kin` styles.

### What works
- **Palette (D41).** The six standard shapes (process, decision, terminal, I/O, connector, document) use your styles of the same name or add them to `\tikzset` with their libraries. The figure's own node styles follow. A node is written as `\node[process, below=of stop] (archive) {Archive};` with `\draw[->] (stop) -- (archive);`, in the arrow style the picture uses most.
- **Keyboard creation.** Tab: a connected child on the flow's side, trying other sides when taken. Enter: a sibling with an edge copied from its sibling's. Tab inside the label box applies it and adds the next. Nothing is written until the label is applied, so names mean something and Escape is clean.
- **Resizing (D40).** The dragged edge follows the pointer, the opposite edge stays, in one undo step; Ctrl resizes from the centre.
- **Style panel and factoring (D42).** Edit a style as text, with the same minimal diff and refusal rules as labels. Factoring is offered for options at least two nodes repeat (six items in all), named from the fill or shape, and refused with the node named if it would change how anything looks.
- **Match width / Match height (D42),** following the node-or-style scope. Unnamed nodes show their label in the panel title.
- **Libraries (D43):** added by every creating edit, and removed after a style edit when the last use goes (conservative rule, D34).
- **Fixes along the way:** the view no longer refits after every edit (it did, since M1, and resizing made it visible), `below=of a` keeps its plain form when only a shift is added, and the view pans to a node being created.

### Tests
- **Vitest:** 566 tests in 12 files, about 10 s. New this round: `test/resize-hold.test.ts` (15), `test/create.test.ts` (19), `test/style-panel.test.ts` (19). Golden minimal-diff files unchanged.
- **Playwright:** 51 tests in Edge, about 32 s. New: resize (3), `create.spec.ts` (9), `styles.spec.ts` (8), `scratch.spec.ts` (1: a flowchart built from an empty picture).
- `npm run typecheck` and `npm run build` pass; `npm run layout:bench` is unchanged (parse 7.4 ms, layout 7.1 ms, drop 29 ms).
- I checked the layout of the palette, panel and label box in screenshots from Playwright's Edge. I didn't re-run `npm run fidelity`: the interpreter didn't change.

### Known limits
- **A parent needs a name** to place a node relative to it. An unnamed node, or a locked one, gets a refusal with the reason. *(Owner, D44: unnamed parents get a name automatically; scheduled for the start of 2b.)*
- **A palette click with nothing selected** drops the node at the middle of the view (snapped), and the first node of an empty picture goes at the origin. Click-with-selection and Tab are the connected paths.
- **Held edge precision (D40):** up to 0.5 mm off when the node's position is relational, because shifts are whole millimetres. *(Owner, D44: accepted; whole millimetres stay.)*
- **Style editing is text.** There's no structured key list, and no rename, for styles or nodes. Deleting nodes isn't in 2a.
- **Factoring** only looks at node options, and suggests at most six sets.
- **Palette dragging** uses HTML5 drag and drop. It's tested in Edge only, and there is no live preview while dragging from the palette; the node appears at the drop with its label box open.
- **Building-block styles** (like `base`) aren't palette entries; the styles nodes use through them are.
- Firefox is still untested (see "Any time" below).

### Decisions for you
1. **Resizing precision (D40).** Is "within 0.5 mm when the position is relational" acceptable, or should a held edge win over round numbers (shifts in tenths of a millimetre)?
2. **Enter in the label box applies; Tab applies and adds the next one** (D41). Should Enter add a sibling instead, as in mind-map tools? I kept Enter as "apply" so that the box behaves like the label editor.
3. **A palette click with nothing selected** puts the node at the view's centre. Would you rather it continue after the last node?
4. **Factoring threshold (D42):** two nodes with three shared options, or three with two. Too eager or too shy?
5. **Style editing as text** (D42). OK for 2a, or do you want a key-by-key editor?
6. **Naming an unnamed parent** automatically when Tab is pressed on it: yes or no?

## M2a plan and status
| Step | Content | Status |
|---|---|---|
| 1 | Shared editing core: option and style edits, statement insertion, library management, multi-selection model, node naming (D35) | Done |
| 2 | M1 fixes: nudge shifts, locked-node explanations and fixes, clickable errors, undefined references, coordinate markers, undrawable-option marker (D36) | Done |
| 3 | Properties panel with style scope, colour picker, multi-select (D37) | Done |
| 4 | Resizing (D38) | Done |
| 5 | In-place label editing (D39) | Done |
| 6 | Palette (standard shapes and the document's own styles) and keyboard creation (D41) | Done |
| 7 | Style panel, factoring repeated options, Match width/height (D42) | Done |
| 8 | End-to-end tests, docs, report, push (D43) | Done |

## M2a steps 4–5, and feedback on steps 2–3 (2026-10-07)
### How to try it
- `npm run dev`, open http://localhost:5173, and click a node: eight handles appear. Drag one.
  - With "This node" chosen in the panel, the node gets `minimum width` or `minimum height`.
  - With "All process nodes" chosen, the `process` style gets it, and every process node changes.
  - Drag a width to line up with another node and the status bar says "Same width as …".
- Double-click a node (or select it and press F2) to edit its label as TeX. Enter applies, Shift+Enter adds a line, Esc cancels. Try typing `50%` to see a refusal.
- Open `corpus/self-hybrid-surrogate.tex`, pick the locked node `#2` and drag it: dropping it pins it with plain coordinates. The "Pin at current position" button is still there.
- The `»` button at the top of the properties panel folds it into a strip. It stays folded after a reload.

### What works
**Feedback on steps 2–3.**
- **Drag to pin.** A node locked only by an undefined or later-defined reference can be dragged. The drop writes `at (x,y)` at the drop position (`planPin` takes an optional centre). Snapping and guides work. Nodes locked for other reasons still refuse.
- **Collapsible panel.** The state is kept in `localStorage`, per viewer. The collapsed strip shows a lock icon when the selected node is locked. I did it now rather than in step 8; it was small.
- Your handling of hand-written shifts is unchanged.

**Step 4, resizing (D38).**
- **Handles** on one selected node: corners and sides. Not on `fit` nodes, nodes scaled with `transform shape`, or shapes the preview draws approximately.
- **What gets written:** whole-millimetre `minimum width` and `minimum height` (never `86.0000007pt`), updated in place on a second drag.
  - A drag that should rewrap the text writes `text width`, never below the widest word. That is a node that already has a `text width`, or a label that can break at a space, made narrower than its text.
  - Circles get `minimum size`.
- **The opposite edge stays put** (D40, which replaced the "grows around its anchor" rule): the dragged edge follows the pointer and the node is repositioned in the same edit if its anchor doesn't already hold the other side. Ctrl (Cmd) resizes from the centre. See "Resizing holds the opposite edge" below.
- **Live preview:** dependent nodes and edges follow while dragging. The edit is one undo step.
- **Snapping** to whole millimetres and to other nodes' widths and heights, with dimension marks. Alt drags without snapping to nodes.
- **Scope.** The drag follows the panel's choice, "This node" or the style. The scope now lives in the store so the canvas can read it.
- **Checked by layout.** If the drawn size is off by more than 0.75 mm, the written value is corrected. If nothing changes (a later `minimum size`, or a node that sets its own size under style scope), the drag is refused with the reason.

**Step 5, label editing (D39).**
- The text box holds the label's TeX between its braces, as written. Only the characters that changed are patched. Comments and line breaks inside the label stay, and CRLF files get CRLF.
- Refused, with the reason under the box: unbalanced braces, a `%` that would comment out the closing brace, and a trailing backslash. The patched text is parsed again and must still be the same node with no new syntax errors.
- Works on locked nodes too, since it doesn't touch position. Not on coordinates, unclosed labels, or edge labels (2b).

**Also fixed:** the canvas never had keyboard focus, because SVG `tabIndex` is case-sensitive in Preact. It's `tabindex` now.

### Resizing holds the opposite edge (D40, 2026-10-07)
- Drag the south-east corner and the north-west corner stays where it is; drag a side and the opposite side stays. **Ctrl** (Cmd on a Mac) resizes from the centre instead. Alt still turns snapping off.
- If the node's anchor already holds that edge (`below=of a` holds the top), only the size is written. Otherwise the move planner repositions it in the same edit: `below=of small` becomes `below=of small, xshift=4mm`. One undo step.
- Also fixed: the view refitted after every edit that changed the picture's size (an M1 bug that resizing made visible).

### Tests
- **Vitest:** 513 tests in 9 files, about 10 s. New: `test/resize.test.ts` (23) and `test/label.test.ts` (39). The latter includes a sweep that appends a character to every closed label in the corpus and checks it is exactly one inserted character. There are also two drag-to-pin tests in `test/fixes.test.ts`. The golden minimal-diff files didn't change.
- **Playwright:** 30 tests in Edge. New: `test/e2e/resize.spec.ts` (5), `test/e2e/label.spec.ts` (5), one drag-to-pin test in `fixes.spec.ts` and one panel-collapse test in `properties.spec.ts`.
- `npm run typecheck` and `npm run build` pass. `npm run layout:bench` is unchanged (parse 7.6 ms, layout 7.9 ms, drop 28 ms).
- I didn't re-run `npm run fidelity`. It needs the engines fetched, and these steps changed no interpreter behaviour: the layout only gained a `sizing` field per node.

### Known limits (steps 4–5)
- **Resizing is one node at a time.** A multi-selection shows no handles. Resizing several nodes together needs a rule for nodes of different shapes; say if you want it.
- **The held edge can be up to 0.5 mm off** for a node placed relative to another, because shifts are written in whole millimetres (D40). Plain coordinates hold to 0.1 mm.
- **Locked nodes** can't be repositioned, so they still grow around their anchor, with a note.
- **Diamonds and ellipses** only take minimums (no rewrap), because their width isn't text width plus padding.
- **Matched sizes are approximate.** Snapping to another node's width writes a whole-millimetre value, so a node whose width comes from its text matches to within 0.5 mm.
- **Label editing shows no live preview** while typing, because the box covers the node. The canvas updates when the label is applied.
- **Label text isn't checked as LaTeX** beyond braces, `%` and the final backslash. An unbalanced `$` is accepted and only shows up when compiling.
- **Resized shapes** are checked against the native layout and unit tests, not against pdfTeX beyond what the existing fidelity probes cover.

## M2a steps 1–3 (2026-10-07)
### How to try it
- `npm run dev`, open http://localhost:5173, and click a node: the panel on the right shows its properties.
- Open `corpus/self-hybrid-surrogate.tex` (the owner's research figure) for the M1 fixes:
  - the syntax errors and undefined names in the summary bar;
  - the locked node `#2` (in Details, under "Locked nodes");
  - the coordinates `v1`–`v6`.

### What works
**Step 1, shared editing core (D35).** Option and style edits, statement insertion, library management, node names, and Shift-click multi-selection. No UI of its own beyond multi-select; steps 3–7 build on it.

**Step 2, fixes from testing M1 (D36).**
- **Nudges.** A repeated nudge updates the shift it wrote (`xshift=5mm` → `xshift=1cm`) instead of adding another. A drop that lines up exactly drops the shift.
- **Locked nodes.** Selecting one shows a plain-language explanation in the panel.
  - An undefined or later-defined reference says LaTeX would stop too, with TeX's own message, and suggests a close name.
  - **Pin at current position** writes plain coordinates.
  - **Attach to** swaps the name for an earlier node, keeping anchors and shifts.
- **Syntax errors.** The count in the summary bar is a button that steps through them, scrolling the code to each. Details lists them by line.
- **Undefined references.** "4 undefined names" lists `model`, `prevkinleft`, `pkin` and `outkin` in the research figure, including the ones inside `\draw` paths. Each name jumps to its uses in the code.
- **Coordinates.** Markers show their name on hover. Unused ones (`v1`–`v3` in the research figure) are hollow and labelled "unused".
- **Undrawable options.** A small amber dot marks nodes with options or shapes the preview can't draw; its tooltip lists them.

**Step 3, properties panel (D37).**
- Fill, outline and text colour; font size, bold, italic and family; alignment.
- **Scope.** "This node" by default, or "All state nodes (14)" to edit the style in place. Nodes that set the key themselves keep their own value, and the status bar says how many.
- **Colour picker.** The document's `\definecolor` names first, then xcolor mixes, base colours, None, and a custom colour that can be added as a named `\definecolor` in the document's colour model.
- **Multi-select.** Shift-click several nodes and every change applies to all of them, as one undo step.
- **Justify** sets a text width on a node that has none. For a style without one it's disabled, and says why.
- **Interpreter fix.** A later `font=` replaces an earlier one, confirmed against pdfTeX with a new probe.

### Tests
- **Vitest:** 449 tests in 7 files, about 10 s. New: `test/fixes.test.ts` (22) and `test/properties.test.ts` (22), plus nudge tests in `test/move.test.ts`. The golden minimal-diff files didn't change.
- **Playwright:** 18 tests in Edge. New: `test/e2e/fixes.spec.ts` (5) and `test/e2e/properties.spec.ts` (5).
- **Fidelity:** `npm run fidelity` gives 204 of 300 nodes within 1 pt of pdfTeX, including the 29 probe nodes. The font fix changed no corpus node.
- `npm run typecheck` and `npm run build` pass.

### Known limits (steps 1–3)
- **Pin and attach.**
  - "Pin at current position" pins where the node is drawn. For an unresolved reference that's usually near the picture's origin, so the node then needs dragging into place.
  - "Attach to" only offers nodes defined earlier in the code, as TikZ requires.
- **Undefined references** are reported conservatively. Names that a `\foreach`, a `\matrix`, a pic, `append after command` or `remember picture` might create are never reported, so some real typos in such pictures go unlisted.
- **Properties panel.**
  - It reads styles from the preamble, the picture's options and top-level `\tikzset`. Styles set inside a `scope` aren't followed, and the `color=` shorthand isn't shown as a fill or outline source.
  - There is no "Default" choice to remove a node's own colour and fall back to its style. Pick the style's value instead, or edit the code.
  - `node font` isn't edited. A `\fontsize{…}{…}` size is kept, and shown as "Custom", until a named size is chosen.
- **The panel takes 280 px** from the canvas unless it is collapsed (see steps 4–5 below).

## Milestones
| Milestone | Status |
|---|---|
| M0: Technical spike | Done, approved 2026-10-07 |
| M1: Core loop | Done, approved 2026-10-07 |
| M2a: Creating and editing nodes and styles | Done, approved 2026-10-07 |
| M2b: Editing edges | Done, approved 2026-10-08 |
| M3: Accurate preview and export | In progress: steps 1–5 done 2026-10-08, steps 6–8 done 2026-10-09 |
| M4: Layout and import | Not started |
| M5: Polish and launch prep | Not started |

## M1 review (2026-10-07)
The owner approved M1 and answered its four questions (D31):
1. **Emitter order: approved.** In 2a, repeated nudges must update an existing `xshift`/`yshift` instead of adding more. A nudge that lands exactly on a clean relation drops the shift.
2. **Locking: approved.** The rule is "never damage or misedit unknown content", not "lock everything". 2a adds a subtle marker on nodes with options the preview can't draw.
3. **Loading positioning automatically: approved.**
4. **Chains: keep.** Dragging chain nodes, by converting them to explicit positioning, is now in Milestone 4.

The owner tested with a real 27-node research figure. Their findings are now at the start of Milestone 2a (D33):
- **Locked nodes:** a plain-language explanation that says LaTeX would fail too, and one-click fixes ("Pin at current position", "Attach to another node").
- **Syntax errors:** the error count is clickable and jumps to each error.
- **Undefined references:** listed in the summary, including those inside `\draw` paths.
- **Coordinates:** markers show their name on hover, and unused ones look different.

Missing features added to 2a:
- resizing nodes, with snapped values;
- a properties panel with node-or-style scope, a colour picker that prefers `\definecolor` names, and font and alignment controls;
- in-place label editing;
- multi-select.

**Corpus:** the figure is now `corpus/self-hybrid-surrogate.tex`, byte-exact with its code errors kept as a realistic test case. It has round-trip tests and two golden moves like every corpus file.

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

### M1: decisions for the owner (answered, see "M1 review" above)
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
1. **First task: confirm the CI toolchain is feasible.** *Done 2026-10-08 (M3 step 1, D59).* Build TikZJax's `tex.wasm` (web2js) and dump our own format from a pinned TeX Live snapshot in **GitHub Actions on Linux**, not locally on Windows. Do this before any other Milestone 3 work.
2. *Done 2026-10-09 (steps 6–7, D66, D67).* **Our own engine build** (D15): current LaTeX kernel, expl3 and pgf 3.1.12, with matching extra packages hosted as `tex_files/<name>.gz`.
3. *Done (step 6, D66).* **Replace `pgfsys-ximera.def`** (unknown origin and license) with a driver based on pgf's `pgfsys-dvisvgm.def` (LPPL). Fix box handling so that `\matrix` cell borders and pictures nested in node text keep their strokes and colours. Adapt `dvi2html` as needed.
4. *Done (steps 7–8, D67, D68).* **Use `\scrollmode` by default**, stream the TeX log, and map error lines back to the user's source.
5. *Done (D67, D68).* **Missing packages:** show a visible warning when a package isn't available, rather than letting TikZJax load an empty file silently.
6. *Done (D68).* **Font notice:** the preview always uses Computer Modern (D16). When the preamble loads a font package, show a small notice that text widths in the preview may differ from the user's document. `.tex` export keeps the user's packages.
7. *Done (D66, D68).* **Units and hairlines:** place the SVG with the 72/72.27 correction (or emit bp), and enforce a minimum visible stroke width in the preview.
8. *Done (step 11, D72).* **PDF export:** `.tex` export is the primary output. For quick PDF exports, prefer converting the preview SVG to PDF in the browser. Don't ship busytex for this. Decide the details in Milestone 3.

### Milestone 5: owner requirements on top of SPEC.md (2026-10-09, D69)
- **Stop the engine worker while the tab is hidden** (it holds about 330 MB) and start it again when the tab is shown.
- **Keep the previous TeX picture visible until the new compile is ready,** instead of showing the native drawing for 0.1–0.3 s on every edit.

### Milestone 5: license audit items
- **web2js's license files disagree** (found 2026-10-08, M3 step 1). `drgrice1/web2js` (commit `0114ef5`, used to build `tex.wasm` in CI) declares `"license": "GPL-3.0"` in `package.json`. Its `LICENSE.md` names "Math-expression", apparently pasted from another project, and offers GPL-3.0 or Apache-2.0. GitHub reports the license as NOASSERTION. web2js itself is only a build tool. But its `library.js` runtime and the TikZJax worker code adapted from it in step 7 ship in the app, so the audit must settle their license, upstream (kisonecat/web2js) included.

- **Added in M3 steps 6–8:** `src/engine/texlib.ts` is our port of web2js's `library.js` (GPL-3.0 as declared; see the item above). `engine/build/texinputs/pgfsys-tikzflow.def` is derived from pgf's `pgfsys-dvisvgm.def` (LPPL and/or GPL; ours takes GPL-3.0-or-later). The preview's glyphs come from the AMS Type 1 Computer Modern fonts (OFL-1.1). The engine release bundles 44 TeX Live packages (`engine/build/packages.txt`), each to be listed with its licence. dvi2html and the BaKoMa fonts are no longer used.

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
- **TikZJax rendering defects** (matrix borders, nested pictures, the 72.27/72 scale): gone with our driver and converter (D66). TikZJax itself is now used only by the M0 comparison pages.
- **Refetching files on every compile:** our worker caches them for the session (D67); across sessions, step 9.
- **`.gz` assets get decompressed early.** Static servers may send `.gz` files with `Content-Encoding: gzip`, so the browser inflates them before the engine does. Vite's dev server did this. Cloudflare Pages behaviour needs checking in Milestone 3, or the assets should be renamed or recompressed with Brotli.
- **Cross-origin isolation** isn't needed by our engine (no SharedArrayBuffer), so production sets no COOP/COEP; the dev server still sends it, for the M0 spike pages.
- **Firefox not yet tested.** Playwright's Firefox won't start in the agent's environment. The owner will run the check (see "Notes for later milestones").
