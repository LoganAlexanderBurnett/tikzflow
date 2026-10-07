// Library management: loading the TikZ libraries an edit relies on, and
// removing ones an edit made unused. Removal is deliberately conservative
// (D34): a library goes only when an edit removed its last use and nothing in
// the whole document text, blocks kept as-is included, still mentions it.
import { analyzeDocument, type DocumentModel } from "../model/document.ts";
import type { OptionList, PictureSyntax, Range } from "../model/syntax.ts";
import { SHAPE_LIBRARY } from "../tikz/keys.ts";
import { applyChanges, type Change } from "./changes.ts";
import { appendItem, removeItems } from "./optionEdits.ts";
import { preambleAnchor } from "./styles.ts";
import { eolNear, lineEnd, lineStart } from "./text.ts";

export type LibraryResult =
  /** Already loaded, or added by `change`. */
  | { ok: true; change?: Change }
  /** A bare picture: the libraries live in a preamble the editor can't see. */
  | { ok: false; reason: string };

/** Libraries that load others: chains and tikz-ext's positioning-plus load positioning; "shapes" loads every shapes library. */
const IMPLIES: Record<string, string[]> = {
  chains: ["positioning"],
  "ext.positioning-plus": ["positioning"],
  shapes: ["shapes.geometric", "shapes.misc", "shapes.symbols", "shapes.arrows", "shapes.multipart", "shapes.callouts"],
};

export function libraryLoaded(doc: DocumentModel, pic: PictureSyntax, library: string): boolean {
  const provides = (n: string) => n === library || IMPLIES[n]?.includes(library);
  for (const item of doc.syntax.preamble) {
    if (item.range.from >= pic.from) break;
    if (item.kind === "library" && item.names.some(provides)) return true;
  }
  return pic.items.some((i) => i.kind === "library" && i.names.some(provides));
}

/** The libraries a shape needs, e.g. ["shapes.geometric"] for a diamond. */
export function shapeLibraries(shape: string): string[] {
  const lib = SHAPE_LIBRARY[shape];
  return lib ? [lib] : [];
}

/**
 * Returns the change that loads `libraries` for picture `pic`: added to the
 * last \usetikzlibrary before it, or as a new line after \usepackage{tikz} or
 * the \documentclass line.
 */
export function ensureLibraries(doc: DocumentModel, pic: PictureSyntax, libraries: readonly string[]): LibraryResult {
  const missing = [...new Set(libraries)].filter((l) => !libraryLoaded(doc, pic, l));
  if (!missing.length) return { ok: true };
  const text = doc.text;
  let last: OptionList | undefined;
  for (const item of doc.syntax.preamble) {
    if (item.range.from >= pic.from) break;
    if (item.kind === "library" && item.list) last = item.list;
  }
  if (last) {
    if (!last.items.length) return { ok: true, change: { from: last.from + 1, to: last.to - 1, insert: missing.join(", ") } };
    // "\usetikzlibrary{a, b,}": a trailing comma takes the names directly.
    const lastItem = last.items[last.items.length - 1]!;
    if (last.commas.some((c) => c > lastItem.to)) {
      const comma = Math.max(...last.commas);
      return { ok: true, change: { from: comma + 1, to: comma + 1, insert: missing.map((l) => ` ${l},`).join("") } };
    }
    const first = appendItem(text, last, missing[0]!);
    const sep = first.insert.slice(0, first.insert.length - missing[0]!.length);
    return { ok: true, change: { ...first, insert: first.insert + missing.slice(1).map((l) => sep + l).join("") } };
  }
  const anchor = preambleAnchor(doc, pic);
  if (anchor < 0) {
    const list = missing.join(", ");
    return { ok: false, reason: `this picture needs \\usetikzlibrary{${list}} in your document's preamble` };
  }
  const at = lineEnd(text, anchor);
  return { ok: true, change: { from: at, to: at, insert: `${eolNear(text, anchor)}\\usetikzlibrary{${missing.join(", ")}}` } };
}

export function ensureLibrary(doc: DocumentModel, pic: PictureSyntax, library: string): LibraryResult {
  return ensureLibraries(doc, pic, [library]);
}

const word = (names: readonly string[]) => new RegExp(`(^|[^A-Za-z])(${names.map((n) => n.replace(/ /g, "\\s+")).join("|")})(?![A-Za-z])`, "i");

const SHAPES: Record<string, string[]> = {
  "shapes.geometric": ["diamond", "trapezium", "ellipse", "cylinder", "regular polygon", "star", "isosceles triangle", "kite", "dart", "circular sector", "semicircle"],
  "shapes.misc": ["rounded rectangle", "chamfered rectangle", "cross out", "strike out"],
  "shapes.symbols": ["tape", "cloud", "signal", "starburst", "magnetic tape", "forbidden sign", "correct forbidden sign", "magnifying glass"],
  "shapes.arrows": ["single arrow", "double arrow", "arrow box"],
  "shapes.multipart": ["circle split", "circle solidus", "ellipse split", "rectangle split"],
};

/**
 * Text patterns that may be a use of a library. They are generous on purpose:
 * a false match only keeps a library loaded. Libraries without an entry are
 * never removed.
 */
const USES: Record<string, RegExp[]> = {
  positioning: [/\b(above|below|left|right)(\s+(left|right))?\s*=[^,\]]*\bof\b/, /\bon\s+grid\b/, /\b(base|mid)\s+(left|right)\b/],
  ...Object.fromEntries(Object.entries(SHAPES).map(([lib, names]) => [lib, [word(names)]])),
  shapes: [word(Object.values(SHAPES).flat()), /callout/i],
  "arrows.meta": [
    /\b(Stealth|Latex|Triangle|Kite|Square|Circle|Rays|Bar|Bracket|Hooks|Arc Barb|Straight Barb|Tee Barb|Implies|To|Ellipse|Diamond|Parenthesis|Rectangle|Classical TikZ Rightarrow|Computer Modern Rightarrow|Butt Cap|Round Cap|Triangle Cap|Fast Triangle|Fast Round)\b/,
  ],
  fit: [/\bfit\b/],
  backgrounds: [/background/],
  calc: [/\(\s*\$/, /\$\s*\)/],
};

/** Whether `text` may use `library`. Libraries without patterns always count as used. */
export function mayUseLibrary(text: string, library: string): boolean {
  const patterns = USES[library];
  return !patterns || patterns.some((p) => p.test(text));
}

/** The document text with every \usetikzlibrary command blanked out. */
function withoutLibraryLines(doc: DocumentModel): string {
  const ranges: Range[] = [];
  for (const item of doc.syntax.preamble) if (item.kind === "library") ranges.push(item.range);
  for (const pic of doc.syntax.pictures) for (const item of pic.items) if (item.kind === "library") ranges.push(item.range);
  let out = doc.text;
  for (const r of ranges) out = out.slice(0, r.from) + " ".repeat(r.to - r.from) + out.slice(r.to);
  return out;
}

/** Changes that remove `library` from every \usetikzlibrary list before `pic`, deleting lists that become empty. */
function removeLibrary(doc: DocumentModel, pic: PictureSyntax, library: string): Change[] {
  const text = doc.text;
  const changes: Change[] = [];
  for (const item of doc.syntax.preamble) {
    if (item.range.from >= pic.from) break;
    if (item.kind !== "library" || !item.list) continue;
    const hits = item.list.items.filter((i) => i.key === library);
    if (!hits.length) continue;
    if (hits.length < item.list.items.length) {
      changes.push(...removeItems(text, item.list, hits));
      continue;
    }
    // The whole command goes, with its line if it was alone on it.
    const ls = lineStart(text, item.range.from);
    const le = lineEnd(text, item.range.to);
    const alone = /^[ \t]*$/.test(text.slice(ls, item.range.from)) && /^[ \t]*(%.*)?$/.test(text.slice(item.range.to, le));
    if (alone && !text.slice(item.range.to, le).includes("%")) {
      const next = text.indexOf("\n", le);
      changes.push({ from: ls, to: next < 0 ? text.length : next + 1, insert: "" });
    } else changes.push({ from: item.range.from, to: item.range.to, insert: "" });
  }
  return changes;
}

export interface LibraryEdit {
  /** The edit's changes plus the library changes, against the original text. */
  changes: Change[];
  added: string[];
  removed: string[];
  /** Libraries to add by hand, for a bare picture. */
  notes: string[];
}

/**
 * Adds the library changes an edit needs: loads `needed`, and removes
 * libraries the edit made unused under the conservative rule.
 */
export function withLibraries(text: string, picIndex: number, changes: readonly Change[], needed: readonly string[] = []): LibraryEdit {
  const doc = analyzeDocument(text);
  const pic = doc.syntax.pictures[picIndex];
  const out: LibraryEdit = { changes: [...changes], added: [], removed: [], notes: [] };
  if (!pic) return out;
  const lib = ensureLibraries(doc, pic, needed);
  if (!lib.ok) out.notes.push(lib.reason);
  else if (lib.change) {
    out.changes.unshift(lib.change);
    out.added.push(...needed.filter((l) => !libraryLoaded(doc, pic, l)));
  }
  const before = withoutLibraryLines(doc);
  const after = withoutLibraryLines(analyzeDocument(applyChanges(text, changes)));
  const loaded = new Set<string>();
  for (const item of doc.syntax.preamble) {
    if (item.range.from >= pic.from) break;
    if (item.kind === "library") for (const n of item.names) loaded.add(n);
  }
  for (const name of loaded) {
    if (needed.includes(name) || !USES[name]) continue;
    if (!mayUseLibrary(before, name) || mayUseLibrary(after, name)) continue;
    const removal = removeLibrary(doc, pic, name);
    // Never touch bytes another change in this edit touches.
    if (removal.some((r) => out.changes.some((c) => c.from <= r.to && r.from <= c.to))) continue;
    out.changes.push(...removal);
    out.removed.push(name);
  }
  return out;
}
