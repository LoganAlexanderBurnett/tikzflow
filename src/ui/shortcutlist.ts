// The keyboard shortcut list (M5 step 5, D96): one source for the editor's `?` dialog (shortcuts.tsx)
// and the help site's Keyboard shortcuts page (scripts/lib/help.ts, D99). Plain data, so Node scripts can read it.

/** A row: one or more key combinations (each a list of keys pressed together), and what they do. */
export type Row = [combos: string[][], what: string];

export const SHORTCUT_SECTIONS: Array<{ title: string; note?: string; rows: Row[] }> = [
  {
    title: "Anywhere",
    rows: [
      [[["?"]], "Show or hide this list"],
      [[["Mod", "S"]], "Save (to the file, else a download)"],
      [[["Mod", "Z"]], "Undo, in the code and on the canvas"],
      [[["Mod", "Y"], ["Mod", "Shift", "Z"]], "Redo"],
      [[["Esc"]], "Close a menu, panel or this list"],
    ],
  },
  {
    title: "Canvas",
    note: "Click the canvas first.",
    rows: [
      [[["Tab"]], "Add a node connected after the selected one (in an empty picture, the first node)"],
      [[["Enter"]], "Add a node beside the selected one"],
      [[["F2"]], "Edit the selected node's label (or double-click it)"],
      [[["Delete"], ["Backspace"]], "Delete the selection; what depended on it is re-attached or pinned"],
      [[["Menu"], ["Shift", "F10"]], "Open the selected edge's menu"],
      [[["Space", "drag"]], "Pan"],
    ],
  },
  {
    title: "Mouse",
    rows: [
      [[["Shift", "click"]], "Add to the selection, or take out of it"],
      [[["Alt", "drag"]], "Move or resize without snapping"],
      [[["Mod", "drag"]], "On a node: move the nodes placed against it too (or only it, with Move followers too on). On a resize handle: resize from the center"],
      [[["Right-drag"], ["Middle-drag"]], "Pan (dragging the background does too)"],
      [[["Wheel"]], "Zoom, about the pointer"],
      [[["Right-click"]], "An edge's menu"],
      [[["Double-click"]], "Edit a label; on an edge's corner, remove it"],
      [[["Middle-click"]], "On a tab, close it"],
    ],
  },
  {
    title: "Tabs",
    note: "With a tab focused.",
    rows: [[[["←"], ["→"]], "Show the tab before or after"]],
  },
  {
    title: "Editing a label",
    rows: [
      [[["Enter"]], "Apply"],
      [[["Shift", "Enter"]], "New line"],
      [[["Tab"]], "Apply and add the next connected node"],
      [[["Esc"]], "Cancel"],
    ],
  },
  {
    title: "Edge menu",
    rows: [
      [[["↑"], ["↓"]], "Move between items"],
      [[["Enter"], ["Space"]], "Choose"],
      [[["→"], ["←"]], "Open or leave a submenu (the anchors)"],
    ],
  },
  {
    title: "Code",
    rows: [
      [[["Mod", "F"]], "Find and replace"],
      [[["Tab"], ["Shift", "Tab"]], "Indent, outdent"],
      [[["Esc"]], "Then Tab: leave the code pane by keyboard (Tab alone indents)"],
    ],
  },
];

