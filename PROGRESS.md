# Progress

## Current status
**Milestone 1 (core loop): done and approved (2026-10-07).** The owner's answers and refinements are in DECISIONS.md D31.

Milestone 0 is done and was approved on 2026-10-07:
- **License:** GPL-3.0-or-later (D14).
- **Engine:** TikZJax, with our own build in Milestone 3 (D13, D15).
- **Preview fonts:** always Computer Modern (D16).

**Milestone 2a (nodes and styles): done and approved (2026-10-07).** The owner tested it by hand; their answers are in DECISIONS.md D44 and "M2a review" below.

**Now:** Milestone 2b (edges). The plan was approved on 2026-10-07 (D45). Steps 1–3 were reviewed and approved (D49). Steps 4–6 are done (report below) and waiting for the owner's review; step 7 hasn't been started. Milestone 2 was split into 2a and 2b, each with its own checkpoint (D32). The full list is in SPEC.md, "Milestone 2b". Also read the "Notes for later milestones" below.

**Session stopped by the owner on 2026-10-08, part-way through the owner's follow-up decisions on steps 4–6 (D53). Steps 7–10 were not started. Nothing was pushed.** See "Where things stand" below.

## Where things stand (stopped 2026-10-08, not pushed)
The owner approved steps 4–6 after testing and gave five decisions (D53). Then asked for steps 7–10 to be done in one go, with a commit after each. The session was stopped before step 7.

### Done and committed
- **Decision 2: curve handles, no Alt (commit "curve end handles and a middle handle").** A handle near each end writes only that end's `out=`/`in=` (edited in place when already written that way; a bend turns into `out`/`in`). A middle handle keeps the curve symmetric: a bend changes its angle (5°, or 1° with Alt) and only raises `looseness` when 85° isn't enough; an `out`/`in` curve keeps its angles and scales both loosenesses. `.. controls ..` curves keep their two control-point handles. Alt now only turns snapping off. Code: `planCurve` in `src/edit/curves.ts` (replaces `planControl`), handles in `src/ui/canvas.tsx`. `test/curves.test.ts` rewritten (16 tests) and two Playwright tests in `test/e2e/edges.spec.ts` (all 21 edge tests passed when run).
- **Decision 5: Split writes `[-]` only when needed (commit "Split into separate edges: write [-] only when…").** A piece that loses every tip drops the arrow key (`\draw (a) -- (b);`); if the picture's or a style's own arrow would come back, it retries with `-`. Tests updated and added in `test/edge-ends.test.ts`; the Split Playwright test passes.
- **Decisions 1 and 3** (5° bends, shifted anchors) needed no code.
- **D53** is in DECISIONS.md.

### Half-finished: decision 4, converting `edge` operations to `--` (committed as a work-in-progress commit)
- **Written:** `src/edit/edgeop.ts` (`planEdgeToLine`, `viaLine`). It converts an `edge` operation to `--` in place when the statement holds only that edge (`\path` becomes `\draw`, the edge's options except curve/route keys join the statement's), or into its own `\draw` after the statement when other code shares it, then checks by re-layout that every other path, the node positions and the edge's look (colour, width, dash, opacity, tip count) are unchanged; `every edge` styling is written out if needed. `planMakeOrthogonal` (`src/edit/orthogonal.ts`) and `planAddVertex` (`src/edit/vertices.ts`) call it first and return one combined change set, a note ("converted the "edge" operation…") and `edgeId`. `EditOutcome` gained an optional `edgeId`.
- **Tests:** `test/edgeop.test.ts` (13 tests). 12 pass.
- **Known failures (2 of 676 Vitest tests):**
  1. `test/edgeop.test.ts` corpus sweep: `composeChanges` (`src/edit/changes.ts`) throws "Mismatched change set lengths" on `corpus/self-bare-crlf.tex`. CodeMirror counts a CRLF line break as one character, while our positions count two, so composing changes whose inserted text contains `
` is wrong. This is a latent bug in `composeChanges` (also used by resizing). I was checking how `text.value` is derived (`src/ui/store.ts:101` uses `state.doc.toString()`, which gives `
`, so the app may not see CRLF at all; the tests do). Likely fix: compose without CodeMirror's ChangeSet, or normalise line breaks before composing. I also sorted the specs in `composeChanges` (unsorted specs were read as following on from earlier ones).
  2. `test/vertices.test.ts` "refuses curves, orthogonal pieces and edge operations": the `draw (a) edge (b);` case now converts instead of refusing. The test needs updating (keep the other two cases).
- **Not done for this decision:** UI wiring. Ghost handles still skip edge operations (`canvas.tsx`, `isEdgeOperation` check near line 164), the menu items "Add vertex here" and "Make orthogonal" still say edge operations can't (`src/ui/edgemenu.tsx`), `store.ts` doesn't show the conversion note or select `r.edgeId` after the edit, the Playwright tests, and the "Known limits" lines in this file. The D53 text says item 4 is implemented; it is only partly (see above).
- `npm run typecheck` fails on two lines in `test/edgeop.test.ts` (`moved` isn't in the `ok()` helper's return type). Trivial fix.

### Next, in order
1. Fix the CRLF compose bug, the typecheck error and the `vertices.test.ts` expectation; finish the UI wiring and an e2e test for decision 4; update D53's wording and the known limits; commit.
2. Steps 7–10 as in the plan table (edge labels, edge properties panel, delete, polish/e2e/goldens/docs/report). Then push to `origin` `trunk` and report on all of Milestone 2b.

## M2b plan and status
| Step | Content | Status |
|---|---|---|
| 1 | Edge model and selection; Tab names an unnamed parent (D44, D46) | Done |
| 2 | Edge-editing core and waypoint emitter (D47) | Done |
| 3 | Anchors: endpoint handles, reconnecting, change anchor, drawing new edges (D48) | Done |
| 4 | Vertices: ghost handles, add/remove, Straighten; split a \draw, move an edge below a later node (D49, D50) | Done |
| 5 | Orthogonal mode: Make orthogonal, sliding segments (D51) | Done |
| 6 | Curved mode: Make curved, control points (D52) | Done |
| 7 | Edge labels: add, slide (`pos=`), yes/no on decisions | Not started |
| 8 | Edge properties panel with edge-or-style scope | Not started |
| 9 | Delete nodes and edges (re-attach or pin dependents, drop dangling edges) | Not started |
| 10 | Context menu polish, end-to-end tests, goldens, sweep, docs, report, push | Not started |

## M2b steps 4–6 (2026-10-08)
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

### Known limits (steps 4–6)
- **Corners go on straight segments only.** A curved segment is straightened first; orthogonal edges slide their segments instead of showing corners.
- **`edge` operations** (`(a) edge (b)`) join their ends directly: they can be curved and straightened, but can't get corners or an orthogonal route.
- **Rewriting the code between two ends** (Straighten, Make orthogonal, Make curved, sliding) is refused when the path has options in the middle (they apply to all of it) or an `edge` operation there.
- **Labels on a rewritten edge** go after the piece they are nearest; their `pos=` isn't adjusted yet (step 7).
- **Make orthogonal** checks only node boxes for crossings, not labels or other edges, and its fallback is two corners through the middle.
- **Rounding:** corners and shifts in whole millimetres; bend angles to 5°, `out`/`in` to 1°, looseness to 0.1. A border angle (`(a.34)`) can sit up to about 0.3 pt off the line it was slid to.
- **`rounded corners`** don't change a rectangle's border in TikZ, so a slid edge meets a terminal's side where the sharp rectangle would be, a fraction of a millimetre outside the drawn curve. pdfTeX draws it the same way.
- **A dragged curve replaces the curve keys it finds** (`distance`, `min distance` and the like, which the preview doesn't draw yet) with what it writes. Other keys stay.
- **`.. controls ..` is never introduced,** only kept.
- **Split** is refused when tips on both ends come from a style, when the arrow key is set in the middle of the path, and for paths with `edge` operations.
- **Moving an edge below a later node** is refused inside a scope and for `\node ... edge` statements.

### Decisions for you
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
| M2b: Editing edges | In progress (plan approved 2026-10-07) |
| M3: Accurate preview and export | Not started |
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
