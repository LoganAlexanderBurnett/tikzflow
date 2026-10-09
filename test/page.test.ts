// Milestone 3 step 10 (D71): the page widths a preamble implies.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeWidth, pageGeometry } from "../src/tikz/page.ts";
import { PT_PER_UNIT } from "../src/tikz/units.ts";

const doc = (head: string) => `${head}\n\\begin{document}\n\\end{document}\n`;

describe("the standard classes", () => {
  it("article at 10pt gives the class's 345pt text width, on either paper", () => {
    for (const paper of ["a4paper", "letterpaper", ""]) {
      const g = pageGeometry(doc(`\\documentclass[${paper}]{article}`));
      expect(g.textWidth).toBe(345);
      expect(g.columnWidth).toBe(345);
      expect(g.estimated).toBe(true);
    }
  });

  it("11pt and 12pt have wider text", () => {
    expect(pageGeometry("\\documentclass[11pt]{article}").textWidth).toBe(360);
    expect(pageGeometry("\\documentclass[12pt,a4paper]{report}").textWidth).toBe(390);
  });

  it("two columns take what the paper leaves, to whole points, and split it with a 10pt gap", () => {
    const g = pageGeometry("\\documentclass[twocolumn]{article}");
    expect(g.columns).toBe(2);
    expect(g.textWidth).toBe(469); // letter: 6.5in = 469.75pt
    expect(g.columnWidth).toBeCloseTo(229.5, 6);
    const a4 = pageGeometry("\\documentclass[a4paper,twocolumn]{article}");
    expect(a4.textWidth).toBe(452); // 210mm - 2in = 452.97pt
    expect(a4.columnWidth).toBeCloseTo(221, 6);
  });

  it("a small paper leaves less than the class's width", () => {
    // a5: 148mm = 421.09pt, less 2in = 276.5pt.
    expect(pageGeometry("\\documentclass[a5paper]{article}").textWidth).toBe(276);
  });
});

describe("geometry", () => {
  it("margins on both sides", () => {
    const g = pageGeometry("\\documentclass[a4paper]{article}\n\\usepackage[margin=2cm]{geometry}");
    expect(g.textWidth).toBeCloseTo(210 * PT_PER_UNIT.mm! - 2 * 2 * PT_PER_UNIT.cm!, 4);
    expect(g.estimated).toBe(false);
  });

  it("hmargin, left and right, and a paper named in geometry", () => {
    expect(pageGeometry("\\documentclass{article}\n\\usepackage[a4paper,hmargin={3cm,3cm}]{geometry}").textWidth).toBeCloseTo(210 * PT_PER_UNIT.mm! - 6 * PT_PER_UNIT.cm!, 4);
    expect(pageGeometry("\\documentclass{article}\n\\geometry{left=1in,right=2in}").textWidth).toBeCloseTo(8.5 * 72.27 - 3 * 72.27, 4);
  });

  it("an explicit width", () => {
    expect(pageGeometry("\\documentclass{article}\n\\usepackage[textwidth=16cm]{geometry}").textWidth).toBeCloseTo(16 * PT_PER_UNIT.cm!, 4);
    expect(pageGeometry("\\documentclass{article}\n\\usepackage[text={15cm,22cm}]{geometry}").textWidth).toBeCloseTo(15 * PT_PER_UNIT.cm!, 4);
  });
});

describe("lengths set in the preamble", () => {
  it("\\setlength, \\addtolength and the TeX primitive form", () => {
    expect(pageGeometry("\\documentclass{article}\n\\setlength{\\textwidth}{6in}").textWidth).toBeCloseTo(6 * 72.27, 6);
    expect(pageGeometry("\\documentclass{article}\n\\setlength\\textwidth{16cm}").textWidth).toBeCloseTo(16 * PT_PER_UNIT.cm!, 6);
    expect(pageGeometry("\\documentclass{article}\n\\addtolength{\\textwidth}{1in}").textWidth).toBeCloseTo(345 + 72.27, 6);
    expect(pageGeometry("\\documentclass{article}\n\\textwidth=15cm").textWidth).toBeCloseTo(15 * PT_PER_UNIT.cm!, 6);
  });

  it("multiples of other lengths, in order", () => {
    const g = pageGeometry("\\documentclass{article}\n\\setlength{\\textwidth}{6in}\n\\setlength{\\columnwidth}{0.5\\textwidth}");
    expect(g.columnWidth).toBeCloseTo(3 * 72.27, 6);
    expect(g.estimated).toBe(false);
  });

  it("columnsep changes the column of two", () => {
    const g = pageGeometry("\\documentclass[twocolumn,a4paper]{article}\n\\setlength{\\columnsep}{20pt}");
    expect(g.columnWidth).toBeCloseTo((452 - 20) / 2, 6);
  });

  it("comments don't count, and an unreadable length is ignored with a note", () => {
    const g = pageGeometry("\\documentclass{article}\n% \\setlength{\\textwidth}{1cm}\n\\setlength{\\textwidth}{\\foo}");
    expect(g.textWidth).toBe(345);
    expect(g.notes.join("\n")).toContain("couldn't be read");
  });

  it("only the preamble of a whole document counts", () => {
    const g = pageGeometry("\\documentclass{article}\n\\begin{document}\n\\setlength{\\textwidth}{1cm}\n\\end{document}");
    expect(g.textWidth).toBe(345);
  });
});

describe("other classes", () => {
  it("beamer: the slide less 1cm each side", () => {
    expect(pageGeometry("\\documentclass{beamer}").textWidth).toBeCloseTo(307.29, 1);
    expect(pageGeometry("\\documentclass[aspectratio=169]{beamer}").textWidth).toBeCloseTo(398.34, 1);
  });

  it("a class it doesn't know has no width until the file sets one or one is typed", () => {
    const g = pageGeometry("\\documentclass[ans,11pt]{ans}");
    expect(g.textWidth).toBeNull();
    expect(g.columnWidth).toBeNull();
    expect(g.classPreset).toBe(false);
    expect(g.notes.join("\n")).toContain("ans class's page isn't known");
    expect(pageGeometry("\\documentclass{ans}\n\\setlength{\\columnwidth}{252pt}").columnWidth).toBe(252);
    const typed = pageGeometry("\\documentclass{ans}", { textWidth: 400, columnWidth: 190 });
    expect([typed.textWidth, typed.columnWidth]).toEqual([400, 190]);
    // Only a text width typed: one column is as wide as the text.
    expect(pageGeometry("\\documentclass{ans}", { textWidth: 400 }).columnWidth).toBe(400);
  });

  it("typed widths win over what a known class gives", () => {
    const g = pageGeometry("\\documentclass[3p]{elsarticle}", { columnWidth: 200 });
    expect([g.textWidth, g.columnWidth]).toEqual([468, 200]);
  });

  it("no preamble at all says nothing", () => {
    const g = pageGeometry("\\begin{tikzpicture}\\end{tikzpicture}");
    expect(g.documentClass).toBeNull();
    expect(g.textWidth).toBeNull();
  });
});

it("describes a width in the units people use", () => {
  expect(describeWidth(252)).toBe("252 pt (88.6 mm, 3.49 in)");
});

// The presets are tested against what LaTeX itself printed for each class and option list in the
// pinned TeX Live 2026 image (engine/page-widths/measured.jsonl, made by .github/workflows/page-widths.yml).
interface Measured {
  class: string;
  options: string;
  ok: boolean;
  textwidth?: number;
  columnwidth?: number;
  titleTextwidth?: number;
  titleColumnwidth?: number;
}
const measured = readFileSync(join(import.meta.dirname, "..", "engine", "page-widths", "measured.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l) as Measured)
  .filter((m) => m.ok);
/** Classes whose page this module knows. The others in the measurements (amsart) aren't presets. */
const PRESET_CLASSES = new Set(["article", "report", "book", "elsarticle", "IEEEtran", "revtex4-2", "acmart", "llncs"]);

describe("class presets against LaTeX's own numbers", () => {
  const cases = measured.filter((m) => PRESET_CLASSES.has(m.class));
  it("has measurements for every preset class", () => {
    for (const c of PRESET_CLASSES) expect(cases.some((m) => m.class === c), c).toBe(true);
  });

  // acmcp with twocolumn gives LaTeX a text width of 114.9 pt after the title (a column less a gap: the
  // class doesn't expect it), which isn't a page to draw on; the preset says "not known" instead.
  const NOT_A_PAGE = new Set(["acmart[acmcp,twocolumn]"]);
  for (const m of cases) {
    it(`${m.class}[${m.options}]`, () => {
      if (NOT_A_PAGE.has(`${m.class}[${m.options}]`)) {
        expect(pageGeometry(`\\documentclass[${m.options}]{${m.class}}`).classPreset).toBe(false);
        return;
      }
      // What a figure sees: LaTeX's lengths at \begin{document}, except for acmart, whose two-column
      // formats switch to two columns in \maketitle (revtex4-2's \maketitle leaves \columnwidth wide
      // for the title block itself, so its title-time numbers are not the body's).
      const afterTitle = m.class === "acmart";
      const wantText = afterTitle ? m.titleTextwidth! : m.textwidth!;
      const wantColumn = afterTitle ? m.titleColumnwidth! : m.columnwidth!;
      const g = pageGeometry(`\\documentclass${m.options ? `[${m.options}]` : ""}{${m.class}}`);
      expect(g.classPreset, "known class").toBe(true);
      expect(g.textWidth).toBeCloseTo(wantText, 1);
      expect(g.columnWidth).toBeCloseTo(wantColumn, 1);
    });
  }
});
