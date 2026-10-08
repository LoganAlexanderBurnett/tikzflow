// Milestone 2a step 6: creating nodes. The palette, relational placement for
// Tab and Enter, drops at a point, styles and libraries added only when
// missing, unique names, and nothing else in the file changing.
import { describe, expect, it } from "vitest";
import { applyChanges, diffRange } from "../src/edit/changes.ts";
import { type CreateOutcome, defaultEntry, paletteEntries, type PaletteEntry, planCreate, STANDARD_ENTRIES, type Placement } from "../src/edit/create.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import type { LaidOutNode, PictureLayout } from "../src/tikz/layout.ts";
import { SAMPLE } from "../src/ui/sample.ts";
import { corpusNames, loadCorpusFile } from "./corpus.ts";

const layoutOf = (text: string, pic = 0): PictureLayout => layoutDocumentPicture(analyzeDocument(text), pic)!;
const entries = (text: string, pic = 0) => {
  const doc = analyzeDocument(text);
  const l = layoutDocumentPicture(doc, pic)!;
  return paletteEntries(doc, doc.syntax.pictures[pic]!, l);
};
const entry = (text: string, id: string): PaletteEntry => entries(text).find((e) => e.id === id)!;

function create(text: string, id: string, label: string, placement: Placement, pic = 0): Extract<CreateOutcome, { ok: true }> {
  const r = planCreate(text, pic, { entry: entry(text, id), label, placement });
  if (!r.ok) throw new Error(r.reason);
  // The changes give exactly the text reported.
  expect(applyChanges(text, r.changes)).toBe(r.text);
  return r;
}
const line = (text: string, part: string) => text.split("\n").find((l) => l.includes(part)) ?? "";

describe("the palette", () => {
  it("offers the six flowchart shapes, in the document's own styles where it has them", () => {
    const list = entries(SAMPLE);
    expect(list.filter((e) => e.source === "standard").map((e) => e.id)).toEqual(["process", "decision", "terminal", "io", "connector", "document"]);
    // The sample defines process, decision, terminal and io itself, so those aren't redefined.
    for (const id of ["process", "decision", "terminal", "io"]) expect(list.find((e) => e.id === id)!.body).toBeUndefined();
    for (const id of ["connector", "document"]) expect(list.find((e) => e.id === id)!.body).toBeDefined();
  });

  it("adds the document's own node styles", () => {
    const text = loadCorpusFile("self-hybrid-surrogate.tex").text;
    const own = entries(text).filter((e) => e.source === "document");
    expect(own.map((e) => e.id)).toEqual(expect.arrayContaining(["state", "control", "kin"]));
    // Styles that aren't node styles stay out.
    expect(own.map((e) => e.id)).not.toContain(">");
  });

  it("uses the shapes the brief asks for", () => {
    const shapes = Object.fromEntries(STANDARD_ENTRIES.map((e) => [e.id, e.shape]));
    expect(shapes).toEqual({ process: "rectangle", decision: "diamond", terminal: "rounded rectangle", io: "trapezium", connector: "circle", document: "tape" });
  });

  it("starts new nodes as the document's own most used style when it has no process", () => {
    const text = loadCorpusFile("self-hybrid-surrogate.tex").text;
    const doc = analyzeDocument(text);
    const l = layoutDocumentPicture(doc, 0)!;
    const e = defaultEntry(paletteEntries(doc, doc.syntax.pictures[0]!, l), doc, doc.syntax.pictures[0]!, l);
    expect(e.source).toBe("document");
  });
});

describe("a child (Tab)", () => {
  it("is written below the node with an edge, in the arrow style the picture uses", () => {
    const text = SAMPLE;
    const r = create(text, "process", "Save result", { kind: "child", of: "stop" });
    expect(line(r.text, "(saveResult)")).toMatch(/\\node\[process, below=of stop\] \(saveResult\) \{Save result\};/);
    expect(r.text).toContain("\\draw[->] (stop) -- (saveResult);");
    expect(r.name).toBe("saveResult");
    // Only insertions: nothing already written changes.
    expect(r.changes.every((c) => c.from === c.to)).toBe(true);
    // The node comes after the last node and its edge after the last path.
    expect(r.text.indexOf("(saveResult) {")).toBeGreaterThan(r.text.indexOf("(stop)  {Stop}"));
    expect(r.text.indexOf("(stop) -- (saveResult)")).toBeGreaterThan(r.text.indexOf("(base)  |- (stop)"));
  });

  it("goes to a free side when the flow's direction is taken", () => {
    // Below "rec" is "stop": the new node goes beside it instead.
    const r = create(SAMPLE, "process", "Side step", { kind: "child", of: "rec" });
    expect(line(r.text, "(sideStep)")).toContain("right=of rec");
    const l = r.layout;
    const n = l.nodes.find((x) => x.name === "sideStep")!;
    for (const o of l.nodes) if (o !== n) expect(Math.abs(o.shape.center.x - n.shape.center.x) >= o.shape.hw + n.shape.hw - 0.5 || Math.abs(o.shape.center.y - n.shape.center.y) >= o.shape.hh + n.shape.hh - 0.5, o.id).toBe(true);
  });

  it("follows the way the flow already runs (left to right)", () => {
    const text = "\\usetikzlibrary{positioning}\n\\begin{tikzpicture}\n\\node[draw] (a) {A};\n\\node[draw, right=of a] (b) {B};\n\\draw[->] (a) -- (b);\n\\end{tikzpicture}\n";
    const r = create(text, "process", "C", { kind: "child", of: "b" });
    expect(line(r.text, "(c)")).toContain("right=of b");
  });

  it("adds a style the document lacks, where it keeps its styles, with the libraries its shape needs", () => {
    const r = create(SAMPLE, "document", "Report", { kind: "child", of: "stop" });
    expect(r.text).toMatch(/document\/\.style\s*=\s*\{draw, tape, minimum width=28mm/);
    // shapes.symbols is loaded in the existing \usetikzlibrary line.
    expect(r.text).toMatch(/\\usetikzlibrary\{positioning, shapes\.geometric, arrows\.meta, shapes\.symbols\}/);
    expect(r.text).toContain("\\node[document, below=of stop] (report) {Report};");
    expect(r.notes.join(" ")).toContain("added the document style");
  });

  it("doesn't touch a style the document already has", () => {
    const r = create(SAMPLE, "decision", "Done?", { kind: "child", of: "stop" });
    expect(r.text.match(/decision\/\.style/g)).toHaveLength(1);
    expect(r.text.match(/\\usetikzlibrary/g)).toHaveLength(1);
  });

  it("works in a bare picture: the style goes in the picture's options", () => {
    const text = "\\begin{tikzpicture}\n  \\node[draw] (a) at (0,0) {A};\n\\end{tikzpicture}\n";
    const r = create(text, "terminal", "Stop", { kind: "child", of: "a" });
    expect(r.text).toMatch(/\\begin\{tikzpicture\}\[terminal\/\.style=\{draw, rounded rectangle/);
    expect(r.text).toContain("\\node[terminal, below=of a] (stop) {Stop};");
    // It can't load libraries in a preamble it doesn't have, and says so.
    expect(r.notes.join(" ")).toMatch(/usetikzlibrary/);
  });

  it("gives names that are unique and meaningful, and falls back for math", () => {
    let text = SAMPLE;
    for (let i = 0; i < 3; i++) text = create(text, "process", "Answer", { kind: "child", of: "stop" }).text;
    expect([...text.matchAll(/\((answer\d*)\) \{Answer\}/g)].map((m) => m[1])).toEqual(["answer", "answer2", "answer3"]);
    const m = create(SAMPLE, "decision", "$x > 0$", { kind: "child", of: "stop" });
    expect(m.name).toBe("decision1");
  });

  it("names an unnamed parent from its label, in the same edit (D44)", () => {
    const unnamed = "\\begin{tikzpicture}\n\\node[draw] at (0,0) {Read input};\n\\end{tikzpicture}\n";
    const id = layoutOf(unnamed).nodes[0]!.id;
    const r = create(unnamed, "process", "Check", { kind: "child", of: id });
    expect(r.text).toContain("\\node[draw] (readInput) at (0,0) {Read input};");
    expect(r.text).toContain("below=of readInput] (check) {Check};");
    expect(r.text).toContain("(readInput) -- (check);");
    expect(r.notes.join(" ")).toMatch(/named the selected node readInput/);
    // Only the name was added to the parent's statement.
    expect(line(r.text, "Read input")).toBe(line(unnamed, "Read input").replace("[draw]", "[draw] (readInput)"));
  });

  it("gives the parent the plainer name when both labels would give the same one", () => {
    const unnamed = "\\begin{tikzpicture}\n\\node {Step};\n\\end{tikzpicture}\n";
    const id = layoutOf(unnamed).nodes[0]!.id;
    const r = create(unnamed, "process", "Step", { kind: "sibling", of: id });
    expect(r.text).toContain("\\node (step) {Step};");
    expect(r.name).toBe("step2");
    // A label without words falls back to the shape.
    const math = "\\begin{tikzpicture}\n\\node[draw]{$x$};\n\\end{tikzpicture}\n";
    const m = create(math, "process", "Next", { kind: "child", of: layoutOf(math).nodes[0]!.id });
    expect(m.text).toContain("\\node[draw] (rectangle1) {$x$};");
  });

  it("refuses a locked node and a label that would break the code", () => {
    const bad = planCreate(SAMPLE, 0, { entry: entry(SAMPLE, "process"), label: "50% done", placement: { kind: "child", of: "stop" } });
    expect(bad.ok).toBe(false);
  });

  it("keeps CRLF line endings", () => {
    const text = SAMPLE.replace(/\n/g, "\r\n");
    const r = create(text, "process", "Next", { kind: "child", of: "stop" });
    expect(r.text.replace(/\r\n/g, "")).not.toContain("\n");
    expect(r.text).toContain("\\node[process, below=of stop] (next) {Next};\r\n");
  });

  it("goes right after a node whose name is used again later", () => {
    const text = loadCorpusFile("se-102785-foreach-scope.tex").text;
    const l = layoutOf(text);
    const names = l.nodes.map((n) => n.name).filter(Boolean);
    const dup = names.find((n, i) => names.indexOf(n) !== i);
    if (!dup) return;
    const first = l.nodes.find((n) => n.name === dup)!;
    const r = create(text, "process", "Fresh", { kind: "child", of: first.id });
    const made = r.layout.nodes.find((n) => n.name === r.name)!;
    expect(made.lock).toBeUndefined();
    // It sits next to the node it was added to, not next to a later node of the same name.
    const parent = r.layout.nodes.find((n) => n.id === first.id)!;
    const gap = Math.hypot(made.shape.center.x - parent.shape.center.x, made.shape.center.y - parent.shape.center.y);
    expect(gap).toBeLessThan(parent.shape.hw + made.shape.hw + parent.shape.hh + made.shape.hh + 60);
    // The node went right after the parent, before the next node that has its name.
    const again = l.nodes.find((n) => n.name === dup && l.nodes.indexOf(n) > l.nodes.indexOf(first))!;
    const ins = r.changes.find((c) => c.insert.includes(`(${r.name})`) && c.insert.includes("\\node"))!;
    expect(ins.from).toBeGreaterThanOrEqual(first.statement.to);
    expect(ins.from).toBeLessThanOrEqual(again.statement.from);
  });
});

describe("a sibling (Enter)", () => {
  it("is written beside the node, with an edge from the node that leads to it", () => {
    // "rec" comes from "small" and flows downward, so its sibling goes to the right...
    const r = create(SAMPLE, "process", "Retry", { kind: "sibling", of: "rec" });
    expect(line(r.text, "(retry)")).toMatch(/\\node\[process, (right|left)=of rec\] \(retry\) \{Retry\};/);
    // ...and gets the same kind of edge from "small" that "rec" has.
    expect(r.text).toContain("\\draw[->] (small) -- (retry);");
  });

  it("has no edge when the node has nothing leading to it", () => {
    const r = create(SAMPLE, "process", "Also start", { kind: "sibling", of: "start" });
    expect(r.text).not.toContain("-- (alsoStart)");
    expect(line(r.text, "(alsoStart)")).toMatch(/(right|left)=of start/);
  });
});

describe("a drop at a point", () => {
  it("snaps to a gap at node distance and writes it relatively", () => {
    const l = layoutOf(SAMPLE);
    const stop = l.nodes.find((n) => n.name === "stop")!;
    // Roughly below "stop", off by a few points.
    const at = { x: stop.shape.center.x + 3, y: stop.shape.center.y - stop.shape.hh * 2 - 22 };
    const r = create(SAMPLE, "terminal", "End", { kind: "at", center: at, threshold: 6 });
    expect(line(r.text, "(end)")).toMatch(/\\node\[terminal, below=of stop\] \(end\) \{End\};/);
    expect(r.text).not.toContain("at (0,0)");
  });

  it("writes plain coordinates when nothing lines up, and for an empty picture", () => {
    const empty = "\\begin{tikzpicture}\n\\end{tikzpicture}\n";
    const r = create(empty, "process", "First", { kind: "at", center: { x: 0, y: 0 }, threshold: 6 });
    expect(r.text).toMatch(/\\node\[process\] \(first\) at \(0,0\) \{First\};/);
    const far = create(SAMPLE, "process", "Far away", { kind: "at", center: { x: 400, y: -900 }, threshold: 6 });
    expect(line(far.text, "(farAway)")).toMatch(/at \(/);
  });
});

describe("the corpus", () => {
  it("adds a child to the last named node of every picture without breaking anything", () => {
    let done = 0;
    for (const name of corpusNames()) {
      const text = loadCorpusFile(name).text;
      const doc = analyzeDocument(text);
      doc.syntax.pictures.forEach((_, pic) => {
        const l = layoutDocumentPicture(doc, pic)!;
        const parent = [...l.nodes].reverse().find((n) => n.kind === "statement" && n.name && !n.implicitName && !n.lock && /^[A-Za-z0-9_\-:]+$/.test(n.name));
        if (!parent) return;
        const r = planCreate(text, pic, { entry: entry(text, "process"), label: "Added step", placement: { kind: "child", of: parent.id } });
        if (!r.ok) return;
        done++;
        const after = analyzeDocument(r.text);
        expect(after.errors.length, name).toBeLessThanOrEqual(doc.errors.length);
        const made = r.layout.nodes.find((n) => n.name === r.name)! as LaidOutNode;
        expect(made, name).toBeDefined();
        expect(made.lock, name).toBeUndefined();
        // Nothing existing moved: every old node keeps its place.
        for (const o of l.nodes) {
          const n = r.layout.nodes.find((x) => x.name === o.name && x.id === o.id);
          if (!n) continue;
          expect(Math.abs(n.shape.center.x - o.shape.center.x) + Math.abs(n.shape.center.y - o.shape.center.y), `${name} ${o.id}`).toBeLessThan(0.01);
        }
        // Bytes outside the new lines, the style and the library are untouched: all changes are pure insertions.
        expect(r.changes.every((c) => c.from === c.to), name).toBe(true);
        const d = diffRange(text, r.text);
        expect(d).not.toBeNull();
      });
    }
    expect(done).toBeGreaterThan(15);
  });
});
