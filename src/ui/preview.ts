// The accurate preview in the app (M3 step 8, D68): the picture compiled by
// TeX in the engine worker, shown over the native drawing once it matches
// the code. Compiles start a moment after the code stops changing; while the
// code and the compiled picture differ, the last picture stays, with what
// changed drawn natively over it (D96).

import { computed, effect, signal } from "@preact/signals";
import { EngineClient, type EngineState } from "../engine/client.ts";
import { buildCompileInput, type CompileInput, locate } from "../engine/input.ts";
import { parsePlacements, type TexError, type TexPlacement } from "../engine/log.ts";
import { MARK_TOLERANCE, type Misplaced, misplaced, reportNames } from "../engine/placement.ts";
import type { CompileOutcome } from "../engine/protocol.ts";
import { engineBase } from "../engine/release.ts";
import type { Range } from "../model/syntax.ts";
import { prefetchEngine } from "./offline.ts";
import { pageSettings } from "./pagesettings.ts";
import type { PictureLayout } from "../tikz/layout.ts";
import { baseLayout, currentPicture, doc, dragMoved, layout, overrides, previewLayout, revealInCode, text, withoutMoved } from "./store.ts";
import { type Patch, stalePatch } from "./stalepatch.ts";

/** "accurate": TeX's picture when it is ready; "quick": the native drawing only. Kept per viewer. */
export type PreviewMode = "accurate" | "quick";

const MODE_KEY = "tikzflow.preview";
function storedMode(): PreviewMode {
  try {
    return localStorage.getItem(MODE_KEY) === "quick" ? "quick" : "accurate";
  } catch {
    return "accurate";
  }
}
export const previewMode = signal<PreviewMode>(storedMode());
/** `remember` false changes the mode for this visit only (the banner's switch back, M3 step 8 follow-up). */
export function setPreviewMode(m: PreviewMode, remember = true): void {
  previewMode.value = m;
  if (!remember) return;
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    // Private windows may refuse; the choice then lasts for this visit.
  }
}

export const engineState = signal<EngineState>({ kind: "loading" });

/** A finished compile: of which text and picture, its input, and what came out. */
export interface Compiled {
  text: string;
  picture: number;
  input: CompileInput;
  outcome: CompileOutcome;
  /** Where TeX put the picture's named nodes (D98), when the input asked. */
  placements?: ReadonlyMap<string, TexPlacement>;
}
export const compiled = signal<Compiled | null>(null);
/** A compile is waiting or running for the current text. */
export const compiling = signal(false);

/** The compiled picture, when it is of the code as it is now and nothing is being dragged. */
export const freshCompiled = computed<Compiled | null>(() => {
  const c = compiled.value;
  if (!c || previewMode.value !== "accurate") return null;
  if (c.text !== text.value || c.picture !== currentPicture.value) return null;
  if (previewLayout.value || overrides.value.size) return null;
  return c;
});

/** The compiled picture is shown (and the native drawing only answers the pointer). */
export const showingCompiled = computed(() => !!freshCompiled.value?.outcome.svg && !!freshCompiled.value.outcome.picture);

/** The latest picture TeX drew, with the layout of the code it was compiled from (D96). Set by `startPreview`. */
const lastPicture = signal<{ compiled: Compiled; layout: PictureLayout } | null>(null);

/** A tab's TeX pictures, kept while another tab is shown (D97), so switching back shows them at once. */
export interface PictureStash {
  compiled: Compiled | null;
  last: { compiled: Compiled; layout: PictureLayout } | null;
}
/** Takes the pictures on the canvas, for the tab being left. */
export function stashPictures(): PictureStash {
  return { compiled: compiled.peek(), last: lastPicture.peek() };
}
/** Which tab's pictures are on the canvas: a compile started for one tab is dropped when it ends in another. */
let pictureOwner = 0;
/** Puts a tab's pictures back (none for a tab TeX hasn't drawn yet). Call it in the batch that switches the text. */
export function restorePictures(p: PictureStash | null): void {
  pictureOwner++;
  compiled.value = p?.compiled ?? null;
  lastPicture.value = p?.last ?? null;
  selectedBlock.value = null;
}

/** The masks that cut the stale picture and show the patch (D96). */
export const STALE_HIDE = "tf-stale-hide";
export const STALE_SHOW = "tf-stale-show";

/**
 * TeX's last picture, kept on the canvas while TeX compiles the code as it is now or while something is being
 * dragged, with the patch that draws what changed since natively (D69 item 4, D96). Null when TeX's picture of
 * the code is ready, when there is none to keep, or when too much changed to patch (the native drawing shows).
 */
let lastStale: { compiled: Compiled; old: PictureLayout; now: PictureLayout; result: { compiled: Compiled; patch: Patch } | null } | null = null;

export const stalePicture = computed<{ compiled: Compiled; patch: Patch } | null>(() => {
  if (previewMode.value !== "accurate" || freshCompiled.value) return null;
  const last = lastPicture.value;
  if (!last || last.compiled.picture !== currentPicture.value) return null;
  const dragging = !!previewLayout.value || overrides.value.size > 0;
  if (!dragging && !compiling.value) return null;
  // During a drag, the patch covers what the drag leaves where it was: it stays the same from frame to
  // frame, so TeX's picture isn't drawn again; what moves is drawn natively on top (D108).
  const moved = dragMoved.value;
  const base = baseLayout.value;
  const now = moved.ids.size && base ? withoutMoved(base, moved) : layout.value;
  // The same picture against the same layout: the same patch, so nothing drawn from it changes.
  if (now && lastStale && lastStale.compiled === last.compiled && lastStale.old === last.layout && lastStale.now === now) return lastStale.result;
  const patch = now && stalePatch(last.layout, now);
  const result = patch ? { compiled: last.compiled, patch } : null;
  if (now) lastStale = { compiled: last.compiled, old: last.layout, now, result };
  return result;
});

/** TeX's picture is on the canvas, up to date or patched: the native drawing then only answers the pointer. */
export const showingTex = computed(() => showingCompiled.value || !!stalePicture.value);

/** A TeX error with the line of the user's code it happened on, if it was in the user's code. */
export interface PreviewError extends TexError {
  sourceLine: number | null;
  /** The line of the imported preamble (D71) it happened on, if it was there. */
  preambleLine: number | null;
  /** It happened in the preamble (the code's or the imported one). */
  inPreamble: boolean;
}

/** Every error of the latest compile, mapped to the source (they may be of an older version of the code). */
const allErrors = computed<PreviewError[]>(() => {
  const c = compiled.value;
  if (!c || previewMode.value !== "accurate") return [];
  return c.outcome.errors.map((e) => {
    const at = e.file === "input.tex" && e.line !== null ? locate(c.input, e.line) : null;
    return { ...e, sourceLine: at?.in === "code" ? at.line : null, preambleLine: at?.in === "preamble" ? at.line : null, inPreamble: at?.preamble === true };
  });
});

/**
 * Errors in the preamble of a document whose class the preview replaces (D73): they are most likely
 * something the class defines (\journal, \address…), which the preview can't know. They are shown as notes, not
 * as errors, so a paper in an unknown class doesn't open with a banner.
 */
const classErrors = computed<PreviewError[]>(() => {
  const c = compiled.value;
  return c?.input.substitutedClass ? allErrors.value.filter((e) => e.inPreamble) : [];
});

/**
 * A TS1 font that couldn't be loaded: a text symbol such as \textdegree or \texteuro, whose fonts the
 * engine doesn't carry (5 MB for all of them, D87; \$ is drawn from Computer Modern instead). Not the
 * user's to fix, so a quiet notice rather than an error.
 */
const ts1Errors = computed<PreviewError[]>(() => allErrors.value.filter((e) => /^Font TS1\//.test(e.message)));

/** Errors of the latest compile that are the user's to fix. */
export const previewErrors = computed<PreviewError[]>(() => {
  const hidden = new Set([...classErrors.value, ...ts1Errors.value]);
  return allErrors.value.filter((e) => !hidden.has(e));
});

/**
 * The errors of the compile whose picture is on the canvas. TeX carries on past them, so the picture
 * can be badly wrong (an undefined node is placed at the origin and lines shoot there): the banner
 * says so, next to a way back to the quick preview.
 */
export const shownErrors = computed<PreviewError[]>(() => (showingCompiled.value ? previewErrors.value : []));

/**
 * Nodes TeX puts more than a point away from where the quick preview does, or draws a point bigger or
 * smaller (D98): the editor's geometry is wrong for them, so their outlines and the positions a drag writes
 * would be off. Only for TeX's picture of the code as it is now.
 */
export const misplacedNodes = computed<Misplaced[]>(() => {
  const c = freshCompiled.value;
  const l = layout.value;
  if (!c?.placements || !c.outcome.svg || !l) return [];
  return misplaced(l, c.placements);
});

/** The nodes beyond MARK_TOLERANCE: those that get a marker on the canvas (D101). The rest are only in the notes. */
export const markedNodes = computed<Misplaced[]>(() => misplacedNodes.value.filter((m) => m.off > MARK_TOLERANCE));

/** The note for misplaced nodes, naming the first few. */
export function misplacedNote(list: readonly Misplaced[]): string {
  const names = list.slice(0, 4).map((m) => m.name).join(", ") + (list.length > 4 ? ", …" : "");
  const worst = Math.round(list[0]!.off * 10) / 10;
  const one = list.length === 1;
  const what = one ? `${names} ${worst} pt from where the editor's own drawing does` : `${list.length} nodes (${names}) up to ${worst} pt from where the editor's own drawing does`;
  const marked = list.filter((m) => m.off > MARK_TOLERANCE).length;
  const where = marked === 0 ? "" : ` (${marked === list.length ? "marked on the canvas" : `${marked} beyond ${MARK_TOLERANCE} pt are marked on the canvas`}; select one to see TeX's box)`;
  return `TeX puts ${what}${where}. ${one ? "Its outline" : "Their outlines"} here, and positions written when you drag ${one ? "it" : "them"} or place nodes next to ${one ? "it" : "them"}, may be off by as much. Up to ${MARK_TOLERANCE} pt usually comes from estimated text widths; if it is more, please tell us with Report a problem.`;
}

/** Things the user should know about the latest compile: left-out packages, fonts, missing files. */
export const previewNotices = computed<string[]>(() => {
  const c = compiled.value;
  if (!c || previewMode.value !== "accurate") return [];
  const out: string[] = [];
  const list = (xs: readonly string[]) => xs.join(", ");
  if (c.input.unavailable.length) {
    out.push(`The preview has no ${list(c.input.unavailable)} package${c.input.unavailable.length > 1 ? "s" : ""}, so it compiles without ${c.input.unavailable.length > 1 ? "them" : "it"}; your code still loads ${c.input.unavailable.length > 1 ? "them" : "it"}.`);
  }
  if (c.input.fontPackages.length) {
    out.push(`Your preamble loads ${list(c.input.fontPackages)}. The preview always typesets in Computer Modern, so text widths may differ from your document.`);
  }
  const sub = c.input.substitutedClass;
  if (sub) {
    out.push(
      sub.known
        ? `The preview doesn't load the ${sub.name} class: it takes the page widths ${sub.name} gives and keeps your packages and macros, but not the class's own fonts, spacing or commands.`
        : `The ${sub.name} class isn't available in the preview, so it uses article's page (or the widths you typed in the Page panel) and keeps your packages and macros.`,
    );
    for (const e of classErrors.value) {
      const detail = e.context ? ` (${e.context.trim().split("\n")[0]})` : "";
      out.push(`Line ${e.preambleLine ?? e.sourceLine ?? "?"} of your preamble: ${e.message.replace(/\.$/, "")}${detail}. The ${sub.name} class probably defines it; the preview ignores it.`);
    }
  }
  if (c.input.beamer) {
    out.push("This is a Beamer document. The preview typesets in Computer Modern Sans, not your theme's fonts (Beamer's default sans serif usually differs), so text widths may differ from your slides.");
  }
  // Packages and classes only: TeX and TikZ look for many optional files (configurations,
  // tikzlibrary… before pgflibrary…), and not finding those is normal.
  const files = c.outcome.missingFiles.filter((f) => /\.(sty|cls)$/.test(f));
  if (files.length) out.push(`TeX asked for files the preview doesn't have: ${list(files.slice(0, 6))}${files.length > 6 ? ", …" : ""}.`);
  if (ts1Errors.value.length) out.push("The preview has no fonts for text symbols such as \\textdegree or \\texteuro (LaTeX's TS1 encoding), so they are left out of the picture here. LaTeX draws them in your document.");
  if (c.outcome.missingFonts.length) out.push(`Text in ${list(c.outcome.missingFonts)} isn't drawn: the preview has only Computer Modern and the AMS fonts.`);
  if (c.outcome.aborted) out.push("TeX gave up before the end of the picture, so the accurate preview is missing.");
  const off = misplacedNodes.value;
  if (off.length) out.push(misplacedNote(off));
  return out;
});

/** The locked block the user picked in the compiled picture (its source range), if any. */
export const selectedBlock = signal<{ id: string; range: Range } | null>(null);

/** Shows a TeX error's line in the code. */
export function showPreviewError(e: PreviewError): void {
  if (e.sourceLine === null) return;
  const t = text.value;
  let from = 0;
  for (let n = 1; n < e.sourceLine; n++) {
    const i = t.indexOf("\n", from);
    if (i < 0) break;
    from = i + 1;
  }
  const end = t.indexOf("\n", from);
  revealInCode({ from, to: end < 0 ? t.length : end });
}

/** Selects a locked block's code. */
export function pickBlock(id: string): void {
  const c = freshCompiled.value;
  const range = c?.input.blocks.get(id);
  if (!range) return;
  selectedBlock.value = { id, range };
  revealInCode(range);
}

let client: EngineClient | null = null;

/**
 * TeX's picture of the code as it is now, for exporting: the compile on the canvas if it is of this code,
 * else a fresh one (also when the TeX preview is switched off). Gives the reason when there is none.
 */
export async function compileForExport(): Promise<Compiled | { error: string }> {
  const c = client;
  if (!c) return { error: "The TeX engine isn't running." };
  let index;
  try {
    index = await c.ready();
  } catch {
    return { error: "The TeX engine isn't available here (npm run fetch-engines -- engine), so there is no TeX picture to export." };
  }
  const t = text.peek();
  const picture = currentPicture.peek();
  const have = compiled.peek();
  if (have && have.text === t && have.picture === picture && have.outcome.svg) return have;
  const available = new Set(index.texFiles);
  const input = buildCompileInput(doc.peek(), picture, (f) => available.has(f), pageSettings.peek());
  if (!input) return { error: "There is no picture to export." };
  const outcome = await c.compile(input.tex);
  if (!outcome) return { error: "The code changed while TeX was compiling. Try again." };
  const result: Compiled = { text: t, picture, input, outcome };
  if (!outcome.svg) return { error: outcome.aborted ? "TeX gave up before it drew the picture." : "TeX didn't draw anything for this picture." };
  return result;
}
const DEBOUNCE_MS = 250;

/**
 * How long the browser tab must stay hidden before the engine worker is stopped (D69 item 4, D97): it holds
 * about 330 MB. A quick look at another tab keeps it; it starts again when the tab is shown. Tests shorten it.
 */
export const engineIdle = { hiddenMs: 15_000 };
/** The engine worker is running (stopped while the tab is hidden). */
export const engineRunning = signal(false);

/** Starts the engine and compiles the code whenever it settles. Returns a function that stops it. */
export function startPreview(base = engineBase(new URLSearchParams(location.search).get("engine"))): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let available: Set<string> | null = null;
  let hiddenTimer: ReturnType<typeof setTimeout> | null = null;

  const startEngine = () => {
    if (client) return;
    const c = new EngineClient(base);
    client = c;
    engineRunning.value = true;
    c.onState = (s) => {
      if (client === c) engineState.value = s;
    };
    engineState.value = c.state;
    available = null;
    void c.ready().then(
      (index) => {
        if (client !== c) return;
        available = new Set(index.texFiles);
        schedule();
        void prefetchEngine(base, index);
      },
      () => {},
    );
  };
  const stopEngine = () => {
    const c = client;
    if (!c) return;
    client = null;
    available = null;
    engineRunning.value = false;
    c.dispose();
  };
  const onVisibility = () => {
    if (hiddenTimer) clearTimeout(hiddenTimer);
    hiddenTimer = null;
    if (document.visibilityState === "hidden") hiddenTimer = setTimeout(stopEngine, engineIdle.hiddenMs);
    else startEngine();
  };
  startEngine();
  document.addEventListener("visibilitychange", onVisibility);

  const run = async () => {
    timer = null;
    const c = client;
    if (!c || !available || previewMode.peek() !== "accurate") return;
    const tab = pictureOwner;
    const t = text.peek();
    const picture = currentPicture.peek();
    // The layout of the code being compiled, kept with TeX's picture of it for patching later (D96); TeX is
    // asked where it puts each of its named nodes, to check the layout against (D98).
    const drawn = baseLayout.peek();
    const input = buildCompileInput(doc.peek(), picture, (f) => available!.has(f), pageSettings.peek(), drawn ? reportNames(drawn) : []);
    if (!input) {
      compiling.value = false;
      return;
    }
    const keep = (c: Compiled) => {
      if (drawn && c.outcome.svg && c.outcome.picture) lastPicture.value = { compiled: c, layout: drawn };
    };
    const prev = compiled.peek();
    if (prev && prev.input.tex === input.tex) {
      // Nothing TeX sees changed (an edit outside the picture): the output still holds.
      compiled.value = { ...prev, text: t, picture, input };
      keep(compiled.value);
      compiling.value = false;
      return;
    }
    compiling.value = true;
    try {
      const outcome = await c.compile(input.tex);
      if (!outcome) return; // replaced by a newer compile
      // Another tab was shown meanwhile: this picture is of the tab that was left (D97).
      if (tab !== pictureOwner) return;
      compiled.value = { text: t, picture, input, outcome, placements: parsePlacements(outcome.log) };
      keep(compiled.value);
    } catch (e) {
      engineState.value = { kind: "unavailable", reason: e instanceof Error ? e.message : String(e) };
    } finally {
      if (text.peek() === t) compiling.value = false;
    }
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void run(), DEBOUNCE_MS);
  };

  const stop = effect(() => {
    void text.value;
    void currentPicture.value;
    void pageSettings.value;
    if (previewMode.value !== "accurate") return;
    selectedBlock.value = null;
    compiling.value = true;
    schedule();
  });
  return () => {
    stop();
    if (timer) clearTimeout(timer);
    if (hiddenTimer) clearTimeout(hiddenTimer);
    document.removeEventListener("visibilitychange", onVisibility);
    stopEngine();
  };
}
