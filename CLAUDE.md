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
- Commit after each meaningful step with clear messages. Push to `origin` (branch `trunk`) at the end of each milestone.
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
- Test inputs under `corpus/` and any `fixtures/` folder must stay byte-exact. `.gitattributes` marks them `-text` so git never rewrites their line endings.
- For every corpus file taken from the web, record the source URL and license in `corpus/SOURCES.md`, because the repo is public. Prefer self-written examples.

## Repo
- Remote: `origin` → https://github.com/LoganAlexanderBurnett/tikzflow (default branch `trunk`).
- Commands:
  - `npm run dev`: starts the Vite dev server with the app at http://localhost:5173. The grammar playground is at `/src/debug/grammar.html`.
  - `npm test`: runs Vitest. This includes the corpus round-trip tests, the interpreter and move tests, and the golden minimal-diff tests.
  - `npm run test:e2e`: runs the Playwright end-to-end tests in Edge. It starts its own dev server on port 5174.
  - `npm run typecheck`: runs strict `tsc`. `npm run build` type-checks and builds to `dist/`.
  - `npm run grammar`: regenerates the parser. It runs automatically before dev, test, build and typecheck.
  - `npm run grammar:inspect`: prints byte coverage and parse errors for each corpus file.
  - `npm run grammar:bench`: runs the parse benchmark.
  - `npm run corpus:report [-- <filter>] [-- -v]`: lays out every corpus picture and prints the "what I understood" summary. `-v` adds locked nodes and node geometry.
  - `npm run layout:bench`: times the model, layout, snapping and a move on a 200-node picture.
  - `UPDATE_GOLDEN=1 npx vitest run test/golden.test.ts`: regenerates `test/fixtures/golden/`. Review the result with `npm run golden:review` before committing.
  - `UPDATE_GOLDEN=1 npx vitest run test/golden-edges.test.ts`: regenerates `test/fixtures/golden/edges/`, the golden files for edge edits (dashed, label, orthogonal, curved, delete).
  - `npm run fidelity [-- --only=<file>] [-- --verbose]`: compiles the corpus and `spike/engines/probes/*.tex` with pdfTeX (busytex) and compares node anchors, and labels written inside paths, with the native layout. It writes `spike/engines/results/fidelity.json`. It needs `npm run fetch-engines` and `node scripts/pack-texmf.ts` first. When unsure how TikZ behaves, add a probe here rather than guessing (D23).
  - `npm run test:offline`: builds the app, serves it with `vite preview` and runs the Playwright offline tests (`test/offline/`, D70): visit once, switch the network off, reload. The service worker exists only in production builds.
  - `npm run pdfcheck [-- --set=corpus] [-- --only=<name>]`: compiles the comparison diagrams (or every corpus picture) with our engine, converts the SVG to PDF with `src/export/svg2pdf.ts`, and diffs pdf.js's drawing of the PDF against the browser's drawing of the SVG (D72). Needs the engine.
  - `npm run gen:font-metrics`: regenerates `src/text/fontMetrics.ts` from KaTeX. Run it after upgrading KaTeX.
  - `npm run fetch-engines -- engine`: downloads the accurate preview's engine, the release pinned in `engine/release.json`, checks its SHA-256 and unpacks it into `vendor/engine/<tag>/` (10.8 MB). The dev server serves it as `/engine/<tag>/` and the build copies it into `dist/`. Without it the app runs with the quick preview only. `npm run fetch-engines` with no group also downloads the M0 engines and CTAN packages listed in `scripts/engine-manifest.ts`, recording sizes and hashes in `vendor/LOCK.json`.
  - `node scripts/pack-texmf.ts`: builds `vendor/packs/tikz-flat.json`, which busytex needs.
  - `npm run bench-engines -- tikzjax busytex`: runs the Playwright engine benchmark in Edge. Results go to `spike/engines/results/`.
  - Engine bench page: `/spike/engines/bench.html?engine=tikzjax|busytex|swiftlatex`. Output viewer: `/spike/engines/view.html?files=busytex.pdf,tikzjax.svg`.
  - Engine CI (D59, D66, D67): `.github/workflows/engine.yml` builds `tex.wasm`, the format (with our driver `engine/build/texinputs/pgfsys-tikzflow.def`), the fonts, the package files (`engine/build/packages.txt`) and `engine.tar` on pushes to `m3-engine-ci`, plus reference SVGs from the real dvisvgm. A tag `engine-*` also publishes a GitHub prerelease; to adopt it, put its tag, the tar's size and SHA-256 (from its `manifest.json`) in `engine/release.json`. To try a run's files before releasing:
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
  - `src/tikz/`: the TikZ interpreter: units, colours, keys and styles, coordinates, shapes, and layout.
  - `src/text/`: label typesetting.
  - `src/edit/`: text changes (and merging two edits into one), snapping, the move planner and emitter, resizing and matching sizes, node creation and the palette, style edits and factoring, label edits, the properties edits, libraries, and edge edits: `edges.ts` (the core, ends, waypoints, new edges), `vertices.ts` (corners, Straighten, rewriting the code between two ends), `orthogonal.ts`, `curves.ts`, `split.ts` and `edgeop.ts` (an `edge` operation turned into `--`); `labels.ts` (adding and sliding edge labels, Yes/No on decisions), `edgeprops.ts` (the edge properties panel's edits) and `delete.ts` (deleting nodes, edges and paths).
  - `src/engine/`: the accurate preview's engine (D66, D67): the worker and its client, the TeX runtime (`texlib.ts`), the compile input and line map (`input.ts`), the log reader, the DVI-to-SVG converter (`dvisvg.ts`) and its TFM and Type 1 readers.
  - `src/export/`: the exports (D72): `tex.ts` (standalone document, snippet), `svg.ts` (SVG made ready to save, PNG), `svg2pdf.ts` (SVG to PDF). `src/tikz/page.ts` works out `\textwidth` and `\columnwidth` from a preamble (D71).
  - `src/sw/sw.ts`: the service worker, compiled to `dist/sw.js` by a plugin in `vite.config.ts` (D70).
  - `src/ui/`: Preact components, the CodeMirror setup, and the store. `preview.ts` runs the TeX preview, `compiled.tsx` draws it on the canvas (D68).
  - `test/`: Vitest tests, `test/e2e/` Playwright tests, and `test/fixtures/golden/`.
  - `engine/build/`: the CI engine build (D59, D66, D67): our pgf driver (`texinputs/`), format dump, sample compile and check, fonts, the package list, reference diagrams, packing, the kpsewhich stand-in, and the web2js patches. `engine/release.json` pins the release the app uses.
  - `spike/`: Milestone 0 engine code, plus the fidelity harness and probes (`npm run fidelity`) and the engine comparison pages (`compare.html`, `dvicheck.html`, `ours.html`).
- Shell quoting: backslashes in `node -e` and heredocs get mangled in this environment. Write files containing TeX or regexes with the editor tools, not shell one-liners.
