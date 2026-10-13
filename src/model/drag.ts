// Drags (M6 step 2, D108): a node or a group dragged lays out again only what it changes. The
// picture's layout is recorded once (its names in order, and each path's state), and every frame
// of the drag starts from it. See `dragLayout` in src/tikz/layout.ts.
import { type DragSession, dragLayout as dragFrame, layoutPicture, type LayoutRecord, newLayoutRecord, type PictureLayout } from "../tikz/layout.ts";
import type { Point } from "../tikz/shapes.ts";
import type { PictureSyntax } from "./syntax.ts";
import { type DocumentModel, layoutDocumentPicture, pictureEnv } from "./document.ts";

/** The records of layouts made by `recordedLayout`. */
const records = new WeakMap<PictureLayout, { pic: PictureSyntax; record: LayoutRecord }>();

/** Lays picture `index` out as `layoutDocumentPicture` does, keeping what a drag needs to start from it. */
export function recordedLayout(doc: DocumentModel, index: number): PictureLayout | null {
  const pic = doc.syntax.pictures[index];
  if (!pic) return null;
  const env = pictureEnv(doc, pic);
  const record = newLayoutRecord(env);
  const layout = layoutPicture(pic, env, undefined, record);
  records.set(layout, { pic, record });
  return layout;
}

export interface Drag {
  doc: DocumentModel;
  index: number;
  session: DragSession;
}

/** Starts a drag on picture `index`, from `base` when it is a recorded layout of it (else it is laid out again). */
export function startDrag(doc: DocumentModel, index: number, base?: PictureLayout | null): Drag {
  let known = base ? records.get(base) : undefined;
  let start = base ?? null;
  if (!known) {
    start = recordedLayout(doc, index);
    known = start ? records.get(start) : undefined;
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
