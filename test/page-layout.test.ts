// The page goes through the interpreter (D73): \textwidth, \columnwidth and \linewidth in a picture's
// lengths follow the preamble's page, the imported preamble and the widths the user typed.
import { afterEach, describe, expect, it } from "vitest";
import { analyzeDocument, layoutDocumentPicture, setPageSettings } from "../src/model/document.ts";
import { NO_PAGE_SETTINGS } from "../src/tikz/page.ts";
import { evalLength } from "../src/tikz/units.ts";

const PICTURE = ["\\begin{tikzpicture}", "\\node[draw, text width=0.5\\columnwidth] (a) at (0,0) {A wide box};", "\\node[draw, text width=0.5\\textwidth, below=of a] (b) {B};", "\\end{tikzpicture}", ""].join("\n");

/** The node's width in pt (the text width plus the inner separations). */
function widths(text: string): { a: number; b: number } {
  const layout = layoutDocumentPicture(analyzeDocument(text), 0)!;
  const w = (id: string) => {
    const n = layout.nodes.find((x) => x.id === id)!;
    return n.shape.hw * 2;
  };
  return { a: w("a"), b: w("b") };
}

afterEach(() => setPageSettings(NO_PAGE_SETTINGS));

describe("\\textwidth and \\columnwidth in a picture", () => {
  it("are 345 pt with no preamble (article's page), as before", () => {
    const w = widths(PICTURE);
    expect(w.a).toBeCloseTo(0.5 * 345 + 2 * 3.33333, 1);
    expect(w.b).toBeCloseTo(w.a, 3);
  });

  it("follow the document's own preamble", () => {
    const text = ["\\documentclass[twocolumn,a4paper]{article}", "\\begin{document}", PICTURE, "\\end{document}", ""].join("\n");
    // a4, two columns: text 452 pt, a column 221 pt.
    const w = widths(text);
    expect(w.a).toBeCloseTo(0.5 * 221 + 2 * 3.33333, 1);
    expect(w.b).toBeCloseTo(0.5 * 452 + 2 * 3.33333, 1);
  });

  it("follow a preset class and the imported preamble of a bare picture", () => {
    setPageSettings({ imported: "\\documentclass[5p]{elsarticle}\n", textWidth: null, columnWidth: null });
    const w = widths(PICTURE);
    expect(w.a).toBeCloseTo(0.5 * 252 + 2 * 3.33333, 1);
    expect(w.b).toBeCloseTo(0.5 * 522 + 2 * 3.33333, 1);
  });

  it("follow the widths typed for a class that isn't known, over everything else", () => {
    setPageSettings({ imported: "\\documentclass{ans}\n", textWidth: 400, columnWidth: 190 });
    const w = widths(PICTURE);
    expect(w.a).toBeCloseTo(0.5 * 190 + 2 * 3.33333, 1);
    expect(w.b).toBeCloseTo(0.5 * 400 + 2 * 3.33333, 1);
    // Typed widths alone, with no preamble at all.
    setPageSettings({ imported: "", textWidth: 300, columnWidth: null });
    expect(widths(PICTURE).a).toBeCloseTo(0.5 * 300 + 2 * 3.33333, 1);
  });

  it("are reset by every drawing: a picture with another page isn't affected by the last", () => {
    setPageSettings({ imported: "\\documentclass[5p]{elsarticle}\n", textWidth: null, columnWidth: null });
    widths(PICTURE);
    setPageSettings(NO_PAGE_SETTINGS);
    expect(widths(PICTURE).a).toBeCloseTo(0.5 * 345 + 2 * 3.33333, 1);
    // evalLength reads the page the last drawing set.
    expect(evalLength("0.5\\columnwidth")).toBeCloseTo(172.5, 3);
  });
});
