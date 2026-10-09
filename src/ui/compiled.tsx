// The compiled picture on the canvas (M3 step 8, D68). TeX's SVG is in bp
// with y pointing down; the canvas draws TikZ points with y up as SVG y down,
// so the SVG is scaled by 72.27/72 and moved so TikZ's origin lands on the
// canvas origin. Locked blocks (\foreach, \matrix, …) that TeX drew get an
// outline that can be clicked to show their code.

import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { freshCompiled, pickBlock, selectedBlock } from "./preview.ts";

const f = (v: number) => Math.round(v * 1000) / 1000;

/**
 * The inside of TeX's <svg>, with every stroke at least `--tf-min-stroke`
 * wide, so hairlines (`ultra thin`, 0.1pt) stay visible at any zoom; PDF
 * viewers draw them at least a pixel wide too (D15 item 7).
 */
export function compiledInner(svg: string): string {
  const inner = svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  return inner.replace(/stroke-width="([\d.]+)"/g, (_m, w: string) => `style="stroke-width:max(${w}px,var(--tf-min-stroke))"`);
}

interface BlockBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const DRAWN = new Set(["path", "use", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "image"]);

/** The canvas box of what TeX drew between each block's begin and end markers. */
function blockBoxes(root: SVGGElement): BlockBox[] {
  const rootCtm = root.getCTM();
  if (!rootCtm) return [];
  const inv = rootCtm.inverse();
  const active = new Set<string>();
  const boxes = new Map<string, { x0: number; y0: number; x1: number; y1: number }>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => ((n as Element).tagName === "defs" ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode() as SVGGraphicsElement | null; n; n = walker.nextNode() as SVGGraphicsElement | null) {
    const begin = n.getAttribute("data-tf-begin");
    const end = n.getAttribute("data-tf-end");
    if (begin) active.add(begin);
    if (end) active.delete(end);
    if (!active.size || !DRAWN.has(n.tagName)) continue;
    const ctm = n.getCTM();
    if (!ctm) continue;
    let b: DOMRect;
    try {
      b = n.getBBox();
    } catch {
      continue;
    }
    if (!b.width && !b.height) continue;
    const m = inv.multiply(ctm);
    for (const [px, py] of [
      [b.x, b.y],
      [b.x + b.width, b.y],
      [b.x, b.y + b.height],
      [b.x + b.width, b.y + b.height],
    ] as const) {
      const p = new DOMPoint(px, py).matrixTransform(m);
      for (const id of active) {
        const box = boxes.get(id);
        if (!box) boxes.set(id, { x0: p.x, y0: p.y, x1: p.x, y1: p.y });
        else {
          box.x0 = Math.min(box.x0, p.x);
          box.y0 = Math.min(box.y0, p.y);
          box.x1 = Math.max(box.x1, p.x);
          box.y1 = Math.max(box.y1, p.y);
        }
      }
    }
  }
  return [...boxes].map(([id, b]) => ({ id, x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 }));
}

/** TeX's picture, placed on the canvas. Renders nothing until a compile of the current code is ready. */
export function CompiledPicture({ scale }: { scale: number }) {
  const c = freshCompiled.value;
  const svg = c?.outcome.svg ?? null;
  const p = c?.outcome.picture ?? null;
  const inner = useMemo(() => (svg ? compiledInner(svg) : ""), [svg]);
  const ref = useRef<SVGGElement>(null);
  const [blocks, setBlocks] = useState<BlockBox[]>([]);
  useLayoutEffect(() => {
    setBlocks(ref.current && c?.input.blocks.size ? blockBoxes(ref.current) : []);
  }, [inner]);
  if (!svg || !p) return null;
  // Canvas coordinates of a point of TeX's SVG.
  const k = 1 / p.scale;
  const transform = `scale(${f(k)}) translate(${f(-p.origin.x)} ${f(-p.origin.y)})`;
  const picked = selectedBlock.value?.id;
  const pad = 2 / scale;
  return (
    <g class="tf-compiled-layer">
      <g
        ref={ref}
        class="tf-compiled"
        data-testid="compiled-picture"
        transform={transform}
        style={{ "--tf-min-stroke": `${f(0.75 / scale)}px` }}
        dangerouslySetInnerHTML={{ __html: inner }}
      />
      {blocks.map((b) => (
        <rect
          key={b.id}
          data-block={b.id}
          data-testid="locked-block"
          class={`tf-block-hit${picked === b.id ? " picked" : ""}`}
          x={f((b.x - p.origin.x) * k - pad)}
          y={f((b.y - p.origin.y) * k - pad)}
          width={f(b.width * k + 2 * pad)}
          height={f(b.height * k + 2 * pad)}
          stroke-width={f(1.2 / scale)}
          stroke-dasharray={`${f(4 / scale)} ${f(3 / scale)}`}
        >
          <title>Kept as written: drawn by TeX. Click to show its code.</title>
        </rect>
      ))}
    </g>
  );
}

export { pickBlock };
