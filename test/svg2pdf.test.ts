// Milestone 3 step 11 (D72): the SVG to PDF converter.
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { mul, parsePath, parseTransform, parseXml, svgToPdf } from "../src/export/svg2pdf.ts";

const text = (b: Uint8Array) => Buffer.from(b).toString("latin1");

/** Reads a PDF back: checks its cross-reference table against the objects, and returns the objects and the page content. */
function readPdf(pdf: Uint8Array) {
  const s = text(pdf);
  expect(s.startsWith("%PDF-1.4\n")).toBe(true);
  expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
  const start = Number(/startxref\n(\d+)\n%%EOF/.exec(s)![1]);
  expect(s.slice(start, start + 4)).toBe("xref");
  const m = /xref\n0 (\d+)\n([\s\S]*?)trailer\n<< \/Size (\d+) \/Root 1 0 R/.exec(s.slice(start))!;
  const count = Number(m[1]);
  expect(Number(m[3])).toBe(count);
  const entries = m[2]!.trim().split("\n");
  expect(entries).toHaveLength(count);
  const objects = new Map<number, string>();
  for (let i = 1; i < count; i++) {
    const [offset] = entries[i]!.split(" ");
    const at = Number(offset);
    expect(s.slice(at, at + `${i} 0 obj`.length), `object ${i}`).toBe(`${i} 0 obj`);
    objects.set(i, s.slice(at, s.indexOf("endobj", at)));
  }
  // The content stream of object 4, inflated if it is.
  const o4 = objects.get(4)!;
  const bodyStart = s.indexOf("stream\n", s.indexOf("4 0 obj")) + 7;
  const len = Number(/\/Length (\d+)/.exec(o4)![1]);
  const raw = pdf.slice(bodyStart, bodyStart + len);
  const content = /FlateDecode/.test(o4) ? inflateSync(raw).toString("latin1") : Buffer.from(raw).toString("latin1");
  return { objects, content, s };
}

const svg = (body: string, vb = "0 0 100 50") => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="100pt" height="50pt" viewBox="${vb}" overflow="visible">${body}</svg>`;

describe("reading the SVG", () => {
  it("parses elements and attributes, ignoring comments and the prolog", () => {
    const n = parseXml(`<?xml version="1.0"?><!-- hi --><svg a="1" b='x &amp; y'><g><path d="M0 0"/></g><g/></svg>`);
    expect(n.tag).toBe("svg");
    expect(n.attrs).toEqual({ a: "1", b: "x & y" });
    expect(n.children.map((c) => c.tag)).toEqual(["g", "g"]);
    expect(n.children[0]!.children[0]!.attrs.d).toBe("M0 0");
  });

  it("repairs tags that don't nest, and says so", () => {
    const said: string[] = [];
    const a = parseXml("<svg><g><path/></svg>", (m) => said.push(m));
    expect(a.children[0]!.tag).toBe("g");
    expect(said).toEqual(["</svg> closed 1 element(s) left open"]);
    said.length = 0;
    const b = parseXml("<svg></g><g/></svg>", (m) => said.push(m));
    expect(b.children).toHaveLength(1);
    expect(said).toEqual(["a stray </g> was ignored"]);
    said.length = 0;
    parseXml("<svg><g>", (m) => said.push(m));
    expect(said).toEqual(["<g> was never closed"]);
  });

  it("reads transform lists written without separators, as pgf writes them", () => {
    const m = parseTransform("translate(-71.801,-54.793)scale(0.996264,-0.996264)");
    expect(m[0]).toBeCloseTo(0.996264, 6);
    expect(m[3]).toBeCloseTo(-0.996264, 6);
    expect(m[4]).toBeCloseTo(-71.801, 6);
    expect(parseTransform("rotate(90)")[1]).toBeCloseTo(1, 9);
    expect(mul([2, 0, 0, 2, 0, 0], [1, 0, 0, 1, 5, 5])).toEqual([2, 0, 0, 2, 10, 10]);
  });

  it("reads path data: relative commands, repeated pairs, H and V", () => {
    expect(parsePath(" M 0.0 0.0 L 14.2 8.5 h 35 v 16 Z  ")).toEqual([["M", 0, 0], ["L", 14.2, 8.5], ["L", 49.2, 8.5], ["L", 49.2, 24.5], ["Z"]]);
    expect(parsePath("m1 1 2 2 3 3")).toEqual([["M", 1, 1], ["L", 3, 3], ["L", 6, 6]]);
    expect(parsePath("M0 0C1 1 2 2 3 3c1 1 2 2 3 3")).toEqual([["M", 0, 0], ["C", 1, 1, 2, 2, 3, 3], ["C", 4, 4, 5, 5, 6, 6]]);
  });

  it("raises quadratics and converts arcs to curves that end where the arc does", () => {
    const q = parsePath("M0 0Q3 0 3 3");
    expect(q[1]).toEqual(["C", 2, 0, 3, 1, 3, 3]);
    const a = parsePath("M0 0A5 5 0 0 1 10 0");
    expect(a.length).toBeGreaterThanOrEqual(3);
    const last = a[a.length - 1]!;
    expect(last[0]).toBe("C");
    expect((last as number[])[5]).toBeCloseTo(10, 6);
    expect((last as number[])[6]).toBeCloseTo(0, 6);
    // Flags written without separators.
    expect(parsePath("M0 0a5 5 0 0110 0").length).toBeGreaterThanOrEqual(3);
  });
});

describe("the PDF", () => {
  it("is one page the size of the viewBox, with a consistent cross-reference table", async () => {
    const r = await svgToPdf(svg(`<path d="M 0 0 L 10 10" stroke="#000"/>`, "-20 -10 100 50"));
    expect([r.width, r.height]).toEqual([100, 50]);
    const { objects, content } = readPdf(r.pdf);
    expect(objects.get(3)).toContain("/MediaBox [0 0 100 50]");
    // SVG's y down, origin at the viewBox corner, to PDF's y up: x - (-20), 50 + (-10) - y.
    expect(content.split("\n")[0]).toBe("1 0 0 -1 20 40 cm");
    expect(r.warnings).toEqual([]);
  });

  it("draws strokes and fills with their paint, widths, dashes and caps", async () => {
    const r = await svgToPdf(
      svg(`<g stroke="#f00" stroke-width="0.4" stroke-linecap="round" stroke-linejoin="bevel" stroke-miterlimit="10" stroke-dasharray="3,2" stroke-dashoffset="1" fill="#00f"><path d="M 0 0 L 10 0 L 10 10 Z"/><path d="M 5 5 L 6 6" fill="none"/></g>`),
    );
    const { content } = readPdf(r.pdf);
    expect(content).toContain("0 0 1 rg");
    expect(content).toContain("1 0 0 RG");
    expect(content).toContain("0.4 w 1 J 2 j 10 M [3 2] 1 d");
    expect(content).toContain("0 0 m 10 0 l 10 10 l h B");
    // The second path has no fill: stroke only.
    expect(content).toContain("5 5 m 6 6 l S");
  });

  it("draws nothing for a shape with neither fill nor stroke", async () => {
    const { content } = readPdf((await svgToPdf(svg(`<path d="M 0 0 L 5 5" fill="none"/>`))).pdf);
    expect(content).not.toContain(" S");
    expect(content).not.toContain(" f");
  });

  it("uses a glyph outline once defined and many times used, through its transform", async () => {
    const r = await svgToPdf(
      svg(`<defs><path id="g1" d="M 100 0 L 500 0 L 500 700 Z" stroke="none"/></defs><g fill="#0f0"><use xlink:href="#g1" transform="matrix(0.01,0,0,-0.01,5,20)"/><use xlink:href="#g1" x="30" transform="matrix(0.007,0,0,-0.007,5,20)"/></g>`),
    );
    const { content } = readPdf(r.pdf);
    // The scale of a glyph keeps its digits.
    expect(content).toContain("0.01 0 0 -0.01 5 20 cm");
    expect(content).toContain("0.007 0 0 -0.007 5 20 cm");
    expect(content).toContain("1 0 0 1 30 0 cm");
    expect(content.match(/100 0 m 500 0 l 500 700 l h f/g)).toHaveLength(2);
    expect(content).not.toContain("S\n");
  });

  it("clips to a clip path in the space of the element that names it", async () => {
    const r = await svgToPdf(svg(`<clipPath id="c"><path d="M 0 0 L 20 0 L 20 20 Z"/></clipPath><g clip-path="url(#c)"><path d="M 0 0 L 40 40" stroke="#000"/></g>`));
    const { content } = readPdf(r.pdf);
    expect(content).toMatch(/q\n0 0 m 20 0 l 20 20 l h W n\nq/);
    expect(r.warnings).toEqual([]);
  });

  it("converts rect and circle fills, with gradients as shadings in a pattern", async () => {
    const r = await svgToPdf(
      svg(
        `<linearGradient id="a" gradientTransform="rotate(90)"><stop offset="0.0" stop-color=" #c0c0ff "/><stop offset="0.5" stop-color=" #e0e0ff "/><stop offset="1.0" stop-color=" #fff "/></linearGradient>` +
          `<radialGradient id="b" fx="0.4" fy="0.6"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient>` +
          `<rect x="0" y="0" width="20" height="10" style="fill:url(#a); stroke:none"/><circle cx="50" cy="25" r="10" style="fill:url(#b); stroke:none"/>`,
      ),
    );
    const { objects, content } = readPdf(r.pdf);
    expect(r.warnings).toEqual([]);
    expect(content).toContain("/Pattern cs /P0 scn");
    expect(content).toContain("/Pattern cs /P1 scn");
    const patterns = [...objects.values()].filter((o) => o.includes("/PatternType 2"));
    expect(patterns).toHaveLength(2);
    expect(patterns[0]).toContain("/ShadingType 2");
    expect(patterns[0]).toContain("/FunctionType 3"); // three stops: stitched
    expect(patterns[1]).toContain("/ShadingType 3");
    expect(patterns[1]).toContain("/Coords [0.4 0.6 0 0.5 0.5 0.5]");
    // The linear one runs top to bottom (rotate 90) over the rect: pattern matrix maps the unit box onto it, y flipped.
    const m = /\/Matrix \[([^\]]*)\]/.exec(patterns[0]!)![1]!.split(" ").map(Number);
    expect(m[0]).toBeCloseTo(0, 6);
    expect(m[1]).toBeCloseTo(-10, 6); // unit x (after rotate 90 it points down in SVG) is 10 high, up-to-down in PDF
  });

  it("keeps opacity in a graphics state", async () => {
    const r = await svgToPdf(svg(`<g fill="#000" fill-opacity="0.5" stroke="#000" stroke-opacity="0.25"><path d="M 0 0 L 9 0 L 9 9 Z"/></g>`));
    const { objects, content } = readPdf(r.pdf);
    expect(content).toContain("/G0 gs");
    expect([...objects.values()].some((o) => /\/ca 0\.5 \/CA 0\.25/.test(o))).toBe(true);
  });

  it("says what it can't convert", async () => {
    const r = await svgToPdf(svg(`<image href="x.png" width="5" height="5"/><g opacity="0.5"><path d="M 0 0 L 5 5" stroke="#000"/></g>`));
    expect(r.warnings).toEqual(["<image> isn't converted", "opacity on a group is applied to each shape"]);
  });

  it("converts what it can of an SVG that TeX cut short, and warns", async () => {
    const r = await svgToPdf(svg(`<g stroke="#000" fill="none"><path d="M 0 0 L 5 5"/></g></g>`));
    expect(r.warnings.join()).toContain("a stray </g> was ignored");
    expect(readPdf(r.pdf).content).toContain("0 0 m 5 5 l S");
  });

  it("refuses an SVG without a viewBox", async () => {
    await expect(svgToPdf(`<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>`)).rejects.toThrow(/viewBox/);
  });
});
