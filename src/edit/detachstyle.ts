// Detach from style (M6 step 1, D102): a node that names one of the
// document's styles gets that style's options written into its own, so later
// edits of the style don't reach it. The style's keys go where its name was,
// which is how TikZ applies a style, so the node looks exactly as before;
// styles the style itself uses are expanded too, and a key the node sets again
// later in its own options is left out. Checked by laying the picture out.
import { analyzeDocument, layoutDocumentPicture } from "../model/document.ts";
import type { OptionItem } from "../model/syntax.ts";
import type { LaidOutNode, PictureLayout } from "../tikz/layout.ts";
import { parseOptionString } from "../tikz/options.ts";
import { applyChanges, type Change } from "./changes.ts";
import { removeItems } from "./optionEdits.ts";
import { definedStyleNames, nodeStyles, type StyleSite, styleChain, styleSites } from "./styles.ts";

export type DetachStyleOutcome = { ok: true; changes: Change[]; text: string; nodes: number } | { ok: false; reason: string };

/** Keys where only the last value counts: one the node sets itself after the style needn't be copied. */
const LAST_WINS = new Set([
  "fill",
  "draw",
  "text",
  "color",
  "font",
  "align",
  "shape",
  "minimum width",
  "minimum height",
  "minimum size",
  "text width",
  "inner sep",
  "inner xsep",
  "inner ysep",
  "outer sep",
  "line width",
  "rounded corners",
  "opacity",
  "fill opacity",
  "draw opacity",
  "text opacity",
]);

/** The styles of the document a node names in its own options. */
export function nodeDocumentStyles(text: string, picIndex: number, node: LaidOutNode): string[] {
  const doc = analyzeDocument(text);
  const pic = doc.syntax.pictures[picIndex];
  return pic ? nodeStyles(node.syntax, definedStyleNames(styleSites(doc, pic))) : [];
}

/** The keys style `name` stands for, with `arg` for #1, every document style in them expanded; or why it can't be done. */
function expand(text: string, sites: readonly StyleSite[], defined: ReadonlySet<string>, name: string, arg: string | undefined, depth = 0): string[] | string {
  if (depth > 20) return `The ${name} style refers to itself, so it can't be copied.`;
  const chain = styleChain(sites, name);
  if (!chain.length) return `The ${name} style isn't defined where the editor can read it.`;
  const fallback = sites.flatMap((s) => s.defs).filter((d) => d.name === name && d.defaultArg !== undefined).at(-1)?.defaultArg;
  const out: string[] = [];
  for (const def of chain) {
    const handler = /\/\.\s*(style 2 args|append style|prefix style|estyle|style|code)\b/.exec(text.slice(def.from, def.to))?.[1];
    if (handler !== "style" && handler !== "append style") return `The ${name} style is written with /.${handler ?? "a handler"}, which the editor can't copy onto a node.`;
    if (/#[2-9]/.test(def.bodyText)) return `The ${name} style takes more than one argument, which the editor can't copy onto a node.`;
    const body = def.bodyText.replace(/#1/g, arg ?? fallback ?? "");
    for (const kv of parseOptionString(body)) {
      if (defined.has(kv.key) && kv.key !== name) {
        const inner = expand(text, sites, defined, kv.key, kv.value, depth + 1);
        if (typeof inner === "string") return inner;
        out.push(...inner);
      } else if (kv.key === name) return `The ${name} style refers to itself, so it can't be copied.`;
      else out.push(kv.value === undefined ? kv.key : `${kv.key}=${kv.value}`);
    }
  }
  return out;
}

/** What a node looks like and where it is, to check that nothing changed. */
function look(n: LaidOutNode): string {
  const r = (v: number) => Math.round(v * 20) / 20;
  return JSON.stringify([
    n.shape.kind,
    r(n.shape.center.x),
    r(n.shape.center.y),
    r(n.shape.hw),
    r(n.shape.hh),
    n.fill,
    n.stroke,
    n.textColor,
    r(n.lineWidth),
    n.dash,
    n.opacity,
    n.fillOpacity,
    n.text ? [r(n.text.width), r(n.text.height), r(n.text.depth)] : null,
  ]);
}

function sameLook(a: PictureLayout, b: PictureLayout): string | null {
  for (const n of a.nodes) {
    const m = b.nodes.find((x) => x.id === n.id);
    if (!m || look(m) !== look(n)) return n.name ?? "a node";
  }
  return null;
}

/** Copies style `name` into the options of the nodes `ids` that name it. */
export function planDetachStyle(text: string, picIndex: number, ids: readonly string[], name: string): DetachStyleOutcome {
  const doc = analyzeDocument(text);
  const pic = doc.syntax.pictures[picIndex];
  const layout = layoutDocumentPicture(doc, picIndex);
  if (!pic || !layout) return { ok: false, reason: "There is no picture." };
  const sites = styleSites(doc, pic);
  const defined = definedStyleNames(sites);
  const changes: Change[] = [];
  let count = 0;
  for (const n of layout.nodes) {
    if (!ids.includes(n.id) || n.kind === "path") continue;
    const own = n.syntax.options.flatMap((list) => list.items.map((item) => ({ list, item })));
    const uses = own.filter(({ item }) => item.key === name);
    if (!uses.length) continue;
    count++;
    for (const { list, item } of uses) {
      const keys = expand(text, sites, defined, name, item.value);
      if (typeof keys === "string") return { ok: false, reason: keys };
      // A key the node sets again after the style would be overridden anyway.
      const later = new Set(own.filter(({ item: i }) => i.from > item.from).map(({ item: i }) => i.key));
      const kept = keys.filter((k) => {
        const key = k.split("=")[0]!.trim();
        return !(LAST_WINS.has(key) && later.has(key));
      });
      if (kept.length) changes.push({ from: item.from, to: item.to, insert: kept.join(", ") });
      else changes.push(...removeItems(text, list, [item as OptionItem]));
    }
  }
  if (!count) return { ok: false, reason: `None of the selected nodes names the ${name} style in its own options.` };
  const next = applyChanges(text, changes);
  const after = layoutDocumentPicture(analyzeDocument(next), picIndex);
  if (!after) return { ok: false, reason: "The picture couldn't be laid out after copying the style." };
  const changed = sameLook(layout, after);
  if (changed) return { ok: false, reason: `Copying the ${name} style's options would change how ${changed} looks, so nothing was changed.` };
  return { ok: true, changes, text: next, nodes: count };
}
