// CodeMirror setup: the TikZ language, highlighting, and decorations for the
// range selected on the canvas and for blocks kept as-is.
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, HighlightStyle, LRLanguage, LanguageSupport, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { EditorState, type Extension, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { styleTags, tags as t } from "@lezer/highlight";
import { parser } from "../parser/parser.ts";
import type { Range } from "../model/syntax.ts";

const tikzLanguage = LRLanguage.define({
  name: "tikz",
  parser: parser.configure({
    props: [
      styleTags({
        "NodeKw DrawKw PathKw FillKw FilldrawKw CoordinateKw MatrixKw ForeachKw": t.keyword,
        "TikzsetKw TikzstyleKw UseTikzLibraryKw": t.definitionKeyword,
        "BeginTikz EndTikz": t.moduleKeyword,
        ControlSequence: t.macroName,
        Comment: t.lineComment,
        "OptionKey/OptText": t.propertyName,
        "OptionValue/OptText": t.attributeValue,
        "NodeName/CoordText": t.labelName,
        "Coordinate/CoordText": t.number,
        "Label/Text": t.string,
        "AtKw ToKw EdgeKw ControlsKw AndKw CycleKw NodeWordKw CoordinateWordKw RectangleKw CircleKw EllipseKw ArcKw GridKw InKw": t.controlKeyword,
        'PathOperator "-|" "|-"': t.operator,
        '"[" "]"': t.squareBracket,
        '"{" "}"': t.brace,
        '"(" ")"': t.paren,
        '";" "," "="': t.separator,
      }),
    ],
  }),
  languageData: { commentTokens: { line: "%" } },
});

const highlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: "var(--hl-keyword)", fontWeight: "600" },
  { tag: t.definitionKeyword, color: "var(--hl-definition)", fontWeight: "600" },
  { tag: t.moduleKeyword, color: "var(--hl-module)", fontWeight: "600" },
  { tag: t.macroName, color: "var(--hl-macro)" },
  { tag: t.lineComment, color: "var(--hl-comment)", fontStyle: "italic" },
  { tag: t.propertyName, color: "var(--hl-key)" },
  { tag: t.attributeValue, color: "var(--hl-value)" },
  { tag: t.labelName, color: "var(--hl-name)", fontWeight: "600" },
  { tag: t.number, color: "var(--hl-coord)" },
  { tag: t.controlKeyword, color: "var(--hl-keyword)" },
  { tag: t.operator, color: "var(--hl-operator)" },
]);

export function tikz(): LanguageSupport {
  return new LanguageSupport(tikzLanguage, [syntaxHighlighting(highlightStyle)]);
}

// ---------------------------------------------------------------- decorations

/** The range highlighted because its object is selected on the canvas. */
export const setHighlight = StateEffect.define<Range[]>();
/** Ranges of blocks kept as-is. */
export const setOpaque = StateEffect.define<Range[]>();

const highlightMark = Decoration.mark({ class: "cm-tf-selected" });
const opaqueMark = Decoration.mark({ class: "cm-tf-opaque", attributes: { title: "Kept as-is: not editable on the canvas" } });

function rangeField(effect: typeof setHighlight, mark: Decoration) {
  return StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(deco, tr) {
      deco = deco.map(tr.changes);
      for (const e of tr.effects) {
        if (e.is(effect)) {
          const len = tr.state.doc.length;
          const ranges = e.value
            .map((r) => ({ from: Math.max(0, Math.min(r.from, len)), to: Math.max(0, Math.min(r.to, len)) }))
            .filter((r) => r.to > r.from)
            .sort((a, b) => a.from - b.from);
          deco = Decoration.set(ranges.map((r) => mark.range(r.from, r.to)));
        }
      }
      return deco;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}

const highlightField = rangeField(setHighlight, highlightMark);
const opaqueField = rangeField(setOpaque, opaqueMark);

export interface EditorHooks {
  onChange(text: string): void;
  /** Called when the user moves the cursor (not when the canvas moved it). */
  onCursor(pos: number): void;
}

/** Marks transactions the canvas makes, so the cursor sync ignores them. */
export const fromCanvas = StateEffect.define<null>();

export function editorExtensions(hooks: EditorHooks): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    EditorState.allowMultipleSelections.of(false),
    bracketMatching(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
    tikz(),
    highlightField,
    opaqueField,
    EditorView.lineWrapping,
    EditorView.updateListener.of((u) => {
      if (u.docChanged) hooks.onChange(u.state.doc.toString());
      const canvas = u.transactions.some((tr) => tr.effects.some((e) => e.is(fromCanvas)));
      if (u.selectionSet && !canvas && !u.docChanged) hooks.onCursor(u.state.selection.main.head);
    }),
  ];
}
