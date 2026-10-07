// Resizing a node: turn the size the user dragged to into the options that
// give it (D38). Widths and heights are written as whole millimetres, never as
// the raw measured value, and the result is checked by laying the patched
// text out again.
import { analyzeDocument, type DocumentModel, layoutDocumentPicture } from "../model/document.ts";
import type { LaidOutNode, PictureLayout } from "../tikz/layout.ts";
import { PT_PER_UNIT } from "../tikz/units.ts";
import { applyChanges, type Change } from "./changes.ts";
import { formatDistance } from "./move.ts";
import { formatOption, nodeTarget } from "./optionEdits.ts";
import { setOptions, styleUsers, type Scope } from "./properties.ts";
import { styleSites, styleTarget } from "./styles.ts";

const MM = PT_PER_UNIT.mm!;
/** How far the drawn size may be from the wanted one and still count, in pt. */
const TOLERANCE = 0.75 * MM;

/** Shapes whose width follows the text width one for one, so a drag can rewrap the text. */
const REWRAP = new Set(["rectangle", "rounded rectangle", "tape", "document", "trapezium", "cylinder"]);

/** The size wanted for a node's drawn border, in canvas pt. An axis left out stays as it is. */
export interface SizeWant {
  w?: number;
  h?: number;
}

export type ResizeOutcome =
  | {
      ok: true;
      changes: Change[];
      text: string;
      /** The picture laid out after the change. */
      layout: PictureLayout;
      /** The items written, e.g. "minimum width=3cm". */
      written: string[];
      /** The drawn size after the change, in canvas pt. */
      size: { w: number; h: number };
      notes: string[];
    }
  | { ok: false; reason: string };

/** Why a node can't be resized by dragging, or null if it can. */
export function resizeBlocker(node: LaidOutNode): string | null {
  if (node.kind !== "statement") return "Only nodes can be resized.";
  if (node.lock?.kind === "fit") return "This node's size follows the nodes it fits.";
  if (node.vectorScale !== 1) return "This node is scaled with transform shape; change its size in the code.";
  if (node.unrendered.some((u) => /^the .* shape \(drawn as/.test(u))) return "The preview draws this shape approximately, so its size can't be dragged. Change it in the code.";
  return null;
}

const roundMM = (pt: number) => Math.round(pt / MM) * MM;
const roundUpMM = (pt: number) => Math.ceil(pt / MM - 1e-6) * MM;
const eq = (a: number, b: number) => Math.abs(a - b) < 0.01;

interface Item {
  key: "minimum width" | "minimum height" | "minimum size" | "text width";
  /** The length in pt. */
  pt: number;
}

/** The options that give the node `want`, before checking. */
function plan(node: LaidOutNode, want: SizeWant): { items: Item[]; target: { w: number; h: number } } {
  const s = node.sizing;
  const w0 = 2 * node.shape.hw;
  const h0 = 2 * node.shape.hh;
  const items: Item[] = [];
  if (node.shape.kind === "circle") {
    const d = Math.max(want.w ?? w0, want.h ?? h0, s.natural.w);
    const v = roundMM(d);
    if (!eq(v, w0) && v > s.natural.w + 0.01) items.push({ key: "minimum size", pt: v });
    else if (!eq(Math.max(v, s.natural.w), w0)) items.push({ key: "minimum size", pt: roundUpMM(s.natural.w) });
    const size = Math.max(d, s.natural.w);
    return { items, target: { w: size, h: size } };
  }

  let tw = w0;
  if (want.w !== undefined) {
    const wt = Math.max(want.w, 1);
    const pad = s.natural.w - (node.text?.width ?? 0);
    // The text rewraps if it already has a text width, or if the new width is
    // narrower than the text and there is a place to break it.
    const least = roundUpMM(Math.max(s.minContent(), 1));
    const text = Math.max(roundMM(wt - pad), least);
    const canBreak = s.textWidth !== undefined || text < (node.text?.width ?? 0) - 0.01;
    const rewrap = REWRAP.has(node.shape.kind) && node.text !== undefined && canBreak && (s.textWidth !== undefined || wt < s.natural.w - 0.01);
    if (rewrap) {
      // Set the text width, never narrower than the widest word.
      items.push({ key: "text width", pt: text });
      tw = Math.max(text + pad, s.min.w);
      // A minimum width that would keep the box wider has to come down too.
      if (s.min.w > text + pad + 0.01) {
        items.push({ key: "minimum width", pt: roundUpMM(text + pad) });
        tw = roundUpMM(text + pad);
      }
    } else {
      const v = wt <= s.natural.w + 0.01 ? s.natural.w : roundMM(wt);
      if (v > s.natural.w + 0.01) {
        items.push({ key: "minimum width", pt: v });
        tw = v;
      } else {
        tw = s.natural.w;
        // Back to the natural width: a minimum inherited from a style has to be overridden.
        if (s.min.w > s.natural.w + 0.01) {
          items.push({ key: "minimum width", pt: roundUpMM(s.natural.w) });
          tw = roundUpMM(s.natural.w);
        }
      }
    }
  }
  let th = h0;
  if (want.h !== undefined) {
    const ht = Math.max(want.h, 1);
    const v = ht <= s.natural.h + 0.01 ? s.natural.h : roundMM(ht);
    if (v > s.natural.h + 0.01) {
      items.push({ key: "minimum height", pt: v });
      th = v;
    } else {
      th = s.natural.h;
      if (s.min.h > s.natural.h + 0.01) {
        items.push({ key: "minimum height", pt: roundUpMM(s.natural.h) });
        th = roundUpMM(s.natural.h);
      }
    }
  }
  return { items, target: { w: tw, h: th } };
}

/**
 * The changes that give node `nodeId` the drawn size `want`, for the node
 * itself or for a style it uses (`scope`). `layout` is the picture as `doc`
 * lays it out. The sizes written are whole millimetres; the drawn size can
 * differ from `want` by what that rounding and the text allow.
 */
export function planResize(doc: DocumentModel, picIndex: number, layout: PictureLayout, nodeId: string, want: SizeWant, scope: Scope): ResizeOutcome {
  const pic = doc.syntax.pictures[picIndex];
  const node = layout.nodes.find((n) => n.id === nodeId);
  if (!pic || !node) return { ok: false, reason: "There is no such node." };
  const blocked = resizeBlocker(node);
  if (blocked) return { ok: false, reason: blocked };

  const sites = styleSites(doc, pic);
  const target = scope.kind === "style" ? styleTarget(doc.text, sites, scope.name) : nodeTarget(node.syntax);
  if (!target) return { ok: false, reason: `The ${scope.kind === "style" ? scope.name : "node"} style isn't written in a form the editor can change.` };
  const what = scope.kind === "style" ? `the ${scope.name} style` : "this node";

  const planned = plan(node, want);
  const w0 = 2 * node.shape.hw;
  const h0 = 2 * node.shape.hh;
  const unchanged = (): ResizeOutcome => ({ ok: true, changes: [], text: doc.text, layout, written: [], size: { w: w0, h: h0 }, notes: [] });
  if (!planned.items.length) return unchanged();

  // Write, lay out, and nudge the written values if the drawn size is off.
  let items = planned.items;
  let result: Extract<ResizeOutcome, { ok: true }> | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const texts = items.map((i) => ({ key: i.key, text: formatOption(i.key, formatDistance(i.pt)) }));
    const changes = setOptions(doc.text, target, texts);
    if (!changes) return { ok: false, reason: `${what[0]!.toUpperCase()}${what.slice(1)} uses a style argument (#1) for its size, so it can only be changed in the code.` };
    const text = applyChanges(doc.text, changes);
    const after = layoutDocumentPicture(analyzeDocument(text), picIndex);
    const n2 = after?.nodes.find((n) => n.id === nodeId);
    if (!after || !n2) return { ok: false, reason: "That size couldn't be written." };
    const size = { w: 2 * n2.shape.hw, h: 2 * n2.shape.hh };
    result = { ok: true, changes, text, layout: after, written: items.map((i) => `${i.key}=${formatDistance(i.pt)}`), size, notes: [] };
    const errW = planned.target.w - size.w;
    const errH = planned.target.h - size.h;
    if (Math.abs(errW) <= TOLERANCE && Math.abs(errH) <= TOLERANCE) break;
    // The shape doesn't follow the written value one for one (a rounded
    // rectangle's width depends on its height, say): correct by the error.
    const nudged = items.map((i) => {
      const err = i.key === "minimum width" || i.key === "text width" ? errW : i.key === "minimum height" ? errH : Math.max(errW, errH);
      return { ...i, pt: Math.max(MM, i.pt + roundMM(err)) };
    });
    if (nudged.every((n, k) => eq(n.pt, items[k]!.pt))) break;
    items = nudged;
  }
  if (!result) return unchanged();
  const moved = !eq(result.size.w, w0) || !eq(result.size.h, h0);
  if (!moved) {
    return {
      ok: false,
      reason:
        scope.kind === "style"
          ? `The size didn't change: this node sets its own size, which the ${scope.name} style doesn't override. Resize "This node" instead.`
          : "The size didn't change: something else in the code sets it, such as a later minimum size. Change it in the code.",
    };
  }
  if (scope.kind === "style") {
    const keys = new Set(items.map((i) => i.key));
    const users = styleUsers(sites, layout, scope.name);
    const own = users.filter((n) => n.syntax.options.some((l) => l.items.some((i) => keys.has(i.key as Item["key"]))));
    if (own.length) result.notes.push(`${own.length} of the ${users.length} ${scope.name} nodes set their own size, so they keep it`);
  }
  return result;
}
