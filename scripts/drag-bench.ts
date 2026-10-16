// The drag benchmark (M6 step 0, D102): drags on the canvas of a production build in Edge, with the
// frame times measured in the page. The target (D102 item 1), on the 200-node, 250-edge picture:
// - 60 fps: 95% of frames presented on the next frame (interval under 16.7 ms, plus 10% for jitter),
//   and no task over 50 ms, for node, group (20 nodes), corner and resize drags, TeX preview off and on;
// - 30 fps with the CPU slowed 4×: 95% of intervals under 33.3 ms (plus 10%);
// - the drop (writing the code, to the next frame) under 100 ms.
// The 500-node picture and the dense 4–16–16–4 network are measured only.
//
// Usage: npm run drag:bench [-- options]
//   --no-build        serve the dist/ there is (default: build first)
//   --only=<picture>  200, 500 or dense (repeatable; default: all)
//   --modes=quick,tex the preview modes (default both; tex needs the engine)
//   --throttle=1,4    CPU slowdowns (default both)
//   --interactions=node,group,corner,resize  the drags (default: all the picture has; with --profile, the first)
// Debugging (D108): BENCH_QUERY=?x adds a query to the editor's address; with --profile, BENCH_MUTATIONS=<n>
// lists the n most frequent DOM changes after the pointerup and traces why the browser lays things out
// (profile-<mode>.trace.json).
//   --headless        run Edge headless (default: a window, so frames are paced and drawn as for a user)
//   --label=<name>    save the results to spike/perf/results/<name>.json
//   --profile         instead: one node drag on the 200-node picture in a build that isn't minified,
//                     with a CPU profile (by source and function) and a trace (script, style, layout,
//                     paint and GC per frame)
//   --drop            with --profile: profile and trace only the drop, from just before the pointerup

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { type Browser, type CDPSession, chromium, type Page } from "@playwright/test";
import { SourceMapConsumer } from "source-map-js";
import { build, preview } from "vite";
import { encodeShare } from "../src/ui/share.ts";
import { BENCH_200, BENCH_500, DENSE_4_16_16_4 } from "./lib/benchpictures.ts";

const root = join(import.meta.dirname, "..");
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => args.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3));
const list = (name: string, all: string[]) => (opt(name).length ? opt(name).flatMap((v) => v.split(",")) : all);

const PORT = 5176;
const BASE = `http://localhost:${PORT}`;
// A large window on the owner's screen (3840×2160 at 150%, 60 Hz): 1920×1080 CSS pixels drawn at 1.5×.
const VIEWPORT = { width: 1920, height: 1080 };
const SCALE = 1.5;
const FRAME = 1000 / 60;

type Interaction = "node" | "group" | "corner" | "resize";
interface PictureCase {
  key: string;
  title: string;
  text: string;
  target: string;
  interactions: Interaction[];
  /** Measured only, not held to the target. */
  measureOnly: boolean;
}
const PICTURES: PictureCase[] = [
  { key: "200", title: "200 nodes, 250 edges", text: BENCH_200, target: "n100", interactions: ["node", "group", "corner", "resize"], measureOnly: false },
  { key: "500", title: "500 nodes, 600 edges", text: BENCH_500, target: "n250", interactions: ["node"], measureOnly: true },
  { key: "dense", title: "dense 4-16-16-4 (40 nodes, 384 edges)", text: DENSE_4_16_16_4, target: "l1n7", interactions: ["node"], measureOnly: true },
];

interface Result {
  picture: string;
  mode: string;
  throttle: number;
  interaction: Interaction;
  frames: number;
  moves: number;
  /** One update (a move drawn in its own frame): median and 95th percentile, and the mean by kind of work. */
  update50: number;
  update95: number;
  breakdown: Record<string, number>;
  p50: number;
  p95: number;
  max: number;
  /** Share of frame intervals within one frame (60 fps) and within two (30 fps). */
  within60: number;
  within30: number;
  longTasks: number;
  longestTask: number;
  drop: number | null;
  /** The window was hidden, or frames came a second apart (a covered window): the run is not valid. */
  throttled: boolean;
  /** The page was hidden (document.hidden) at some point of the drag. */
  hidden: boolean;
  status: string;
  pass: boolean | null;
}

// ---------------------------------------------------------------- the page's own measurements

/** Installed before the app: a frame loop, long tasks, and the time from the drop to the next frame. */
function instrument() {
  type B = { on: boolean; start: number; end: number; frames: number[]; long: { start: number; dur: number }[]; moves: number; armDrop: boolean; drop: number | null; hidden: boolean };
  const b: B = { on: false, start: 0, end: 0, frames: [], long: [], moves: 0, armDrop: false, drop: null, hidden: false };
  (window as unknown as { __bench: B }).__bench = b;
  const loop = (t: number) => {
    if (b.on) b.frames.push(t);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) b.long.push({ start: e.startTime, dur: e.duration });
    }).observe({ type: "longtask" });
  } catch {
    // No long-task timing: the frame intervals still tell.
  }
  addEventListener("pointermove", () => {
    if (b.on) b.moves++;
  }, true);
  // A hidden or covered window gets one frame a second: such a run measures nothing (D108).
  addEventListener("visibilitychange", () => {
    if (document.hidden) b.hidden = true;
  });
  // Capturing on the window runs before the canvas's own handler, so this times all of the drop.
  addEventListener("pointerup", () => {
    if (!b.armDrop) return;
    b.armDrop = false;
    const t0 = performance.now();
    requestAnimationFrame(() => setTimeout(() => (b.drop = performance.now() - t0), 0));
  }, true);
}

interface Bench {
  frames: number[];
  hidden: boolean;
  long: { start: number; dur: number }[];
  start: number;
  end: number;
  moves: number;
  drop: number | null;
}

const quantile = (xs: number[], q: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};

// ---------------------------------------------------------------- driving the canvas

type Pt = { x: number; y: number };
const centerOf = (b: { x: number; y: number; width: number; height: number }): Pt => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

async function canvasBox(page: Page) {
  return (await page.locator("svg.tf-canvas").boundingBox())!;
}

async function nodeBox(page: Page, id: string) {
  return page.locator(`g.tf-node[data-node="${id}"] path`).first().boundingBox();
}

/** Zooms with the wheel at the node until it is drawn at a working size (about 28 px tall), and keeps it on screen. */
async function zoomTo(page: Page, id: string) {
  // From the whole picture each time, so every run starts at the same zoom, whatever the last one did.
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await page.waitForTimeout(100);
  for (let i = 0; i < 60; i++) {
    const b = await nodeBox(page, id);
    if (!b) throw new Error(`node ${id} not drawn`);
    if (b.height >= 28 && b.height <= 40) return;
    const c = centerOf(b);
    await page.mouse.move(c.x, c.y);
    await page.mouse.wheel(0, b.height < 28 ? -120 : 120);
    await page.waitForTimeout(30);
  }
}

/** Presses at `from`, gets past the drag slop, then moves along a curve to `from + (dx, dy)` with a move every 8 ms (a 125 Hz mouse), timing the frames meanwhile, and drops. */
async function measuredDrag(page: Page, cdp: CDPSession, from: Pt, dx: number, dy: number, steps = 180, beforeUp?: () => Promise<void>): Promise<Bench> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 4, from.y + 2);
  await page.mouse.move(from.x + 8, from.y + 4);
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    const b = (window as unknown as { __bench: Bench & { on: boolean } }).__bench;
    b.frames = [];
    b.moves = 0;
    b.drop = null;
    b.start = performance.now();
    b.hidden = document.hidden;
    b.on = true;
    console.timeStamp("bench-start");
  });
  // Moves as a mouse sends them, every 8 ms (125 Hz) whether or not the page has caught up: sent
  // straight to the browser without waiting for each to be handled (Playwright's mouse.move waits,
  // which would let a slow page set the pace). The browser coalesces what queues up, once per frame.
  const t0 = Date.now();
  const sent: Promise<unknown>[] = [];
  let last = { x: from.x + 8, y: from.y + 4 };
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    last = { x: from.x + 8 + (dx - 8) * t, y: from.y + 4 + (dy - 4) * t + Math.sin(Math.PI * t) * 40 };
    sent.push(cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: last.x, y: last.y, button: "left", buttons: 1 }));
    const wait = t0 + i * 8 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  await Promise.all(sent);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.evaluate(() => {
    const b = (window as unknown as { __bench: Bench & { on: boolean; armDrop: boolean } }).__bench;
    b.on = false;
    b.end = performance.now();
    b.armDrop = true;
    console.timeStamp("bench-end");
  });
  // Playwright's mouse releases where it last was: tell it where the drag ended first.
  await page.mouse.move(last.x, last.y);
  await beforeUp?.();
  await page.mouse.up();
  await page.waitForFunction(() => (window as unknown as { __bench: Bench }).__bench.drop !== null, null, { timeout: 30_000 });
  await page.waitForTimeout(200);
  return page.evaluate(() => {
    const b = (window as unknown as { __bench: Bench }).__bench;
    return { frames: b.frames, long: b.long, start: b.start, end: b.end, moves: b.moves, drop: b.drop, hidden: b.hidden };
  });
}

/** Where each node can be pressed: the point of its shape nearest its center that nothing else covers (edges cross nodes in the bench pictures), sorted by distance from `t`. */
async function pressPoints(page: Page, t: Pt) {
  return page.locator("g.tf-node[data-node]").evaluateAll((els, t) => {
    const out: { id: string; x: number; y: number; d: number }[] = [];
    for (const el of els) {
      const id = el.getAttribute("data-node")!;
      const r = (el.querySelector("path") ?? el).getBoundingClientRect();
      if (!r.width) continue;
      let best: { x: number; y: number; c: number } | null = null;
      for (let i = 1; i < 12; i++)
        for (let j = 1; j < 6; j++) {
          const x = r.x + (r.width * i) / 12;
          const y = r.y + (r.height * j) / 6;
          const hit = document.elementFromPoint(x, y)?.closest("[data-node]");
          if (hit?.getAttribute("data-node") !== id) continue;
          const c = Math.hypot(i / 12 - 0.5, j / 6 - 0.5);
          if (!best || c < best.c) best = { x, y, c };
        }
      if (best) out.push({ id, x: best.x, y: best.y, d: Math.hypot(r.x + r.width / 2 - t.x, r.y + r.height / 2 - t.y) });
    }
    return out.sort((a, b) => a.d - b.d);
  }, t);
}

/** The point to press for the interaction, after selecting what it needs. */
async function prepare(page: Page, c: PictureCase, interaction: Interaction): Promise<Pt> {
  await page.keyboard.press("Escape");
  const box = await canvasBox(page);
  const inside = (p: Pt, m = 30) => p.x > box.x + m && p.x < box.x + box.width - m && p.y > box.y + m && p.y < box.y + box.height - m;
  const target = await nodeBox(page, c.target);
  if (!target) throw new Error(`node ${c.target} not drawn`);
  const tc = centerOf(target);
  const points = await pressPoints(page, tc);
  const press = points.find((p) => p.id === c.target);
  if (!press) throw new Error(`node ${c.target} is covered everywhere`);
  if (interaction === "node") return press;
  if (interaction === "resize") {
    await page.mouse.click(press.x, press.y);
    const h = await page.locator('[data-handle="e"]').boundingBox();
    if (!h) throw new Error("no east handle");
    return centerOf(h);
  }
  if (interaction === "group") {
    // The 20 nodes nearest the target that are on screen and can be pressed, the target among them.
    let picked = points.filter((n) => inside(n, 15)).slice(0, 20);
    // Zoom out at the target until 20 can be pressed (the next interaction zooms back in).
    for (let i = 0; i < 12 && picked.length < 20; i++) {
      await page.mouse.move(press.x, press.y);
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(50);
      const again = await pressPoints(page, tc);
      const p = again.find((q) => q.id === c.target);
      if (p) Object.assign(press, p);
      picked = again.filter((n) => inside(n, 15)).slice(0, 20);
    }
    if (picked.length < 20) throw new Error(`only ${picked.length} nodes on screen for the group drag`);
    await page.mouse.click(press.x, press.y);
    await page.keyboard.down("Shift");
    for (const n of picked) if (n.id !== c.target) await page.mouse.click(n.x, n.y);
    await page.keyboard.up("Shift");
    const shown = await page.locator("g.tf-node.selected").count();
    if (shown < 20) throw new Error(`only ${shown} nodes selected for the group drag`);
    return press;
  }
  // corner: the nearest `|-` edge that can be clicked on screen; its segment handle.
  const edges = await page.locator("path[data-edge]").evaluateAll((els, t) => {
    const out: { id: string; x: number; y: number; d: number }[] = [];
    for (const el of els) {
      const p = el as SVGPathElement;
      const id = p.getAttribute("data-edge")!;
      const len = p.getTotalLength();
      for (let k = 1; k < 10; k++) {
        const pt = p.getPointAtLength((len * k) / 10);
        const s = new DOMPoint(pt.x, pt.y).matrixTransform(p.getScreenCTM()!);
        if (document.elementFromPoint(s.x, s.y)?.getAttribute("data-edge") !== id) continue;
        out.push({ id, x: s.x, y: s.y, d: Math.hypot(s.x - t.x, s.y - t.y) });
        break;
      }
    }
    return out.sort((a, b) => a.d - b.d);
  }, tc);
  for (const e of edges.filter((e) => inside(e))) {
    await page.mouse.click(e.x, e.y);
    try {
      await page.getByTestId("segment-handle").first().waitFor({ timeout: 300 });
    } catch {
      continue;
    }
    // A segment's bar that the pointer would really press: hovering a node near it brings up the
    // node's connection handles over it, so zoom in at the bar (they keep their screen size) until it is clear.
    const findBar = () => page.getByTestId("segment-handle").evaluateAll((els) => {
      for (const el of els) {
        const r = el.getBoundingClientRect();
        const x = r.x + r.width / 2;
        const y = r.y + r.height / 2;
        if (document.elementFromPoint(x, y) === el) return { x, y };
      }
      return null;
    });
    for (let k = 0; k < 8; k++) {
      // The pointer off the picture first, so no hover handles are up while looking.
      await page.mouse.move(box.x + 3, box.y + 3);
      await page.waitForTimeout(50);
      const bar = await findBar();
      if (!bar || !inside(bar)) break;
      await page.mouse.move(bar.x, bar.y);
      await page.waitForTimeout(50);
      const clear = await page.evaluate((p) => document.elementFromPoint(p.x, p.y)?.getAttribute("data-testid") === "segment-handle", bar);
      if (clear) return bar;
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(50);
    }
  }
  throw new Error("no orthogonal edge with a segment handle on screen");
}

const MOVES: Record<Interaction, [number, number]> = { node: [160, 90], group: [140, 80], corner: [70, 70], resize: [90, 0] };

async function waitForTeX(page: Page) {
  await page.waitForSelector(".tf-compiled-layer:not([data-stale])", { timeout: 180_000 });
}

async function runInteraction(browser: Browser, page: Page, cdp: CDPSession, c: PictureCase, mode: string, throttle: number, interaction: Interaction): Promise<Result> {
  const [dx, dy] = MOVES[interaction];
  const setUp = async () => {
    if (mode === "tex") await waitForTeX(page);
    await zoomTo(page, c.target);
    const from = await prepare(page, c, interaction);
    await page.waitForTimeout(300);
    return from;
  };
  // Undo the drop, so every run starts from the same picture.
  const undo = async () => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(300);
  };
  const slowed = async <T>(f: () => Promise<T>): Promise<T> => {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
    try {
      return await f();
    } finally {
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    }
  };

  // 1. A 125 Hz mouse: the frames the user sees, and the drop.
  let from = await setUp();
  const b = await slowed(() => measuredDrag(page, cdp, from, dx, dy));
  const status = ((await page.getByTestId("status").textContent()) ?? "").trim();
  if (flag("debug")) await page.screenshot({ path: join(root, "spike", "perf", "results", `debug-${c.key}-${mode}-${interaction}-${throttle}.png`) });
  await undo();
  // 2. Moves one frame at a time, traced: the cost of one update.
  from = await setUp();
  const iso = await slowed(() => isolatedMoves(browser, page, cdp, from, dx, dy));
  await undo();

  const intervals = b.frames.slice(1).map((t, i) => t - b.frames[i]!);
  const long = b.long.filter((l) => l.start + l.dur > b.start && l.start < b.end);
  const within60 = intervals.filter((d) => d <= FRAME * 1.1).length / intervals.length;
  const within30 = intervals.filter((d) => d <= 2 * FRAME * 1.1).length / intervals.length;
  const pass = c.measureOnly ? null : throttle === 1 ? within60 >= 0.95 && long.length === 0 && (b.drop ?? Infinity) < 100 : within30 >= 0.95;
  return {
    picture: c.key,
    mode,
    throttle,
    interaction,
    frames: intervals.length,
    moves: b.moves,
    p50: quantile(intervals, 0.5),
    p95: quantile(intervals, 0.95),
    max: Math.max(...intervals),
    within60,
    within30,
    longTasks: long.length,
    longestTask: long.reduce((m, l) => Math.max(m, l.dur), 0),
    drop: b.drop,
    update50: iso ? quantile(iso.costs, 0.5) : NaN,
    update95: iso ? quantile(iso.costs, 0.95) : NaN,
    breakdown: iso?.breakdown ?? {},
    status,
    pass,
    throttled: b.hidden || intervals.some((d) => d > 900),
    hidden: b.hidden,
  };
}

async function openPicture(browser: Browser, c: PictureCase, mode: string) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE, serviceWorkers: "block" });
  await context.addInitScript((m) => localStorage.setItem("tikzflow.preview", m === "tex" ? "accurate" : "quick"), mode);
  await context.addInitScript(instrument);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await page.goto(`${BASE}/editor/${process.env.BENCH_QUERY ?? ""}#${await encodeShare(c.text)}`);
  await page.waitForSelector(`g.tf-node[data-node="${c.target}"]`, { timeout: 60_000 });
  if (mode === "tex") await waitForTeX(page);
  await zoomTo(page, c.target);
  if (flag("debug")) await page.screenshot({ path: join(root, "spike", "perf", "results", `debug-${c.key}-${mode}-zoomed.png`) });
  await page.waitForTimeout(500);
  return { context, page, cdp };
}

// ---------------------------------------------------------------- profile mode

interface CpuProfile {
  nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number; columnNumber: number } }[];
  samples: number[];
  timeDeltas: number[];
}

const maps = new Map<string, SourceMapConsumer | null>();
function original(outDir: string, url: string, line: number, col: number): { source: string; name: string } | null {
  const path = url.startsWith(BASE) ? join(outDir, new URL(url).pathname) : null;
  if (!path) return null;
  if (!maps.has(path)) {
    try {
      maps.set(path, new SourceMapConsumer(JSON.parse(readFileSync(`${path}.map`, "utf8"))));
    } catch {
      maps.set(path, null);
    }
  }
  const m = maps.get(path);
  if (!m) return null;
  const p = m.originalPositionFor({ line: line + 1, column: col });
  if (!p.source) return null;
  return { source: p.source.replace(/^(\.\.\/)+/, "").replace(/^.*node_modules\//, "node_modules/"), name: p.name ?? "" };
}

function summarizeProfile(profile: CpuProfile, outDir: string) {
  const self = new Map<number, number>();
  profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));
  const byFn = new Map<string, number>();
  const byFile = new Map<string, number>();
  let total = 0;
  for (const n of profile.nodes) {
    const t = (self.get(n.id) ?? 0) / 1000;
    if (!t) continue;
    total += t;
    const cf = n.callFrame;
    const o = cf.url ? original(outDir, cf.url, cf.lineNumber, cf.columnNumber) : null;
    const file = o?.source ?? (cf.url ? relative(BASE, cf.url) : cf.functionName);
    const fn = `${cf.functionName || o?.name || "(anonymous)"}  ${file}${o ? "" : cf.url ? `:${cf.lineNumber + 1}` : ""}`;
    byFn.set(fn, (byFn.get(fn) ?? 0) + t);
    byFile.set(file, (byFile.get(file) ?? 0) + t);
  }
  const top = (m: Map<string, number>, k: number) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k);
  return { total, byFile: top(byFile, 20), byFn: top(byFn, 40) };
}

interface TraceEvent { name: string; ph: string; ts: number; dur?: number; pid: number; tid: number; args?: { name?: string; data?: { message?: string; type?: string } } }

const CATEGORY: [RegExp, string][] = [
  [/^(FunctionCall|EventDispatch|FireAnimationFrame|TimerFire|RunMicrotasks|EvaluateScript|V8\.Execute|v8\.callFunction|v8\.run|FireIdleCallback|XHRReadyStateChange)/, "script"],
  [/^(UpdateLayoutTree|RecalculateStyles|ScheduleStyleRecalculation|ParseAuthorStyleSheet)/, "style"],
  [/^(Layout|UpdateLayout|IntersectionObserverController)/, "layout"],
  [/^(PrePaint|Paint|PaintImage|Layerize|UpdateLayer|UpdateLayerTree|Commit|CompositeLayers|ScrollLayer|PaintSetup)/, "paint"],
  [/GC|BlinkGC|V8\.GC|MinorGC|MajorGC/, "gc"],
  [/^HitTest/, "hit test"],
];

/** The renderer's main thread between the bench-start and bench-end marks, and its self time by kind. */
function traceWindow(events: TraceEvent[]) {
  const threads = new Map<string, string>();
  for (const e of events) if (e.ph === "M" && e.name === "thread_name") threads.set(`${e.pid}:${e.tid}`, e.args?.name ?? "");
  const start = events.find((e) => e.name === "TimeStamp" && e.args?.data?.message === "bench-start");
  const end = events.find((e) => e.name === "TimeStamp" && e.args?.data?.message === "bench-end");
  if (!start || !end) return null;
  const thread = `${start.pid}:${start.tid}`;
  if (!/CrRendererMain/.test(threads.get(thread) ?? "")) return null;
  const main = events.filter((e) => e.ph === "X" && e.dur !== undefined && `${e.pid}:${e.tid}` === thread && e.ts >= start.ts && e.ts + e.dur <= end.ts).sort((a, b) => a.ts - b.ts || b.dur! - a.dur!);
  // Self time: each event's duration less its direct children's.
  const self = new Map<string, number>();
  const stack: { e: TraceEvent; child: number }[] = [];
  const close = (upTo: number) => {
    while (stack.length && stack.at(-1)!.e.ts + stack.at(-1)!.e.dur! <= upTo) {
      const s = stack.pop()!;
      self.set(s.e.name, (self.get(s.e.name) ?? 0) + s.e.dur! - s.child);
      if (stack.length) stack.at(-1)!.child += s.e.dur!;
    }
  };
  for (const e of main) {
    close(e.ts);
    stack.push({ e, child: 0 });
  }
  close(Infinity);
  const cats = new Map<string, number>();
  let busy = 0;
  for (const [name, us] of self) {
    const cat = CATEGORY.find(([re]) => re.test(name))?.[1] ?? (/RunTask/.test(name) ? "task overhead" : "other");
    cats.set(cat, (cats.get(cat) ?? 0) + us / 1000);
    busy += us / 1000;
  }
  const frames = main.filter((e) => e.name === "FireAnimationFrame").length;
  const topNames = [...self].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([n, us]) => [n, us / 1000] as const);
  return { main, end: end.ts, window: (end.ts - start.ts) / 1000, busy, frames, categories: [...cats].sort((a, b) => b[1] - a[1]), topNames };
}

const TRACE_CATEGORIES = ["devtools.timeline", "disabled-by-default-devtools.timeline", "toplevel", "v8", "disabled-by-default-v8.gc"];

/**
 * The cost of one drag update, independent of how the browser paces input: `n` moves, each sent
 * only after the page has drawn the frame of the one before (two animation frames), with a trace.
 * Per move: the main thread's tasks from its pointermove to the next one (its handler, the render,
 * and that frame's style, layout and paint).
 */
async function isolatedMoves(browser: Browser, page: Page, cdp: CDPSession, from: Pt, dx: number, dy: number, n = 30) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 4, from.y + 2);
  await page.mouse.move(from.x + 8, from.y + 4);
  await page.waitForTimeout(100);
  await browser.startTracing(page, { categories: TRACE_CATEGORIES });
  await page.evaluate(() => console.timeStamp("bench-start"));
  let last = { x: from.x + 8, y: from.y + 4 };
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    last = { x: from.x + 8 + (dx - 8) * t, y: from.y + 4 + (dy - 4) * t + Math.sin(Math.PI * t) * 40 };
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: last.x, y: last.y, button: "left", buttons: 1 });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  }
  await page.evaluate(() => console.timeStamp("bench-end"));
  const trace = JSON.parse((await browser.stopTracing()).toString("utf8")) as { traceEvents: TraceEvent[] };
  await page.mouse.move(last.x, last.y);
  await page.mouse.up();
  await page.waitForTimeout(300);
  return perMove(trace.traceEvents);
}

/** Per pointermove in the trace: the time the main thread was busy until the next one, and the window's breakdown per move. */
function perMove(events: TraceEvent[]) {
  const w = traceWindow(events);
  if (!w) return null;
  // Top-level tasks only: a task can be recorded under both names, or run inside another.
  const tasks: TraceEvent[] = [];
  let busyUntil = -Infinity;
  for (const e of w.main) {
    if ((e.name !== "RunTask" && e.name !== "ThreadControllerImpl::RunTask") || e.ts < busyUntil) continue;
    tasks.push(e);
    busyUntil = e.ts + e.dur!;
  }
  const moves = w.main.filter((e) => e.name === "EventDispatch" && e.args?.data?.type === "pointermove").sort((a, b) => a.ts - b.ts);
  const taskStart = (ts: number) => tasks.find((t) => t.ts <= ts && ts <= t.ts + t.dur!)?.ts ?? ts;
  const starts = moves.map((m) => taskStart(m.ts));
  const costs = starts.map((s, i) => {
    const end = starts[i + 1] ?? w.end;
    return tasks.filter((t) => t.ts >= s && t.ts < end).reduce((sum, t) => sum + t.dur!, 0) / 1000;
  });
  const breakdown = Object.fromEntries(w.categories.map(([cat, ms]) => [cat, ms / Math.max(1, moves.length)]));
  return { moves: moves.length, costs, breakdown };
}

// ---------------------------------------------------------------- main

const fmt = (x: number | null, d = 1) => (x === null || !Number.isFinite(x) ? "-" : x.toFixed(d));
const pct = (x: number) => `${(100 * x).toFixed(0)}%`;

async function main() {
  const profile = flag("profile");
  // Relative to the root: vite.config.ts joins the root and outDir when it copies the engine.
  const outRel = profile ? "test-results/drag-profile" : "dist";
  const outDir = join(root, outRel);
  if (profile || !flag("no-build")) {
    console.log(profile ? `Building without minifying, with source maps, into ${outDir}…` : "Building…");
    await build({ root, logLevel: "warn", build: profile ? { outDir: outRel, emptyOutDir: true, minify: false, sourcemap: true } : {} });
  }
  const server = await preview({ root, logLevel: "warn", preview: { port: PORT, strictPort: true }, build: { outDir: outRel } });
  const browser = await chromium.launch({ channel: "msedge", headless: flag("headless") });
  const version = browser.version();
  try {
    if (profile) {
      const c = PICTURES[0]!;
      const modes = list("modes", ["quick"]);
      const kind = list("interactions", ["node"])[0] as Interaction;
      for (const mode of modes) {
        const { context, page, cdp } = await openPicture(browser, c, mode);
        const from = await prepare(page, c, kind);
        await cdp.send("Profiler.enable");
        await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
        // --drop: only the drop, from just before the pointerup (D108).
        const dropOnly = flag("drop");
        const startProfiling = async () => {
          await browser.startTracing(page, { categories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "v8", "disabled-by-default-v8.gc", ...(process.env.BENCH_MUTATIONS ? ["disabled-by-default-devtools.timeline.invalidationTracking"] : [])] });
          await cdp.send("Profiler.start");
          if (dropOnly) await page.evaluate(() => console.timeStamp("bench-start"));
        };
        if (!dropOnly) await startProfiling();
        if (process.env.BENCH_MUTATIONS) {
          await page.evaluate(() => {
            const w = window as unknown as { __muts: string[] };
            w.__muts = [];
            const obs = new MutationObserver((ms) => {
              for (const m of ms) {
                const el = (m.target.nodeType === 1 ? m.target : m.target.parentElement) as Element;
                const label = el?.closest?.(".tf-label")?.getAttribute("data-label-of");
                w.__muts.push(`${label ? `label ${label}` : el?.closest?.(".tf-labels") ? "labels box" : el?.closest?.(".cm-editor") ? "code" : el?.closest?.("svg") ? "svg" : "other"} ${m.type} ${m.type === "attributes" ? m.attributeName : `+${m.addedNodes.length}/-${m.removedNodes.length}`} ${el?.nodeName}.${el?.getAttribute?.("class") ?? ""}`);
              }
            });
            window.addEventListener("pointerup", () => obs.observe(document.body, { subtree: true, attributes: true, childList: true, characterData: true }), { capture: true, once: true });
            const svg = document.querySelector("svg.tf-canvas");
            if (svg) new ResizeObserver((es) => es.forEach((e) => w.__muts.push(`RESIZE canvas ${Math.round(e.contentRect.width)}x${Math.round(e.contentRect.height)}`))).observe(svg);
          });
        }
        const b = await measuredDrag(page, cdp, from, ...MOVES[kind], 180, dropOnly ? startProfiling : undefined);
        if (dropOnly) await page.evaluate(() => console.timeStamp("bench-end"));
        if (process.env.BENCH_MUTATIONS) {
          await page.waitForTimeout(300);
          const muts = await page.evaluate(() => (window as unknown as { __muts: string[] }).__muts);
          const counts = new Map<string, number>();
          for (const m of muts) counts.set(m, (counts.get(m) ?? 0) + 1);
          console.log(`\nMutations after the pointerup (${muts.length}):`);
          for (const [k, v] of [...counts].sort((x, y) => y[1] - x[1]).slice(0, Number(process.env.BENCH_MUTATIONS) || 40)) console.log(`  ${String(v).padStart(4)}  ${k}`);
        }
        const { profile: cpu } = (await cdp.send("Profiler.stop")) as unknown as { profile: CpuProfile };
        const raw = (await browser.stopTracing()).toString("utf8");
        const trace = JSON.parse(raw) as { traceEvents: TraceEvent[] };
        writeFileSync(join(root, "spike", "perf", "results", `profile-${mode}${kind === "node" ? "" : `-${kind}`}.trace.json`), raw);
        const intervals = b.frames.slice(1).map((t, i) => t - b.frames[i]!);
        console.log(`\n=== Profile: ${kind} drag, ${c.title}, ${mode} preview (Edge ${version}) ===`);
        console.log(`frames ${intervals.length}, p50 ${fmt(quantile(intervals, 0.5))} ms, p95 ${fmt(quantile(intervals, 0.95))} ms, drop ${fmt(b.drop)} ms (unminified build, profiler on)`);
        const t = traceWindow(trace.traceEvents);
        if (t) {
          console.log(`\nMain thread during the drag: ${fmt(t.busy, 0)} ms busy of ${fmt(t.window, 0)} ms; ${t.frames} animation frames; per frame ${fmt(t.busy / Math.max(1, intervals.length))} ms`);
          for (const [cat, ms] of t.categories) console.log(`  ${cat.padEnd(14)} ${fmt(ms, 0).padStart(6)} ms  ${fmt(ms / Math.max(1, intervals.length)).padStart(5)} ms/frame`);
          console.log("  top trace events by self time:");
          for (const [n, ms] of t.topNames) console.log(`    ${n.padEnd(36)} ${fmt(ms, 0).padStart(6)} ms`);
        } else console.log("(no trace summary: markers or main thread not found)");
        const p = summarizeProfile(cpu, outDir);
        console.log(`\nCPU profile, self time (${fmt(p.total, 0)} ms sampled):\n  by source:`);
        for (const [f, ms] of p.byFile) console.log(`    ${fmt(ms, 0).padStart(6)} ms  ${f}`);
        console.log("  by function:");
        for (const [f, ms] of p.byFn) console.log(`    ${fmt(ms, 0).padStart(6)} ms  ${f}`);
        mkdirSync(join(root, "spike", "perf", "results"), { recursive: true });
        writeFileSync(join(root, "spike", "perf", "results", `profile-${mode}${kind === "node" ? "" : `-${kind}`}.cpuprofile`), JSON.stringify(cpu));
        await context.close();
      }
      return;
    }

    const pictures = PICTURES.filter((p) => !opt("only").length || list("only", []).includes(p.key));
    const modes = list("modes", ["quick", "tex"]);
    const throttles = list("throttle", ["1", "4"]).map(Number);
    const results: Result[] = [];
    const failures: string[] = [];
    console.log(`Edge ${version}, ${flag("headless") ? "headless" : "windowed"}, viewport ${VIEWPORT.width}×${VIEWPORT.height} at ${SCALE}×`);
    const firstLine = (e: unknown) => String(e).split("\n")[0];
    for (const c of pictures)
      for (const mode of modes) {
        // One failure (a timeout, a crashed page) is reported and the rest still run.
        let opened: Awaited<ReturnType<typeof openPicture>> | null = null;
        try {
          opened = await openPicture(browser, c, mode);
        } catch (e) {
          failures.push(`${c.key} ${mode}: ${firstLine(e)}`);
          console.log(`${c.key} ${mode}: FAILED to open: ${firstLine(e)}`);
          continue;
        }
        const { context, page, cdp } = opened;
        const only = list("interactions", c.interactions);
        for (const interaction of c.interactions.filter((i) => only.includes(i)))
          for (const throttle of throttles) {
            let r: Result;
            try {
              r = await runInteraction(browser, page, cdp, c, mode, throttle, interaction);
            } catch (e) {
              failures.push(`${c.key} ${mode} ${throttle}× ${interaction}: ${firstLine(e)}`);
              console.log(`${c.key} ${mode} ${throttle}× ${interaction}: FAILED: ${firstLine(e)}`);
              continue;
            }
            results.push(r);
            const parts = ["script", "style", "layout", "paint", "gc"].map((k) => `${k} ${fmt(r.breakdown[k] ?? 0)}`).join(", ");
            console.log(
              `${c.key.padEnd(6)} ${mode.padEnd(6)} ${`${throttle}×`.padEnd(3)} ${interaction.padEnd(7)} ` +
                `frames ${String(r.frames).padStart(4)} (moves ${String(r.moves).padStart(3)})  p50 ${fmt(r.p50).padStart(5)}  p95 ${fmt(r.p95).padStart(6)}  max ${fmt(r.max).padStart(6)} ms  ` +
                `≤1 frame ${pct(r.within60).padStart(4)}  ≤2 ${pct(r.within30).padStart(4)}  long ${r.longTasks} (max ${fmt(r.longestTask, 0)})  drop ${fmt(r.drop, 0)} ms  ` +
                `${r.pass === null ? "(measured)" : r.pass ? "PASS" : "FAIL"}${r.throttled ? `  (${r.hidden ? "PAGE HIDDEN" : "FRAMES A SECOND APART"}: not valid)` : ""}\n` +
                `${"".padEnd(25)}one update ${fmt(r.update50)} / ${fmt(r.update95)} ms (p50 / p95; mean ${parts})  | ${r.status.slice(0, 70)}`,
            );
          }
        await context.close().catch(() => {});
      }
    if (failures.length) console.log(`\n${failures.length} failed:\n  ${failures.join("\n  ")}`);
    const label = opt("label")[0];
    if (label) {
      const dir = join(root, "spike", "perf", "results");
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${label}.json`);
      writeFileSync(file, `${JSON.stringify({ date: new Date().toISOString(), edge: version, headless: flag("headless"), viewport: VIEWPORT, scale: SCALE, results, failures }, null, 1)}\n`);
      console.log(`Saved ${relative(root, file)}`);
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

await main();
