// The accurate preview in the app (M3 step 8, D68): the picture compiled by
// TeX in the engine worker, shown over the native drawing once it matches
// the code. Compiles start a moment after the code stops changing; while the
// code and the compiled picture differ, the native drawing shows.

import { computed, effect, signal } from "@preact/signals";
import { EngineClient, type EngineState } from "../engine/client.ts";
import { buildCompileInput, type CompileInput, sourceLine } from "../engine/input.ts";
import type { TexError } from "../engine/log.ts";
import type { CompileOutcome } from "../engine/protocol.ts";
import { engineBase } from "../engine/release.ts";
import type { Range } from "../model/syntax.ts";
import { currentPicture, doc, overrides, previewLayout, revealInCode, text } from "./store.ts";

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
export function setPreviewMode(m: PreviewMode): void {
  previewMode.value = m;
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

/** A TeX error with the line of the user's code it happened on, if it was in the user's code. */
export interface PreviewError extends TexError {
  sourceLine: number | null;
}

/** Errors of the latest compile, mapped to the source (they may be of an older version of the code). */
export const previewErrors = computed<PreviewError[]>(() => {
  const c = compiled.value;
  if (!c || previewMode.value !== "accurate") return [];
  return c.outcome.errors.map((e) => ({ ...e, sourceLine: e.file === "input.tex" && e.line !== null ? sourceLine(c.input, e.line) : null }));
});

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
  // Packages and classes only: TeX and TikZ look for many optional files (configurations,
  // tikzlibrary… before pgflibrary…), and not finding those is normal.
  const files = c.outcome.missingFiles.filter((f) => /\.(sty|cls)$/.test(f));
  if (files.length) out.push(`TeX asked for files the preview doesn't have: ${list(files.slice(0, 6))}${files.length > 6 ? ", …" : ""}.`);
  if (c.outcome.missingFonts.length) out.push(`Text in ${list(c.outcome.missingFonts)} isn't drawn: the preview has only Computer Modern and the AMS fonts.`);
  if (c.outcome.aborted) out.push("TeX gave up before the end of the picture, so the accurate preview is missing.");
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
const DEBOUNCE_MS = 250;

/** Starts the engine and compiles the code whenever it settles. Returns a function that stops it. */
export function startPreview(base = engineBase(new URLSearchParams(location.search).get("engine"))): () => void {
  client = new EngineClient(base);
  client.onState = (s) => (engineState.value = s);
  engineState.value = client.state;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let available: Set<string> | null = null;
  void client.ready().then(
    (index) => {
      available = new Set(index.texFiles);
      schedule();
    },
    () => {},
  );

  const run = async () => {
    timer = null;
    const c = client;
    if (!c || !available || previewMode.peek() !== "accurate") return;
    const t = text.peek();
    const picture = currentPicture.peek();
    const input = buildCompileInput(doc.peek(), picture, (f) => available!.has(f));
    if (!input) {
      compiling.value = false;
      return;
    }
    const prev = compiled.peek();
    if (prev && prev.input.tex === input.tex) {
      // Nothing TeX sees changed (an edit outside the picture): the output still holds.
      compiled.value = { ...prev, text: t, picture, input };
      compiling.value = false;
      return;
    }
    compiling.value = true;
    try {
      const outcome = await c.compile(input.tex);
      if (!outcome) return; // replaced by a newer compile
      compiled.value = { text: t, picture, input, outcome };
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
    if (previewMode.value !== "accurate") return;
    selectedBlock.value = null;
    compiling.value = true;
    schedule();
  });
  return () => {
    stop();
    if (timer) clearTimeout(timer);
    client?.dispose();
    client = null;
  };
}
