// Milestone 2b step 7 (D54): adding labels to edges, sliding them with pos=,
// and the Yes/No labels on decisions.
import { describe, expect, it } from "vitest";
import { applyChanges } from "../src/edit/changes.ts";
import { planConnect } from "../src/edit/edges.ts";
import { addLabelBlocker, branchLabel, closestOnSegment, isDecision, planAddLabel, planSlideLabel, roundPos } from "../src/edit/labels.ts";
import { paletteEntries, planCreate, type Placement } from "../src/edit/create.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import { type Edge, pictureEdges } from "../src/model/edges.ts";
import type { PictureLayout } from "../src/tikz/layout.ts";
import { corpusNames, loadCorpusFile } from "./corpus.ts";

const NODES = "\\node[draw] (a) at (0,0) {A};\n\\node[draw] (b) at (4,-2) {B};\n\\node[draw] (c) at (4,-5) {C};";
const pic = (body: string, opts = "") => `\\begin{tikzpicture}${opts}\n${NODES}\n${body}\n\\end{tikzpicture}\n`;
const layoutOf = (text: string): PictureLayout => layoutDocumentPicture(analyzeDocument(text), 0)!;
const edgesOf = (text: string): Edge[] => pictureEdges(layoutOf(text));
const lines = (text: string) => text.split("\n").slice(4, -2);
const mid = (e: Edge, t = 0.5) => {
  const s = e.route.segs[e.segs[0]!]!;
  return { x: s.from.x + (s.to.x - s.from.x) * t, y: s.from.y + (s.to.y - s.from.y) * t };
};

describe("rounding", () => {
  it("snaps to quarters and rounds to twentieths, or hundredths without snapping", () => {
    expect(roundPos(0.51, true)).toBe(0.5);
    expect(roundPos(0.27, true)).toBe(0.25);
    expect(roundPos(0.33, true)).toBe(0.35);
    expect(roundPos(0.337, false)).toBe(0.34);
    expect(roundPos(-1, true)).toBe(0);
    expect(roundPos(2, true)).toBe(1);
  });
  it("finds the nearest point on a straight, orthogonal and curved piece", () => {
    const line = { kind: "line" as const, from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, a: 0, b: 1, op: 1 };
    expect(closestOnSegment(line, { x: 2.5, y: 4 }).t).toBeCloseTo(0.25, 3);
    const hv = { kind: "hv" as const, from: { x: 0, y: 0 }, to: { x: 10, y: -10 }, a: 0, b: 1, op: 1 };
    expect(closestOnSegment(hv, { x: 5, y: 1 }).t).toBeCloseTo(0.25, 2);
    expect(closestOnSegment(hv, { x: 11, y: -5 }).t).toBeCloseTo(0.75, 2);
    const curve = { kind: "curve" as const, from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, c1: { x: 0, y: 5 }, c2: { x: 10, y: 5 }, a: 0, b: 1, op: 1 };
    expect(closestOnSegment(curve, { x: 5, y: 10 }).t).toBeCloseTo(0.5, 2);
  });
});

describe("adding a label", () => {
  it("writes the label before the end, with pos= where it was clicked and a side that fits the edge", () => {
    const text = pic("\\draw[->] (a) -- (b);");
    const e = edgesOf(text)[0]!;
    const r = planAddLabel(text, 0, e.id, mid(e, 0.5), "yes");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(applyChanges(text, r.changes)).toBe(r.text);
    expect(lines(r.text)).toEqual(["\\draw[->] (a) -- node[above] {yes} (b);"]);
    expect(edgesOf(r.text)[0]!.labels).toHaveLength(1);
    const near = planAddLabel(text, 0, e.id, mid(e, 0.25), "x");
    expect(near.ok && lines(near.text)).toEqual(["\\draw[->] (a) -- node[pos=0.25, above] {x} (b);"]);
  });

  it("puts a label beside an upright edge, on the side it was clicked", () => {
    const text = pic("\\draw (b) -- (c);");
    const e = edgesOf(text)[0]!;
    const p = mid(e);
    const right = planAddLabel(text, 0, e.id, { x: p.x + 5, y: p.y }, "no");
    expect(right.ok && lines(right.text)).toEqual(["\\draw (b) -- node[right] {no} (c);"]);
    const left = planAddLabel(text, 0, e.id, { x: p.x - 5, y: p.y }, "no");
    expect(left.ok && lines(left.text)).toEqual(["\\draw (b) -- node[left] {no} (c);"]);
  });

  it("goes on the segment nearest the click, in a polyline, a curve and an edge operation", () => {
    const poly = pic("\\draw (a) -- ++(2,0) -- (b);");
    const e = edgesOf(poly)[0]!;
    const second = e.route.segs[e.segs[1]!]!;
    const r = planAddLabel(poly, 0, e.id, { x: (second.from.x + second.to.x) / 2, y: (second.from.y + second.to.y) / 2 }, "z");
    expect(r.ok && lines(r.text)[0]).toMatch(/^\\draw \(a\) -- \+\+\(2,0\) -- node\[.*\] \{z\} \(b\);$/);
    const curve = pic("\\draw (a) to[bend left] (b);");
    const c = edgesOf(curve)[0]!;
    const cr = planAddLabel(curve, 0, c.id, mid(c), "w");
    expect(cr.ok && lines(cr.text)[0]).toMatch(/^\\draw \(a\) to\[bend left\] node\[.*\] \{w\} \(b\);$/);
    const op = pic("\\path[->] (a) edge (b);");
    const o = edgesOf(op)[0]!;
    const or = planAddLabel(op, 0, o.id, mid(o), "q");
    expect(or.ok && lines(or.text)[0]).toMatch(/^\\path\[->\] \(a\) edge node\[.*\] \{q\} \(b\);$/);
  });

  it("refuses text that would break the code, and locked edges", () => {
    const text = pic("\\draw (a) -- (b);");
    const e = edgesOf(text)[0]!;
    expect(planAddLabel(text, 0, e.id, mid(e), "50%")).toMatchObject({ ok: false });
    expect(planAddLabel(text, 0, e.id, mid(e), "a}b")).toMatchObject({ ok: false });
    const locked = pic("\\draw (a) -- (b) -- (2,-4) -- cycle;");
    const l = edgesOf(locked)[0];
    if (l?.lock) expect(addLabelBlocker(l)).toMatch(/can't be edited/);
  });

  it("keeps CRLF files, comments and what is after the end", () => {
    const text = pic("\\draw[->] (a) -- (b); % the main one").replace(/\n/g, "\r\n");
    const e = edgesOf(text)[0]!;
    const r = planAddLabel(text, 0, e.id, mid(e), "x");
    expect(r.ok && r.text).toContain("\\draw[->] (a) -- node[above] {x} (b); % the main one\r\n");
  });
});

describe("sliding a label", () => {
  const labelled = pic("\\draw[->] (a) -- node[above] {yes} (b);");
  const slide = (text: string, p: { x: number; y: number }, snap = true) => {
    const l = layoutOf(text);
    const label = l.pathNodes[0]!;
    return planSlideLabel(text, 0, label.id, p, snap);
  };

  it("adds pos= to a label that has none", () => {
    const e = edgesOf(labelled)[0]!;
    const r = slide(labelled, mid(e, 0.2));
    expect(r.ok && lines(r.text)).toEqual(["\\draw[->] (a) -- node[above, pos=0.2] {yes} (b);"]);
    expect(r.ok && edgesOf(r.text)[0]!.labels[0]!.pathPos!.t).toBeCloseTo(0.2, 6);
  });

  it("changes pos= in place, and replaces midway and near start", () => {
    const e = edgesOf(labelled)[0]!;
    const withPos = pic("\\draw[->] (a) -- node[pos=0.2, above] {yes} (b);");
    const r = slide(withPos, mid(e, 0.75));
    expect(r.ok && lines(r.text)).toEqual(["\\draw[->] (a) -- node[pos=0.75, above] {yes} (b);"]);
    const near = pic("\\draw[->] (a) -- node[near start, above] {yes} (b);");
    const n = slide(near, mid(e, 0.6));
    expect(n.ok && lines(n.text)).toEqual(["\\draw[->] (a) -- node[pos=0.6, above] {yes} (b);"]);
  });

  it("writes nothing when the label is already there", () => {
    const e = edgesOf(labelled)[0]!;
    const r = slide(labelled, mid(e, 0.5));
    expect(r.ok && r.changes).toEqual([]);
  });

  it("gives a label with no options a list, and one after the end a pos on the last segment", () => {
    const bare = pic("\\draw (a) -- node {x} (b);");
    const e = edgesOf(bare)[0]!;
    const r = slide(bare, mid(e, 0.3));
    expect(r.ok && lines(r.text)).toEqual(["\\draw (a) -- node[pos=0.3] {x} (b);"]);
    const after = pic("\\draw (a) -- (b) node[right] {x};");
    const a = slide(after, mid(edgesOf(after)[0]!, 0.5));
    expect(a.ok && lines(a.text)).toEqual(["\\draw (a) -- (b) node[right, pos=0.5] {x};"]);
  });

  it("slides along curves and orthogonal pieces, and without snapping uses hundredths", () => {
    const curve = pic("\\draw (a) to[bend left] node {x} (b);");
    const c = edgesOf(curve)[0]!;
    const seg = c.route.segs[c.segs[0]!]!;
    const r = slide(curve, { x: (seg.from.x * 3 + seg.to.x) / 4, y: (seg.from.y * 3 + seg.to.y) / 4 }, false);
    expect(r.ok).toBe(true);
    const o = pic("\\draw (a) -| node {x} (b);");
    const oe = edgesOf(o)[0]!;
    const s = oe.route.segs[oe.segs[0]!]!;
    const w = slide(o, { x: s.to.x, y: (s.from.y + s.to.y) / 2 }, true);
    expect(w.ok && lines(w.text)[0]).toMatch(/pos=0\.7[05]?\]|pos=0\.75/);
    expect(w.ok && edgesOf(w.text)[0]!.labels[0]!.pathPos!.t).toBeGreaterThan(0.6);
  });

  it("adds pos= after a style that sets the position, so it wins", () => {
    const text = pic("\\tikzset{lab/.style={pos=#1}}\n\\draw (a) -- node[lab=0.3] {x} (b);");
    const l = layoutOf(text);
    const label = l.pathNodes[0]!;
    const r = planSlideLabel(text, 0, label.id, mid(pictureEdges(l)[0]!, 0.8));
    expect(r.ok && lines(r.text)[1]).toBe("\\draw (a) -- node[lab=0.3, pos=0.8] {x} (b);");
  });
});

describe("Yes and No on decisions", () => {
  const dec = "\\node[draw, diamond] (d) at (0,0) {Ok?};\n\\node[draw] (y) at (0,-3) {Y};\n\\node[draw] (n) at (4,0) {N};\n";
  const picture = (body: string) => `\\begin{tikzpicture}\n${dec}${body}\n\\end{tikzpicture}\n`;
  const nodeD = (text: string) => layoutOf(text).nodes.find((n) => n.name === "d")!;

  it("knows a decision by its shape or its style", () => {
    expect(isDecision(nodeD(picture("")))).toBe(true);
    const styled = layoutOf("\\begin{tikzpicture}\n\\node[decision] (d) {x};\n\\end{tikzpicture}\n").nodes[0]!;
    expect(isDecision(styled)).toBe(true);
    expect(isDecision(layoutOf(picture("")).nodes.find((n) => n.name === "y")!)).toBe(false);
  });

  it("labels the first branch Yes, then the second No", () => {
    const none = picture("");
    expect(branchLabel(none, layoutOf(none), nodeD(none))).toBe("Yes");
    const one = picture("\\draw[->] (d) -- node[right] {Yes} (y);");
    expect(branchLabel(one, layoutOf(one), nodeD(one))).toBe("No");
    const two = picture("\\draw[->] (d) -- node {Yes} (y);\n\\draw[->] (d) -- node {No} (n);");
    expect(branchLabel(two, layoutOf(two), nodeD(two))).toBeNull();
  });

  it("follows the pair the figure uses, and leaves other wording alone", () => {
    const lower = picture("\\draw[->] (d) -- node[right] {yes} (y);");
    expect(branchLabel(lower, layoutOf(lower), nodeD(lower))).toBe("no");
    const german = picture("\\draw[->] (d) -- node[right] {Nein} (y);");
    expect(branchLabel(german, layoutOf(german), nodeD(german))).toBe("Ja");
    const other = picture("\\draw[->] (d) -- node[right] {valid} (y);");
    expect(branchLabel(other, layoutOf(other), nodeD(other))).toBeNull();
    // Other wording anywhere on a decision's branches means no automatic labels.
    const elsewhere = picture("\\draw[->] (y) -- node {valid} (n);\n\\draw[->] (n) -- node {fine} (d);\n\\draw[->] (d) -- node[right] {valid} (n);");
    expect(branchLabel(elsewhere, layoutOf(elsewhere), nodeD(elsewhere))).toBeNull();
    // An unlabelled first branch gives no clue.
    const unlabelled = picture("\\draw[->] (d) -- (y);");
    expect(branchLabel(unlabelled, layoutOf(unlabelled), nodeD(unlabelled))).toBeNull();
  });
});

describe("the corpus", () => {
  it("adds a label to every editable edge and slides it, touching only the label", () => {
    let added = 0;
    let slid = 0;
    for (const name of corpusNames()) {
      const text = loadCorpusFile(name).text;
      const doc = analyzeDocument(text);
      doc.syntax.pictures.forEach((_, i) => {
        const l = layoutDocumentPicture(doc, i)!;
        for (const e of pictureEdges(l)) {
          if (e.lock) continue;
          const r = planAddLabel(text, i, e.id, mid(e), "lbl");
          if (!r.ok) {
            expect(r.reason, name).toBeTruthy();
            continue;
          }
          added++;
          expect(applyChanges(text, r.changes), name).toBe(r.text);
          expect(r.changes, name).toHaveLength(1);
          expect(r.changes[0]!.insert, name).toMatch(/^node\[.*\] \{lbl\} $/);
          // Slide the new label to a quarter of the way.
          const s = planSlideLabel(r.text, i, r.labelId, mid(findIn(r.layout, e.id)!, 0.25));
          if (s.ok) {
            slid++;
            expect(applyChanges(r.text, s.changes), name).toBe(s.text);
          } else expect(s.reason, name).toBeTruthy();
        }
      });
    }
    expect(added).toBeGreaterThan(100);
    expect(slid / added).toBeGreaterThan(0.8);
  });
});

function findIn(layout: PictureLayout, id: string): Edge | undefined {
  return pictureEdges(layout).find((e) => e.id === id);
}

describe("creating from a decision", () => {
  const head = "\\begin{tikzpicture}[node distance=8mm]\n";
  const tail = "\\end{tikzpicture}\n";
  const dec = `${head}\\node[draw, diamond] (d) {Ok?};\n${tail}`;
  const entryOf = (text: string) => paletteEntries(analyzeDocument(text), analyzeDocument(text).syntax.pictures[0]!, layoutOf(text)).find((e) => e.id === "process")!;
  const create = (text: string, placement: Placement) => {
    const r = planCreate(text, 0, { entry: entryOf(text), label: "Go", placement });
    if (!r.ok) throw new Error(r.reason);
    return r;
  };
  const firstNode = (text: string) => layoutOf(text).nodes[0]!.id;

  it("labels the first branch Yes, the second No, and says so", () => {
    const first = create(dec, { kind: "child", of: firstNode(dec) });
    expect(first.text).toMatch(/\\draw\[->\] \(d\) -- node\[near start, (right|above)\] \{Yes\} \(go\);/);
    expect(first.written).toContain("labelled Yes");
    const second = create(first.text, { kind: "child", of: firstNode(first.text) });
    expect(second.text).toMatch(/node\[near start, (right|above)\] \{No\} \(go2\);/);
    // A third branch gets no label.
    const third = create(second.text, { kind: "child", of: firstNode(second.text) });
    expect(third.text.match(/\{(Yes|No)\}/g)).toHaveLength(2);
  });

  it("puts the label beside an upright edge and above a level one", () => {
    const first = create(dec, { kind: "child", of: firstNode(dec) });
    expect(first.text).toContain("node[near start, right] {Yes}");
    const side = `${head}\\node[draw, diamond] (d) {Ok?};\n\\node[draw, below=of d] (x) {X};\n\\draw[->] (d) -- node[right] {Yes} (x);\n${tail}`;
    const second = create(side, { kind: "child", of: firstNode(side) });
    expect(second.text).toContain("-- node[near start, above] {No} (go);");
    // An unlabelled first branch gives no clue, so the new one stays unlabelled too.
    const bare = `${head}\\node[draw, diamond] (d) {Ok?};\n\\node[draw, below=of d] (x) {X};\n\\draw[->] (d) -- (x);\n${tail}`;
    expect(create(bare, { kind: "child", of: firstNode(bare) }).text).not.toContain("{No}");
  });

  it("leaves a plain node's edges unlabelled, and respects the figure's wording", () => {
    const plain = `${head}\\node[draw] (d) {Ok?};\n${tail}`;
    expect(create(plain, { kind: "child", of: firstNode(plain) }).text).not.toContain("near start");
    const other = `${head}\\node[draw, diamond] (d) {Ok?};\n\\node[draw, below=of d] (x) {X};\n\\draw[->] (d) -- node[right] {valid} (x);\n${tail}`;
    expect(create(other, { kind: "child", of: firstNode(other) }).text).not.toContain("near start");
  });

  it("labels an edge drawn from a decision by dragging", () => {
    const text = `${head}\\node[draw, diamond] (d) {Ok?};\n\\node[draw, below=of d] (x) {X};\n${tail}`;
    const l = layoutOf(text);
    const r = planConnect(text, 0, { node: l.nodes[0]!.id }, { node: l.nodes[1]!.id }, "\\draw[->]");
    if (!r.ok) throw new Error(r.reason);
    expect(r.text).toContain("\\draw[->] (d) -- node[near start, right] {Yes} (x);");
    expect(r.notes.join(" ")).toContain("labelled the branch Yes");
  });
});
