# TikZFlow

A free, static, fully client-side web app for creating and editing TikZ flowcharts. The code pane and the visual canvas are both live and stay in sync. Its main selling point is lossless round-tripping: visual edits become minimal text patches, and anything the editor doesn't understand is kept verbatim.

## Start of every session
1. Read [PROGRESS.md](PROGRESS.md) for the current milestone, its status, and known issues.
2. Read [DECISIONS.md](DECISIONS.md) before changing architecture, stack, or conventions.
3. [SPEC.md](SPEC.md) holds the full requirements. Change it only when the owner approves. Then log the change in its "Spec revisions" section and the reasons in DECISIONS.md.

## Workflow
- Work one milestone at a time. At the end of each, stop and report what works, what doesn't, how to try it, and which decisions are needed. Wait for approval before starting the next milestone.
- If part of the spec proves infeasible or a bad idea, say so and propose an alternative. Never work around it silently.
- Commit after each meaningful step with clear messages. Push to `origin` (branch `trunk`) at the end of each milestone.
- Keep DECISIONS.md and PROGRESS.md current as you go, not only at the end of a milestone.
- Don't build the "Later" features in SPEC.md unless asked.
- Before downloading engine binaries or TeX packages, list each file's source and size. These assets go in a gitignored folder and never into git.
- Don't choose a project license until the engine licenses are confirmed.

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
  - `npm run dev`: starts the Vite dev server, currently the grammar playground.
  - `npm test`: runs Vitest.
  - `npm run typecheck`: runs strict `tsc`.
  - `npm run grammar`: regenerates the parser. It runs automatically before dev, test, build and typecheck.
  - `npm run grammar:inspect`: prints coverage and error details for each fixture.
  - `node spike/grammar/bench.ts`: runs the parse benchmark. Node 24 runs `.ts` files directly.
  - `npm run fetch-engines`: downloads the engines and CTAN packages listed in `scripts/engine-manifest.ts` into the gitignored `vendor/` folder, recording sizes and hashes in `vendor/LOCK.json`.
  - `node scripts/pack-texmf.ts`: builds `vendor/packs/tikz-flat.json`, which busytex needs.
  - `npm run bench-engines -- tikzjax busytex`: runs the Playwright engine benchmark in Edge. Results go to `spike/engines/results/`.
  - Engine bench page: `/spike/engines/bench.html?engine=tikzjax|busytex|swiftlatex`. Output viewer: `/spike/engines/view.html?files=busytex.pdf,tikzjax.svg`.
- Layout: `spike/` holds throwaway Milestone 0 code. The generated `spike/grammar/parser*.ts` files are gitignored.
