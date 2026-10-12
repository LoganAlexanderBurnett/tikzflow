---
title: When something can't be edited
description: Why parts of a TikZ picture are kept as-is or locked in TikZFlow, what the summary's warnings mean, and how to report a problem.
order: 13
---
# When something can't be edited

TikZFlow never changes code it doesn't understand. Whatever it can't model is kept exactly as you wrote it, and TeX still draws it.

## The summary

Under the canvas, the summary says what the editor understood, for example "12 nodes, 2 groups and 14 edges editable; 1 block kept as-is". **Details** lists each item below, and clicking one shows its code.

## Blocks kept as-is

`\foreach` loops, `\matrix`, `pic`s and macros the editor doesn't know become blocks kept as-is. The quick preview doesn't draw them; the TeX preview does, and clicking one there selects its code. Edit them in the code pane.

## Locked nodes

A node that can't be dragged says why when you select it. The most common reasons:

- **It refers to a name that doesn't exist** (a typo, or a node defined later). LaTeX would fail on it too. The panel suggests the name you probably meant, and offers **Pin at current position** (plain coordinates where it is drawn now) or **Attach to** another node.
- **It refers to a node inside a block kept as-is.** The editor can't know where that node is.
- **It is a group's box** (`fit`): it follows its nodes. Dragging it moves them.

## Other warnings

- **Syntax errors:** click the count to jump to each one.
- **Undefined names:** nodes or coordinates used but never defined, including inside `\draw`.
- **Options the preview ignores**, and the small amber dot on a node: options or shapes the quick preview can't draw. They stay in the code, and the TeX preview draws them.
- **Low contrast:** text that is hard to read against its fill. Select the node for a one-click fix.
- **Style … is a TikZ key:** a style named like one of TikZ's own keys, which makes TeX fail.
- **An amber marker with "TeX puts … from where the editor's own drawing does"** in the TeX preview's notes: see [Nodes TeX places elsewhere](tex-preview.md#nodes-tex-places-elsewhere).

## Reporting a problem

**Report a problem** in the app bar opens a form on GitHub (you need a GitHub account). It asks for the code, your browser and what happened. Nothing is sent from TikZFlow: you choose what to paste. The smallest piece of code that shows the problem helps most.

TikZFlow is open source: the code is at [github.com/LoganAlexanderBurnett/tikzflow](https://github.com/LoganAlexanderBurnett/tikzflow).
