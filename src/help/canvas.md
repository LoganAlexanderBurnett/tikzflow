---
title: Editing on the canvas
description: Selecting, moving, adding, resizing and deleting nodes in TikZFlow, and editing their labels.
order: 3
---
# Editing on the canvas

Every change you make on the canvas becomes a small change to the code, and only to the lines it is about. Everything else, your comments and spacing included, stays exactly as you wrote it. <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes it, whether you made it on the canvas or in the code.

## Selecting

- **Click** a node to select it. Its code is highlighted in the code pane, and the properties panel shows it.
- **Shift-click** adds a node to the selection, or takes it out.
- Putting the cursor in a node's code selects that node on the canvas.

## Moving nodes

Drag a node. While you drag, guides show when it lines up with another node, and it snaps to the distances your picture already uses. When you let go, the code says where it is in the way a person would write it, in this order of preference:

1. a relation to a nearby node: `below=of start`, `right=1cm of check`, `below right=7mm and 1.8cm of read`;
2. a line-up with two nodes: `at (a |- b)`;
3. plain coordinates, only when nothing else fits.

Hold <kbd>Alt</kbd> while dragging to move freely, without snapping. Nodes placed relative to the one you move go with it, as they do in TeX.

### Moving several nodes

Select several nodes with Shift-click and drag one of them: they move together, and each is written relative to what it was placed against. Dragging a group's or a lane's box moves everything in it.

### Chains

Nodes placed with the `chains` library (`on chain`) can be dragged too. The first time you drag one, the editor writes the chain out as ordinary positions so the node can move, and says so in the status bar.

## Adding nodes

- **The palette** along the top of the canvas has Process, Decision, Terminal, I/O, Connector and Document, then your picture's own node styles under "This figure". Click one to add it after the selected node, connected to it (or in the middle of the view when nothing is selected), or drag it onto the canvas. A shape's style is added to your `\tikzset` the first time you use it.
- <kbd>Tab</kbd> adds a node connected after the selected one. In an empty picture it adds the first node.
- <kbd>Enter</kbd> adds a node beside the selected one.

New nodes get names made from their labels, such as `(check)`, and never clash with names already in the picture.

## Editing labels

Double-click a node, or select it and press <kbd>F2</kbd>, to edit its label in place. <kbd>Enter</kbd> applies, <kbd>Shift</kbd>+<kbd>Enter</kbd> starts a new line, <kbd>Tab</kbd> applies and adds the next connected node, and <kbd>Esc</kbd> cancels. Labels can hold math (`$n \le 1$`); the canvas draws it with KaTeX until TeX's own picture is ready.

## Resizing

Select one node and drag a handle on its corners or sides. The edge or corner opposite the handle stays put. Hold <kbd>Ctrl</kbd> to resize from the center, or <kbd>Alt</kbd> to turn off snapping. Sizes snap to whole millimeters and to the sizes of other nodes, and are written as `minimum width` and `minimum height` (or `text width` when the text should wrap).

To give several nodes the same size, select them (the first one you click sets the size) and use **Match width** or **Match height** in the properties panel.

## Deleting

Press <kbd>Delete</kbd> (or <kbd>Backspace</kbd>), or use **Delete node** in the properties panel. The edges to and from the node go too. Nodes that were placed relative to it are attached to what it was placed against, or kept where they are, so the code never refers to a node that is gone. A node in a group's box is taken out of the box.

## Panning and zooming

- Scroll to zoom, about the pointer.
- Drag the background, or drag with the right or middle mouse button, or hold <kbd>Space</kbd> and drag, to pan.
- **Fit** in the toolbar fits the picture to the canvas.

## Accessibility views

**View** in the toolbar shows the picture in grayscale, or as someone with red, green or blue color blindness would see it. Only the preview changes: your code and your exports keep their colors. Text that is hard to read against its fill gets a marker, and the summary counts it ("1 low contrast"); select the node and the properties panel offers black or white text that reads well.
