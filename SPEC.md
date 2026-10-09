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
- Deployable as static files to Cloudflare Pages. Keep every individual file under 25 MB and split larger assets into chunks. Keep the total file count within the Pages per-deployment limit by bundling many small files (such as TeX package trees) into packs.
- Pasting code must never destroy user content. If parsing fails or a construct isn't understood, keep it verbatim.
- TypeScript throughout, strict mode.

## Tech stack (change only with justification in DECISIONS.md)
- Vite + TypeScript. A lightweight UI framework (Preact or Svelte) is fine, or none.
- CodeMirror 6 for the code editor.
- A Lezer grammar for the supported TikZ subset. It must be incremental, error-tolerant, and keep exact source ranges for every node so edits can be surgical.
- SVG for the canvas.
- KaTeX for math in node labels in the quick preview.
- elk.js for auto-layout.
- A WebAssembly TeX engine (evaluate busytex, SwiftLaTeX, and TikZJax) running in a Web Worker for the accurate preview.
- Vitest for unit tests, Playwright for end-to-end tests.

## Architecture
- **Concrete syntax tree.** It is the single source of truth. Visual edits become small text patches applied to the source. The tree is never fully re-serialized, except when generating a brand-new diagram. A fixed grammar can't fully parse TeX, because catcode changes and macros can alter meaning. The grammar recognises the TikZ commands it knows, and everything else falls through to opaque blocks.
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
- Compile a minimal TikZ flowchart to PDF or SVG in the browser with a WASM TeX engine, inside a Web Worker. Evaluate busytex, SwiftLaTeX, and TikZJax.
- Measure the download size of a curated package set: pgf/TikZ with the positioning, shapes, arrows.meta, fit, backgrounds, calc, and matrix libraries, plus standalone, amsmath, and Latin Modern fonts. Also report the largest single file and the total file count.
- Measure cold and warm compile times.
- For each engine, report the pgf/TikZ version it ships with, and confirm that every library listed above actually loads (especially arrows.meta and positioning).
- For each engine, confirm its license.
- Timebox each engine. If one won't compile the sample after a reasonable effort, document what failed and move on.
- Write a minimal Lezer grammar for `\node`, `\draw`, `\path`, and `\tikzset`. On three sample files, confirm that:
  - the tree's leaves cover every byte of the source exactly once, with no gaps and no overlaps, so joining them reproduces the file;
  - the report shows how much of each file is modelled structure rather than catch-all or error nodes;
  - an incremental reparse after an edit gives the same tree as a full parse.

Report the results and a recommendation on which engine to use. If WASM TeX isn't viable, propose a fallback, for example the native preview only plus a "compile on Overleaf" export.

### Milestone 1: Core loop
- A split view with the canvas and code pane side by side.
- Paste or open TikZ: extract the `tikzpicture` and relevant preamble parts (`\tikzset`, `\usetikzlibrary`, simple `\newcommand` macros) from a full document.
- Show a "what I understood" summary after parsing (for example, "12 nodes and 14 edges editable; 1 block kept as-is").
- Native SVG rendering of the supported subset, with KaTeX labels.
- Drag nodes. Writes back follow the emitter rules, and snapping and alignment guides encourage relational positions.
- Bidirectional selection sync: clicking a shape highlights its code, and moving the cursor in code highlights the shape.
- Undo and redo across both panes.
- Round-trip test suite: a corpus of at least 20 real-world TikZ flowcharts. For every file:
  - The syntax tree must cover every byte exactly once.
  - Loading and saving without edits must be byte-identical. This holds by construction, so it is only a cheap regression guard.
  - Single edits must produce minimal diffs, checked against golden files. Only the bytes the edit is about may change.

### Milestone 2: Creating from scratch and editing edges
Milestone 2 is split in two, each ending with its own report and approval checkpoint.

#### Milestone 2a: Creating and editing nodes and styles
Fixes from testing Milestone 1, done first:
- Locked nodes get a plain-language explanation. For an unresolved reference, it says LaTeX would fail too. It offers one-click fixes: "Pin at current position" (writes absolute coordinates) or "Attach to another node".
- The syntax-error count in the summary is clickable and jumps to each error's line.
- The summary lists undefined node references, including those inside `\draw` paths.
- `\coordinate` markers show their name on hover. Unused coordinates are visibly distinguished.
- Nodes with options the native preview can't draw get a subtle visual marker.
- Repeated nudges update an existing `xshift`/`yshift` rather than adding more. A nudge that lands exactly on a clean relation drops the shift entirely.

New features:
- A shape palette with process, decision, terminal, I/O, connector, and document shapes. Each inserts a styled node, and the needed style is added to `\tikzset` if it's missing. The document's own node styles also appear as palette entries, so extending an existing figure keeps its look.
- Keyboard-driven creation: Tab adds a connected child, Enter adds a sibling, and typing edits the label.
- Generated node names are unique. Labels that are pure math or have no usable words get a sensible fallback name.
- Double-click a node to edit its label in place.
- Resize nodes by dragging corners or sides.
  - This writes `minimum width`/`minimum height`, or `text width` when the drag should rewrap the text.
  - Sizes snap to round values (such as whole millimetres) and to the sizes of other nodes. Values like `86.0000007pt` are never emitted.
  - The edge or corner opposite the handle stays where it is, as in PowerPoint or Figma. Where the node's anchor already holds it, only the size is written; otherwise the position is updated in the same edit, relationally where possible. Ctrl (Cmd on a Mac) resizes from the centre.
  - Resizing is one node at a time. With several nodes selected, "Match width" and "Match height" copy the first selected node's size to the others, following the node-or-style scope.
- A properties panel for the selected node or nodes: fill colour, outline colour, text colour, font (size, bold, italic, and family: `\rmfamily`, `\sffamily`, `\ttfamily`), and alignment (left, centre, right, justify).
  - Every change asks whether it applies to this node only or to its style (for example "all State nodes"). "All" edits the `\tikzset` style cleanly instead of copying options onto each node.
  - The colour picker offers the document's existing `\definecolor` names first, then common xcolor mixes (`blue!20` and so on), then a custom colour. A custom colour can be named and added as a `\definecolor` rather than written as raw RGB.
  - Justify needs a text width. The panel either sets one or explains why the option is disabled.
- Multi-select (Shift-click) applies a change to all selected nodes at once.
- Style panel: editing a style updates every node that uses it. The panel detects repeated inline options and offers to factor them into a named style.
- Library management: `\usetikzlibrary` lines are added or removed automatically.

#### Milestone 2b: Editing edges
- Edges attach to anchors and stay attached when nodes move.
- Right-click context menu on an edge: Add vertex here, Remove vertex, Straighten, Make orthogonal, Make curved, Change start/end anchor, and Add label here.
- Ghost handles at segment midpoints. Dragging one creates a vertex, and double-clicking a vertex removes it.
- Orthogonal mode: dragging a segment slides it perpendicular to itself and emits `|-` / `-|` chains.
- Curved mode: emits `bend left/right`, `to[out=,in=]`, or `.. controls ..` with draggable control points.
- Edge labels slide along the path and store `pos=`. Decision nodes get yes/no branch labels automatically.
- Dragging an edge's endpoint onto a different node reconnects it. Dragging from a node's anchor to another node draws a new edge.
  - An end shared by two edges of one `\draw` can't be dragged. A "Split into separate edges" context-menu action splits the path into separate `\draw` statements and keeps the arrow tips where they were (with `->`, only the last piece keeps the tip). The refusal message explains this option.
  - An end dropped on a node defined later in the code moves the edge's `\draw` below that node when that is safe (the moved statement defines no nodes or coordinates used elsewhere); otherwise it is refused with a reason.
- An edge properties panel: arrow direction and tips, dashed/dotted, colour and line width, with the same "this edge / its style" scope toggle as nodes.
- Delete removes the selected nodes or edges. Deleting a node never leaves undefined references: nodes positioned relative to it are re-attached to whatever it was positioned against, or pinned at their current position if that isn't possible. Edges that would be left dangling are deleted too.
- Defaults: "Make curved" writes a plain `bend left`; "Make orthogonal" uses a single-corner route (`|-` or `-|`) where it can.

### Milestone 3: Accurate preview and export
Fixes from testing Milestone 2b, done early (after the engine feasibility check):
- Deleting a node that is in another node's `fit` removes it from the `fit=` list. Only the fit's last member is refused.
- The edge panel offers "Split and apply" when an arrow tip is set on one edge of a `\draw` with several edges.
- Changing an edge's form (straight, orthogonal, curved) turns a label side key that would then overlap the line into `auto`, by the same rule as dragging a label. Dragging one of the edge's corners, curve handles, segments or ends does the same, in the same undo step. Moving a node never rewrites labels; a label that its line cuts through instead shows a subtle warning marker with a one-click fix (Flip / `auto`).
- "Flip label side" on a label with no side key writes `auto`.

Features:
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
- Make chain nodes (`on chain`) draggable by converting them to explicit positioning.
- Drag a multi-selection as a group.
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
- Never lose user content. Treat any round-trip diff on unedited code, any byte not covered by the syntax tree, or any edit that changes bytes outside its target as a release-blocking bug.
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
- Don't choose a project license until the engine licenses are confirmed.

## Spec revisions
- **2026-10-07** (approved by the project owner; reasons in DECISIONS.md D3–D7):
  - Replaced byte-identical round-trip checks with byte coverage plus minimal-diff checks.
  - Added TikZJax to the engine evaluation.
  - Added the pgf version, library-loading, license, and timebox requirements to Milestone 0.
  - Added the Cloudflare Pages file-count constraint.
  - Recorded the limits of parsing TeX with a fixed grammar.
- **2026-10-07, after the Milestone 1 review** (approved by the project owner; reasons in DECISIONS.md D31–D33):
  - Split Milestone 2 into 2a (nodes and styles) and 2b (edges), each with its own checkpoint. Library management and the style panel moved to 2a.
  - Added to the start of 2a: fixes from testing Milestone 1 (locked-node explanations and one-click fixes, clickable syntax errors, undefined references in the summary, coordinate markers, a marker for undrawable options, and refined nudge shifts).
  - Added to 2a: resizing nodes, a properties panel with node-or-style scope and a colour picker, in-place label editing, and multi-select.
  - Added to Milestone 4: dragging chain nodes by converting them to explicit positioning.
- **2026-10-07, approving the Milestone 2a plan** (approved by the project owner; reasons in DECISIONS.md D34):
  - Added to 2a: the document's own node styles appear as palette entries; generated node names are unique, with a fallback for labels without usable words.
  - Added to Milestone 4: dragging a multi-selection as a group.
- **2026-10-07, after Milestone 2a steps 4–5** (approved by the project owner; reasons in DECISIONS.md D40 and D42):
  - Resizing keeps the opposite edge fixed, and Ctrl resizes from the centre.
  - Resizing several nodes together is replaced by "Match width" and "Match height" in the properties panel.
- **2026-10-07, approving the Milestone 2b plan** (approved by the project owner; reasons in DECISIONS.md D44 and D45):
  - Added to 2b: reconnecting an edge by dragging its endpoint to another node, drawing a new edge from a node's anchor, an edge properties panel with edge-or-style scope, and Delete for nodes and edges, which re-attaches or pins dependent nodes and removes dangling edges.
  - Recorded the 2b defaults: plain `bend left` and single-corner orthogonal routes.
- **2026-10-07, after Milestone 2b steps 1–3** (approved by the project owner; reasons in DECISIONS.md D49):
  - Added to 2b: "Split into separate edges" for ends shared by two edges, and moving an edge's `\draw` below a node defined later when an end is dropped on it.
- **2026-10-08, after Milestone 2b steps 4–6** (approved by the project owner; reasons in DECISIONS.md D53):
  - Curves are edited with a handle near each end (writing `out=`/`in=`) and one in the middle (keeping a bend symmetric). Alt keeps its meaning of "no snapping".
  - Make orthogonal and adding a corner convert an `edge` operation into `--`, in its own `\draw` if needed.
  - Split writes `[-]` only to override an arrow tip inherited from a style or the picture.
- **2026-10-08, Milestone 2b steps 7–10** (approved by the project owner; reasons in DECISIONS.md D54–D56 and D58):
  - Edge labels: "Add label here" writes the label before the clicked segment's end with `pos=` where needed; dragging writes `pos=`; Yes/No go on the first two branches out of a decision, following the figure's own wording.
  - The edge properties panel keeps the form an edge already uses, doesn't repeat inherited values, and loads `arrows.meta` when a tip needs it. A tip on one edge of a multi-edge `\draw` is refused with a pointer to Split.
  - Delete re-attaches dependent nodes with the move planner or pins them, rewrites corners written relative to the deleted node, and lists what it refuses and why.
- **2026-10-08, after the owner's testing of Milestone 2b** (approved by the project owner; reasons in DECISIONS.md D57):
  - The edge menu always shows the same items in the same order, ticks the edge's current form, and gives a reason for each disabled item. Menus stay inside the window.
  - Labels are written with `auto`/`auto, swap` instead of a side key. A "Flip label side" action was added, and dragging a label onto a part of the line that would cut through it turns its side key into `auto`.
- **2026-10-08, the Milestone 2b review** (approved by the project owner; reasons in DECISIONS.md D58):
  - No Yes/No is added when a decision's first branch is unlabelled.
  - Added to the start of Milestone 3: removing a deleted node from a `fit=` list, "Split and apply" for arrow tips, `auto` labels after a form change, and Flip on a label with no side key.
- **2026-10-09, after Milestone 3 steps 2–5** (decided by the project owner; reasons in DECISIONS.md D65):
  - Dragging an edge's corners, curve handles, segments or ends also turns an overlapping label side key into `auto`. Moving a node doesn't; overlapping labels get a warning marker with a one-click fix instead.
