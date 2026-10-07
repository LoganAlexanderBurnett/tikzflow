# Project: TikZFlow — an interactive TikZ flowchart editor for the browser

## Your role
You are the lead engineer building this project end-to-end. Work in milestones. At the end of each milestone, stop and give me a short report: what works, what doesn't, how to try it, and any decisions you need from me. Do not start the next milestone until I approve. Keep a running `DECISIONS.md` (architecture choices and why) and `PROGRESS.md` (milestone status, known issues) in the repo root.

If something in this spec turns out to be infeasible or a bad idea once you're in the code, tell me and propose an alternative rather than silently working around it.

## Product goal
A free, static, fully client-side web app for creating and editing TikZ flowcharts. Users can either:
1. Paste existing TikZ code (a bare `tikzpicture` or a whole `.tex` document) and continue editing it visually, or
2. Start from a blank canvas and build a flowchart with drag and drop.

The code pane and the visual canvas are both live and editable at all times and stay in sync.

What makes it better than existing tools (TikZiT, TikzEdt, Mathcha, draw.io's TikZ export, etc.):
- **Lossless round-tripping.** Visual edits make minimal text edits. Comments, formatting, macros, and unsupported constructs are preserved exactly.
- **Human-quality output.** Relative positioning (`positioning` library), named styles in `\tikzset`, meaningful node names, and automatically managed `\usetikzlibrary` lines. Never dump absolute coordinates when a relational form exists.
- **Fast and accurate preview.** An instant native SVG preview, plus a real TeX compile in the background.

## Hard constraints
- 100% client-side. There is no backend, and user diagrams never leave the browser.
- Deployable as static files to Cloudflare Pages. Keep every individual file under 25 MB and split larger assets into chunks.
- Pasting code must never destroy user content. If parsing fails or a construct isn't understood, keep it verbatim.
- TypeScript throughout, strict mode.

## Tech stack (change only with justification in DECISIONS.md)
- Vite + TypeScript. A lightweight UI framework (Preact or Svelte) is fine, or none.
- CodeMirror 6 for the code editor.
- A Lezer grammar for the supported TikZ subset. It must be incremental, error-tolerant, and keep exact source ranges for every node so edits can be surgical.
- SVG for the canvas.
- KaTeX for math in node labels in the quick preview.
- elk.js for auto-layout.
- A WebAssembly TeX engine (evaluate busytex and SwiftLaTeX) running in a Web Worker for the accurate preview.
- Vitest for unit tests, Playwright for end-to-end tests.

## Architecture
- **Concrete syntax tree.** It is the single source of truth. Visual edits become small text patches applied to the source. The tree is never fully re-serialized, except when generating a brand-new diagram.
- **Opaque blocks.** Anything the editor can't model (`\foreach`, `pic`, custom macros, unknown options) becomes a locked opaque block. It is rendered by the TeX engine and selectable as a unit, but not editable visually.
- **Semantic model.** Derived from the tree: nodes (name, shape or style, label, position expression), edges (endpoints with anchors, waypoints, labels with `pos=`), styles, groups (`fit`), and libraries used.
- **Emitter rules.** These generate new code fragments in priority order:
  1. Relative positioning to a nearby node (`below=of a`, `right=1cm of b`).
  2. Perpendicular coordinates (`(a.east |- b.north)`) and `-|` / `|-` path operators.
  3. Coordinates relative to the edge's source (`++(0.8,0)`).
  4. Absolute coordinates, as a last resort or when the user explicitly locks a position.

## Features by milestone

### Milestone 0: Technical spike (do this first)
Prove the riskiest pieces before building the app:
- Compile a minimal TikZ flowchart to PDF or SVG in the browser with a WASM TeX engine, inside a Web Worker.
- Measure the download size of a curated package set: pgf/TikZ with the positioning, shapes, arrows.meta, fit, backgrounds, calc, and matrix libraries, plus standalone, amsmath, and Latin Modern fonts.
- Measure cold and warm compile times.
- Write a minimal Lezer grammar for `\node`, `\draw`, `\path`, and `\tikzset`, and confirm it can round-trip three sample files byte-for-byte.

Report the results and a recommendation on which engine to use. If WASM TeX isn't viable, propose a fallback, for example the native preview only plus a "compile on Overleaf" export.

### Milestone 1: Core loop
- A split view with the canvas and code pane side by side.
- Paste or open TikZ: extract the `tikzpicture` and relevant preamble parts (`\tikzset`, `\usetikzlibrary`, simple `\newcommand` macros) from a full document.
- Show a "what I understood" summary after parsing (for example, "12 nodes and 14 edges editable; 1 block kept as-is").
- Native SVG rendering of the supported subset, with KaTeX labels.
- Drag nodes. Writes back follow the emitter rules, and snapping and alignment guides encourage relational positions.
- Bidirectional selection sync: clicking a shape highlights its code, and moving the cursor in code highlights the shape.
- Undo and redo across both panes.
- Round-trip test suite: a corpus of at least 20 real-world TikZ flowcharts. Loading and saving without edits must be byte-identical. Single edits must produce minimal diffs, checked against golden files.

### Milestone 2: Creating from scratch and editing edges
- A shape palette with process, decision, terminal, I/O, connector, and document shapes. Each inserts a styled node, and the needed style is added to `\tikzset` if it's missing.
- Keyboard-driven creation: Tab adds a connected child, Enter adds a sibling, and typing edits the label.
- Edges attach to anchors and stay attached when nodes move.
- Right-click context menu on an edge: Add vertex here, Remove vertex, Straighten, Make orthogonal, Make curved, Change start/end anchor, and Add label here.
- Ghost handles at segment midpoints. Dragging one creates a vertex, and double-clicking a vertex removes it.
- Orthogonal mode: dragging a segment slides it perpendicular to itself and emits `|-` / `-|` chains.
- Curved mode: emits `bend left/right`, `to[out=,in=]`, or `.. controls ..` with draggable control points.
- Edge labels slide along the path and store `pos=`. Decision nodes get yes/no branch labels automatically.
- Style panel: editing a style updates every node that uses it. The panel detects repeated inline options and offers to factor them into a named style.
- Library management: `\usetikzlibrary` lines are added or removed automatically.

### Milestone 3: Accurate preview and export
- Integrate the WASM TeX engine. The quick SVG preview shows instantly, and the compiled output replaces it when ready.
- Lazy-load and cache the engine and packages with a service worker so it works offline after the first visit.
- Clearly show compile errors, mapped to source lines.
- Optionally import a user's preamble (macros, fonts, `\textwidth`), with a guide showing column width.
- Export as a standalone `.tex` file, a bare `tikzpicture` snippet, PDF, SVG, and PNG.
- Save and open: autosave to IndexedDB, the File System Access API in Chromium browsers, and a download/upload fallback elsewhere.
- Shareable links: compress the source into the URL hash. There is no server.

### Milestone 4: Layout and import
- Auto-layout with elk.js using a layered algorithm. Results are written back as relative positioning, not coordinates.
- Swimlanes and groups using `fit` and the `backgrounds` layer.
- Import from Mermaid flowcharts and Graphviz DOT.
- Accessibility: grayscale and colorblind preview modes, and contrast warnings for text on fills.

### Milestone 5: Polish and launch prep
- Onboarding: an empty state with a "Paste TikZ" button and a "Start blank" button, plus 3–5 example diagrams.
- Keyboard shortcut reference, plus light and dark themes.
- Performance target: smooth dragging with 200 nodes.
- A license audit of every bundled component (TeX packages, WASM engine, elk.js, KaTeX, and so on). Summarize the results in `THIRD_PARTY_LICENSES.md` and recommend a project license for me to choose.
- README with features, screenshots, local development setup, and deployment steps.
- A GitHub Actions workflow that runs the tests on every push.

### Later (do not build unless I ask)
Beamer overlay timeline, visual diff between versions, and natural-language edits via an API.

## Deployment (I will handle the account steps)
Prepare everything so deployment is push-to-publish: a Vite build to `dist/`, Cloudflare Pages settings documented in the README, and TeX assets chunked under the file-size limit (or documented for hosting on Cloudflare R2). I will create the GitHub repo and the Cloudflare account and connect them. Give me exact step-by-step instructions when we get there.

## Quality bar
- Never lose user content. Treat any round-trip diff on unedited code as a release-blocking bug.
- Generated TikZ should look like an experienced user wrote it by hand.
- Each milestone ends with passing tests and a working build I can run locally with `npm install && npm run dev`.

Start with Milestone 0. Before writing code, give me a brief plan for the spike and list any assumptions you're making.

## Working conventions
- Save this entire spec as `SPEC.md` in the repo root, and create a `CLAUDE.md` that summarizes the project, the conventions below, and points to SPEC.md, DECISIONS.md, and PROGRESS.md. Future sessions will start fresh, so these files must be enough to resume work.
- Commit after each meaningful step with clear messages. Push to GitHub at the end of each milestone.
- I'm on Windows. Keep all npm scripts and tooling cross-platform (no bash-only scripts).
- Test corpus: if you gather example TikZ code from the web (e.g., TeX Stack Exchange, which is CC BY-SA licensed), record the source URL and license for each file in `corpus/SOURCES.md`, since this repo will be public. Prefer examples you write yourself where attribution would be awkward.
- No analytics or tracking in the app.
- For the accurate-preview path, evaluate producing SVG (e.g., via dvisvgm) rather than PDF, so the compiled output can be overlaid precisely on the native canvas without bundling a PDF renderer.
