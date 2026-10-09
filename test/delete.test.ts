// Milestone 2b step 9 (D56): deleting nodes, edges and paths without leaving
// references LaTeX would reject.
import { describe, expect, it } from "vitest";
import { applyChanges } from "../src/edit/changes.ts";
import { type DeleteTarget, planDelete, statementRemoval } from "../src/edit/delete.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import { pictureEdges } from "../src/model/edges.ts";
import { unresolvedReferences } from "../src/model/references.ts";
import type { PictureLayout } from "../src/tikz/layout.ts";
import { shapeBounds } from "../src/tikz/shapes.ts";
import { corpusNames, loadCorpusFile } from "./corpus.ts";

const head = "\\begin{tikzpicture}[node distance=10mm]\n";
const tail = "\\end{tikzpicture}\n";
const pic = (body: string) => `${head}${body}\n${tail}`;
const layoutOf = (text: string): PictureLayout => layoutDocumentPicture(analyzeDocument(text), 0)!;
const node = (text: string, name: string) => layoutOf(text).nodes.find((n) => n.name === name)!;
const del = (text: string, target: DeleteTarget) => {
  const r = planDelete(text, 0, target);
  if (!r.ok) throw new Error(r.reason);
  expect(applyChanges(text, r.changes)).toBe(r.text);
  return r;
};
const delNode = (text: string, ...names: string[]) => del(text, { kind: "nodes", ids: names.map((n) => node(text, n).id) });
const refused = (text: string, target: DeleteTarget) => {
  const r = planDelete(text, 0, target);
  expect(r.ok).toBe(false);
  return r.ok ? "" : r.reason;
};
const body = (text: string) => text.slice(head.length, text.length - tail.length).replace(/\n$/, "");

describe("removing a statement", () => {
  it("takes the whole line and the comment after it", () => {
    const t = "a\n  \\draw (a) -- (b); % to b\nz\n";
    const from = t.indexOf("\\draw");
    const c = statementRemoval(t, from, t.indexOf(";") + 1);
    expect(applyChanges(t, [c])).toBe("a\nz\n");
  });
  it("takes only the statement when others share the line", () => {
    const t = "\\node (a) {A}; \\node (b) {B};\n";
    expect(applyChanges(t, [statementRemoval(t, 0, 14)])).toBe("\\node (b) {B};\n");
    expect(applyChanges(t, [statementRemoval(t, 15, 29)])).toBe("\\node (a) {A};\n");
  });
  it("keeps CRLF line ends", () => {
    const t = "a\r\n\\draw (a) -- (b);\r\nz\r\n";
    const from = t.indexOf("\\draw");
    expect(applyChanges(t, [statementRemoval(t, from, t.indexOf(";") + 1)])).toBe("a\r\nz\r\n");
  });
});

describe("deleting an edge", () => {
  const nodes = "\\node[draw] (a) at (0,0) {A};\n\\node[draw] (b) at (3,0) {B};\n\\node[draw] (c) at (3,-3) {C};\n";

  it("removes a statement that holds only that edge, with its comment", () => {
    const text = pic(`${nodes}\\draw[->] (a) -- (b); % the first\n\\draw[->] (b) -- (c);`);
    const edge = pictureEdges(layoutOf(text))[0]!;
    const r = del(text, { kind: "edge", id: edge.id });
    expect(body(r.text)).toBe(`${nodes}\\draw[->] (b) -- (c);`);
    expect(r.message).toMatch(/Deleted the edge a → b/);
    expect(pictureEdges(r.layout)).toHaveLength(1);
  });

  it("splits a \\draw with several edges first, so only that edge goes", () => {
    const text = pic(`${nodes}\\draw[->] (a) -- (b) -- (c);`);
    const edges = pictureEdges(layoutOf(text));
    const first = del(text, { kind: "edge", id: edges[0]!.id });
    expect(body(first.text)).toBe(`${nodes}\\draw[->] (b) -- (c);`);
    const second = del(text, { kind: "edge", id: edges[1]!.id });
    expect(body(second.text)).toBe(`${nodes}\\draw (a) -- (b);`);
  });

  it("deletes an edge operation, alone or among others", () => {
    const text = pic(`${nodes}\\path[->] (a) edge (b) (b) edge[bend left] (c);`);
    const edges = pictureEdges(layoutOf(text));
    expect(edges).toHaveLength(2);
    const r = del(text, { kind: "edge", id: edges[1]!.id });
    expect(body(r.text)).toBe(`${nodes}\\path[->] (a) edge (b);`);
    expect(pictureEdges(r.layout)).toHaveLength(1);
  });

  it("refuses edges that are kept as written", () => {
    const text = pic(`${nodes}\\draw (a) -- (b) -- (2,-3) -- cycle;`);
    const e = pictureEdges(layoutOf(text)).find((x) => x.lock);
    if (e) expect(refused(text, { kind: "edge", id: e.id })).toMatch(/kept as written/);
  });
});

describe("deleting nodes", () => {
  it("deletes a node and the edges that led to it, leaving the rest alone", () => {
    const text = pic("\\node[draw] (a) at (0,0) {A};\n\\node[draw] (b) at (3,0) {B};\n\\node[draw] (c) at (3,-3) {C};\n\\draw[->] (a) -- (b);\n\\draw[->] (b) -- (c);\n\\draw[->] (a) -- (c);");
    const r = delNode(text, "b");
    expect(body(r.text)).toBe("\\node[draw] (a) at (0,0) {A};\n\\node[draw] (c) at (3,-3) {C};\n\\draw[->] (a) -- (c);");
    expect(r.message).toBe("Deleted b and 2 edges that led to it");
    expect(r.layout.nodes.map((n) => n.name)).toEqual(["a", "c"]);
  });

  it("deletes a node with no edges, an unnamed node, and several at once", () => {
    const text = pic("\\node[draw] (a) at (0,0) {A};\n\\node[draw] at (3,0) {Loose};\n\\node[draw] (c) at (3,-3) {C};\n\\draw (a) -- (c);");
    const loose = layoutOf(text).nodes[1]!;
    const r = del(text, { kind: "nodes", ids: [loose.id] });
    expect(body(r.text)).toBe("\\node[draw] (a) at (0,0) {A};\n\\node[draw] (c) at (3,-3) {C};\n\\draw (a) -- (c);");
    const both = delNode(text, "a", "c");
    expect(body(both.text)).toBe("\\node[draw] at (3,0) {Loose};");
    expect(both.layout.nodes).toHaveLength(1);
  });

  it("re-attaches nodes placed relative to it to what it was placed against, where they were", () => {
    const text = pic("\\node[draw] (a) {A};\n\\node[draw, below=of a] (b) {B};\n\\node[draw, below=of b] (c) {C};\n\\draw[->] (a) -- (b);\n\\draw[->] (b) -- (c);");
    const c0 = node(text, "c").shape.center;
    const r = delNode(text, "b");
    const c1 = r.layout.nodes.find((n) => n.name === "c")!;
    expect(Math.hypot(c1.shape.center.x - c0.x, c1.shape.center.y - c0.y)).toBeLessThan(1.5 * 2.845);
    expect(r.text).toMatch(/\\node\[draw, below=[^\]]*of a\] \(c\) \{C\};/);
    expect(r.text).not.toMatch(/of b/);
    expect(r.notes.join(" ")).toMatch(/c is now placed/);
    expect(body(r.text)).not.toMatch(/\\draw/);
  });

  it("re-attaches a node placed with at (b |- a)", () => {
    const text = pic("\\node[draw] (a) at (0,0) {A};\n\\node[draw] (b) at (4,-2) {B};\n\\node[draw] (c) at (b |- a) {C};");
    const r = delNode(text, "b");
    expect(r.text).not.toMatch(/\bb\b.*\{C\}/);
    const c = r.layout.nodes.find((n) => n.name === "c")!;
    expect(c.shape.center.x).toBeCloseTo(4 * 28.4528, 0);
    expect(c.shape.center.y).toBeCloseTo(0, 1);
  });

  it("pins a node at its current position when nothing else can hold it", () => {
    const text = pic("\\node[draw] (b) at (2,1) {B};\n\\node[draw, right=of b] (c) {C};");
    const c0 = node(text, "c").shape.center;
    const r = delNode(text, "b");
    expect(r.notes.join(" ")).toMatch(/at its current position/);
    const c1 = r.layout.nodes[0]!;
    expect(Math.hypot(c1.shape.center.x - c0.x, c1.shape.center.y - c0.y)).toBeLessThan(0.5);
    expect(r.text).toMatch(/\\node\[draw(, [^\]]*)?\] \(c\) at \([\d.]+,[\d.]+\) \{C\};/);
  });

  it("rewrites a corner that was written relative to the deleted node", () => {
    const text = pic("\\node[draw] (a) at (0,0) {A};\n\\node[draw] (b) at (4,0) {B};\n\\node[draw] (c) at (4,-3) {C};\n\\node[draw] (d) at (0,-3) {D};\n\\draw[->] (a) -- (b |- d) -- (d);");
    const before = pictureEdges(layoutOf(text));
    expect(before).toHaveLength(1);
    const r = delNode(text, "b");
    expect(r.text).not.toMatch(/\(b \|-/);
    expect(pictureEdges(r.layout)).toHaveLength(1);
    expect(r.notes.join(" ")).toMatch(/rewrote a corner/);
  });

  it("deletes a node that starts its own path statement", () => {
    const text = pic("\\node[draw] (a) at (0,0) {A};\n\\node[draw] (b) at (3,0) {B} edge[->] (a);");
    // The statement holds the node and its edge; both go.
    const r = delNode(text, "b");
    expect(body(r.text)).toBe("\\node[draw] (a) at (0,0) {A};");
  });

  it("refuses names used in code the editor keeps as written", () => {
    const loop = pic("\\node[draw] (a) at (0,0) {A};\n\\foreach \\i in {1,2} { \\draw (a) -- (\\i,1); }");
    if (layoutOf(loop).opaque.length) expect(refused(loop, { kind: "nodes", ids: [node(loop, "a").id] })).toMatch(/kept as written|keeps as written/);
  });

  describe("a node in the fit of another (D58 item 4)", () => {
    const abc = "\\node[draw] (a) at (0,0) {A};\n\\node[draw] (b) at (2,0) {B};\n\\node[draw] (c) at (4,0) {C};\n";

    it("leaves the fit list, and the fitted node shrinks", () => {
      const three = pic(`${abc}\\node[draw, fit=(a) (b) (c)] (box) {};`);
      const widthOf = (t: string) => {
        const b = shapeBounds(layoutOf(t).nodes.find((n) => n.name === "box")!.shape);
        return b.maxX - b.minX;
      };
      for (const [gone, left] of [["a", "fit=(b) (c)"], ["b", "fit=(a) (c)"], ["c", "fit=(a) (b)"]] as const) {
        const r = delNode(three, gone);
        expect(body(r.text)).toContain(left);
        expect(r.notes.join(" ")).toContain(`${gone} left the fit of box`);
        expect(r.message).toMatch(/Deleted/);
        // The middle node doesn't change the box; an end node does.
        if (gone === "b") expect(widthOf(r.text)).toBeCloseTo(widthOf(three), 6);
        else expect(widthOf(r.text)).toBeLessThan(widthOf(three));
      }
    });

    it("takes several at once, with their spacing, inside braces too", () => {
      const braced = pic(`${abc}\\node[draw, fit={(a)  (b)(c)}] (box) {};`);
      expect(body(delNode(braced, "b", "c").text)).toContain("fit={(a)}");
      expect(body(delNode(braced, "a", "b").text)).toContain("fit={(c)}");
      expect(body(delNode(braced, "a").text)).toContain("fit={(b)(c)}");
    });

    it("changes nothing else in the statement", () => {
      const text = pic("\\node[draw] (a) at (0,0) {A};\n\\node[draw] (b) at (2,0) {B};\n\\node[draw, fit = (a)  (b), inner sep=5pt, dashed] (box) {}; % group");
      const r = delNode(text, "b");
      expect(body(r.text)).toBe("\\node[draw] (a) at (0,0) {A};\n\\node[draw, fit = (a), inner sep=5pt, dashed] (box) {}; % group");
    });

    it("is refused only for the last members, naming them", () => {
      const two = pic("\\node[draw] (a) at (0,0) {A};\n\\node[draw] (b) at (2,0) {B};\n\\node[draw, fit=(a) (b)] (box) {};");
      expect(refused(two, { kind: "nodes", ids: [node(two, "a").id, node(two, "b").id] })).toMatch(/a, b are the last nodes that box fits around/);
      const one = pic("\\node[draw] (a) at (0,0) {A};\n\\node[draw, fit=(a)] (box) {};");
      expect(refused(one, { kind: "nodes", ids: [node(one, "a").id] })).toMatch(/a is the last node that box fits around/);
      // Taking the fitted node along is fine.
      expect(body(delNode(two, "a", "b", "box").text)).toBe("");
    });

    it("re-attaches a node placed against the deleted member, and keeps the fit", () => {
      const text = pic(`${abc}\\node[draw, fit=(a) (b)] (box) {};\n\\node[draw, below=of b] (d) {D};`);
      const r = delNode(text, "b");
      expect(body(r.text)).toContain("fit=(a)");
      expect(r.text).not.toMatch(/of b\b/);
    });
  });

  it("refuses a node written inside a path", () => {
    const text = pic("\\node[draw] (a) at (0,0) {A};\n\\draw (a) -- (2,0) coordinate (m);");
    const m = layoutOf(text).nodes.find((n) => n.name === "m");
    if (m) expect(refused(text, { kind: "nodes", ids: [m.id] })).toMatch(/inside a path/);
  });

  it("leaves no new undefined names, and every other node and edge as it was", () => {
    const text = pic("\\node[draw] (a) {A};\n\\node[draw, right=of a] (b) {B};\n\\node[draw, right=of b] (c) {C};\n\\node[draw, below=of b] (d) {D};\n\\draw[->] (a) -- (b);\n\\draw[->] (b) -- (c);\n\\draw[->] (b) -- (d);\n\\draw[->] (a) -- (d);");
    const r = delNode(text, "b");
    const doc = analyzeDocument(r.text);
    expect(unresolvedReferences(r.text, doc.syntax.pictures[0]!, r.layout)).toEqual([]);
    expect(pictureEdges(r.layout)).toHaveLength(1);
    for (const n of ["a", "c", "d"]) {
      const was = node(text, n).shape.center;
      const now = r.layout.nodes.find((x) => x.name === n)!.shape.center;
      expect(Math.hypot(was.x - now.x, was.y - now.y)).toBeLessThan(4.3);
    }
  });
});

describe("deleting a path", () => {
  it("removes a statement that isn't an edge", () => {
    const text = pic("\\node[draw] (a) at (0,0) {A};\n\\draw[dashed] (a) circle (1);");
    const path = layoutOf(text).paths[0]!;
    const r = del(text, { kind: "path", id: path.id });
    expect(body(r.text)).toBe("\\node[draw] (a) at (0,0) {A};");
  });
});

describe("the corpus", () => {
  it("deletes each named node where it can, without leaving undefined references or moving anything", () => {
    let tried = 0;
    let done = 0;
    for (const name of corpusNames()) {
      const text = loadCorpusFile(name).text;
      const doc = analyzeDocument(text);
      doc.syntax.pictures.forEach((_, i) => {
        const l = layoutDocumentPicture(doc, i)!;
        for (const n of l.nodes) {
          if (n.kind !== "statement" || !n.name || n.lock) continue;
          tried++;
          const r = planDelete(text, i, { kind: "nodes", ids: [n.id] });
          if (!r.ok) {
            expect(r.reason, name).toBeTruthy();
            continue;
          }
          done++;
          expect(applyChanges(text, r.changes), name).toBe(r.text);
          expect(r.layout.nodes.length, name).toBe(l.nodes.length - 1);
          const d2 = analyzeDocument(r.text);
          const was = new Set(unresolvedReferences(text, doc.syntax.pictures[i]!, l).map((u) => u.name));
          expect(unresolvedReferences(r.text, d2.syntax.pictures[i]!, r.layout).filter((u) => !was.has(u.name)), name).toEqual([]);
        }
      });
    }
    expect(tried).toBeGreaterThan(150);
    expect(done / tried).toBeGreaterThan(0.5);
  }, 120000);

  it("deletes each editable edge, changing nothing else", () => {
    let tried = 0;
    let done = 0;
    for (const name of corpusNames()) {
      const text = loadCorpusFile(name).text;
      const doc = analyzeDocument(text);
      doc.syntax.pictures.forEach((_, i) => {
        const l = layoutDocumentPicture(doc, i)!;
        for (const e of pictureEdges(l)) {
          if (e.lock) continue;
          tried++;
          const r = planDelete(text, i, { kind: "edge", id: e.id });
          if (!r.ok) {
            expect(r.reason, name).toBeTruthy();
            continue;
          }
          done++;
          expect(applyChanges(text, r.changes), name).toBe(r.text);
          expect(r.layout.nodes.length, name).toBe(l.nodes.length);
          expect(pictureEdges(r.layout).length, name).toBe(pictureEdges(l).length - 1);
        }
      });
    }
    expect(tried).toBeGreaterThan(200);
    expect(done / tried).toBeGreaterThan(0.8);
  }, 120000);
});
