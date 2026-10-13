// Drags (M6 step 2, D108): a node or a group dragged lays out again only what it changes. The
// picture's layout is recorded once (its names in order, and each path's state), and every frame
// of the drag starts from it. See `dragLayout` in src/tikz/layout.ts.
import { type DragSession, dragLayout as dragFrame, type PictureLayout } from "../tikz/layout.ts";
import type { Point } from "../tikz/shapes.ts";
import { type DocumentModel, layoutDocumentPicture, layoutRecordOf } from "./document.ts";

/** Picture `index` laid out, recorded so that a drag can start from it (`layoutDocumentPicture` keeps the record). */
export function recordedLayout(doc: DocumentModel, index: number): PictureLayout | null {
  return layoutDocumentPicture(doc, index);
}

export interface Drag {
  doc: DocumentModel;
  index: number;
  session: DragSession;
}

/** Starts a drag on picture `index`, from `base` when it is a recorded layout of it (else it is laid out again). */
export function startDrag(doc: DocumentModel, index: number, base?: PictureLayout | null): Drag {
  let known = base ? layoutRecordOf(base) : undefined;
  let start = base ?? null;
  if (!known) {
    start = recordedLayout(doc, index);
    known = start ? layoutRecordOf(start) : undefined;
  }
  const session: DragSession = {
    pic: known?.pic ?? doc.syntax.pictures[index]!,
    base: start ?? { nodes: [], pathNodes: [], paths: [], opaque: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, opaqueNames: new Set(), boxes: new Map(), issues: [] },
    record: known?.record ?? null,
    index: null,
    pathMade: null,
    dirty: new Map(),
    stats: { frames: 0, full: 0, paths: 0, nodes: 0, why: null },
  };
  return { doc, index, session };
}

/** The picture with `overrides` applied, as a full layout gives it. */
export function dragLayout(d: Drag, overrides: ReadonlyMap<string, Point>): PictureLayout {
  return dragFrame(d.session, overrides, () => layoutDocumentPicture(d.doc, d.index, overrides)!);
}

/** The work done so far: frames, full layouts among them, and the paths and nodes of the last frame. */
export function dragStats(d: Drag): DragSession["stats"] {
  return d.session.stats;
}
