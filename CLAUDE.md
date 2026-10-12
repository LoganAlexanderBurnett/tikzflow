# TikZFlow

A free, static, fully client-side web app for creating and editing TikZ flowcharts. The code pane and the visual canvas are both live and stay in sync. Its main selling point is lossless round-tripping: visual edits become minimal text patches, and anything the editor doesn't understand is kept verbatim.

## Start of every session
1. Read [PROGRESS.md](PROGRESS.md) for the current milestone, its status, and known issues.
2. Read [DECISIONS.md](DECISIONS.md) before changing architecture, stack, or conventions.
3. [SPEC.md](SPEC.md) holds the full requirements. Change it only when the owner approves. Then log the change in its "Spec revisions" section and the reasons in DECISIONS.md.
4. The owner has added requirements for later milestones that aren't in SPEC.md, notably Milestone 3's engine build. They're listed in PROGRESS.md under "Notes for later milestones". Treat them as part of the spec.

## Workflow
- When asked for a plan first, stop after presenting it and wait for approval before writing code.
- Work one milestone at a time. At the end of each, stop and report what works, what doesn't, how to try it, and which decisions are needed. Wait for approval before starting the next milestone.
- If part of the spec proves infeasible or a bad idea, say so and propose an alternative. Never work around it silently.
- Commit after each meaningful step with clear messages.
- **`trunk` deploys automatically to the live public beta (https://tikzflow.pages.dev).** Do each milestone on its own branch (Milestone 5: `m5`) and push that branch as you go. Merge into `trunk` only at the end, after everything passes, including `npm run test:live` against the branch's Cloudflare preview deployment (`TIKZFLOW_URL=https://<branch>.tikzflow.pages.dev`) if one exists, and only after the owner has reviewed the milestone report (D77).
- Keep DECISIONS.md and PROGRESS.md current as you go, not only at the end of a milestone.
- Don't build the "Later" features in SPEC.md unless asked.
- Before downloading engine binaries or TeX packages, list each file's source and size. These assets go in a gitignored folder and never into git.
- The project license is GPL-3.0-or-later (see `LICENSE` and DECISIONS.md D14). Every bundled dependency must be GPL-3.0-compatible.

## Hard rules
- **Client-side only.** No backend, no analytics or tracking, and no runtime requests to third-party servers. User diagrams never leave the browser.
- **Never lose user content.** Any round-trip diff on unedited input is a release-blocking bug. Constructs the editor can't model become locked opaque blocks and are kept verbatim.
- **The concrete syntax tree is the source of truth.** Visual edits become small text patches. Never re-serialize the whole tree, except when generating a brand-new diagram.
- **TypeScript in strict mode** throughout.
- **Static deploy to Cloudflare Pages.** Every file must be under 25 MB, so chunk large assets.
- **Windows development machine.** npm scripts and tooling must be cross-platform: use Node scripts, never bash-only ones.
- **Every milestone ends green.** Tests pass and `npm install && npm run dev` works.

## Conventions
- Generated TikZ should read as hand-written: `positioning`-library relative placement, named styles in `\tikzset`, meaningful node names, and managed `\usetikzlibrary` lines. Follow the emitter priority order in SPEC.md.
- User-facing text (the interface, status messages, tooltips, notes, the issue template) is in American English: "color", "gray", "center", "behavior" (D86 item 4). Code identifiers and docs follow it where that is cheap.
- Test inputs under `corpus/` and any `fixtures/` folder must stay byte-exact. `.gitattributes` marks them `-text` so git never rewrites their line endings.
- For every corpus file taken from the web, record the source URL and license in `corpus/SOURCES.md`, because the repo is public. Prefer self-written examples.

## Repo
- Remote: `origin` → https://github.com/LoganAlexanderBurnett/tikzflow (default branch `trunk`).
- Commands:
  - `npm run dev`: starts the Vite dev server: the home page at http://localhost:5173/, the editor at http://localhost:5173/editor/ (D92). The grammar playground is at `/src/debug/grammar.html`.
  - `npm run site:assets`: regenerates the site's committed pictures (the templates' thumbnails in `src/site/thumbs/`, rendered by the engine, and the PNG icons). Needs the engine and Edge; `test/templates.test.ts` fails when the thumbnails are stale (D92, D95). Run it after changing a template.
  - `npm run help:build`: writes the help site from `src/help/*.md`: `help/**/index.html`, `src/help/search-index.json` and `public/sitemap.xml` (D99). Commit what it writes; `test/help.test.ts` fails when they are stale. Run it after changing a help page or `src/ui/shortcutlist.ts`.
  - `npm run help:shots [-- <name>…]`: retakes the help's screenshots (`src/help/shots/`) in Edge; needs the engine. Then `npm run help:build`.
  - `npm test`: runs Vitest. This includes the corpus round-trip tests, the interpreter and move tests, and the golden minimal-diff tests.
  - `npm run test:e2e`: runs the Playwright end-to-end tests in Edge. It starts its own dev server on port 5174.
  - `npm run typecheck`: runs strict `tsc`. `npm run build` type-checks and builds to `dist/`.
  - `npm run grammar`: regenerates the parser. It runs automatically before dev, test, build and typecheck.
  - `npm run grammar:inspect`: prints byte coverage and parse errors for each corpus file.
  - `npm run grammar:bench`: runs the parse benchmark.
  - `npm run corpus:report [-- <filter>] [-- -v]`: lays out every corpus picture and prints the "what I understood" summary. `-v` adds locked nodes and node geometry.
  - `npm run layout:bench`: times the model, layout, snapping, a move and auto-layout on a 200-node picture.
  - `npm run autolayout:report [-- <filter>] [-- --right] [-- --full] [-- --out=<dir>]`: runs auto-layout (D80) on every corpus picture and prints what it writes (changed lines, or the whole picture before and after with `--full`).
  - `npm run import:report [-- <file or folder>…] [-- --right] [-- --out=<dir>]`: imports Mermaid and DOT files (default: `test/fixtures/import/`) and prints the TikZ they become, with the notes (D84).
  - `UPDATE_GOLDEN=1 npx vitest run test/golden.test.ts`: regenerates `test/fixtures/golden/`. Review the result with `npm run golden:review` before committing.
  - `UPDATE_GOLDEN=1 npx vitest run test/golden-edges.test.ts`: regenerates `test/fixtures/golden/edges/`, the golden files for edge edits (dashed, label, orthogonal, curved, delete).
  - `UPDATE_GOLDEN=1 npx vitest run test/golden-group.test.ts test/golden-chains.test.ts`: regenerates `test/fixtures/golden/group/` (group moves, D78) and `test/fixtures/golden/chains/` (chain drags, D79).
  - `UPDATE_GOLDEN=1 npx vitest run test/golden-autolayout.test.ts`: regenerates `test/fixtures/golden/autolayout/` (every corpus picture laid out top to bottom and left to right, D80).
  - `UPDATE_GOLDEN=1 npx vitest run test/golden-reorder.test.ts`: regenerates `test/fixtures/golden/reorder/` (auto-layout with "Allow reordering statements", only the cases that move lines, D87).
  - `npm run fidelity [-- --only=<file>] [-- --verbose]`: compiles the corpus, the templates (D95) and `spike/engines/probes/*.tex` with pdfTeX (busytex) and compares node anchors (the four compass ones and, since D98, the four corner ones), and labels written inside paths, with the native layout. It writes `spike/engines/results/fidelity.json`. A run that includes `p12-diagonal-anchors.tex` also writes `test/fixtures/fidelity/p12-tex.json` (D98), which `test/anchors.test.ts` checks without the engine. It needs `npm run fetch-engines` and `node scripts/pack-texmf.ts` first. When unsure how TikZ behaves, add a probe here rather than guessing (D23).
  - `npm run test:offline`: builds the app, serves it with `vite preview` and runs the Playwright offline tests (`test/offline/`, D70): visit once, switch the network off, reload. The service worker exists only in production builds.
  - `npm run test:live` (D76): the post-deploy checks against the deployed site (default https://tikzflow.pages.dev, or `TIKZFLOW_URL=…`): headers and CSP, `.gz` handling, the engine download and cache, offline use, exports, share links, the Beta label. Read-only; no server is started.
  - `npm run check:dist`: after `npm run build`, checks `dist/` against Cloudflare Pages' limits (files, sizes, `_headers`) and for the engine and service-worker files it needs (D75).
  - Page widths of document classes (D73): `.github/workflows/page-widths.yml` runs `engine/page-widths/measure.sh` over `engine/page-widths/cases.txt` in the pinned TL2026 image and prints the widths LaTeX itself gives. Download the artifact (`gh run download <id> --name page-widths`) and commit it as `engine/page-widths/measured.jsonl`: `test/page.test.ts` checks every preset in `src/tikz/classes.ts` against it. The image is pulled through `mirror.gcr.io` (same digest) because Docker Hub's anonymous pull limit kept failing the job.
  - `npm run pdfcheck [-- --set=corpus] [-- --only=<name>]`: compiles the comparison diagrams (or every corpus picture) with our engine, converts the SVG to PDF with `src/export/svg2pdf.ts`, and diffs pdf.js's drawing of the PDF against the browser's drawing of the SVG (D72). Needs the engine.
  - `npm run gen:font-metrics`: regenerates `src/text/fontMetrics.ts` from KaTeX. Run it after upgrading KaTeX.
  - `npm run fetch-engines -- engine`: downloads the accurate preview's engine, the release pinned in `engine/release.json`, checks its SHA-256 and unpacks it into `vendor/engine/<tag>/` (10.8 MB). The dev server serves it as `/engine/<tag>/` and the build copies it into `dist/`. Without it the app runs with the quick preview only. `npm run fetch-engines` with no group also downloads the M0 engines and CTAN packages listed in `scripts/engine-manifest.ts`, recording sizes and hashes in `vendor/LOCK.json`.
  - `node scripts/pack-texmf.ts`: builds `vendor/packs/tikz-flat.json`, which busytex needs.
  - `npm run bench-engines -- tikzjax busytex`: runs the Playwright engine benchmark in Edge. Results go to `spike/engines/results/`.
  - Engine bench page: `/spike/engines/bench.html?engine=tikzjax|busytex|swiftlatex`. Output viewer: `/spike/engines/view.html?files=busytex.pdf,tikzjax.svg`.
  - Engine CI (D59, D66, D67): `.github/workflows/engine.yml` builds `tex.wasm`, the format (with our driver `engine/build/texinputs/pgfsys-tikzflow.def`), the fonts, the package files (`engine/build/packages.txt`) and `engine.tar` on pushes to `trunk`, plus reference SVGs from the real dvisvgm. A tag `engine-*` also publishes a GitHub prerelease; to adopt it, put its tag, the tar's size and SHA-256 (from its `manifest.json`) in `engine/release.json`. To try a run's files before releasing:
    1. `gh run download <run id> --name engine --dir vendor/engine-ci/<folder>`
    2. `node scripts/stage-engine-ci.ts vendor/engine-ci/<folder>` (unpacks into `vendor/engine/ci-<run id>/`)
    3. Open the app with `?engine=ci-<run id>`, or run `TIKZFLOW_ENGINE=ci-<run id> npx vitest run test/engine-run.test.ts`.
  - `npm run compare-engines [-- --engines=ours,tikzjax] [-- --engine=ci-<run id>]`: compares our engine (and TikZJax) with busytex on `spike/engines/diagrams/*.tex`. It writes composite PNGs and `compare.json` to `spike/engines/results/compare/`. Use `--engines=ours` alone: with all three the page runs out of memory.
  - `npm run dvicheck -- --run=<folder>`: checks our DVI-to-SVG converter against the real dvisvgm on a CI artifact's reference DVIs (in `vendor/engine-ci/<folder>/reference`, with its `fonts/` unpacked from `engine.tar`). Output in `spike/engines/results/dvicheck/`.
  - `/spike/engines/ours.html[?engine=…]`: compiles one picture three times with our worker and prints the timings.
  - `/spike/engines/packages.html`: the TikZJax runtime-package and user-preamble checks.
- Playwright's Firefox doesn't start on this machine (see PROGRESS.md), so use Edge (`msedge` channel) for browser automation. In development builds, `window.tikzflow` exposes the store for tests and debugging.
- Layout:
  - `src/parser/`: the Lezer grammar, analysis helpers, and structure helpers. The generated `parser*.ts` files are gitignored.
  - `src/model/`: tree → syntax (with source ranges), the document model, the edge model (paths split into node-to-node edges), and the summary.
  - `src/tikz/`: the TikZ interpreter: units, colors, keys and styles, coordinates, shapes, and layout.
  - `src/text/`: label typesetting.
  - `src/edit/`: text changes (and merging two edits into one), snapping, the move planner and emitter, resizing and matching sizes, node creation and the palette, style edits and factoring, label edits, the properties edits, libraries, and edge edits: `edges.ts` (the core, ends, waypoints, new edges), `vertices.ts` (corners, Straighten, rewriting the code between two ends), `orthogonal.ts`, `curves.ts`, `split.ts` and `edgeop.ts` (an `edge` operation turned into `--`); `labels.ts` (adding and sliding edge labels, Yes/No on decisions), `edgeprops.ts` (the edge properties panel's edits) and `delete.ts` (deleting nodes, edges and paths); `group.ts` (dragging a multi-selection or a fit node, D78), `chains.ts` (writing a chain out so its nodes can be dragged, D79), `autolayout.ts` (auto-layout: elk.js decides layers and order, each node is written as a relation to an earlier one, D80; groups kept together when they would cross, and the opt-in reordering of statements, D87), `layoutworker.ts` and `layoutjobs.ts` (auto-layout and import run in a worker with progress and Cancel; only the worker loads elk.js, D87), `stylekeys.ts` (styles named like TikZ keys, with the list in `src/tikz/tikzkeys.ts`, D87) and `lanes.ts` (groups and swimlanes: fit boxes on the background layer, lanes sharing a top and bottom, membership, titles, and the upkeep that keeps lanes even after every visual edit, D81).
  - `src/import/`: import from Mermaid and Graphviz DOT (D84): `mermaid.ts` and `dot.ts` read into one model (`graph.ts`, with the color parsing), `tikz.ts` writes it as hand-style TikZ (styles per shape, names, groups as `fit` nodes, writing order), `index.ts` (`detectFormat`, `importDiagram`) runs the auto-layout with its `groups` option on the result, and `route.ts` bends the edges that would run through nodes. `src/edit/contrast.ts` is the WCAG AA check of text on fills (D85).
  - `src/engine/`: the accurate preview's engine (D66, D67): the worker and its client, the TeX runtime (`texlib.ts`), the compile input and line map (`input.ts`), the log reader (and where TeX put each named node, compared with the layout in `placement.ts`, D98), the DVI-to-SVG converter (`dvisvg.ts`) and its TFM and Type 1 readers.
  - `src/export/`: the exports (D72): `tex.ts` (standalone document, snippet), `svg.ts` (SVG made ready to save, PNG), `svg2pdf.ts` (SVG to PDF). `src/tikz/page.ts` works out `\textwidth` and `\columnwidth` from a preamble (D71).
  - `src/tikz/shapes.ts`: node shapes, anchors and borders; `NodeShape.rotate` turns a node about its center (D87).
  - `src/tikz/classes.ts`: the page each known document class gives (article, report, book, elsarticle, IEEEtran, revtex4-2, acmart, llncs), from its options (D73). `src/tikz/units.ts` holds the page lengths (`setPageLengths`) that `\textwidth` and the like read; `layoutPicture` sets them from `LayoutEnv.page`, which `pictureEnv` fills from `effectivePage` (the code's preamble, else the imported one, with typed widths over it).
  - `src/ui/files.ts` (Open and Save in place, imports, links and templates opened in a tab), `tabs.ts` (the tabs, D97: per-tab editor state and undo, autosave, Web Locks so one window edits a tab, the broadcast between windows, the localStorage journal for an interrupted close, Recently closed), `docs.ts` (the record and the decisions that need no browser), `kv.ts` (IndexedDB), `tabbar.tsx` (the tab bar and the read-only banner), `share.ts` and `sharepanel.tsx` (links with the code in the URL fragment), `pagesettings.ts` (the imported preamble, typed widths and named presets): D74.
  - `public/_headers`: the production headers, including the Content-Security-Policy that allows only this site's own files (D75). `vite preview` serves them too, so `npm run test:offline` runs under them.
  - `src/sw/sw.ts`: the service worker, compiled to `dist/sw.js` by a plugin in `vite.config.ts` (D70).
  - `src/ui/`: Preact components, the CodeMirror setup, and the store. `preview.ts` runs the TeX preview, `compiled.tsx` draws it on the canvas (D68). `layoutpanel.tsx` is the toolbar's Layout panel (D80), `grouppanel.tsx` the properties panel's groups and lanes section (D81), `importpanel.tsx` the toolbar's Import panel (D84; `files.ts` has `importSource`, which Open and dropping a file use too), `vision.ts` and `visionui.tsx` the grayscale and colorblind views (an SVG color matrix over the drawing, D85), `contrastmarks.tsx` the contrast markers and the panel's note (D85). `newpanel.tsx` is the toolbar's New menu and its `TemplateGrid` (D95). `firstrun.tsx` is the start screen shown while the code is empty (Paste TikZ, Start blank, Start from a template), `shortcuts.tsx` the `?` shortcut list, and `stalepatch.ts` the patch that keeps TeX's last picture on the canvas during edits and drags, with what changed cut out and drawn natively (`stalePicture` in `preview.ts`) (D96). The editor starts empty; the e2e base opens the Basic process template on a test's first `goto("/")`.
  - `test/`: Vitest tests, `test/e2e/` Playwright tests (import `test` from `test/e2e/base.ts`, which waits for the code pane after `goto`), and `test/fixtures/golden/`.
  - `engine/build/`: the CI engine build (D59, D66, D67): our pgf driver (`texinputs/`), format dump, sample compile and check, fonts, the package list, reference diagrams, packing, the kpsewhich stand-in, and the web2js patches. `engine/release.json` pins the release the app uses.
  - `spike/`: Milestone 0 engine code, plus the fidelity harness and probes (`npm run fidelity`) and the engine comparison pages (`compare.html`, `dvicheck.html`, `ours.html`).
  - `spike/swimlanes/`: the three swimlane code forms shown to the owner for M4 step 4 (D77 item 3).
- Shell quoting: backslashes in `node -e` and heredocs get mangled in this environment. Write files containing TeX or regexes with the editor tools, not shell one-liners.
- Encodings: Windows PowerShell 5.1's `Get-Content` reads a UTF-8 file without a BOM as ANSI, so a read-modify-write through it garbles every non-ASCII character (it turned `·` into `Ã‚Â·` in index.html once). Edit files with the editor tools, or with `sed`/`perl` in the Bash tool.
- Site layout (D92): `index.html` (home), `editor/index.html` (the app), `404.html`; `help/` (generated help pages, D99, from `src/help/*.md` with `scripts/lib/help.ts`; their script and search are `src/site/help.ts`, `helpsearch.ts`, `help.css`); `public/boot.js` (theme before first paint, old share links forwarded); `src/site/` (the site's script, CSS and committed pictures); `src/theme/` (tokens, fonts and the theme switch shared by the site and the editor, D91); `src/sw/pages.ts` (which kept page answers an address offline); `scripts/lib/compile.ts` (the engine in Node).
- Templates (D95): `src/templates/<id>.tex` (the nine of D95 and three neural networks of D100, and `blank.tex`), `catalog.ts` (ids, titles, blurbs; no TeX, so Node scripts can read it), `index.ts` (the code, bundled with `?raw`; `isPristine`). The home page's gallery in `index.html` must list the catalog in order (tested). The state machine relies on the `automata` styles and loops in `src/tikz/keys.ts` (`addAutomataStyles`, `builtinStyles`) and `src/tikz/layout.ts` (`automataArrow`, `loopFrom`); a loop is the edge form `loop` (`LOOP_REASON` in `src/model/edges.ts`).
