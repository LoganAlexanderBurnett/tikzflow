// Auto-layout (M4 step 3, D80): ELK decides layers and order; every node
// is written as a relation to a node before it; what already agrees is kept.
import { describe, expect, it } from "vitest";
import { autoLayoutMessage, guessDirection, layoutBlocker, planAutoLayout } from "../src/edit/autolayout.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";

const doc = (body: string, preamble = "\\usetikzlibrary{positioning}\n") =>
  `\\documentclass{article}\n\\usepackage{tikz}\n${preamble}\\begin{document}\n\\begin{tikzpicture}\n${body}\\end{tikzpicture}\n\\end{document}\n`;

function center(text: string, name: string) {
  const n = layoutDocumentPicture(analyzeDocument(text), 0)!.nodes.find((x) => x.name === name)!;
  return n.shape.center;
}

async function layOut(text: string, direction: "down" | "right" = "down", ids?: string[]) {
  const r = await planAutoLayout(text, 0, ids ? { direction, ids } : { direction });
  if (!r.ok) throw new Error(r.reason);
  return r;
}

describe("auto-layout", () => {
  it("writes a scattered chain as relations, keeping the first node where it is", async () => {
    const text = doc("\\node[draw] (a) at (1,1) {A};\n\\node[draw] (b) at (4,2) {B};\n\\node[draw] (c) at (-2,-3) {C};\n\\draw[->] (a) -- (b);\n\\draw[->] (b) -- (c);\n");
    const r = await layOut(text);
    expect(r.text).toContain("\\node[draw] (a) at (1,1) {A};");
    expect(r.text).toContain("\\node[draw, below=of a] (b) {B};");
    expect(r.text).toContain("\\node[draw, below=of b] (c) {C};");
    expect(center(r.text, "a")).toEqual(center(text, "a"));
    expect(r.count).toBe(3);
    expect(r.written.map((w) => w.name)).toEqual(["b", "c"]);
  });

  it("lays out left to right", async () => {
    const text = doc("\\node[draw] (a) at (0,0) {A};\n\\node[draw] (b) at (0,-3) {B};\n\\node[draw] (c) at (1,-6) {C};\n\\draw[->] (a) -- (b);\n\\draw[->] (b) -- (c);\n");
    const r = await layOut(text, "right");
    expect(r.text).toContain("\\node[draw, right=of a] (b) {B};");
    expect(r.text).toContain("\\node[draw, right=of b] (c) {C};");
  });

  it("puts a decision's second branch beside the first", async () => {
    const text = doc(
      "\\node[draw] (s) at (0,0) {S};\n\\node[draw, diamond] (d) at (0,-2) {D};\n\\node[draw] (y) at (-3,-4) {Yes};\n\\node[draw] (n) at (3,-4) {No};\n\\draw[->] (s) -- (d);\n\\draw[->] (d) -- (y);\n\\draw[->] (d) -- (n);\n",
    );
    const r = await layOut(text);
    expect(r.text).toContain("\\node[draw, diamond, below=of s] (d) {D};");
    // One branch goes straight down; the other sits beside it in the same row.
    const y = center(r.text, "y");
    const n = center(r.text, "n");
    expect(Math.abs(y.y - n.y)).toBeLessThan(0.01);
    expect(Math.min(Math.abs(y.x - center(r.text, "d").x), Math.abs(n.x - center(r.text, "d").x))).toBeLessThan(0.01);
  });

  it("keeps relations that already say what the layout says, and changes nothing a second time", async () => {
    const text = doc("\\node[draw] (a) {A};\n\\node[draw, below=of a] (b) {B};\n\\node[draw, below=of b] (c) {C};\n\\draw[->] (a) -- (b);\n\\draw[->] (b) -- (c);\n");
    const r = await layOut(text);
    expect(r.changes).toEqual([]);
    expect(autoLayoutMessage(r)).toMatch(/already follow this layout/);
  });

  it("keeps an old-style relation that still fits, and drops the node distance of one it replaces", async () => {
    const text = doc(
      "\\node[draw] (a) {A};\n\\node[draw, below of=a] (b) {B};\n\\node[draw, left of=b, node distance=4cm] (c) {C};\n\\draw[->] (a) -- (b);\n\\draw[->] (b) -- (c);\n",
    );
    const r = await layOut(text);
    expect(r.text).toContain("\\node[draw, below of=a] (b) {B};");
    expect(r.text).toContain("\\node[draw, below=of b] (c) {C};");
    expect(r.text).not.toContain("node distance=4cm");
  });

  it("loads the positioning library when the document lacks it", async () => {
    const text = doc("\\node[draw] (a) at (0,0) {A};\n\\node[draw] (b) at (3,0) {B};\n\\draw[->] (a) -- (b);\n", "");
    const r = await layOut(text);
    expect(r.added).toEqual(["positioning"]);
    expect(r.text).toContain("\\usetikzlibrary{positioning}");
  });

  it("removes corners written as fixed coordinates and keeps relative ones", async () => {
    const text = doc(
      "\\node[draw] (a) at (0,0) {A};\n\\node[draw] (b) at (5,1) {B};\n\\node[draw] (c) at (2,-4) {C};\n\\draw[->] (a) -- (3,3) -- (b);\n\\draw[->] (b) -- ++(1,0) |- (c);\n",
    );
    const r = await layOut(text);
    expect(r.text).toContain("\\draw[->] (a) -- (b);");
    expect(r.text).toContain("\\draw[->] (b) -- ++(1,0) |- (c);");
    expect(r.corners).toBe(1);
  });

  it("keeps an orthogonal edge orthogonal when its fixed corner goes, and writes one whose ends now line up with --", async () => {
    // Two children: one goes under the parent (its edge would run into the child's centre), the other beside it.
    const text = doc("\\node[draw] (a) at (0,0) {A};\n\\node[draw] (b) at (-4,-3) {B};\n\\node[draw] (c) at (4,-3) {C};\n\\draw[->] (a) -| (-3,2) |- (b);\n\\draw[->] (a) -| (3,2) |- (c);\n");
    const r = await layOut(text);
    expect(r.corners).toBe(2);
    expect(r.straightened).toBe(1);
    expect(r.text).toMatch(/\\draw\[->\] \(a\) -- \((b|c)\);/);
    expect(r.text).toMatch(/\\draw\[->\] \(a\) -\| \((b|c)\);/);
    expect(autoLayoutMessage(r)).toMatch(/now runs straight, so it is written with --/);
  });

  it("puts a label the new line cuts through beside it with auto", async () => {
    const text = doc("\\node[draw] (a) at (0,0) {A};\n\\node[draw] (b) at (0,-3) {B};\n\\draw[->] (a) -- node[right] {x} (b);\n");
    const r = await layOut(text, "right");
    expect(r.text).toContain("\\node[draw, right=of a] (b) {B};");
    expect(r.text).toMatch(/\\draw\[->\] \(a\) -- node\[auto(, swap)?\] \{x\} \(b\);/);
    expect(r.labels).toBe(1);
    expect(autoLayoutMessage(r)).toMatch(/the label "x" was written as right → auto/);
  });

  it("lays out only the selection when two or more nodes are selected", async () => {
    const text = doc(
      "\\node[draw] (a) at (0,0) {A};\n\\node[draw] (b) at (4,1) {B};\n\\node[draw] (c) at (7,-2) {C};\n\\node[draw] (x) at (-5,5) {X};\n\\draw[->] (a) -- (b);\n\\draw[->] (b) -- (c);\n\\draw[->] (x) -- (a);\n",
    );
    const r = await layOut(text, "down", ["b", "c"]);
    expect(r.count).toBe(2);
    expect(r.text).toContain("\\node[draw] (a) at (0,0) {A};");
    expect(r.text).toContain("\\node[draw] (b) at (4,1) {B};");
    expect(r.text).toContain("\\node[draw, below=of b] (c) {C};");
    expect(r.text).toContain("\\node[draw] (x) at (-5,5) {X};");
  });

  it("leaves locked nodes where they are", async () => {
    const text = doc("\\node[draw] (a) at (0,0) {A};\n\\node[draw] (b) at (3,0) {B};\n\\node[draw, right=of nowhere] (l) {L};\n\\draw[->] (a) -- (b);\n");
    const before = center(text, "l");
    const r = await layOut(text);
    expect(r.count).toBe(2);
    expect(r.text).toContain("\\node[draw, right=of nowhere] (l) {L};");
    expect(center(r.text, "l")).toEqual(before);
  });

  it("refuses when fewer than two nodes can move", () => {
    const l = layoutDocumentPicture(analyzeDocument(doc("\\node[draw] (a) {A};\n")), 0)!;
    expect(layoutBlocker(l)).toMatch(/fewer than two/);
  });

  it("guesses the direction the picture runs in", () => {
    const across = layoutDocumentPicture(analyzeDocument(doc("\\node (a) {A};\n\\node[right=of a] (b) {B};\n\\node[right=of b] (c) {C};\n\\draw (a) -- (b) -- (c);\n")), 0)!;
    const down = layoutDocumentPicture(analyzeDocument(doc("\\node (a) {A};\n\\node[below=of a] (b) {B};\n\\draw (a) -- (b);\n")), 0)!;
    expect(guessDirection(across)).toBe("right");
    expect(guessDirection(down)).toBe("down");
  });

  it("is one edit whose text is the result", async () => {
    const text = doc("\\node[draw] (a) at (0,0) {A};\n\\node[draw] (b) at (2,2) {B};\n\\node[draw] (c) at (5,5) {C};\n\\draw (a) -- (b) -- (c);\n");
    const r = await layOut(text);
    let t = text;
    for (const c of [...r.changes].sort((p, q) => q.from - p.from)) t = t.slice(0, c.from) + c.insert + t.slice(c.to);
    expect(t).toBe(r.text);
  });
});
