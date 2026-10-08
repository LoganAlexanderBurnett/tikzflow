// Milestone 2b step 2: the edge-editing core. Points are written in emitter
// order (perpendicular, relative, plain coordinates), only the point's own
// text changes, later relative points are held in place, and every edit is
// checked by laying it out again.
import { describe, expect, it } from "vitest";
import { applyChanges, diffRange } from "../src/edit/changes.ts";
import { findEdge, formatLength, perpendicularText, planWaypoint, relativeStyle, snapWaypoint, writeStops } from "../src/edit/edges.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import { type Edge, pictureEdges } from "../src/model/edges.ts";
import type { PictureLayout } from "../src/tikz/layout.ts";
import type { Point } from "../src/tikz/shapes.ts";
import { CM, PT_PER_UNIT } from "../src/tikz/units.ts";
import { corpusNames, loadCorpusFile } from "./corpus.ts";

const MM = PT_PER_UNIT.mm!;
const pic = (body: string, opts = "") => `\\begin{tikzpicture}${opts}\n\\node (a) at (0,0) {A};\n\\node (b) at (4,-2) {B};\n\\node (c) at (1,-4) {C};\n${body}\n\\end{tikzpicture}\n`;
const layoutOf = (text: string): PictureLayout => layoutDocumentPicture(analyzeDocument(text), 0)!;
const node = (l: PictureLayout, name: string) => l.nodes.find((n) => n.name === name)!;
const firstEdge = (text: string): Edge => pictureEdges(layoutOf(text))[0]!;
const lastLine = (text: string) => text.split("\n").filter((l) => l.startsWith("\\draw")).pop()!;

/** Moves waypoint `k` (counting inside the edge from 1) of the first edge to `p` and checks the result. */
function move(text: string, k: number, p: Point) {
  const e = firstEdge(text);
  const index = e.route.segs[e.segs[k]!]!.a;
  const r = planWaypoint(text, 0, e.id, index, p);
  if (!r.ok) throw new Error(r.reason);
  expect(applyChanges(text, r.changes)).toBe(r.text);
  return { ...r, stop: findEdge(r.layout, e.id)!.route.stops[index]! };
}

describe("writing lengths and points", () => {
  it("writes lengths in whole millimetres", () => {
    expect([0.2, 5 * MM, -3 * MM, 15 * MM, 1.04 * CM].map(formatLength)).toEqual(["0", "5mm", "-3mm", "1.5cm", "1cm"]);
  });

  it("follows how the picture writes relative points", () => {
    const doc = (body: string) => {
      const t = pic(body);
      return relativeStyle(t, analyzeDocument(t).syntax.pictures[0]!);
    };
    expect(doc("\\draw (a) -- ++(0.35,0) |- (b);")).toBe("plain");
    expect(doc("\\draw (a) -- ++(5mm,0) |- (b);")).toBe("dims");
    expect(doc("\\draw (a) -- (b);")).toBe("dims");
  });

  it("finds perpendicular coordinates from centres and sides, never from one node", () => {
    const text = pic("\\draw (a) -- (b);");
    const l = layoutOf(text);
    const path = l.paths[0]!;
    const a = node(l, "a").shape;
    const b = node(l, "b").shape;
    expect(perpendicularText(l, path, { x: a.center.x, y: b.center.y })).toBe("(a |- b)");
    expect(perpendicularText(l, path, { x: a.center.x + a.hw, y: b.center.y + b.hh })).toBe("(a.east |- b.north)");
    expect(perpendicularText(l, path, { x: a.center.x, y: a.center.y + a.hh })).toBeNull();
    expect(perpendicularText(l, path, { x: 17, y: 3 })).toBeNull();
  });
});

describe("moving a waypoint", () => {
  it("writes a perpendicular coordinate when it lines up with two nodes", () => {
    const text = pic("\\draw (a) -- ++(1,0) -- (b);");
    const l = layoutOf(text);
    const r = move(text, 1, { x: node(l, "b").shape.center.x, y: node(l, "a").shape.center.y });
    expect(r.form).toBe("perpendicular");
    expect(lastLine(r.text)).toBe("\\draw (a) -- (b |- a) -- (b);");
  });

  it("keeps a relative point relative, in whole millimetres, and changes only its text", () => {
    const text = pic("\\draw (a) -- ++(1cm,0) -- (b);");
    const before = firstEdge(text).route.stops[1]!;
    const r = move(text, 1, { x: before.point.x + 3.2 * MM, y: before.point.y - 7 * MM });
    expect(r.form).toBe("relative");
    expect(lastLine(r.text)).toBe("\\draw (a) -- ++(1.3cm,-7mm) -- (b);");
    const d = diffRange(text, r.text)!;
    expect(d.from).toBeGreaterThanOrEqual(before.range.from);
    expect(d.to).toBeLessThanOrEqual(before.range.to);
  });

  it("uses plain numbers in a picture that writes relative points that way", () => {
    const text = pic("\\draw (a) -- ++(1,0) -- ++(0.5,0) |- (b);");
    const before = firstEdge(text).route.stops[1]!;
    const r = move(text, 1, { x: before.point.x + 5 * MM, y: before.point.y });
    expect(lastLine(r.text)).toBe("\\draw (a) -- ++(1.5,0) -- ++(0,0) |- (b);");
  });

  it("holds the relative points after it where they were", () => {
    const text = pic("\\draw (a) -- ++(1cm,0) -- ++(0,-1cm) -- (b);");
    const e = firstEdge(text);
    const second = e.route.stops[2]!.point;
    const r = move(text, 1, { x: e.route.stops[1]!.point.x + 5 * MM, y: e.route.stops[1]!.point.y });
    expect(lastLine(r.text)).toBe("\\draw (a) -- ++(1.5cm,0) -- ++(-5mm,-1cm) -- (b);");
    const after = findEdge(r.layout, e.id)!.route.stops[2]!.point;
    expect(Math.hypot(after.x - second.x, after.y - second.y)).toBeLessThan(0.05);
  });

  it("knows that \"+\" keeps the point it measures from", () => {
    const text = pic("\\draw (a) -- +(1cm,0) -- +(0,-1cm) -- (b);");
    const e = firstEdge(text);
    const r = move(text, 1, { x: e.route.stops[1]!.point.x, y: e.route.stops[1]!.point.y + 4 * MM });
    // The second point is measured from (a), not from the moved one, so it stays as written.
    expect(lastLine(r.text)).toBe("\\draw (a) -- +(1cm,4mm) -- +(0,-1cm) -- (b);");
  });

  it("keeps plain coordinates plain", () => {
    const text = pic("\\draw (a) -- (2,1) -- (b);");
    const e = firstEdge(text);
    const r = move(text, 1, { x: e.route.stops[1]!.point.x + 5 * MM, y: e.route.stops[1]!.point.y });
    expect(r.form).toBe("absolute");
    expect(lastLine(r.text)).toBe("\\draw (a) -- (2.5,1) -- (b);");
  });

  it("writes relative points in the path's own frame", () => {
    const text = pic("\\draw[scale=2] (a) -- ++(1,0) -- (b);");
    const e = firstEdge(text);
    const r = move(text, 1, { x: e.route.stops[1]!.point.x + 1 * CM, y: e.route.stops[1]!.point.y + 1 * CM });
    // Scaled by 2: 1 cm on the canvas is 0.5 in the path's own units.
    expect(lastLine(r.text)).toBe("\\draw[scale=2] (a) -- ++(1.5,0.5) -- (b);");
  });

  it("refuses a point that isn't inside the edge, and locked edges", () => {
    const text = pic("\\draw (a) -- (2,1) -- (b);");
    const e = firstEdge(text);
    expect(planWaypoint(text, 0, e.id, 0, { x: 0, y: 0 }).ok).toBe(false);
    const locked = pic("\\draw (a) -- (2,1) -- (b) -- cycle;");
    const le = firstEdge(locked);
    expect(planWaypoint(locked, 0, le.id, 1, { x: 0, y: 0 })).toMatchObject({ ok: false, reason: expect.stringMatching(/can't be edited/) });
  });

  it("can't rewrite the node a \\node ... edge path starts from", () => {
    const text = pic("\\node (d) at (0,-6) {D} edge (c);");
    const e = pictureEdges(layoutOf(text)).find((x) => x.path.id.includes("/edge"))!;
    expect(writeStops(text, 0, e, [{ stop: 0, text: "(a)" }])).toMatchObject({ ok: false });
  });
});

describe("snapping a waypoint", () => {
  it("lines up with node centres and sides, and with the points before and after it", () => {
    const text = pic("\\draw (a) -- (2,1) -- (b);");
    const l = layoutOf(text);
    const e = firstEdge(text);
    const b = node(l, "b").shape.center;
    const a = node(l, "a").shape.center;
    const s = snapWaypoint(l, e, [a, b], { x: b.x + 2, y: a.y - 1.5 }, 4);
    expect(s.point).toEqual({ x: b.x, y: a.y });
    expect(s.guides.map((g) => g.axis).sort()).toEqual(["h", "v"]);
    const free = snapWaypoint(l, e, [a, b], { x: 60, y: 30 }, 4);
    expect(free.guides).toEqual([]);
  });
});

describe("the corpus", () => {
  it("moves a waypoint of every editable edge that has one, touching only that path", () => {
    let moved = 0;
    let tried = 0;
    for (const name of corpusNames()) {
      const text = loadCorpusFile(name).text;
      const doc = analyzeDocument(text);
      doc.syntax.pictures.forEach((_, i) => {
        const l = layoutDocumentPicture(doc, i)!;
        for (const e of pictureEdges(l)) {
          if (e.lock || e.segs.length < 2) continue;
          const index = e.route.segs[e.segs[1]!]!.a;
          const p = e.route.stops[index]!.point;
          tried++;
          const r = planWaypoint(text, i, e.id, index, { x: p.x + 3 * MM, y: p.y - 2 * MM });
          if (!r.ok) continue;
          moved++;
          const d = diffRange(text, r.text)!;
          expect(d.from, name).toBeGreaterThanOrEqual(e.path.syntax.from);
          expect(d.to, name).toBeLessThanOrEqual(e.path.syntax.to);
        }
      });
    }
    expect(tried).toBeGreaterThan(20);
    // Most waypoints can be moved; the rest are refused with a reason, never misedited.
    expect(moved / tried).toBeGreaterThan(0.8);
  });
});
