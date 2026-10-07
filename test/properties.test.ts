// Milestone 2a step 3: the properties panel's edits. Colours, font and
// alignment on nodes or on a style they share, and new named colours.
import { describe, expect, it } from "vitest";
import { applyChanges, diffRange } from "../src/edit/changes.ts";
import {
  addColorDefinition,
  colorNameProblem,
  documentColors,
  editFont,
  nodeOption,
  type PropEdit,
  propertyChanges,
  rawColor,
  readFont,
  type Scope,
  sharedStyles,
  styleOption,
  styleUsers,
} from "../src/edit/properties.ts";
import { styleSites } from "../src/edit/styles.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import { ColorTable } from "../src/tikz/colors.ts";
import type { LaidOutNode, PictureLayout } from "../src/tikz/layout.ts";
import { SAMPLE } from "../src/ui/sample.ts";
import { loadCorpusFile } from "./corpus.ts";

const hybrid = loadCorpusFile("self-hybrid-surrogate.tex").text;

function layout(text: string): PictureLayout {
  return layoutDocumentPicture(analyzeDocument(text), 0)!;
}

function node(text: string, id: string): LaidOutNode {
  return layout(text).nodes.find((n) => n.id === id)!;
}

function edit(text: string, scope: Scope, e: PropEdit): { text: string; notes: string[] } {
  const doc = analyzeDocument(text);
  const r = propertyChanges(doc, 0, layout(text), scope, e);
  if (!r.ok) throw new Error(r.reason);
  return { text: applyChanges(text, r.changes), notes: r.notes };
}

const nodes = (...ids: string[]): Scope => ({ kind: "nodes", ids });

describe("fonts", () => {
  it("reads size, series, shape and family", () => {
    expect(readFont("\\small\\bfseries")).toEqual({ size: "\\small", bold: true, italic: false });
    expect(readFont("\\sffamily\\itshape")).toEqual({ bold: false, italic: true, family: "sf" });
    expect(readFont("\\fontsize{9}{11}\\selectfont")).toEqual({ size: "custom", bold: false, italic: false });
    expect(readFont(undefined)).toEqual({ bold: false, italic: false });
  });

  it("edits one part and keeps the rest", () => {
    expect(editFont("\\small", { bold: true })).toBe("\\small\\bfseries");
    expect(editFont("\\bfseries\\small", { bold: false })).toBe("\\small");
    expect(editFont("\\small\\bfseries", { size: "\\Large" })).toBe("\\Large\\bfseries");
    expect(editFont("\\bfseries", { size: "\\small" })).toBe("\\small\\bfseries");
    expect(editFont("\\small", { size: "\\normalsize" })).toBe("");
    expect(editFont("\\small\\color{red}", { family: "sf" })).toBe("\\sffamily\\small\\color{red}");
    expect(editFont("\\sffamily\\small", { family: null })).toBe("\\small");
    expect(editFont("\\fontsize{9}{11}\\selectfont", { italic: true })).toBe("\\fontsize{9}{11}\\selectfont\\itshape");
    expect(editFont("\\bf x", {})).toBe("\\bf x");
  });
});

describe("reading options", () => {
  it("follows styles, including styles used by styles", () => {
    const doc = analyzeDocument(hybrid);
    const sites = styleSites(doc, doc.syntax.pictures[0]!);
    const pastcontrol = node(hybrid, "pastcontrol").syntax;
    expect(nodeOption(sites, pastcontrol, "fill")).toEqual({ value: "ControlFill", via: "control" });
    expect(nodeOption(sites, pastcontrol, "font")).toEqual({ value: "\\small", via: "control" });
    expect(nodeOption(sites, pastcontrol, "text width")).toEqual({ value: "33mm" });
    expect(styleOption(sites, "state", "font")).toEqual({ value: "\\small", via: "box" });
    expect(styleOption(sites, "state", "fill")).toEqual({ value: "StateFill" });
  });

  it("knows which nodes use a style", () => {
    const doc = analyzeDocument(hybrid);
    const pic = doc.syntax.pictures[0]!;
    const l = layout(hybrid);
    const sites = styleSites(doc, pic);
    expect(styleUsers(sites, l, "state").map((n) => n.name ?? n.id)).toEqual(
      expect.arrayContaining(["paststate", "temporal", "spatial", "flux", "outstate", "hybrid"]),
    );
    // Through other styles: every state node is also a box node.
    expect(styleUsers(sites, l, "box").length).toBeGreaterThan(styleUsers(sites, l, "state").length);
    const sel = ["temporal", "flux"].map((id) => l.nodes.find((n) => n.id === id)!);
    expect(sharedStyles(doc, pic, sel)).toEqual(["state"]);
    expect(sharedStyles(doc, pic, [...sel, l.nodes.find((n) => n.id === "ctrl")!])).toEqual([]);
  });
});

describe("colour edits", () => {
  it("set a node's fill in place, changing only that value", () => {
    const r = edit(SAMPLE, nodes("read"), { kind: "color", key: "fill", value: "red!20" });
    expect(r.text).toContain("\\node[io, below=of start, fill=red!20]      (read)");
    const d = diffRange(SAMPLE, r.text)!;
    expect(d.from).toBeGreaterThan(SAMPLE.indexOf("(start) {Start};"));
  });

  it("replace a node's own value rather than add another", () => {
    const text = SAMPLE.replace("\\node[process, right=of small] (base)", "\\node[process, fill=red, right=of small] (base)");
    const r = edit(text, nodes("base"), { kind: "color", key: "fill", value: "blue!20" });
    expect(r.text).toContain("\\node[process, fill=blue!20, right=of small] (base)");
  });

  it("apply to every selected node as one edit", () => {
    const r = edit(SAMPLE, nodes("base", "rec"), { kind: "color", key: "draw", value: "blue" });
    expect(r.text).toContain("\\node[process, right=of small, draw=blue] (base)");
    expect(r.text).toContain("\\node[process, below=of small, draw=blue] (rec)");
  });

  it("edit a style instead when asked, and say which nodes keep their own value", () => {
    const text = SAMPLE.replace("\\node[process, right=of small] (base)", "\\node[process, fill=red, right=of small] (base)");
    const r = edit(text, { kind: "style", name: "process" }, { kind: "color", key: "fill", value: "green!10" });
    expect(r.text).toContain("process/.style  = {base, fill=green!10},");
    expect(r.notes).toEqual(["1 of the 2 process nodes set their own fill, so they keep it"]);
    // Only the style changed.
    const d = diffRange(text, r.text)!;
    expect(text.slice(d.from, d.to)).toBe("blue!8");
  });

  it("refuse a style item that uses an argument", () => {
    const text = "\\begin{tikzpicture}[s/.style={fill=#1}]\n\\node[s=red] (a) {A};\n\\end{tikzpicture}\n";
    const doc = analyzeDocument(text);
    const r = propertyChanges(doc, 0, layout(text), { kind: "style", name: "s" }, { kind: "color", key: "fill", value: "blue" });
    expect(r.ok).toBe(false);
  });

  it("raw colours are valid xcolor", () => {
    const value = rawColor([31, 119, 180]);
    expect(value).toBe("{rgb,255:red,31;green,119;blue,180}");
    expect(new ColorTable().parse(value.slice(1, -1))).toEqual([31 / 255, 119 / 255, 180 / 255]);
    const r = edit(SAMPLE, nodes("read"), { kind: "color", key: "fill", value: rawColor([31, 119, 180]) });
    expect(r.text).toContain("fill={rgb,255:red,31;green,119;blue,180}]");
    const n = node(r.text, "read");
    expect(n.fill?.map((v) => Math.round(v * 255))).toEqual([31, 119, 180]);
  });
});

describe("font edits", () => {
  it("write the whole font on the node, since font= replaces the style's", () => {
    const r = edit(hybrid, nodes("pastcontrol"), { kind: "font", change: { bold: true } });
    expect(r.text).toContain("\\node[control, text width=33mm, font=\\small\\bfseries] (pastcontrol)");
    expect(node(r.text, "pastcontrol").text!.lines.length).toBeGreaterThan(0);
  });

  it("drop the node's own font when it's back to what the style gives", () => {
    const once = edit(hybrid, nodes("pastcontrol"), { kind: "font", change: { bold: true } }).text;
    const back = edit(once, nodes("pastcontrol"), { kind: "font", change: { bold: false } }).text;
    expect(back).toBe(hybrid);
  });

  it("write font={} to undo an inherited font", () => {
    const text = "\\begin{tikzpicture}[b/.style={font=\\bfseries}]\n\\node[b] (a) {A};\n\\end{tikzpicture}\n";
    expect(edit(text, nodes("a"), { kind: "font", change: { bold: false } }).text).toContain("\\node[b, font={}] (a) {A};");
  });

  it("edit a style's font from what it inherits", () => {
    const r = edit(hybrid, { kind: "style", name: "state" }, { kind: "font", change: { italic: true } });
    expect(r.text).toContain("state/.style={box, fill=StateFill, draw=StateDraw, text width=28mm, font=\\small\\itshape},");
  });
});

describe("alignment", () => {
  it("sets align", () => {
    const r = edit(SAMPLE, nodes("rec"), { kind: "align", value: "left" });
    // "base" sets align=center; the node's own align=left goes after the style.
    expect(r.text).toContain("\\node[process, below=of small, align=left] (rec)");
  });

  it("justify sets a text width when the node has none", () => {
    const r = edit(SAMPLE, nodes("rec"), { kind: "align", value: "justify" });
    expect(r.text).toMatch(/\\node\[process, below=of small, text width=\d+mm, align=justify\] \(rec\)/);
    expect(r.notes[0]).toMatch(/^Justify needs a text width, so text width=\d+mm was set too$/);
  });

  it("justify on a node with a text width just sets align", () => {
    const r = edit(hybrid, nodes("pastcontrol"), { kind: "align", value: "justify" });
    expect(r.text).toContain("\\node[control, text width=33mm, align=justify] (pastcontrol)");
    expect(r.notes).toEqual([]);
  });

  it("justify on a style without a text width explains why it can't", () => {
    const doc = analyzeDocument(SAMPLE);
    const r = propertyChanges(doc, 0, layout(SAMPLE), { kind: "style", name: "process" }, { kind: "align", value: "justify" });
    expect(r).toEqual({ ok: false, reason: "Justify needs a text width, and the process style doesn't set one. Set a text width first." });
  });
});

describe("named colours", () => {
  it("lists the document's colours first", () => {
    const doc = analyzeDocument(hybrid);
    const colors = documentColors(doc, doc.syntax.pictures[0]!);
    expect(colors.map((c) => c.name)).toEqual(["StateFill", "StateDraw", "ControlFill", "ControlDraw", "RhoFill", "RhoDraw", "KinFill", "KinDraw", "NeutFill", "NeutDraw"]);
    expect(colors[0]!.rgb?.map((v) => Math.round(v * 255))).toEqual([230, 238, 252]);
  });

  it("checks new names", () => {
    const doc = analyzeDocument(hybrid);
    const pic = doc.syntax.pictures[0]!;
    expect(colorNameProblem(doc, pic, "Accent")).toBeNull();
    expect(colorNameProblem(doc, pic, "StateFill")).toBe('"StateFill" is already a colour.');
    expect(colorNameProblem(doc, pic, "red")).toBe('"red" is already a colour.');
    expect(colorNameProblem(doc, pic, "my colour")).toMatch(/letters and digits/);
  });

  it("adds a definition after the others, in their colour model", () => {
    const doc = analyzeDocument(hybrid);
    const c = addColorDefinition(doc, doc.syntax.pictures[0]!, "Accent", [31, 119, 180]);
    const out = applyChanges(hybrid, [c]);
    expect(out).toContain("\\definecolor{NeutDraw}{RGB}{90,90,90}\r\n\\definecolor{Accent}{RGB}{31,119,180}\r\n");
  });

  it("adds a definition to a document without any, or to a bare picture", () => {
    const doc = analyzeDocument(SAMPLE);
    const out = applyChanges(SAMPLE, [addColorDefinition(doc, doc.syntax.pictures[0]!, "Accent", [31, 119, 180])]);
    expect(out).toContain("\\usetikzlibrary{positioning, shapes.geometric, arrows.meta}\n\\definecolor{Accent}{HTML}{1F77B4}\n");
    const bare = "\\begin{tikzpicture}\n  \\node (a) {A};\n\\end{tikzpicture}\n";
    const bdoc = analyzeDocument(bare);
    const bout = applyChanges(bare, [addColorDefinition(bdoc, bdoc.syntax.pictures[0]!, "Accent", [31, 119, 180])]);
    expect(bout).toBe("\\begin{tikzpicture}\n  \\definecolor{Accent}{HTML}{1F77B4}\n  \\node (a) {A};\n\\end{tikzpicture}\n");
    // The picture can use it.
    const used = bout.replace("\\node (a)", "\\node[fill=Accent] (a)");
    expect(node(used, "a").fill?.map((v) => Math.round(v * 255))).toEqual([31, 119, 180]);
  });
});
