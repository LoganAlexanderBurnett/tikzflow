// The document model: parse, extract, and lay out pictures with the
// definitions that come before them.
import { IterMode, type Tree } from "@lezer/common";
import { parser } from "../parser/parser.ts";
import type { Macro } from "../text/label.ts";
import { ColorTable } from "../tikz/colors.ts";
import { builtinStyles } from "../tikz/keys.ts";
import { type LayoutEnv, layoutPicture, type PictureLayout } from "../tikz/layout.ts";
import type { KeyValue } from "../tikz/options.ts";
import { fontSizes, type SizeTable } from "../tikz/state.ts";
import type { Point } from "../tikz/shapes.ts";
import { type DocumentSyntax, documentSyntax, type PictureSyntax, type Range } from "./syntax.ts";

export interface DocumentModel {
  text: string;
  tree: Tree;
  syntax: DocumentSyntax;
  /** Syntax errors in the whole document: the number of places with parse errors. */
  errorCount: number;
  /** Where they are, in document order. Zero-length ones mark a missing token. */
  errors: Range[];
}

export function analyzeDocument(text: string): DocumentModel {
  // Always a full parse: the model must not depend on edit history (D17).
  const tree = parser.parse(text);
  // Error nodes, one per place: recovery can leave nested or repeated
  // markers at the same position.
  const errors: Range[] = [];
  tree.iterate({
    mode: IterMode.IncludeAnonymous,
    enter: (n) => {
      if (!n.type.isError) return;
      const last = errors[errors.length - 1];
      if (last && n.from < Math.max(last.to, last.from + 1)) last.to = Math.max(last.to, n.to);
      else errors.push({ from: n.from, to: n.to });
    },
  });
  return { text, tree, syntax: documentSyntax(tree, text), errorCount: errors.length, errors };
}

/** Styles, colours, macros and settings defined before `pic`. */
export function pictureEnv(doc: DocumentModel, pic: PictureSyntax): LayoutEnv {
  const styles = builtinStyles();
  const colors = new ColorTable();
  const macros = new Map<string, Macro>();
  const settings: KeyValue[] = [];
  for (const item of doc.syntax.preamble) {
    if (item.range.from >= pic.from) break;
    if (item.kind === "styles") {
      for (const d of item.defs) {
        if (d.defaultArg !== undefined) styles.setDefault(d.name, d.defaultArg);
        else if (d.mode === "append") styles.append(d.name, d.bodyText);
        else styles.set(d.name, d.bodyText);
      }
      for (const list of item.settings) for (const i of list.items) settings.push(i.value === undefined ? { key: i.key } : { key: i.key, value: i.value });
    } else if (item.kind === "definition") {
      const def = item.def;
      if (def.kind === "color") colors.define(def.name, def.model, def.spec);
      else if (def.kind === "colorlet") {
        const c = colors.parse(def.expr);
        if (c) colors.set(def.name, c);
      } else {
        const m: Macro = { params: def.params, body: def.body };
        if (def.defaultArg !== undefined) m.defaultArg = def.defaultArg;
        macros.set(def.name, m);
      }
    }
  }
  const before = doc.text.slice(0, pic.from);
  const env: LayoutEnv = { styles, colors, macros, settings, font: classFont(before) };
  // Only a document with a preamble says which libraries it loads.
  if (/\\documentclass|\\usetikzlibrary/.test(before)) env.libraries = librariesBefore(doc, pic);
  return env;
}

/** The base font a \documentclass line implies: its size option, and sans serif for beamer. */
export function classFont(before: string): { sizes: SizeTable; family: "rm" | "sf" } {
  const m = /\\documentclass\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/.exec(before);
  const options = m?.[1] ?? "";
  const cls = (m?.[2] ?? "").trim();
  const size = /\b(10|11|12)pt\b/.exec(options)?.[1];
  const beamer = cls === "beamer";
  return { sizes: fontSizes(size ? +size : beamer ? 11 : 10), family: beamer ? "sf" : "rm" };
}

export function layoutDocumentPicture(doc: DocumentModel, index: number, overrides?: ReadonlyMap<string, Point>): PictureLayout | null {
  const pic = doc.syntax.pictures[index];
  if (!pic) return null;
  return layoutPicture(pic, pictureEnv(doc, pic), overrides);
}

/** Libraries loaded before `pic`. */
export function librariesBefore(doc: DocumentModel, pic: PictureSyntax): string[] {
  const out: string[] = [];
  for (const item of doc.syntax.preamble) {
    if (item.range.from >= pic.from) break;
    if (item.kind === "library") out.push(...item.names);
  }
  for (const item of pic.items) if (item.kind === "library") out.push(...item.names);
  return [...new Set(out)];
}
