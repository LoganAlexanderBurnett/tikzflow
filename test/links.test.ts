// Placement links (M6 step 1, D102, D104): the links listed for a node, Unlink,
// Detach, keeping a dragged node's followers where they are, and Detach from
// style. Nothing but the node a user drags may move.
import { describe, expect, it } from "vitest";
import { applyChanges } from "../src/edit/changes.ts";
import { planDetachStyle } from "../src/edit/detachstyle.ts";
import { keepInPlace, placementLinks, planDetach, planUnlink } from "../src/edit/links.ts";
import { formatDistance, planMove } from "../src/edit/move.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import type { PictureLayout } from "../src/tikz/layout.ts";
import { CM, PT_PER_UNIT } from "../src/tikz/units.ts";

const MM = PT_PER_UNIT.mm!;

const PICTURE = [
  "\\usetikzlibrary{positioning}",
  "\\begin{tikzpicture}[node distance=8mm, box/.style={draw, fill=blue!10, minimum width=2cm}, base/.style={draw}, fancy/.style={base, fill=#1!20}, fancy/.default=red]",
  "\\node[box] (a) {A};",
  "\\node[box, below=of a] (b) {B is taller\\\\two lines};",
  "\\node[box, below=of b] (c) {C};",
  "\\node[box, right=of b] (d) {D};",
  "\\node[fancy, below=of c] (e) {E};",
  "\\node[fancy=green, fill=yellow, right=of e] (f) {F};",
  "\\draw[->] (a) -- (b);",
  "\\end{tikzpicture}",
  "",
].join("\n");

const layoutOf = (text: string) => layoutDocumentPicture(analyzeDocument(text), 0)!;
const node = (l: PictureLayout, id: string) => l.nodes.find((n) => n.id === id)!;
const line = (text: string, name: string) => text.split("\n").find((l) => l.includes(`(${name})`)) ?? "";

/** Every node but `except` is where it was, within half a point. */
function expectStill(before: string, after: string, except: string[] = []) {
  const a = layoutOf(before);
  const b = layoutOf(after);
  for (const n of a.nodes) {
    if (except.includes(n.id) || n.kind === "path") continue;
    const m = node(b, n.id);
    expect(Math.hypot(m.shape.center.x - n.shape.center.x, m.shape.center.y - n.shape.center.y), `${n.id} moved`).toBeLessThan(0.5);
  }
}

describe("placementLinks", () => {
  it("lists what a node follows and what follows it, with the placement as written", () => {
    const l = layoutOf(PICTURE);
    const links = placementLinks(PICTURE, l, node(l, "b"));
    expect(links.follows).toEqual([{ id: "a", name: "a", how: "below=of a" }]);
    expect(links.followers.map((f) => [f.name, f.how])).toEqual([
      ["c", "below=of b"],
      ["d", "right=of b"],
    ]);
    expect(placementLinks(PICTURE, l, node(l, "a")).follows).toEqual([]);
  });
});

describe("planUnlink", () => {
  it("cuts what a node follows; with nothing else before it, it is pinned where it is", () => {
    const r = planUnlink(PICTURE, 0, "b", "a", "follows");
    if (!r.ok) throw new Error(r.reason);
    expect(line(r.text, "b")).not.toContain("of a");
    expect(line(r.text, "b")).toMatch(/at \(/);
    expect(r.kept[0]!.how).toBe("pinned with coordinates");
    expectStill(PICTURE, r.text);
  });

  it("cuts a follower: it is re-attached to another node, written exactly", () => {
    const r = planUnlink(PICTURE, 0, "b", "c", "follower");
    if (!r.ok) throw new Error(r.reason);
    expect(line(r.text, "c")).toMatch(/below=[\d.]+(mm|cm) of a/);
    expect(line(r.text, "b")).toBe(line(PICTURE, "b"));
    expectStill(PICTURE, r.text);
  });
});

describe("planDetach", () => {
  it("pins the node and re-attaches its followers to what it followed, with nothing moving", () => {
    const r = planDetach(PICTURE, 0, ["b"]);
    if (!r.ok) throw new Error(r.reason);
    expect(line(r.text, "b")).not.toMatch(/\bof\b/);
    expect(line(r.text, "c")).toMatch(/of a\b/);
    expect(line(r.text, "d")).toMatch(/of a\b/);
    expect(r.kept.map((k) => k.name)).toEqual(["c", "d"]);
    // Nothing refers to b any more.
    const l = layoutOf(r.text);
    expect(placementLinks(r.text, l, node(l, "b"))).toEqual({ follows: [], followers: [] });
    expectStill(PICTURE, r.text);
  });

  it("says when there is nothing to detach", () => {
    const text = "\\begin{tikzpicture}\n\\node (a) at (0,0) {A};\n\\end{tikzpicture}\n";
    const r = planDetach(text, 0, ["a"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("already detached");
  });
});

describe("keepInPlace (dragging moves only the dragged node, D104)", () => {
  it("re-attaches the dragged node's followers to what it hung off; their own followers stay with them", () => {
    const l = layoutOf(PICTURE);
    const b = node(l, "b");
    const m = planMove(PICTURE, 0, "b", { x: b.shape.center.x - 3 * CM, y: b.shape.center.y })!;
    const k = keepInPlace(m.text, 0, l, new Set(["b"]), new Set(["a"]));
    if (!k.ok) throw new Error(k.reason);
    const text = applyChanges(m.text, k.changes);
    expect(k.text).toBe(text);
    expect(k.kept.map((x) => x.name)).toEqual(["c", "d"]);
    expect(line(text, "c")).toMatch(/of a\b/);
    // e follows c, which stayed: its line is untouched.
    expect(line(text, "e")).toBe(line(PICTURE, "e"));
    expectStill(PICTURE, text, ["b"]);
  });

  it("refuses when a node that would move along can't be rewritten", () => {
    const text = PICTURE.replace("\\draw[->] (a) -- (b);", "\\foreach \\i in {1} \\node[right=of c] (g) {G};");
    const l = layoutOf(text);
    const c = node(l, "c");
    const m = planMove(text, 0, "c", { x: c.shape.center.x - 3 * CM, y: c.shape.center.y })!;
    const k = keepInPlace(m.text, 0, l, new Set(["c"]));
    // The loop's node is kept as it is, so it can't be kept in place: the drag must be refused.
    if (l.nodes.some((n) => n.id === "g")) expect(k.ok).toBe(false);
    else expect(k.ok).toBe(true);
  });
});

describe("formatDistance", () => {
  it("writes whole millimetres, or tenths when asked", () => {
    expect(formatDistance(22.37 * MM)).toBe("2.2cm");
    expect(formatDistance(22.37 * MM, true)).toBe("2.24cm");
    expect(formatDistance(7.04 * MM, true)).toBe("7mm");
    expect(formatDistance(7.36 * MM, true)).toBe("7.4mm");
    expect(formatDistance(0.02 * MM, true)).toBe("0pt");
  });
});

describe("planDetachStyle", () => {
  it("writes the style's keys where its name was, so the node looks the same", () => {
    const r = planDetachStyle(PICTURE, 0, ["a"], "box");
    if (!r.ok) throw new Error(r.reason);
    expect(line(r.text, "a")).toBe("\\node[draw, fill=blue!10, minimum width=2cm] (a) {A};");
    expect(r.nodes).toBe(1);
    // Only a's line changed.
    expect(r.text.split("\n").filter((x, i) => x !== PICTURE.split("\n")[i])).toHaveLength(1);
  });

  it("expands styles the style uses, with its default argument", () => {
    const r = planDetachStyle(PICTURE, 0, ["e"], "fancy");
    if (!r.ok) throw new Error(r.reason);
    expect(line(r.text, "e")).toBe("\\node[draw, fill=red!20, below=of c] (e) {E};");
  });

  it("leaves out a key the node sets again after the style", () => {
    const r = planDetachStyle(PICTURE, 0, ["f"], "fancy");
    if (!r.ok) throw new Error(r.reason);
    expect(line(r.text, "f")).toBe("\\node[draw, fill=yellow, right=of e] (f) {F};");
  });

  it("refuses a style written as code", () => {
    const text = PICTURE.replace("base/.style={draw}", "base/.code={\\pgfkeysalso{draw}}");
    const r = planDetachStyle(text, 0, ["e"], "fancy");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("/.code");
  });
});
