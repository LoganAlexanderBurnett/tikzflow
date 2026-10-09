// M3 step 6 (D66): the DVI to SVG converter, on small DVI files written here.
import { describe, expect, it } from "vitest";
import { dviFonts, dviToSvg, specialColor } from "../src/engine/dvisvg.ts";
import type { FontData } from "../src/engine/fontdata.ts";

const SP = 65536;
/** TeX's DVI units: num/den make one unit 1 sp. */
const NUM = 25400000;
const DEN = 473628672;
const BP = 72 / 72.27 / SP; // bp per sp

class DviWriter {
  bytes: number[] = [];
  u(n: number, v: number) {
    for (let i = n - 1; i >= 0; i--) this.bytes.push(Math.floor(v / 2 ** (8 * i)) & 255);
    return this;
  }
  s(n: number, v: number) {
    return this.u(n, v < 0 ? v + 2 ** (8 * n) : v);
  }
  op(o: number) {
    return this.u(1, o);
  }
  pre() {
    this.op(247).u(1, 2).u(4, NUM).u(4, DEN).u(4, 1000).u(1, 0);
    return this.op(139).u(4 * 11, 0); // bop: c0..c9 and p
  }
  fontDef(id: number, name: string, size: number) {
    this.op(243).u(1, id).u(4, 0).s(4, size).s(4, size).u(1, 0).u(1, name.length);
    for (const c of name) this.u(1, c.charCodeAt(0));
    return this;
  }
  special(s: string) {
    this.op(239).u(1, s.length);
    for (const c of s) this.u(1, c.charCodeAt(0));
    return this;
  }
  right(sp: number) {
    return this.op(146).s(4, sp);
  }
  down(sp: number) {
    return this.op(160).s(4, sp);
  }
  end() {
    return new Uint8Array([...this.op(140).bytes, 248]);
  }
}

// A font where "A" is half the design size wide and "B" a quarter.
const FONT: FontData = {
  name: "testr10",
  checksum: 0,
  design: 10 * 2 ** 20,
  upem: 1000,
  chars: {
    65: [0.5 * 2 ** 20, 0.7 * 2 ** 20, 0, "M0 0L500 0L250 700Z"],
    66: [0.25 * 2 ** 20, 0.7 * 2 ** 20, 0, "M0 0L250 0L250 700Z"],
  },
};
const fonts = (name: string) => (name === "testr10" ? FONT : undefined);

describe("DVI to SVG", () => {
  it("draws characters where TeX set them, advancing by their TFM widths", () => {
    const d = new DviWriter().pre().fontDef(0, "testr10", 10 * SP).op(171).down(20 * SP).right(10 * SP);
    d.op(65).op(66).op(65);
    const r = dviToSvg(d.end(), fonts);
    const uses = [...r.svg.matchAll(/<use xlink:href="#tfg0-(\d+)" transform="matrix\(([^)]+)\)"/g)];
    expect(uses.map((m) => m[1])).toEqual(["65", "66", "65"]);
    const xs = uses.map((m) => Number(m[2]!.split(" ")[4]));
    // A is 5pt wide, B 2.5pt: the characters start at 10, 15 and 17.5pt.
    expect(xs[0]).toBeCloseTo(10 * SP * BP, 3);
    expect(xs[1]).toBeCloseTo(15 * SP * BP, 3);
    expect(xs[2]).toBeCloseTo(17.5 * SP * BP, 3);
    // Each glyph is defined once, without a stroke of its own.
    expect(r.svg.match(/<path id="tfg0-65"/g)).toHaveLength(1);
    expect(r.svg).toContain('<path id="tfg0-65" d="M0 0L500 0L250 700Z" stroke="none"/>');
    expect(r.glyphs).toBe(3);
  });

  it("lists the fonts a file defines, and the ones it has no outlines for", () => {
    const d = new DviWriter().pre().fontDef(0, "testr10", 10 * SP).fontDef(1, "nofont", 12 * SP).op(172).op(65);
    const dvi = d.end();
    expect(dviFonts(dvi).map((f) => f.name)).toEqual(["testr10", "nofont"]);
    expect(dviToSvg(dvi, fonts).missingFonts).toEqual(["nofont"]);
  });

  it("writes raw SVG with the current position, and colours text from the colour stack", () => {
    const d = new DviWriter().pre().fontDef(0, "testr10", 10 * SP).op(171).right(72.27 * SP).down(72.27 * SP);
    d.special("dvisvgm:raw <g transform=\"translate({?x},{?y})\">");
    d.special("color push rgb 1 0 0").op(65).special("color pop").op(65);
    d.special("dvisvgm:raw </g>");
    const svg = dviToSvg(d.end(), fonts).svg;
    // 72.27pt is 72bp.
    expect(svg).toContain('<g transform="translate(72,72)">');
    const uses = [...svg.matchAll(/<use [^>]*>/g)].map((m) => m[0]);
    expect(uses[0]).toContain('fill="#ff0000"');
    expect(uses[1]).not.toContain("fill=");
  });

  it("lets text inherit its group's colour only where the driver says so; black from a special is written", () => {
    // A picture: the driver pushes "inherit"; a node part's text pushes black itself.
    const d = new DviWriter().pre().fontDef(0, "testr10", 10 * SP).op(171);
    d.special("color push tikzflow inherit").special('dvisvgm:raw <g fill="#f3f3f3">').op(65);
    d.special("color push gray 0").op(65).special("color pop");
    d.special("dvisvgm:raw </g>").special("color pop");
    const uses = [...dviToSvg(d.end(), fonts).svg.matchAll(/<use [^>]*>/g)].map((m) => m[0]);
    expect(uses[0]).not.toContain("fill=");
    expect(uses[1]).toContain('fill="#000000"');
  });

  it("keeps raw sets until they are put, and puts each definition once", () => {
    const d = new DviWriter().pre();
    d.special("dvisvgm:rawset grad").special('dvisvgm:rawdef <linearGradient id="g1"/>').special("dvisvgm:endrawset");
    d.special("dvisvgm:rawput grad").special("dvisvgm:rawput grad");
    const svg = dviToSvg(d.end(), fonts).svg;
    expect(svg.match(/linearGradient id="g1"/g)).toHaveLength(1);
    expect(svg.indexOf("<linearGradient")).toBeLessThan(svg.indexOf("</defs>"));
  });

  it("draws rules without a stroke", () => {
    const d = new DviWriter().pre().down(10 * SP).op(132).s(4, 0.4 * SP).s(4, 20 * SP);
    const svg = dviToSvg(d.end(), fonts).svg;
    expect(svg).toMatch(/<rect x="0" y="9\.\d+" width="19\.9\d*" height="0\.\d+" stroke="none"\/>/);
  });

  it("places the picture from the driver's special: its box and TikZ's origin", () => {
    // The box's lower left corner is at (100pt, 200pt) on the page; TikZ's box runs from (-10,-5) to (30,15).
    const d = new DviWriter().pre().right(100 * SP).down(200 * SP).special("tikzflow:picture -10 -5 40 20");
    const r = dviToSvg(d.end(), fonts);
    const k = 72 / 72.27;
    expect(r.picture!.origin.x).toBeCloseTo(110 * k, 6);
    expect(r.picture!.origin.y).toBeCloseTo(195 * k, 6);
    expect(r.picture!.box.width).toBeCloseTo(40 * k, 6);
    expect(r.picture!.tikz).toEqual([-10, -5, 30, 15]);
    expect(r.viewBox.x).toBeCloseTo(100 * k - 2, 6);
    expect(r.svg).toMatch(/viewBox="97\.6\d* 177\.3\d* 43\.8\d* 23\.9\d*"/);
  });

  it("marks where a block of the source begins and ends", () => {
    const d = new DviWriter().pre().special("tikzflow:begin b3").special("dvisvgm:raw <path d=\"M0 0\"/>").special("tikzflow:end b3");
    expect(dviToSvg(d.end(), fonts).svg).toContain('<g data-tf-begin="b3"/><path d="M0 0"/><g data-tf-end="b3"/>');
  });

  it("counts specials meant for other drivers", () => {
    const d = new DviWriter().pre().special("papersize=10pt,10pt").special("ps: gsave").special("ps: grestore");
    expect(dviToSvg(d.end(), fonts).ignoredSpecials).toEqual({ papersize: 1, "ps:": 2 });
  });
});

describe("colour specials", () => {
  it("reads dvips colour models", () => {
    expect(specialColor("rgb 1 0.5 0")).toBe("#ff8000");
    expect(specialColor("gray 0.5")).toBe("#808080");
    expect(specialColor("cmyk 0 1 1 0")).toBe("#ff0000");
    expect(specialColor("hsb 0 1 1")).toBe("#ff0000");
    expect(specialColor("Blue")).toBe("#0000ff");
  });
});
