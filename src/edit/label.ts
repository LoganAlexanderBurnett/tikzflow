// Editing a node's label in place (D39). The label is shown and edited as the
// TeX between its braces, so nothing in it is lost or rewritten: only the
// characters that changed are patched.
import { analyzeDocument, layoutDocumentPicture } from "../model/document.ts";
import type { LaidOutNode, PictureLayout } from "../tikz/layout.ts";
import { applyChanges, type Change, diffRange } from "./changes.ts";
import { eolNear } from "./text.ts";

export type LabelOutcome = { ok: true; changes: Change[]; text: string } | { ok: false; reason: string };

/** The label as it is edited: line breaks as "\n" whatever the file uses. */
export const draftOf = (source: string): string => source.replace(/\r\n/g, "\n");

/**
 * Why `draft` can't be a label, or null if it can: it must keep the node's
 * braces balanced, and must not comment out or escape the closing brace.
 */
export function labelProblem(draft: string): string | null {
  let depth = 0;
  for (let i = 0; i < draft.length; i++) {
    const ch = draft[i]!;
    if (ch === "\\") {
      if (i === draft.length - 1) return "The label can't end with a backslash: it would escape the closing brace.";
      i++;
    } else if (ch === "{") depth++;
    else if (ch === "}") {
      if (--depth < 0) return 'There is a "}" with no matching "{". Write \\} for a literal brace.';
    } else if (ch === "%" && !draft.includes("\n", i)) {
      return "A % starts a comment in TeX and would swallow the closing brace. Write \\% for a percent sign.";
    }
  }
  return depth > 0 ? 'There is a "{" with no matching "}". Write \\{ for a literal brace.' : null;
}

/** A node or an edge label (path node) by id. */
export function labelledNode(layout: PictureLayout | null | undefined, id: string): LaidOutNode | undefined {
  return layout?.nodes.find((n) => n.id === id) ?? layout?.pathNodes.find((n) => n.id === id);
}

/** Why the label of `nodeId` (a node, or a label on an edge) can't be edited in place, or null if it can. */
export function labelBlocker(text: string, picIndex: number, nodeId: string): string | null {
  const node = labelledNode(layoutDocumentPicture(analyzeDocument(text), picIndex), nodeId);
  if (!node || node.kind === "coordinate") return "Only a node's own label, or a label on an edge, can be edited here.";
  const label = node.syntax.label;
  if (!label) return "This node has no text to edit.";
  if (text[label.range.to - 1] !== "}") return "This node's label isn't closed; fix the code first.";
  return null;
}

/**
 * The change that gives node `nodeId` the label `draft`. Only the characters
 * that differ are replaced; the result is checked by parsing it again.
 */
export function planLabelEdit(text: string, picIndex: number, nodeId: string, draft: string): LabelOutcome {
  const problem = labelProblem(draft);
  if (problem) return { ok: false, reason: problem };
  const doc = analyzeDocument(text);
  const before = layoutDocumentPicture(doc, picIndex);
  const node = labelledNode(before, nodeId);
  const blocked = labelBlocker(text, picIndex, nodeId);
  if (!before || !node || blocked) return { ok: false, reason: blocked ?? "There is no such node." };
  const inner = node.syntax.label!.inner;
  const eol = eolNear(text, inner.from);
  const next = eol === "\r\n" ? draft.replace(/\r?\n/g, "\r\n") : draft;
  const d = diffRange(text.slice(inner.from, inner.to), next);
  if (!d) return { ok: true, changes: [], text };
  const changes: Change[] = [{ from: inner.from + d.from, to: inner.from + d.to, insert: d.insert }];
  const after = applyChanges(text, changes);
  // The statement must still be the same node, with the label we wrote, and no new syntax errors.
  const doc2 = analyzeDocument(after);
  const laid = layoutDocumentPicture(doc2, picIndex);
  const same = labelledNode(laid, nodeId);
  if (!laid || !same || laid.nodes.length !== before.nodes.length || laid.pathNodes.length !== before.pathNodes.length || same.syntax.label?.text !== next || doc2.errors.length > doc.errors.length) {
    return { ok: false, reason: "That text would change the structure of the code around it, so it wasn't applied." };
  }
  return { ok: true, changes, text: after };
}
