// Groups and swimlanes (M4 step 4, D81): reading lane sets, making groups and
// lanes, moving nodes between lanes, titles, the upkeep that keeps the lanes'
// shared top and bottom at the extremes, deleting members and lanes, dragging
// a lane, and the label positions lane titles use.
import { describe, expect, it } from "vitest";
import { planAutoLayout } from "../src/edit/autolayout.ts";
import { applyChanges } from "../src/edit/changes.ts";
import { planCreate, STANDARD_ENTRIES } from "../src/edit/create.ts";
import { planDelete } from "../src/edit/delete.ts";
import { groupMembers } from "../src/edit/group.ts";
import {
  fitBoxes,
  laneAt,
  laneOrientation,
  laneSets,
  laneUpkeep,
  type LaneOutcome,
  planGroup,
  planJoin,
  planLane,
  planLeave,
  planTitle,
  titleOf,
  withLaneUpkeep,
} from "../src/edit/lanes.ts";
import { planMove } from "../src/edit/move.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import type { PictureLayout } from "../src/tikz/layout.ts";
import { anchorPoint, shapeBounds } from "../src/tikz/shapes.ts";
import { CM } from "../src/tikz/units.ts";
import { loadCorpusFile } from "./corpus.ts";

const STYLES = [
  "  box/.style={draw, minimum width=24mm, minimum height=8mm},",
  "  lane/.style={draw, fill=gray!8, inner sep=3mm},",
  "  lane title/.style={font=\\bfseries\\small},",
];
const doc = (body: string, libs = "positioning, fit, backgrounds") =>
  ["\\documentclass{article}", "\\usepackage{tikz}", `\\usetikzlibrary{${libs}}`, "\\tikzset{", ...STYLES, "}", "\\begin{document}", "\\begin{tikzpicture}[node distance=8mm and 14mm]", body, "\\end{tikzpicture}", "\\end{document}", ""].join("\n");

/** Three steps in a column and two beside them: the picture runs down. */
const FLOW = doc(
  [
    "  \\node[box] (a) {A};",
    "  \\node[box, below=of a] (b) {B};",
    "  \\node[box, right=of a] (c) {C};",
    "  \\node[box, below=of c] (d) {D};",
    "  \\node[box, below=of b] (e) {E};",
    "  \\draw[->] (a) -- (b);",
    "  \\draw[->] (b) -- (e);",
    "  \\draw[->] (c) -- (d);",
  ].join("\n"),
);

const layoutOf = (text: string): PictureLayout => layoutDocumentPicture(analyzeDocument(text), 0)!;
const node = (l: PictureLayout, name: string) => l.nodes.filter((n) => n.name === name).at(-1)!;

function ok(r: LaneOutcome): LaneOutcome & { ok: true } {
  if (!r.ok) throw new Error(r.reason);
  return r;
}

/** Applies a planned outcome and checks it agrees with its own text, with no new syntax errors. */
function applied(before: string, r: LaneOutcome): string {
  const o = ok(r);
  expect(applyChanges(before, o.changes)).toBe(o.text);
  expect(analyzeDocument(o.text).errors.length).toBe(analyzeDocument(before).errors.length);
  return o.text;
}

/** Every lane of the picture's first set spans the same height (columns) or width (rows). */
function expectEven(text: string) {
  const l = layoutOf(text);
  const set = laneSets(text, l)[0]!;
  const spans = set.lanes.map((lane) => {
    const b = shapeBounds(lane.node.shape);
    return set.orientation === "columns" ? [b.minY, b.maxY] : [b.minX, b.maxX];
  });
  for (const s of spans) {
    expect(s[0]).toBeCloseTo(spans[0]![0]!, 2);
    expect(s[1]).toBeCloseTo(spans[0]![1]!, 2);
  }
  // Every member is inside its lane.
  for (const lane of set.lanes) {
    const b = shapeBounds(lane.node.shape);
    for (const id of lane.members) {
      const m = shapeBounds(l.nodes.find((n) => n.id === id)!.shape);
      expect(m.minX).toBeGreaterThanOrEqual(b.minX - 0.01);
      expect(m.maxX).toBeLessThanOrEqual(b.maxX + 0.01);
      expect(m.minY).toBeGreaterThanOrEqual(b.minY - 0.01);
      expect(m.maxY).toBeLessThanOrEqual(b.maxY + 0.01);
    }
  }
}

function twoLanes(): string {
  const one = applied(FLOW, planLane(FLOW, 0, ["a", "b", "e"], "Customer"));
  return applied(one, planLane(one, 0, ["c", "d"], "Shop"));
}

describe("reading lanes", () => {
  it("finds the corpus picture's three lanes in order, and its group is not a lane", () => {
    const { text } = loadCorpusFile("self-swimlanes.tex");
    const l = layoutOf(text);
    const sets = laneSets(text, l);
    expect(sets).toHaveLength(1);
    expect(sets[0]!.orientation).toBe("columns");
    expect(sets[0]!.ends.map((e) => e.name)).toEqual(["lanes top", "lanes bottom"]);
    expect(sets[0]!.lanes.map((x) => x.node.name)).toEqual(["employee", "manager", "finance"]);
    expect(sets[0]!.lanes[1]!.members).toEqual(["review", "within", "query"]);
    expect(sets[0]!.lanes[0]!.title?.text).toBe("Employee");
    expect(fitBoxes(text, l).map((b) => b.node.name)).toContain("checks");
    expectEven(text);
  });

  it("reads titles with options, a direction, braces and math", () => {
    const l = layoutOf(doc("  \\node[box] (a) {A};\n  \\node[draw, fit=(a), label={[font=\\small]north:Stage {1}: $x:y$}] (g) {};"));
    const t = titleOf(analyzeDocument(doc("  \\node[box] (a) {A};\n  \\node[draw, fit=(a), label={[font=\\small]north:Stage {1}: $x:y$}] (g) {};")).text, node(l, "g").syntax)!;
    expect(t.dir).toBe("north");
    expect(t.text).toBe("Stage {1}: $x:y$");
  });

  it("chooses columns for a picture that runs down and rows for one that runs across", () => {
    expect(laneOrientation(layoutOf(FLOW))).toBe("columns");
    const across = doc("  \\node[box] (a) {A};\n  \\node[box, right=of a] (b) {B};\n  \\node[box, right=of b] (c) {C};\n  \\draw[->] (a) -- (b);\n  \\draw[->] (b) -- (c);");
    expect(laneOrientation(layoutOf(across))).toBe("rows");
  });
});

describe("making lanes and groups", () => {
  it("writes the first lane as form B in a background block at the end, with its shared coordinates", () => {
    const text = applied(FLOW, planLane(FLOW, 0, ["a", "b", "e"], "Customer"));
    expect(text).toContain(
      [
        "  \\begin{scope}[on background layer]",
        "    \\coordinate (lanes top) at (a.north);",
        "    \\coordinate (lanes bottom) at (e.south);",
        "    \\node[lane, fit=(a) (b) (e) (a |- lanes top) (a |- lanes bottom), label={[lane title]north:Customer}] (customer) {};",
        "  \\end{scope}",
        "\\end{tikzpicture}",
      ].join("\n"),
    );
    // Only bytes after the last statement and nothing else changed.
    expect(text.startsWith(FLOW.slice(0, FLOW.indexOf("\\end{tikzpicture}")))).toBe(true);
  });

  it("adds a second lane next to the first and widens the shared top and bottom to every member", () => {
    const text = twoLanes();
    expect(text).toContain("    \\node[lane, fit=(c) (d) (c |- lanes top) (c |- lanes bottom), label={[lane title]north:Shop}] (shop) {};\n  \\end{scope}");
    expectEven(text);
    const l = layoutOf(text);
    expect(laneSets(text, l)[0]!.lanes.map((x) => x.node.name)).toEqual(["customer", "shop"]);
  });

  it("makes rows, titled on the left, in a picture that runs across", () => {
    const across = doc("  \\node[box] (a) {A};\n  \\node[box, right=of a] (b) {B};\n  \\node[box, below=of a] (c) {C};\n  \\draw[->] (a) -- (b);");
    const one = applied(across, planLane(across, 0, ["a", "b"], "Top"));
    const two = applied(one, planLane(one, 0, ["c"], "Bottom"));
    expect(two).toContain("\\coordinate (lanes left) at (a.west);");
    expect(two).toContain("\\node[lane, fit=(c) (c -| lanes left) (c -| lanes right), label={[lane title]west:Bottom}] (bottom) {};");
    expectEven(two);
    expect(laneSets(two, layoutOf(two))[0]!.orientation).toBe("rows");
  });

  it("adds the lane styles and loads fit and backgrounds when the document has neither", () => {
    const bare = FLOW.replace("positioning, fit, backgrounds", "positioning").replace(STYLES[1]!, "").replace(STYLES[2]!, "");
    const r = ok(planLane(bare, 0, ["a"], "One"));
    expect(r.text).toContain("\\usetikzlibrary{positioning, fit, backgrounds}");
    expect(r.text).toContain("lane/.style={draw=gray!60, fill=gray!8, rounded corners=2pt, inner sep=3mm}");
    expect(r.text).toContain("lane title/.style={font=\\bfseries\\small}");
  });

  it("names unnamed nodes from their labels so the fit list can list them", () => {
    const text = doc("  \\node[box] (a) {A};\n  \\node[box, below=of a] {Check input};");
    const l = layoutOf(text);
    const unnamed = l.nodes.find((n) => !n.name)!;
    const r = ok(planGroup(text, 0, ["a", unnamed.id], ""));
    expect(r.text).toContain("\\node[box, below=of a] (checkInput) {Check input};");
    expect(r.text).toContain("\\node[group, fit=(a) (checkInput)] (group) {};");
  });

  it("groups nodes in a dashed box with a title, inside the existing background block", () => {
    const lanes = twoLanes();
    const text = applied(lanes, planGroup(lanes, 0, ["c", "d"], "Checks"));
    expect(text).toContain("    \\node[group, fit=(c) (d), label={[group title]north:Checks}] (checks) {};\n  \\end{scope}");
    expect(text).toContain("group/.style={draw=gray!70, dashed, rounded corners=3pt, inner sep=3mm}");
  });

  it("moves a node already in a lane to the new lane, and refuses to empty a lane", () => {
    const lanes = twoLanes();
    const text = applied(lanes, planLane(lanes, 0, ["d"], "Warehouse"));
    expect(text).toContain("fit=(c) (c |- lanes top) (c |- lanes bottom), label={[lane title]north:Shop}");
    expect(planLane(text, 0, ["c"], "Again")).toMatchObject({ ok: false, reason: expect.stringMatching(/can't be empty/) });
  });

  it("puts new nodes before the background block, so lanes can list them", () => {
    const lanes = twoLanes();
    const entry = STANDARD_ENTRIES[0]!;
    const r = planCreate(lanes, 0, { entry, label: "F", placement: { kind: "child", of: "e" } });
    if (!r.ok) throw new Error(r.reason);
    expect(r.text.indexOf("{F};")).toBeLessThan(r.text.indexOf("\\begin{scope}[on background layer]"));
    applied(r.text, planJoin(r.text, 0, [r.id], "customer"));
  });
});

describe("membership and titles", () => {
  it("moves a node to another lane, out of its own", () => {
    const lanes = twoLanes();
    const text = applied(lanes, planJoin(lanes, 0, ["e"], "shop"));
    expect(text).toContain("fit=(a) (b) (a |- lanes top) (a |- lanes bottom)");
    expect(text).toContain("fit=(c) (d) (e) (c |- lanes top)");
  });

  it("moving the member a lane lines up with keeps the line-up on another member", () => {
    const lanes = twoLanes();
    const text = applied(lanes, planJoin(lanes, 0, ["a"], "shop"));
    expect(text).toContain("fit=(b) (e) (b |- lanes top) (b |- lanes bottom)");
    expectEven(text);
  });

  it("takes nodes out of their groups and lanes", () => {
    const lanes = applied(twoLanes(), planGroup(twoLanes(), 0, ["c", "d"], ""));
    const text = applied(lanes, planLeave(lanes, 0, ["d"]));
    expect(text).toContain("fit=(c) (c |- lanes top) (c |- lanes bottom)");
    expect(text).toContain("\\node[group, fit=(c)] (group) {};");
    expect(planLeave(text, 0, ["c"])).toMatchObject({ ok: false });
  });

  it("sets, changes and removes a title", () => {
    const lanes = twoLanes();
    const renamed = applied(lanes, planTitle(lanes, 0, "shop", "Store"));
    expect(renamed).toContain("label={[lane title]north:Store}] (shop)");
    const removed = applied(renamed, planTitle(renamed, 0, "shop", ""));
    expect(removed).toContain("\\node[lane, fit=(c) (d) (c |- lanes top) (c |- lanes bottom)] (shop) {};");
    const back = applied(removed, planTitle(removed, 0, "shop", "Shop"));
    expect(back).toContain("(c |- lanes bottom), label={[lane title]north:Shop}] (shop)");
    expect(planTitle(back, 0, "shop", "Bad}")).toMatchObject({ ok: false });
  });

  it("finds the lane a dropped node lands in, not its own", () => {
    const text = twoLanes();
    const l = layoutOf(text);
    expect(laneAt(text, l, node(l, "d").shape.center, "e")?.node.name).toBe("shop");
    expect(laneAt(text, l, node(l, "b").shape.center, "e")).toBeUndefined();
  });
});

describe("upkeep", () => {
  it("moves the shared top to the member that is highest after a drag", () => {
    const text = twoLanes();
    const l = layoutOf(text);
    const c = node(l, "c").shape.center;
    const move = planMove(text, 0, "c", { x: c.x, y: c.y + 2 * CM })!;
    const up = withLaneUpkeep(text, 0, move.changes);
    expect(up.kept).toBe(true);
    const after = applyChanges(text, up.changes);
    expect(after).toContain("\\coordinate (lanes top) at (c.north);");
    expectEven(after);
    expect(laneUpkeep(after, 0)).toEqual([]);
  });

  it("leaves coordinates written another way alone", () => {
    const text = twoLanes().replace("\\coordinate (lanes top) at (a.north);", "\\coordinate (lanes top) at (0,2);");
    expect(laneUpkeep(text, 0)).toEqual([]);
  });
});

describe("deleting", () => {
  it("deleting the member a lane's top sits on moves the top to the next highest member", () => {
    const text = twoLanes();
    const r = planDelete(text, 0, { kind: "nodes", ids: ["a"] });
    if (!r.ok) throw new Error(r.reason);
    expect(r.text).toContain("\\coordinate (lanes top) at (c.north);");
    expect(r.text).toContain("fit=(b) (e) (b |- lanes top) (b |- lanes bottom)");
    expectEven(r.text);
  });

  it("deleting every lane removes the shared coordinates and the emptied block", () => {
    const text = twoLanes();
    const r = planDelete(text, 0, { kind: "nodes", ids: ["customer", "shop"] });
    if (!r.ok) throw new Error(r.reason);
    expect(r.text).not.toContain("lanes top");
    expect(r.text).not.toContain("\\begin{scope}");
    expect(r.text).toBe(FLOW);
  });
});

describe("dragging and laying out", () => {
  it("dragging a lane moves its members, not the shared coordinates", () => {
    const text = twoLanes();
    const l = layoutOf(text);
    expect(groupMembers(l, ["shop"]).members.map((id) => node(l, id).name ?? id)).toEqual(["c", "d"]);
  });

  it("auto-layout keeps each lane's nodes apart from the other lanes, both ways", async () => {
    const { text } = loadCorpusFile("self-swimlanes.tex");
    for (const direction of ["down", "right"] as const) {
      const r = await planAutoLayout(text, 0, { direction });
      if (!r.ok) throw new Error(r.reason);
      const l = layoutOf(r.text);
      const set = laneSets(r.text, l)[0]!;
      const boxes = set.lanes.map((lane) => shapeBounds(lane.node.shape));
      for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.minX, `${direction}: lane ${i} starts after lane ${i - 1}`).toBeGreaterThan(boxes[i - 1]!.maxX);
      expectEven(r.text);
    }
  });
});

describe("label positions (checked against pdfTeX, probe p9)", () => {
  it("puts a north label's bottom on the node's top, and a north east one's corner on its corner", () => {
    const text = doc("  \\node[draw, minimum width=2cm, minimum height=1cm, label={north:T}, label={north east:C}, label={30:x}] (r) {R};");
    const r = node(layoutOf(text), "r");
    const [t, c, x] = r.extras;
    const top = anchorPoint(r.shape, "north")!;
    expect(shapeBounds(t!.shape).minY).toBeCloseTo(top.y, 3);
    expect(t!.shape.center.x).toBeCloseTo(top.x, 3);
    const ne = anchorPoint(r.shape, "north east")!;
    expect(shapeBounds(c!.shape).minX).toBeCloseTo(ne.x, 3);
    expect(shapeBounds(c!.shape).minY).toBeCloseTo(ne.y, 3);
    const at30 = anchorPoint(r.shape, "30")!;
    expect(shapeBounds(x!.shape).minX).toBeCloseTo(at30.x, 3);
    expect(shapeBounds(x!.shape).minY).toBeCloseTo(at30.y, 3);
  });
});
