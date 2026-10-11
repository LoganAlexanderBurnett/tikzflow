// M4 step 5 (D84): import from Mermaid and Graphviz DOT. The readers, the TikZ
// they are written as, and what the auto-layout makes of it.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planAutoLayout } from "../src/edit/autolayout.ts";
import { detectFormat, importDiagram } from "../src/import/index.ts";
import { parseDot } from "../src/import/dot.ts";
import { parseColor } from "../src/import/graph.ts";
import { parseMermaid } from "../src/import/mermaid.ts";
import { arrowOption, graphToTikz, texText, writingOrder } from "../src/import/tikz.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import { shapeBounds } from "../src/tikz/shapes.ts";

const fixtures = join(import.meta.dirname, "fixtures", "import");
const fixture = (name: string) => readFileSync(join(fixtures, name), "utf8");

const edgeSummary = (g: ReturnType<typeof parseMermaid>) => g.edges.map((e) => `${e.from}>${e.to}${e.label ? `:${e.label}` : ""}`);

describe("detectFormat", () => {
  it("tells Mermaid from DOT by the first statement", () => {
    expect(detectFormat("graph TD\nA-->B")).toBe("mermaid");
    expect(detectFormat("flowchart LR\nA-->B")).toBe("mermaid");
    expect(detectFormat("%% a comment\n\nflowchart TD;\nA-->B")).toBe("mermaid");
    expect(detectFormat("---\ntitle: x\n---\ngraph TD\nA-->B")).toBe("mermaid");
    expect(detectFormat("digraph G { a -> b }")).toBe("dot");
    expect(detectFormat("// c\nstrict graph {\n a -- b }")).toBe("dot");
    expect(detectFormat("digraph\n{\n a -> b }")).toBe("dot");
    expect(detectFormat("\\begin{tikzpicture}\\end{tikzpicture}")).toBeNull();
    expect(detectFormat("")).toBeNull();
  });
});

describe("the Mermaid reader", () => {
  it("reads chains, & lists and the direction", () => {
    const g = parseMermaid("graph LR\nA --> B --> C\nA & B --> D & E");
    expect(g.direction).toBe("right");
    expect(g.nodes.map((n) => n.id)).toEqual(["A", "B", "C", "D", "E"]);
    expect(edgeSummary(g)).toEqual(["A>B", "B>C", "A>D", "A>E", "B>D", "B>E"]);
    expect(parseMermaid("flowchart TB\nA-->B").direction).toBe("down");
    expect(parseMermaid("flowchart\nA-->B").direction).toBe("down");
  });

  it("notes the two directions it can't draw", () => {
    expect(parseMermaid("flowchart BT\nA-->B").notes.join(" ")).toMatch(/bottom to top/);
    expect(parseMermaid("flowchart RL\nA-->B").notes.join(" ")).toMatch(/right to left/);
  });

  it("reads every node shape", () => {
    const shapes = (s: string) => parseMermaid(`flowchart TD\n${s}`).nodes.map((n) => [n.shape, n.label]);
    expect(shapes("a[x]")).toEqual([["process", "x"]]);
    expect(shapes("a(x)")).toEqual([["rounded", "x"]]);
    expect(shapes("a([x])")).toEqual([["terminal", "x"]]);
    expect(shapes("a[[x]]")).toEqual([["subroutine", "x"]]);
    expect(shapes("a[(x)]")).toEqual([["database", "x"]]);
    expect(shapes("a((x))")).toEqual([["circle", "x"]]);
    expect(shapes("a(((x)))")).toEqual([["doublecircle", "x"]]);
    expect(shapes("a{x}")).toEqual([["decision", "x"]]);
    expect(shapes("a{{x}}")).toEqual([["hexagon", "x"]]);
    expect(shapes("a[/x/]")).toEqual([["io", "x"]]);
    expect(shapes("a[\\x\\]")).toEqual([["io alt", "x"]]);
    expect(shapes("a[/x\\]")).toEqual([["trapez", "x"]]);
    expect(shapes("a[\\x/]")).toEqual([["trapez alt", "x"]]);
    expect(shapes("a>x]")).toEqual([["flag", "x"]]);
    expect(shapes("a")).toEqual([["process", "a"]]);
    expect(shapes('a@{ shape: cyl, label: "Store" }')).toEqual([["database", "Store"]]);
  });

  it("reads quoted text with brackets, line breaks, entities and HTML", () => {
    const g = parseMermaid('flowchart TD\na["one [two] (three)"] --> b[first<br/>second]\nc["#quot;q#quot; &amp; #35;1"]\nd[<b>bold</b> text]');
    expect(g.nodes.map((n) => n.label)).toEqual(["one [two] (three)", "first\nsecond", '"q" & #1', "bold text"]);
    expect(g.notes.join(" ")).toMatch(/HTML/);
  });

  it("reads link kinds, labels and tips", () => {
    const g = parseMermaid(
      [
        "flowchart TD",
        "a --> b",
        "a --- c",
        "a -.-> d",
        "a ==> e",
        "a --o f",
        "a --x g",
        "a <--> h",
        "a o--o i",
        "a -->|piped| j",
        "a -- spoken --> k",
        "a == loud ==> l",
        "a -. faint .-> m",
        "a ~~~ n",
        "a ---> o",
      ].join("\n"),
    );
    const edge = (to: string) => g.edges.find((e) => e.to === to)!;
    expect([edge("b").line, edge("b").head, edge("b").tail]).toEqual(["solid", "arrow", "none"]);
    expect([edge("c").line, edge("c").head]).toEqual(["solid", "none"]);
    expect([edge("d").line, edge("d").head]).toEqual(["dotted", "arrow"]);
    expect([edge("e").line, edge("e").head]).toEqual(["thick", "arrow"]);
    expect(edge("f").head).toBe("open circle");
    expect(edge("g").head).toBe("cross");
    expect([edge("h").head, edge("h").tail]).toEqual(["arrow", "arrow"]);
    expect([edge("i").head, edge("i").tail]).toEqual(["open circle", "open circle"]);
    expect(edge("j").label).toBe("piped");
    expect(edge("k").label).toBe("spoken");
    expect([edge("l").label, edge("l").line]).toEqual(["loud", "thick"]);
    expect([edge("m").label, edge("m").line]).toEqual(["faint", "dotted"]);
    expect(edge("n").line).toBe("invisible");
    expect(edge("o").head).toBe("arrow");
  });

  it("reads subgraphs, nested, with titles, and edges to them", () => {
    const g = parseMermaid("flowchart TD\nsubgraph one [First part]\n a --> b\n subgraph inner\n  c\n end\nend\nsubgraph \"Two words\"\n d\nend\nb --> one\nd --> a");
    expect(g.groups.map((x) => [x.id, x.title, x.parent])).toEqual([
      ["one", "First part", undefined],
      ["inner", "inner", 0],
      ["Two words", "Two words", undefined],
    ]);
    expect(g.nodes.map((n) => [n.id, n.group])).toEqual([
      ["a", 0],
      ["b", 0],
      ["c", 1],
      ["d", 2],
    ]);
    // "one" is a group, not a node.
    expect(g.nodes.some((n) => n.id === "one")).toBe(false);
    expect(g.edges.map((e) => `${e.from}>${e.to}`)).toContain("b>one");
  });

  it("reads style, classDef, class, :::class and linkStyle", () => {
    const g = parseMermaid(
      [
        "flowchart TD",
        "a:::hot --> b --> c",
        "classDef hot fill:#f96,stroke:#333,stroke-width:4px,color:#fff;",
        "class c hot",
        "style b fill:#e8f0ff,stroke-dasharray: 5 5",
        "linkStyle 0 stroke:#f00,stroke-width:2px",
        "linkStyle default stroke:#999",
      ].join("\n"),
    );
    const hot = g.classes.find((c) => c.name === "hot")!;
    expect(hot.look).toEqual({ fill: [255, 153, 102], stroke: [51, 51, 51], text: [255, 255, 255], width: 3 });
    expect(g.nodes.find((n) => n.id === "a")!.classes).toEqual(["hot"]);
    expect(g.nodes.find((n) => n.id === "c")!.classes).toEqual(["hot"]);
    expect(g.nodes.find((n) => n.id === "b")!.look).toEqual({ fill: [232, 240, 255], dashed: true });
    expect(g.edges[0]!.look.stroke).toEqual([255, 0, 0]);
    expect(g.edges[1]!.look.stroke).toEqual([153, 153, 153]);
  });

  it("refuses other diagram types by name", () => {
    expect(() => parseMermaid("sequenceDiagram\nA->>B: hi")).toThrow(/sequence diagram/);
    expect(() => parseMermaid("classDiagram\nclass A")).toThrow(/class diagram/);
    expect(() => parseMermaid("gantt\ntitle x")).toThrow(/Gantt/);
    expect(() => parseMermaid("A-->B")).toThrow(/doesn't start like a Mermaid flowchart/);
    expect(() => parseMermaid("")).toThrow(/empty/);
  });

  it("leaves out what it can't read, and says so, without keeping half a statement", () => {
    const g = parseMermaid("graph TD\nclick A callback\nA-->B\nweird stuff here ???\nC-->");
    expect(g.nodes.map((n) => n.id)).toEqual(["A", "B"]);
    expect(g.notes.join(" ")).toMatch(/3 statements weren't understood/);
  });

  it("takes ; and line breaks as statement ends, and skips comments and front matter", () => {
    const g = parseMermaid("---\ntitle: T\n---\n%% hi\ngraph TD; A-->B;B-->C\n%% done");
    expect(edgeSummary(g)).toEqual(["A>B", "B>C"]);
  });
});

describe("the DOT reader", () => {
  it("reads digraphs and graphs, and checks the edge operator", () => {
    expect(parseDot("digraph G { a -> b -> c; }").edges.map((e) => [e.from, e.to, e.head])).toEqual([["a", "b", "arrow"], ["b", "c", "arrow"]]);
    expect(parseDot("graph { a -- b }").edges.map((e) => e.head)).toEqual(["none"]);
    expect(() => parseDot("digraph { a -- b }")).toThrow(/digraph/);
    expect(() => parseDot("graph { a -> b }")).toThrow(/undirected/);
    expect(() => parseDot("a -> b")).toThrow(/digraph or graph/);
    expect(() => parseDot("digraph { a -> b")).toThrow(/isn't closed/);
  });

  it("reports the line of a mistake", () => {
    try {
      parseDot("digraph {\n  a -> b;\n  c -> ;\n}");
      expect.unreachable();
    } catch (e) {
      expect((e as { line?: number }).line).toBe(3);
    }
  });

  it("reads node defaults with their scope, and attributes", () => {
    const g = parseDot(
      'digraph { node [shape=box]; a; b [shape=diamond, label="Is it?"]; subgraph { node [shape=circle]; c } d; a [label="two\\nlines"]; e [shape=doublecircle]; f [shape=cylinder]; g [shape=point]; h [style=invis] }',
    );
    const shape = (id: string) => g.nodes.find((n) => n.id === id)!.shape;
    expect(shape("a")).toBe("process");
    expect(shape("b")).toBe("decision");
    expect(g.nodes.find((n) => n.id === "b")!.label).toBe("Is it?");
    expect(shape("c")).toBe("circle");
    expect(shape("d")).toBe("process");
    expect(g.nodes.find((n) => n.id === "a")!.label).toBe("two\nlines");
    expect(shape("e")).toBe("doublecircle");
    expect(shape("f")).toBe("database");
    expect(shape("g")).toBe("dot");
    expect(shape("h")).toBe("plain");
    expect(g.nodes.find((n) => n.id === "h")!.label).toBe("");
    // Graphviz's own default is the ellipse.
    expect(parseDot("digraph { x }").nodes[0]!.shape).toBe("oval");
  });

  it("expands subgraphs on either side of an edge", () => {
    const g = parseDot("digraph { a -> {b c}; {x y} -> z }");
    expect(g.edges.map((e) => `${e.from}>${e.to}`)).toEqual(["a>b", "a>c", "x>z", "y>z"]);
  });

  it("makes clusters groups, nested, with their labels", () => {
    const g = parseDot('digraph { subgraph cluster_a { label="A"; x; subgraph cluster_b { label="B"; y } } z; subgraph notacluster { w } }');
    expect(g.groups.map((x) => [x.id, x.title, x.parent])).toEqual([
      ["cluster_a", "A", undefined],
      ["cluster_b", "B", 0],
    ]);
    expect(g.nodes.map((n) => [n.id, n.group])).toEqual([
      ["x", 0],
      ["y", 1],
      ["z", undefined],
      ["w", undefined],
    ]);
  });

  it("reads colours, styles and arrow directions", () => {
    const g = parseDot(
      'digraph { a [style=filled, fillcolor=lightblue, color="#336699", fontcolor=white, penwidth=2]; a -> b [color=red, style=dashed, dir=both, arrowtail=odot, arrowhead=vee, label="go"]; b -> c [dir=none]; c -> d [dir=back, arrowtail=diamond]; d -> e [arrowhead=none] }',
    );
    expect(g.nodes[0]!.look).toEqual({ fill: [173, 216, 230], stroke: [51, 102, 153], text: [255, 255, 255], width: 1.6 });
    const [ab, bc, cd, de] = g.edges as [(typeof g.edges)[number], (typeof g.edges)[number], (typeof g.edges)[number], (typeof g.edges)[number]];
    expect([ab.line, ab.tail, ab.head, ab.label, ab.look.stroke]).toEqual(["dashed", "open circle", "arrow", "go", [255, 0, 0]]);
    expect([bc.head, bc.tail]).toEqual(["none", "none"]);
    expect([cd.head, cd.tail]).toEqual(["none", "diamond"]);
    expect(de.head).toBe("none");
  });

  it("reduces HTML labels and record labels to text, and drops ports, saying so", () => {
    const g = parseDot('digraph { a [label=<<b>bold</b><br/>html>]; b [shape=record, label="{x|y}"]; a:p -> b:q }');
    expect(g.nodes.map((n) => n.label)).toEqual(["bold\nhtml", "x\ny"]);
    expect(g.notes.join(" ")).toMatch(/HTML-like/);
    expect(g.notes.join(" ")).toMatch(/Ports/);
    expect(g.notes.join(" ")).toMatch(/Record/);
  });

  it("keeps only the first of repeated edges in a strict graph, and reads rankdir", () => {
    expect(parseDot("strict digraph { a -> b; a -> b }").edges).toHaveLength(1);
    expect(parseDot("digraph { a -> b; a -> b }").edges).toHaveLength(2);
    expect(parseDot("digraph { rankdir=LR; a -> b }").direction).toBe("right");
    expect(parseDot("digraph { graph [rankdir=LR]; a -> b }").direction).toBe("right");
    expect(parseDot("digraph { rankdir=BT; a -> b }").notes.join(" ")).toMatch(/bottom to top/);
  });

  it("reads comments, joined strings and quoted names", () => {
    const g = parseDot('digraph { /* c */ "my node" -> b // x\n; # preprocessor line\n}'.replace("# preprocessor line", "").replace("; \n", ";\n"));
    expect(g.nodes.map((n) => n.id)).toEqual(["my node", "b"]);
    expect(parseDot('digraph { a [label="x" + "y"] }').nodes[0]!.label).toBe("xy");
  });

  it("names a shape it doesn't know and draws a rectangle", () => {
    const g = parseDot("digraph { a [shape=weirdo] }");
    expect(g.nodes[0]!.shape).toBe("process");
    expect(g.notes.join(" ")).toMatch(/weirdo/);
  });
});

describe("colours", () => {
  it("reads CSS and Graphviz forms", () => {
    expect(parseColor("#f9f")).toEqual([255, 153, 255]);
    expect(parseColor("#FF99FF")).toEqual([255, 153, 255]);
    expect(parseColor("#ff99ffcc")).toEqual([255, 153, 255]);
    expect(parseColor("lightblue")).toEqual([173, 216, 230]);
    expect(parseColor("gray30")).toEqual([77, 77, 77]);
    expect(parseColor("rgb(10, 20, 30)")).toEqual([10, 20, 30]);
    expect(parseColor("none")).toBeNull();
    expect(parseColor("nonsense")).toBeNull();
  });
});

describe("the TikZ written", () => {
  it("writes the arrow option for every pair of tips", () => {
    expect(arrowOption("none", "none")).toBeNull();
    expect(arrowOption("none", "arrow")).toBe("-> ".trim());
    expect(arrowOption("arrow", "none")).toBe("<-");
    expect(arrowOption("arrow", "arrow")).toBe("<->");
    expect(arrowOption("none", "open circle")).toBe("-{Circle[length=2mm, open]}");
    expect(arrowOption("arrow", "circle")).toBe("{<}-{Circle[length=2mm]}");
    expect(arrowOption("cross", "none")).toBe("{Rays[n=4]}-");
  });

  it("escapes TeX's special characters and breaks lines", () => {
    expect(texText("50% of a_b & c #1 {x} ~ ^ \\")).toBe("50\\% of a\\_b \\& c \\#1 \\{x\\} \\textasciitilde{} \\^{} \\textbackslash{}");
    expect(texText("a < b | c > d")).toBe("a \\textless{} b \\textbar{} c \\textgreater{} d");
    expect(texText("one\ntwo")).toBe("one\\\\ two");
  });

  it("writes each node after one it follows, breadth first", () => {
    const g = parseMermaid("flowchart TD\nz --> a\nz --> b\nb --> c\nq --> r");
    expect(writingOrder(g)).toEqual(["z", "a", "b", "c", "q", "r"]);
    // A cycle and a node with no edges are still written.
    const cyc = parseMermaid("flowchart TD\na --> b --> a\nlone");
    expect(writingOrder(cyc)).toEqual(["a", "b", "lone"]);
  });

  it("names nodes from their words, keeping ids that are words", () => {
    const g = parseMermaid("flowchart TD\nA[Start here] --> validate[Check input]\nvalidate --> B[Start here]\n1[One] --> C");
    const t = graphToTikz(g);
    expect([...t.names.values()]).toEqual(expect.arrayContaining(["startHere", "validate", "startHere2", "one", "c"]));
    expect(new Set(t.names.values()).size).toBe(t.names.size);
  });

  it("defines a style per shape used, once, and the document is well formed", () => {
    const t = graphToTikz(parseMermaid("flowchart TD\na[x] --> b{y}\nb --> c{z}\nc --> d([w])"));
    expect(t.text.match(/^  decision\/\.style/gm)).toHaveLength(1);
    expect(t.text).toMatch(/\\usetikzlibrary\{positioning, shapes\.geometric, arrows\.meta\}/);
    expect(t.text).not.toMatch(/\bfit\b/);
    const doc = analyzeDocument(t.text);
    expect(doc.errors).toEqual([]);
    expect(doc.syntax.pictures).toHaveLength(1);
  });

  it("makes classes styles, with names that aren't TikZ keys", () => {
    const t = graphToTikz(parseMermaid("flowchart TD\nclassDef red fill:#f00\nclassDef hot fill:#f96\na:::red --> b:::hot"));
    expect(t.text).toMatch(/red class\/\.style = \{fill=\{rgb,255:red,255;green,0;blue,0\}\}/);
    expect(t.text).toMatch(/^  hot\/\.style = /m);
    expect(t.text).toMatch(/\\node\[process, red class\]/);
  });

  it("makes a look shared by several edges a style", () => {
    const t = graphToTikz(parseDot("digraph { edge [color=gray30]; a -> b -> c; c -> d [color=red] }"));
    expect(t.text).toMatch(/link\/\.style = \{draw=\{rgb,255:red,77;green,77;blue,77\}\}/);
    expect(t.text.match(/\\draw\[->, link\]/g)).toHaveLength(2);
    expect(t.text).toMatch(/\\draw\[->, draw=\{rgb,255:red,255;green,0;blue,0\}\] \(c\) -- \(d\)/);
  });

  it("writes groups as fit nodes on the background layer, inner ones first", () => {
    const t = graphToTikz(parseMermaid("flowchart TD\nsubgraph outer [Outer]\n a --> b\n subgraph inner [Inner]\n  c\n end\nend\nb --> c\nouter --> d"));
    const scope = t.text.slice(t.text.indexOf("\\begin{scope}[on background layer]"));
    expect(scope).toMatch(/\\node\[group, fit=\(c\), label=\{\[group title\]north:Inner\}\] \(inner\) \{\};\n\s+\\node\[group, inner sep=6mm, fit=\(a\) \(b\) \(inner\), label=\{\[group title\]north:Outer\}\] \(outer\) \{\};/);
    // An edge to a group comes after the group's node.
    expect(t.text.indexOf("(outer) --")).toBeGreaterThan(t.text.indexOf("\\end{scope}"));
    expect(t.text).toMatch(/\\usetikzlibrary\{positioning, fit, backgrounds/);
    expect(analyzeDocument(t.text).errors).toEqual([]);
  });

  it("bends edges between the same two nodes apart, and loops a self edge", () => {
    const t = graphToTikz(parseMermaid("flowchart TD\na --> b\nb --> a\na --> a"));
    expect(t.text).toMatch(/\(a\) to\[bend left=15\] \(b\)/);
    expect(t.text).toMatch(/\(b\) to\[bend left=15\] \(a\)/);
    expect(t.text).toMatch(/\(a\) to\[loop above\] \(a\)/);
  });

  it("leaves out invisible links and edges to empty groups, saying so", () => {
    const t = graphToTikz(parseMermaid("flowchart TD\na ~~~ b\nsubgraph s\nend\na --> s"));
    expect(t.edges).toBe(0);
    expect(t.notes.join(" ")).toMatch(/invisible link/);
    expect(t.notes.join(" ")).toMatch(/empty group/);
  });
});

describe("importDiagram", () => {
  it("refuses what is neither format, and says where DOT went wrong", async () => {
    const none = await importDiagram("hello there");
    expect(none.ok).toBe(false);
    const bad = await importDiagram("digraph {\n a -> b;\n c -> ;\n}");
    expect(bad).toMatchObject({ ok: false, line: 3 });
    expect((bad as { reason: string }).reason).toMatch(/^Line 3:/);
    expect(await importDiagram("graph TD\n")).toMatchObject({ ok: false, reason: "The diagram has no nodes." });
    expect(await importDiagram("sequenceDiagram\nA->>B: hi")).toMatchObject({ ok: false });
  });

  it("takes a direction over the source's", async () => {
    const r = await importDiagram("flowchart LR\na --> b --> c", { direction: "down" });
    expect(r.ok && r.direction).toBe("down");
    expect(r.ok && r.text).toMatch(/below=of/);
    const s = await importDiagram("flowchart TD\na --> b --> c", { direction: "right" });
    expect(s.ok && s.text).toMatch(/right=of/);
  });

  it("imports a single node", async () => {
    const r = await importDiagram("flowchart TD\nonly[Just me]");
    expect(r.ok && r.nodes).toBe(1);
  });

  const files = readdirSync(fixtures).filter((f) => /\.(mmd|dot|gv)$/.test(f));
  for (const name of files) {
    it(`${name}: valid TikZ, every node editable and placed by relations, no overlaps, layout stable`, async () => {
      const r = await importDiagram(fixture(name));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.laidOut).toBe(true);
      const doc = analyzeDocument(r.text);
      expect(doc.errors).toEqual([]);
      const layout = layoutDocumentPicture(doc, 0)!;
      const nodes = layout.nodes.filter((n) => n.kind === "statement" && n.position.kind !== "fit");
      expect(nodes).toHaveLength(r.nodes);
      // Nothing locked, and only the first node has a place of its own.
      expect(nodes.filter((n) => n.locked).map((n) => n.name)).toEqual([]);
      expect(r.text.match(/\) at \(/g) ?? []).toHaveLength(0);
      // No two nodes overlap.
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = shapeBounds(nodes[i]!.shape);
          const b = shapeBounds(nodes[j]!.shape);
          const overlap = a.minX < b.maxX - 0.5 && b.minX < a.maxX - 0.5 && a.minY < b.maxY - 0.5 && b.minY < a.maxY - 0.5;
          expect(overlap, `${nodes[i]!.name} and ${nodes[j]!.name} overlap`).toBe(false);
        }
      }
      // Laying out again changes nothing.
      const again = await planAutoLayout(r.text, 0, { direction: r.direction, groups: true });
      expect(again.ok && again.changes).toEqual([]);
    });
  }

  it("keeps the source's own text in the code", async () => {
    const r = await importDiagram(fixture("order-flow.mmd"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const word of ["Start", "In stock?", "Pick items", "Back-order list", "Pack and label", "Hand to courier", "Tell the customer", "Delivered", "Yes", "No"]) {
      expect(r.text).toContain(`{${word}}`);
    }
  });
});

describe("groups stay together", () => {
  const boxesOf = (text: string) => {
    const layout = layoutDocumentPicture(analyzeDocument(text), 0)!;
    return layout.nodes.filter((n) => n.position.kind === "fit").map((n) => ({ name: n.name, ...shapeBounds(n.shape) }));
  };
  const overlap = (a: ReturnType<typeof boxesOf>[number], b: ReturnType<typeof boxesOf>[number]) => a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;

  it("keeps the boxes of interleaved groups apart", async () => {
    const r = await importDiagram(fixture("interleaved-teams.mmd"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const boxes = boxesOf(r.text);
    expect(boxes).toHaveLength(2);
    expect(overlap(boxes[0]!, boxes[1]!)).toBe(false);
  });

  it("is what the option does: the same picture laid out without it has overlapping boxes", async () => {
    const t = graphToTikz(parseMermaid(fixture("interleaved-teams.mmd"))).text;
    const plain = await planAutoLayout(t, 0, { direction: "down" });
    expect(plain.ok).toBe(true);
    if (!plain.ok) return;
    const boxes = boxesOf(plain.text);
    expect(overlap(boxes[0]!, boxes[1]!)).toBe(true);
  });

  it("keeps nested groups inside their parents, and a group's nodes out of other groups' boxes", async () => {
    const r = await importDiagram("flowchart TD\nsubgraph outer [Outer]\n a --> b\n subgraph inner [Inner]\n  c --> d\n end\n b --> c\nend\nz --> a\nz --> c\nd --> y");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const boxes = boxesOf(r.text);
    const inner = boxes.find((b) => b.name === "inner")!;
    const outer = boxes.find((b) => b.name === "outer")!;
    expect(inner.minX).toBeGreaterThanOrEqual(outer.minX);
    expect(inner.maxX).toBeLessThanOrEqual(outer.maxX);
    expect(inner.minY).toBeGreaterThanOrEqual(outer.minY);
    expect(inner.maxY).toBeLessThanOrEqual(outer.maxY);
    const layout = layoutDocumentPicture(analyzeDocument(r.text), 0)!;
    for (const n of layout.nodes.filter((x) => ["z", "y"].includes(x.name ?? ""))) {
      const b = shapeBounds(n.shape);
      expect(overlap({ name: "n", ...b }, outer), `${n.name} is outside the outer box`).toBe(false);
    }
  });
});
