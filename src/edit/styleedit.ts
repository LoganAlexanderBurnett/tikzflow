// The style panel's edits (D42): changing a style's definition, which changes
// every node that uses it, and factoring options that several nodes repeat
// into a new named style.
import { analyzeDocument, type DocumentModel, layoutDocumentPicture } from "../model/document.ts";
import type { OptionItem, PictureSyntax, Range } from "../model/syntax.ts";
import { KNOWN_SHAPES } from "../tikz/keys.ts";
import type { LaidOutNode, PictureLayout } from "../tikz/layout.ts";
import { applyChanges, type Change, diffRange } from "./changes.ts";
import { draftOf, labelProblem } from "./label.ts";
import { isPlacementKey } from "./move.ts";
import { removeItems } from "./optionEdits.ts";
import { styleUsers } from "./properties.ts";
import { addStyles, definedStyleNames, styleChain, styleSites } from "./styles.ts";
import { eolNear } from "./text.ts";

// ---------------------------------------------------------------- the style list

export interface StyleInfo {
  name: string;
  /** Nodes that use the style, directly or through another style. */
  users: LaidOutNode[];
  /** The text between the braces of the definition that is in effect. Undefined if it can't be edited. */
  body?: string;
  /** Why it can't be edited, when it can't. */
  reason?: string;
  /** Later `.append style` definitions, which the panel leaves to the code. */
  appended: number;
}

/** The styles the picture defines, with how many nodes use them. TikZ's own "every …" styles are left out. */
export function styleInfos(doc: DocumentModel, pic: PictureSyntax, layout: PictureLayout): StyleInfo[] {
  const sites = styleSites(doc, pic);
  const out: StyleInfo[] = [];
  for (const name of definedStyleNames(sites)) {
    const chain = styleChain(sites, name);
    const base = chain.find((d) => d.mode === "set");
    if (!chain.length) continue;
    const info: StyleInfo = { name, users: styleUsers(sites, layout, name), appended: chain.filter((d) => d.mode === "append").length };
    if (!base?.body || !["{", "["].includes(doc.text[base.body.from] ?? "")) info.reason = "This style isn't written in a form the editor can change.";
    else if (/#\d/.test(base.bodyText)) info.reason = "This style takes an argument (#1), so it is changed in the code.";
    else info.body = draftOf(doc.text.slice(base.body.from + 1, base.body.to - 1));
    out.push(info);
  }
  return out;
}

export type StyleEditOutcome = { ok: true; changes: Change[]; text: string; users: number } | { ok: false; reason: string };

/** Why `draft` can't be the inside of a style body written with `open`, or null. */
export function styleBodyProblem(draft: string, open: "{" | "["): string | null {
  const p = labelProblem(draft);
  if (p) return p.replace("The label can't", "The style can't").replace("label", "style");
  if (open === "[") {
    let depth = 0;
    for (let i = 0; i < draft.length; i++) {
      const ch = draft[i]!;
      if (ch === "\\") i++;
      else if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (depth === 0 && ch === "]") return 'There is a "]" with no matching "[". Put the option in braces to use one.';
    }
  }
  return null;
}

/**
 * The change that gives style `name` the body `draft`. Only the characters
 * that differ are replaced, and the patched code is parsed again to make sure
 * the style, the nodes and the syntax errors are still what they were.
 */
export function planStyleEdit(text: string, picIndex: number, name: string, draft: string): StyleEditOutcome {
  const doc = analyzeDocument(text);
  const pic = doc.syntax.pictures[picIndex];
  const layout = layoutDocumentPicture(doc, picIndex);
  if (!pic || !layout) return { ok: false, reason: "There is no picture." };
  const info = styleInfos(doc, pic, layout).find((s) => s.name === name);
  if (!info) return { ok: false, reason: `There is no style called ${name}.` };
  if (info.body === undefined) return { ok: false, reason: info.reason ?? "This style can't be changed here." };
  const sites = styleSites(doc, pic);
  const def = styleChain(sites, name).find((d) => d.mode === "set")!;
  const open = text[def.body!.from] as "{" | "[";
  const problem = styleBodyProblem(draft, open);
  if (problem) return { ok: false, reason: problem };
  const inner = { from: def.body!.from + 1, to: def.body!.to - 1 };
  const eol = eolNear(text, inner.from);
  const next = eol === "\r\n" ? draft.replace(/\r?\n/g, "\r\n") : draft;
  const d = diffRange(text.slice(inner.from, inner.to), next);
  if (!d) return { ok: true, changes: [], text, users: info.users.length };
  const changes: Change[] = [{ from: inner.from + d.from, to: inner.from + d.to, insert: d.insert }];
  const after = applyChanges(text, changes);
  const doc2 = analyzeDocument(after);
  const laid = layoutDocumentPicture(doc2, picIndex);
  const same = laid && laid.nodes.length === layout.nodes.length;
  const defs = (d: DocumentModel) => d.syntax.pictures[picIndex] && [...definedStyleNames(styleSites(d, d.syntax.pictures[picIndex]!))].sort().join("|");
  if (!same || doc2.errors.length > doc.errors.length || defs(doc2) !== defs(doc)) {
    return { ok: false, reason: "That text would change the structure of the code around it, so it wasn't applied." };
  }
  return { ok: true, changes, text: after, users: info.users.length };
}

// ---------------------------------------------------------------- repeated options

/** A set of option items that several nodes write out themselves. */
export interface Repeat {
  /** The items as written, in the order the first node has them. */
  items: string[];
  /** Ids of the nodes that have all of them. */
  nodes: string[];
  /** A style name that isn't taken. */
  suggestion: string;
}

/** Keys that say where a node is or what it is called, not how it looks. */
const NOT_APPEARANCE = /^(name|at|alias|label.*|pin.*|on chain|join.*|fit|late options|node contents|inner.*sep.*anchor|anchor|rotate|every .*)$/;

/** The own, factorable options of a node as written: appearance only, no placement, no document styles. */
function ownItems(doc: DocumentModel, node: LaidOutNode, styles: ReadonlySet<string>): Array<{ text: string; item: OptionItem; list: number }> {
  const out: Array<{ text: string; item: OptionItem; list: number }> = [];
  node.syntax.options.forEach((list, li) => {
    for (const item of list.items) {
      if (!item.key || isPlacementKey(item.key) || NOT_APPEARANCE.test(item.key) || styles.has(item.key)) continue;
      if (/\bof\b/.test(item.value ?? "") && /^(above|below|left|right)/.test(item.key)) continue;
      out.push({ text: doc.text.slice(item.from, item.to).replace(/\s+/g, " ").trim(), item, list: li });
    }
  });
  return out;
}

const MIN_SCORE = 6;

/**
 * Sets of two or more options that at least two nodes write out in full. A
 * set is offered when it covers at least six items in all (three nodes with
 * two options, two nodes with three) and no larger set is shared by as many
 * nodes. The best come first.
 */
export function findRepeats(doc: DocumentModel, pic: PictureSyntax, layout: PictureLayout): Repeat[] {
  const styles = definedStyleNames(styleSites(doc, pic));
  const nodes = layout.nodes.filter((n) => n.kind === "statement").slice(0, 300);
  const items = nodes.map((n) => ownItems(doc, n, styles).map((i) => i.text));
  const sets = items.map((l) => new Set(l));
  const candidates = new Map<string, string[]>();
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const common = items[i]!.filter((t) => sets[j]!.has(t));
      const unique = [...new Set(common)];
      if (unique.length >= 2) candidates.set(unique.join("\u0000"), unique);
    }
  }
  const scored = [...candidates.values()].map((set) => {
    const holders = nodes.filter((_, k) => set.every((t) => sets[k]!.has(t)));
    return { set, holders };
  });
  const kept = scored.filter((c) => c.holders.length >= 2 && c.holders.length * c.set.length >= MIN_SCORE);
  // Drop a set when a larger one is held by as many nodes.
  const maximal = kept.filter((c) => !kept.some((o) => o !== c && o.set.length > c.set.length && o.holders.length >= c.holders.length && c.set.every((t) => o.set.includes(t))));
  maximal.sort((a, b) => b.holders.length * b.set.length - a.holders.length * a.set.length || a.set.join().localeCompare(b.set.join()));
  const taken = new Set(styles);
  return maximal.slice(0, 6).map((c) => {
    const name = uniqueStyleName(suggestStyleName(c.set), taken);
    taken.add(name);
    return { items: c.set, nodes: c.holders.map((n) => n.id), suggestion: name };
  });
}

/** Words that are keys or shapes in TikZ, so a style with that name would shadow them. */
const RESERVED = new Set([
  ...KNOWN_SHAPES,
  "draw", "fill", "text", "font", "shape", "color", "thick", "thin", "dashed", "dotted", "rounded", "align", "scale", "shift", "rotate", "node", "style", "every",
  "above", "below", "left", "right", "inner", "outer", "minimum", "opacity", "shade", "clip", "name", "label", "pin", "anchor", "at", "pos", "bend", "loop", "to", "in", "out",
]);

/** Why `name` can't be a new style's name, or null. */
export function styleNameProblem(doc: DocumentModel, pic: PictureSyntax, name: string): string | null {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) return "Use letters, digits, - or _, starting with a letter.";
  if (definedStyleNames(styleSites(doc, pic)).has(name)) return `There is already a style called ${name}.`;
  if (RESERVED.has(name.toLowerCase())) return `${name} is a TikZ key, so a style with that name would shadow it.`;
  return null;
}

const camel = (words: string[]) => words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0]!.toUpperCase() + w.slice(1).toLowerCase())).join("");

/** A name for a style made of `items`: its fill colour or shape, then "Box" or "Node". */
export function suggestStyleName(items: readonly string[]): string {
  const fill = items.map((i) => /^fill\s*=\s*\{?([A-Za-z]+)/.exec(i)?.[1]).find(Boolean);
  const shape = items.find((i) => KNOWN_SHAPES.has(i));
  if (fill && fill !== "none") return `${fill}Box`;
  if (shape) return `${camel(shape.split(" "))}Node`;
  if (items.some((i) => /^draw\b/.test(i))) return "boxed";
  return "nodeStyle";
}

function uniqueStyleName(base: string, taken: ReadonlySet<string>): string {
  let name = base;
  for (let i = 2; RESERVED.has(name.toLowerCase()) || taken.has(name); i++) name = `${base}${i}`;
  return name;
}

/** What shows of a node, for checking that an edit didn't change how it looks. */
function look(n: LaidOutNode): string {
  const r = (v: number) => Math.round(v * 100) / 100;
  return JSON.stringify([
    n.shape.kind,
    r(n.shape.center.x),
    r(n.shape.center.y),
    r(n.shape.hw),
    r(n.shape.hh),
    n.fill,
    n.stroke,
    n.lineWidth,
    n.dash,
    n.opacity,
    n.fillOpacity,
    n.textColor,
    n.text && [r(n.text.width), r(n.text.height)],
    n.shape.roundedCorners,
    n.shadow,
  ]);
}

export type FactorOutcome = { ok: true; changes: Change[]; text: string; nodes: number } | { ok: false; reason: string };

/**
 * Moves the options `repeat.items` out of every node that has them into a new
 * style `name`, which each of those nodes names in the first one's place. The
 * result is laid out and must look exactly as before; if it doesn't (an option
 * between them overrides one, say) nothing is written.
 */
export function planFactor(text: string, picIndex: number, repeat: Pick<Repeat, "items" | "nodes">, name: string): FactorOutcome {
  const doc = analyzeDocument(text);
  const pic = doc.syntax.pictures[picIndex];
  const layout = layoutDocumentPicture(doc, picIndex);
  if (!pic || !layout) return { ok: false, reason: "There is no picture." };
  const problem = styleNameProblem(doc, pic, name);
  if (problem) return { ok: false, reason: problem };
  const styles = definedStyleNames(styleSites(doc, pic));
  const wanted = new Set(repeat.items);
  const changes: Change[] = [];
  let touched = 0;
  for (const id of repeat.nodes) {
    const node = layout.nodes.find((n) => n.id === id);
    if (!node) continue;
    const mine = ownItems(doc, node, styles).filter((i) => wanted.has(i.text));
    if (new Set(mine.map((i) => i.text)).size < wanted.size) continue;
    touched++;
    // The first item gives its place to the style name; the rest go.
    const first = mine[0]!;
    changes.push({ from: first.item.from, to: first.item.to, insert: name });
    const byList = new Map<number, OptionItem[]>();
    for (const m of mine.slice(1)) byList.set(m.list, [...(byList.get(m.list) ?? []), m.item]);
    for (const [li, list] of byList) changes.push(...removeItems(text, node.syntax.options[li]!, list));
  }
  if (touched < 2) return { ok: false, reason: "Fewer than two nodes still repeat these options." };
  const body = repeat.items.join(", ");
  changes.unshift(addStyles(doc, pic, [{ name, body }]));
  let next: string;
  try {
    next = applyChanges(text, changes);
  } catch {
    return { ok: false, reason: "That edit would overlap another; make it in the code instead." };
  }
  const doc2 = analyzeDocument(next);
  const after = layoutDocumentPicture(doc2, picIndex);
  if (!after || doc2.errors.length > doc.errors.length) return { ok: false, reason: "That would break the code around it, so it wasn't applied." };
  const changed = layout.nodes.filter((n) => {
    const m = after.nodes.find((x) => x.id === n.id);
    return !m || look(m) !== look(n);
  });
  if (changed.length) {
    const first = changed[0]!;
    return { ok: false, reason: `Factoring these out would change how ${first.name ?? first.id} looks (an option between them overrides one), so it wasn't applied.` };
  }
  return { ok: true, changes, text: next, nodes: touched };
}

/** The range of a node's statement, for scrolling to it. */
export const statementRange = (n: LaidOutNode): Range => n.statement;
