// Styles named like TikZ keys (D83 item 3, D87).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { keyNamedMessage, keyNamedStyles } from "../src/edit/stylekeys.ts";
import { analyzeDocument } from "../src/model/document.ts";
import { tikzKeyClash } from "../src/tikz/tikzkeys.ts";

const styles = (text: string) => {
  const doc = analyzeDocument(text);
  return keyNamedStyles(doc, doc.syntax.pictures[0]!);
};

describe("styles named like TikZ keys", () => {
  it("knows keys that need a value, keys that don't, and leaves TikZ's every … styles alone", () => {
    expect(tikzKeyClash("step")).toEqual({ what: "the grid's spacing", needsValue: true });
    expect(tikzKeyClash("text  width")?.needsValue).toBe(true);
    expect(tikzKeyClash("draw")?.needsValue).toBe(false);
    expect(tikzKeyClash("cloud")).toBeNull();
    expect(tikzKeyClash("every node")).toBeNull();
    expect(tikzKeyClash("process")).toBeNull();
    expect(tikzKeyClash("Step")).toBeNull();
  });

  it("finds them in \\tikzset, \\tikzstyle and the picture's options, with every definition", () => {
    const text = [
      "\\tikzset{step/.style={draw, fill=blue!10}, box/.style={draw}}",
      "\\tikzstyle{fill}=[draw]",
      "\\begin{tikzpicture}[scale/.style={red}, step/.append style={thick}, every node/.style={draw}]",
      "\\node[step] (a) {A};",
      "\\end{tikzpicture}",
      "",
    ].join("\n");
    const found = styles(text);
    expect(found.map((s) => s.name).sort()).toEqual(["fill", "scale", "step"]);
    const step = found.find((s) => s.name === "step")!;
    expect(step.ranges.map((r) => text.slice(r.from, r.to))).toEqual(["step/.style={draw, fill=blue!10}", "step/.append style={thick}"]);
    expect(keyNamedMessage(step)).toContain("TeX stops with an error");
    expect(keyNamedMessage(found.find((s) => s.name === "fill")!)).not.toContain("TeX stops");
  });

  it("finds none in the corpus", () => {
    const dir = join(import.meta.dirname, "..", "corpus");
    const hits: string[] = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".tex"))) {
      const doc = analyzeDocument(readFileSync(join(dir, f), "utf8"));
      doc.syntax.pictures.forEach((pic) => hits.push(...keyNamedStyles(doc, pic).map((s) => `${f}: ${s.name}`)));
    }
    expect(hits).toEqual([]);
  });
});
