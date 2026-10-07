// Names for new nodes: meaningful (taken from the label's words), unique in
// the picture, and in the document's own naming style. Labels without usable
// words (pure math, symbols, other scripts) fall back to the node's style or
// shape plus a number, e.g. "decision2" (D34).
import type { DocumentModel } from "../model/document.ts";
import type { PictureSyntax } from "../model/syntax.ts";
import type { PictureLayout } from "../tikz/layout.ts";

export type NameStyle = "camel" | "snake" | "kebab";

/** Small words dropped from names unless nothing else is left. */
const STOP = new Set(["a", "an", "the", "of", "to", "and", "or", "for", "in", "on", "at", "is", "be", "by", "with", "from", "into", "as"]);
/** At most this many words go into a name. */
const MAX_WORDS = 3;
const MAX_LENGTH = 24;

/** The words of a label, with TeX markup, math and accents removed. */
export function labelWords(label: string): string[] {
  const t = label
    .replace(/(^|[^\\])%[^\n]*/g, "$1")
    .replace(/\$\$[\s\S]*?\$\$|\$[^$]*\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g, " ")
    .replace(/\\\\(\[[^\]]*\])?/g, " ")
    // Accent commands ("\'e", "\"o") keep their letter.
    .replace(/\\['"`^~=.]\{?([A-Za-z])\}?/g, "$1")
    .replace(/\\[A-Za-z@]+\*?/g, " ")
    .replace(/\\./g, " ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  return t.split(/[^A-Za-z0-9]+/).filter(Boolean);
}

/** The naming style most of `names` use; camelCase when there's nothing to go by. */
export function nameStyle(names: Iterable<string>): NameStyle {
  let camel = 0;
  let snake = 0;
  let kebab = 0;
  for (const n of names) {
    if (n.includes("_")) snake++;
    else if (n.includes("-")) kebab++;
    else if (/[a-z][A-Z]/.test(n)) camel++;
  }
  if (snake > camel && snake >= kebab) return "snake";
  if (kebab > camel && kebab > snake) return "kebab";
  return "camel";
}

function join(words: string[], style: NameStyle): string {
  const lower = words.map((w) => (/^[A-Z0-9]+$/.test(w) && w.length > 1 ? w : w.toLowerCase()));
  if (style === "snake") return lower.join("_");
  if (style === "kebab") return lower.join("-");
  return lower.map((w, i) => (i === 0 ? w : w[0]!.toUpperCase() + w.slice(1))).join("");
}

/** A base name from label words, or "" if the label has none. */
export function baseName(label: string, style: NameStyle): string {
  const words = labelWords(label);
  const content = words.filter((w) => !STOP.has(w.toLowerCase()));
  const chosen = (content.length ? content : words).slice(0, MAX_WORDS);
  let name = join(chosen, style);
  // Shorten word by word rather than cutting one in half.
  while (name.length > MAX_LENGTH && chosen.length > 1) {
    chosen.pop();
    name = join(chosen, style);
  }
  if (name.length > MAX_LENGTH) name = name.slice(0, MAX_LENGTH);
  // A name that starts with a digit reads like a coordinate.
  return /^[0-9]/.test(name) ? `n${name}` : name;
}

/** Turns a style or shape name ("rounded rectangle") into a fallback base ("roundedRectangle"). */
function fallbackBase(fallback: string, style: NameStyle): string {
  const words = fallback.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const base = words.length ? join(words, style) : "node";
  return /^[0-9]/.test(base) ? `n${base}` : base;
}

/**
 * A unique name for a new node labelled `label`. `fallback` is its style or
 * shape, used when the label has no words. Repeats get a number: "start2";
 * fallback names always do: "decision1".
 */
export function newNodeName(label: string, taken: ReadonlySet<string>, fallback: string, style: NameStyle = "camel"): string {
  const base = baseName(label, style);
  if (base && !taken.has(base)) return base;
  const stem = base || fallbackBase(fallback, style);
  const sep = style === "camel" || !/[0-9]$/.test(stem) ? "" : style === "snake" ? "_" : "-";
  for (let i = base ? 2 : 1; ; i++) {
    const n = `${stem}${sep}${i}`;
    if (!taken.has(n)) return n;
  }
}

/**
 * Names already used in picture `pic`: laid-out nodes and coordinates, names
 * inside blocks kept as-is, bounding boxes, and anything written as "(name)"
 * or "name=" in its text, so names hidden in code the editor can't model
 * aren't reused.
 */
export function takenNames(doc: DocumentModel, pic: PictureSyntax, layout: PictureLayout): Set<string> {
  const out = new Set<string>();
  for (const n of layout.nodes) if (n.name) out.add(n.name);
  for (const n of layout.opaqueNames) out.add(n);
  for (const n of layout.boxes.keys()) out.add(n);
  const body = doc.text.slice(pic.from, pic.to);
  for (const m of body.matchAll(/\(\s*([A-Za-z][A-Za-z0-9_\-]*)\s*\)/g)) out.add(m[1]!);
  for (const m of body.matchAll(/\bname\s*=\s*\{?\s*([A-Za-z0-9_\-]+)/g)) out.add(m[1]!);
  return out;
}
