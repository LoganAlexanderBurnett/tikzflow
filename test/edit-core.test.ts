// The shared editing core of Milestone 2a: option and style edits, library
// management, statement insertion, and node names.
import { afterAll, describe, expect, it } from "vitest";
import { applyChanges, type Change } from "../src/edit/changes.ts";
import { insertStatements, nodeAnchor, pathAnchor } from "../src/edit/insert.ts";
import { ensureLibraries, withLibraries } from "../src/edit/libraries.ts";
import { baseName, labelWords, nameStyle, newNodeName, takenNames } from "../src/edit/names.ts";
import { formatOption, nodeTarget, setOption } from "../src/edit/optionEdits.ts";
import { addStyles, definedStyleNames, nodeStyles, setStyleOption, styleSites } from "../src/edit/styles.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import type { OptionItem } from "../src/model/syntax.ts";
import type { LaidOutNode, PictureLayout } from "../src/tikz/layout.ts";
import { corpusNames, loadCorpusFile } from "./corpus.ts";

const key = (k: string) => (i: OptionItem) => i.key === k;

function layout(text: string, index = 0): PictureLayout {
  const l = layoutDocumentPicture(analyzeDocument(text), index);
  if (!l) throw new Error("no picture");
  return l;
}

function node(l: PictureLayout, id: string): LaidOutNode {
  const n = l.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`no node ${id}`);
  return n;
}

/** Applies a node option edit to the first node of picture 0. */
function editNode(text: string, id: string, k: string, item: string | null): string {
  const n = node(layout(text), id);
  const changes = setOption(text, nodeTarget(n.syntax), key(k), item);
  if (!changes) throw new Error("refused");
  return applyChanges(text, changes);
}

function styleEdit(text: string, name: string, k: string, item: string | null): string {
  const doc = analyzeDocument(text);
  const changes = setStyleOption(doc, doc.syntax.pictures[0]!, name, key(k), item);
  if (!changes) throw new Error("refused");
  return applyChanges(text, changes);
}

function addStyle(text: string, name: string, body: string, index = 0): string {
  const doc = analyzeDocument(text);
  return applyChanges(text, [addStyles(doc, doc.syntax.pictures[index]!, [{ name, body }])]);
}

describe("formatOption", () => {
  it("writes flags and simple values plainly", () => {
    expect(formatOption("draw")).toBe("draw");
    expect(formatOption("fill", "blue!20")).toBe("fill=blue!20");
    expect(formatOption("font", "\\bfseries\\small")).toBe("font=\\bfseries\\small");
  });
  it("braces values that would split the item", () => {
    expect(formatOption("label", "above:x")).toBe("label=above:x");
    expect(formatOption("label", "[red]above:x")).toBe("label={[red]above:x}");
    expect(formatOption("text width", "a,b")).toBe("text width={a,b}");
    expect(formatOption("fill", "{rgb,255:red,1;green,2;blue,3}")).toBe("fill={rgb,255:red,1;green,2;blue,3}");
  });
});

describe("setOption on a node", () => {
  const src = "\\begin{tikzpicture}\n\\node[draw, fill=red] (a) {A};\n\\node (b) {B};\n\\end{tikzpicture}\n";
  it("replaces the value of an existing key in place", () => {
    expect(editNode(src, "a", "fill", "fill=blue!20")).toBe(src.replace("fill=red", "fill=blue!20"));
  });
  it("replaces the last occurrence, which is the one in effect", () => {
    const t = src.replace("[draw, fill=red]", "[fill=red, draw, fill=green]");
    expect(editNode(t, "a", "fill", "fill=blue")).toBe(t.replace("fill=green", "fill=blue"));
  });
  it("appends to the list in its separator style", () => {
    const t = src.replace("[draw, fill=red]", "[draw,fill=red]");
    expect(editNode(t, "a", "text", "text=white")).toBe(t.replace("fill=red]", "fill=red,text=white]"));
  });
  it("adds a list to a node without one", () => {
    expect(editNode(src, "b", "fill", "fill=red")).toBe(src.replace("\\node (b)", "\\node[fill=red] (b)"));
  });
  it("removes a key, and the list when it was the only item", () => {
    expect(editNode(src, "a", "fill", null)).toBe(src.replace("[draw, fill=red]", "[draw]"));
    const t = src.replace("[draw, fill=red]", "[fill=red]");
    expect(editNode(t, "a", "fill", null)).toBe(t.replace("\\node[fill=red] (a)", "\\node (a)"));
  });
  it("keeps comments next to the items it changes", () => {
    const t = "\\begin{tikzpicture}\n\\node[draw, % outline\n  fill=red] (a) {A};\n\\end{tikzpicture}\n";
    expect(editNode(t, "a", "fill", "fill=blue")).toBe(t.replace("fill=red", "fill=blue"));
  });
  it("puts a new item on its own line in a one-item-per-line list", () => {
    const t = "\\begin{tikzpicture}\n\\node[\n    draw\n  ] (a) {A};\n\\end{tikzpicture}\n";
    expect(editNode(t, "a", "fill", "fill=red")).toBe(t.replace("    draw\n", "    draw,\n    fill=red\n"));
  });
});

const PREAMBLE = "\\documentclass{article}\n\\usepackage{tikz}\n\\usetikzlibrary{positioning}\n";

describe("styles", () => {
  const doc = `${PREAMBLE}\\tikzset{
  box/.style={draw, fill=red!20},
  box/.append style={fill=blue!20},
  arg/.style={fill=#1},
  every node/.style={font=\\small},
}
\\begin{document}
\\begin{tikzpicture}[small/.style={inner sep=1pt}]
\\tikzstyle{old}=[draw]
\\node[box] (a) {A};
\\node[old, small] (b) {B};
\\end{tikzpicture}
\\end{document}
`;

  it("finds every site in reading order", () => {
    const d = analyzeDocument(doc);
    const sites = styleSites(d, d.syntax.pictures[0]!);
    expect(sites.map((s) => `${s.where}:${s.form}`)).toEqual(["preamble:tikzset", "picture:options", "body:tikzstyle"]);
    expect([...definedStyleNames(sites)]).toEqual(["box", "arg", "small", "old"]);
    const l = layout(doc);
    expect(nodeStyles(node(l, "b").syntax, definedStyleNames(sites))).toEqual(["old", "small"]);
  });

  it("edits the key where it takes effect: the append after the base", () => {
    const out = styleEdit(doc, "box", "fill", "fill=green!20");
    expect(out).toBe(doc.replace("box/.append style={fill=blue!20}", "box/.append style={fill=green!20}"));
    expect(node(layout(out), "a").fill).toEqual(node(layout(doc.replace("blue!20}", "green!20}")), "a").fill);
  });

  it("adds a missing key to the last definition in the chain", () => {
    expect(styleEdit(doc, "box", "text", "text=white")).toBe(doc.replace("{fill=blue!20}", "{fill=blue!20, text=white}"));
  });

  it("edits \\tikzstyle and picture-option styles", () => {
    expect(styleEdit(doc, "old", "fill", "fill=yellow")).toBe(doc.replace("\\tikzstyle{old}=[draw]", "\\tikzstyle{old}=[draw, fill=yellow]"));
    expect(styleEdit(doc, "small", "inner sep", "inner sep=2pt")).toBe(doc.replace("inner sep=1pt", "inner sep=2pt"));
  });

  it("keeps the braces when a style loses its last key", () => {
    expect(styleEdit(doc, "old", "draw", null)).toBe(doc.replace("[draw]", "[]"));
  });

  it("refuses to touch items that use the style's argument", () => {
    const d = analyzeDocument(doc);
    expect(setStyleOption(d, d.syntax.pictures[0]!, "arg", key("fill"), "fill=red")).toBeNull();
    expect(setStyleOption(d, d.syntax.pictures[0]!, "nonexistent", key("fill"), "fill=red")).toBeNull();
  });
});

describe("addStyles", () => {
  it("adds to the \\tikzset that holds the most styles, in its layout", () => {
    const t = `${PREAMBLE}\\tikzset{\n  a/.style={draw},\n  b/.style={fill=red}\n}\n\\begin{document}\n\\begin{tikzpicture}\n\\node[c] {C};\n\\end{tikzpicture}\n\\end{document}\n`;
    const out = addStyle(t, "c", "draw, circle");
    expect(out).toBe(t.replace("b/.style={fill=red}\n", "b/.style={fill=red},\n  c/.style={draw, circle}\n"));
    expect(layout(out).nodes[0]!.shape.kind).toBe("circle");
  });

  it("adds to the picture options when that's where styles are kept", () => {
    const t = `${PREAMBLE}\\begin{document}\n\\begin{tikzpicture}[a/.style={draw}, b/.style={draw}]\n\\node {C};\n\\end{tikzpicture}\n\\end{document}\n`;
    expect(addStyle(t, "c", "fill=red")).toBe(t.replace("b/.style={draw}]", "b/.style={draw}, c/.style={fill=red}]"));
  });

  it("follows the \\tikzstyle form a file uses", () => {
    const t = "\\begin{tikzpicture}\n  \\tikzstyle{a} = [draw]\n  \\node[c] {C};\n\\end{tikzpicture}\n";
    expect(addStyle(t, "c", "fill=red")).toBe(t.replace("[draw]\n", "[draw]\n  \\tikzstyle{c} = [fill=red]\n"));
  });

  it("starts a \\tikzset after the libraries when a document has no styles", () => {
    const t = `${PREAMBLE}\\begin{document}\n\\begin{tikzpicture}\n\\node[c] {C};\n\\end{tikzpicture}\n\\end{document}\n`;
    const out = addStyle(t, "c", "draw");
    expect(out).toBe(t.replace("{positioning}\n", "{positioning}\n\\tikzset{\n  c/.style={draw}\n}\n"));
    // A second style joins it on its own line.
    expect(addStyle(out, "d", "fill=red")).toBe(out.replace("c/.style={draw}\n", "c/.style={draw},\n  d/.style={fill=red}\n"));
  });

  it("keeps CRLF line endings", () => {
    const t = `${PREAMBLE}\\begin{document}\n\\begin{tikzpicture}\n\\node[c] {C};\n\\end{tikzpicture}\n\\end{document}\n`.replace(/\n/g, "\r\n");
    const out = addStyle(t, "c", "draw");
    expect(out).toBe(t.replace("{positioning}\r\n", "{positioning}\r\n\\tikzset{\r\n  c/.style={draw}\r\n}\r\n"));
  });

  it("puts styles in a bare picture's own options", () => {
    const t = "\\begin{tikzpicture}\n\\node[c] {C};\n\\end{tikzpicture}\n";
    expect(addStyle(t, "c", "draw")).toBe(t.replace("\\begin{tikzpicture}", "\\begin{tikzpicture}[c/.style={draw}]"));
    const u = "\\begin{tikzpicture}[scale=2]\n\\node[c] {C};\n\\end{tikzpicture}\n";
    expect(addStyle(u, "c", "draw")).toBe(u.replace("[scale=2]", "[scale=2, c/.style={draw}]"));
  });
});

describe("libraries", () => {
  const body = (b: string) => `${PREAMBLE}\\begin{document}\n\\begin{tikzpicture}\n${b}\n\\end{tikzpicture}\n\\end{document}\n`;

  it("adds several libraries to the existing list in one change", () => {
    const t = body("\\node {A};");
    const d = analyzeDocument(t);
    const r = ensureLibraries(d, d.syntax.pictures[0]!, ["shapes.geometric", "positioning", "fit"]);
    expect(r.ok && applyChanges(t, [r.change!])).toBe(t.replace("{positioning}", "{positioning, shapes.geometric, fit}"));
  });

  it("knows that the shapes meta-library loads shapes.geometric", () => {
    const t = body("\\node {A};").replace("{positioning}", "{shapes}");
    const d = analyzeDocument(t);
    expect(ensureLibraries(d, d.syntax.pictures[0]!, ["shapes.geometric"])).toEqual({ ok: true });
  });

  it("adds a \\usetikzlibrary line when there is none", () => {
    const t = "\\documentclass{article}\n\\usepackage{tikz}\n\\begin{document}\n\\begin{tikzpicture}\n\\node {A};\n\\end{tikzpicture}\n\\end{document}\n";
    const d = analyzeDocument(t);
    const r = ensureLibraries(d, d.syntax.pictures[0]!, ["shapes.geometric"]);
    expect(r.ok && applyChanges(t, [r.change!])).toBe(t.replace("{tikz}\n", "{tikz}\n\\usetikzlibrary{shapes.geometric}\n"));
  });

  it("only notes what a bare picture needs", () => {
    const t = "\\begin{tikzpicture}\n\\node {A};\n\\end{tikzpicture}\n";
    const r = withLibraries(t, 0, [], ["shapes.geometric"]);
    expect(r.changes).toEqual([]);
    expect(r.notes[0]).toMatch(/shapes\.geometric/);
  });

  /** Removes the diamond node "d" and lets withLibraries prune. */
  function removeDiamond(t: string) {
    const l = layout(t);
    const d = node(l, "d");
    const change: Change = { from: d.statement.from, to: d.statement.to, insert: "" };
    return withLibraries(t, 0, [change]);
  }

  it("removes a library when an edit removed its last use", () => {
    const t = body("\\node (a) {A};\n\\node[diamond] (d) {D};").replace("{positioning}", "{positioning, shapes.geometric}");
    const r = removeDiamond(t);
    expect(r.removed).toEqual(["shapes.geometric"]);
    expect(applyChanges(t, r.changes)).toBe(body("\\node (a) {A};\n").replace("{positioning}", "{positioning}"));
  });

  it("removes the whole line when its list empties", () => {
    const t = body("\\node (a) {A};\n\\node[diamond] (d) {D};").replace("\\usetikzlibrary{positioning}\n", "\\usetikzlibrary{positioning}\n\\usetikzlibrary{shapes.geometric}\n");
    expect(applyChanges(t, removeDiamond(t).changes)).toBe(body("\\node (a) {A};\n"));
  });

  it("keeps a library still mentioned anywhere, even in code kept as-is", () => {
    const t = body("\\node (a) {A};\n\\node[diamond] (d) {D};\n\\foreach \\i in {1,2} \\node[diamond] at (\\i,0) {};").replace("{positioning}", "{positioning, shapes.geometric}");
    expect(removeDiamond(t).removed).toEqual([]);
  });

  it("never removes a library it has no usage patterns for", () => {
    const t = body("\\node (a) {A};\n\\node[diamond] (d) {D};").replace("{positioning}", "{positioning, decorations.pathmorphing, shapes.geometric}");
    expect(removeDiamond(t).removed).toEqual(["shapes.geometric"]);
  });

  it("doesn't remove libraries the user's own code never used", () => {
    // Loaded but unused before the edit: not the edit's doing, so it stays.
    const t = body("\\node (a) {A};\n\\node (d) {D};").replace("{positioning}", "{positioning, shapes.geometric}");
    expect(removeDiamond(t).removed).toEqual([]);
  });
});

describe("inserting statements", () => {
  function insert(t: string, statements: { node?: string; edge?: string }, after?: number): string {
    const doc = analyzeDocument(t);
    const pic = doc.syntax.pictures[0]!;
    const na = nodeAnchor(doc, pic, after);
    if (!na) return "refused";
    const changes: Change[] = [];
    if (statements.node && statements.edge) {
      const pa = pathAnchor(doc, pic, na);
      if (pa.pos === na!.pos) changes.push(insertStatements(t, pic, na, [statements.node, statements.edge]));
      else changes.push(insertStatements(t, pic, na, [statements.node]), insertStatements(t, pic, pa, [statements.edge]));
    } else if (statements.node) changes.push(insertStatements(t, pic, na, [statements.node]));
    return applyChanges(t, changes);
  }
  const NEW = "\\node[below=of a] (n) {N};";
  const EDGE = "\\draw[->] (a) -- (n);";

  it("puts nodes after the nodes and edges after the edges, indented alike", () => {
    const t = "\\begin{tikzpicture}\n  \\node (a) {A};\n  \\node[right=of a] (b) {B}; % b\n\n  \\draw[->] (a) -- (b);\n\\end{tikzpicture}\n";
    expect(insert(t, { node: NEW, edge: EDGE })).toBe(
      "\\begin{tikzpicture}\n  \\node (a) {A};\n  \\node[right=of a] (b) {B}; % b\n  \\node[below=of a] (n) {N};\n\n  \\draw[->] (a) -- (b);\n  \\draw[->] (a) -- (n);\n\\end{tikzpicture}\n",
    );
  });

  it("puts the edge right after the node when every path comes earlier", () => {
    const t = "\\begin{tikzpicture}\n\t\\node (a) {A};\n\t\\draw (a) -- ++(1,0);\n\t\\node (b) at (2,0) {B};\n\\end{tikzpicture}\n";
    expect(insert(t, { node: NEW, edge: EDGE })).toBe(t.replace("{B};\n", `{B};\n\t${NEW}\n\t${EDGE}\n`));
  });

  it("stays at the top level, after scopes and layers rather than inside them", () => {
    const t = "\\begin{tikzpicture}\n\\node (a) {A};\n\\begin{scope}[xshift=3cm]\n  \\node (b) {B};\n\\end{scope}\n\\draw (a) -- (b);\n\\end{tikzpicture}\n";
    expect(insert(t, { node: NEW })).toBe(t.replace("\\end{scope}\n", `\\end{scope}\n${NEW}\n`));
  });

  it("goes after the node it must follow", () => {
    const t = "\\begin{tikzpicture}\n\\node (a) {A};\n\\draw (0,0) -- (1,1);\n\\node (z) at (3,0) {Z};\n\\end{tikzpicture}\n";
    expect(insert(t, { node: NEW })).toBe(t.replace("{Z};\n", `{Z};\n${NEW}\n`));
  });

  it("keeps CRLF and handles an empty picture", () => {
    const t = "\\begin{tikzpicture}[x=1cm]\r\n\\end{tikzpicture}\r\n";
    expect(insert(t, { node: "\\node (a) {A};" })).toBe("\\begin{tikzpicture}[x=1cm]\r\n  \\node (a) {A};\r\n\\end{tikzpicture}\r\n");
  });

  it("never inserts right after a statement with a syntax error", () => {
    const t = "\\begin{tikzpicture}\n\\node (a) {A};\n\\draw (a) -- (1,1);\n\\node (y) at (4,-2) {Y\n\\draw (a) -- (y);\n\\end{tikzpicture}\n";
    expect(insert(t, { node: NEW, edge: EDGE })).toBe(t.replace("{A};\n", `{A};\n${NEW}\n`).replace("(1,1);\n", `(1,1);\n${EDGE}\n`));
    const doc = analyzeDocument(t);
    const y = layout(t).nodes.find((n) => n.name === "y")!;
    expect(nodeAnchor(doc, doc.syntax.pictures[0]!, y.statement.to)).toBeNull();
  });

  it("adds to a one-line picture without breaking it", () => {
    const u = "\\begin{tikzpicture}\\node (a) {A}; \\node (b) {B};\\end{tikzpicture}";
    expect(insert(u, { node: NEW })).toBe(u.replace("{B};", `{B}; ${NEW}`));
  });
});

describe("node names", () => {
  it("takes the label's meaningful words", () => {
    expect(labelWords("\\textbf{Check} the input\\\\ $x^2$ % note")).toEqual(["Check", "the", "input"]);
    expect(baseName("Check the input", "camel")).toBe("checkInput");
    expect(baseName("Check the input", "snake")).toBe("check_input");
    expect(baseName("Start", "camel")).toBe("start");
    expect(baseName("Is it valid?", "kebab")).toBe("it-valid");
    expect(baseName("Read PDE coefficients from the file system", "camel")).toBe("readPDECoefficients");
  });
  it("strips accents and markup", () => {
    expect(baseName("\\'Etape fin\\'ee", "camel")).toBe("etapeFinee");
    expect(baseName("Équation", "camel")).toBe("equation");
    expect(baseName("{\\small\\itshape Output}", "camel")).toBe("output");
  });
  it("doesn't start names with a digit", () => {
    expect(baseName("1st step", "camel")).toBe("n1stStep");
  });
  it("falls back to the style or shape for labels without words", () => {
    expect(newNodeName("$x^2 + y$", new Set(), "decision")).toBe("decision1");
    expect(newNodeName("", new Set(["decision1"]), "decision")).toBe("decision2");
    expect(newNodeName("→ ⇒", new Set(), "rounded rectangle")).toBe("roundedRectangle1");
    expect(newNodeName("流程", new Set(), "")).toBe("node1");
  });
  it("is unique", () => {
    expect(newNodeName("Start", new Set(["start"]), "terminal")).toBe("start2");
    expect(newNodeName("Start", new Set(["start", "start2"]), "terminal")).toBe("start3");
    expect(newNodeName("Step 1", new Set(["step_1"]), "process", "snake")).toBe("step_1_2");
  });
  it("follows the document's naming style", () => {
    expect(nameStyle(["bestFit", "assignBee", "a"])).toBe("camel");
    expect(nameStyle(["gene_expression", "pre_process", "bestFit"])).toBe("snake");
    expect(nameStyle(["a", "b"])).toBe("camel");
  });
  it("counts names hidden in code it can't model as taken", () => {
    const t = "\\begin{tikzpicture}\n\\node (a) {A};\n\\foreach \\i in {1,2} \\node (hidden) at (\\i,0) {};\n\\node[name=other] {O};\n\\end{tikzpicture}\n";
    const d = analyzeDocument(t);
    const taken = takenNames(d, d.syntax.pictures[0]!, layout(t));
    expect([...taken]).toEqual(expect.arrayContaining(["a", "hidden", "other"]));
  });
});

// Every corpus picture: define a style, add a node using it below an
// existing node, and connect them. Nothing else may move, the parse must not
// get worse, and the new node must have the style.
const exercised: string[] = [];
afterAll(() => {
  // Guards against the sweep quietly skipping pictures.
  expect(exercised.length).toBeGreaterThanOrEqual(27);
});
describe.each(corpusNames())("create in %s", (name) => {
  const file = loadCorpusFile(name);
  const doc = analyzeDocument(file.text);
  const cases = doc.syntax.pictures.map((_, i) => i).filter((i) => layout(file.text, i).nodes.some((n) => n.kind === "statement" && n.name && !n.locked));
  if (!cases.length) {
    it("has no named node to attach to", () => expect(true).toBe(true));
    return;
  }
  it.each(cases)("picture %i", (index) => {
    const text = file.text;
    const before = layout(text, index);
    const pic = doc.syntax.pictures[index]!;
    // A parent whose name isn't reused later, so a new node after it can refer to it.
    const named = (n: LaidOutNode) => n.kind === "statement" && !!n.name && /^[A-Za-z0-9_-]+$/.test(n.name) && !n.locked;
    const parent = before.nodes.find((n) => named(n) && before.nodes.filter((m) => m.name === n.name).at(-1) === n);
    if (!parent) return;
    const taken = takenNames(doc, pic, before);
    const style = newNodeName("", taken, "tf test", "camel");
    const child = newNodeName("Fresh node", taken, "process");
    const styleChange = addStyles(doc, pic, [{ name: style, body: "draw=red, circle" }]);
    const na = nodeAnchor(doc, pic, parent.statement.to);
    if (!na) {
      // Only refused right after a statement with a syntax error.
      expect(doc.errorCount).toBeGreaterThan(0);
      return;
    }
    const pa = pathAnchor(doc, pic, na!);
    // Plain coordinates, so the test doesn't depend on the positioning library.
    const stmt = `\\node[${style}] (${child}) at (${parent.name} |- 0,-100) {Fresh node};`;
    const edge = `\\draw[->] (${parent.name}) -- (${child});`;
    const changes = [styleChange];
    if (pa.pos === na!.pos) changes.push(insertStatements(text, pic, na!, [stmt, edge]));
    else changes.push(insertStatements(text, pic, na!, [stmt]), insertStatements(text, pic, pa, [edge]));
    exercised.push(`${name}#${index}`);
    for (const c of changes) expect(c.to, "insertions only").toBe(c.from);
    const after = applyChanges(text, changes);
    const doc2 = analyzeDocument(after);
    expect(doc2.errorCount).toBe(doc.errorCount);
    const l = layout(after, index);
    for (const n of before.nodes) {
      const m = l.nodes.find((x) => x.id === n.id);
      expect(m, `node ${n.id} disappeared`).toBeDefined();
      expect(Math.hypot(m!.shape.center.x - n.shape.center.x, m!.shape.center.y - n.shape.center.y), `node ${n.id} moved`).toBeLessThan(1e-6);
    }
    const added = node(l, child);
    expect(added.shape.kind).toBe("circle");
    expect(added.stroke).toEqual([1, 0, 0]);
    expect(Math.abs(added.shape.center.x - parent.shape.center.x)).toBeLessThan(1e-6);
    expect(l.paths.some((p) => p.edges.some(([a, b]) => a === parent.id && b === child))).toBe(true);
  });
});
