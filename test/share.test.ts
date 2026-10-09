import { describe, expect, it } from "vitest";
import { decodeShare, encodeShare, isShareHash } from "../src/ui/share.ts";
import { readFileSync } from "node:fs";

describe("share links (D74)", () => {
  it("carries the code through the fragment unchanged, whatever it holds", async () => {
    const codes = [
      "",
      "\begin{tikzpicture}\n\node (a) {A};\n\end{tikzpicture}\n",
      "% unicode: é ü 日本語 🙂 and CRLF\r\n\node {x};\r\n",
      "\uFEFF\documentclass{article}\n", // a BOM stays in the text
      readFileSync("corpus/self-hybrid-surrogate.tex", "utf8"),
    ];
    for (const code of codes) {
      const hash = await encodeShare(code, 0);
      expect(hash).toMatch(/^tf1=[A-Za-z0-9_-]*$/);
      expect(await decodeShare(`#${hash}`)).toEqual({ text: code, picture: 0 });
    }
  });

  it("is compressed: a real figure's link is far smaller than its code", async () => {
    const code = readFileSync("corpus/self-hybrid-surrogate.tex", "utf8");
    const hash = await encodeShare(code, 0);
    expect(hash.length).toBeLessThan(code.length * 0.6);
  });

  it("keeps the picture number, 1-based in the link", async () => {
    const hash = await encodeShare("x", 2);
    expect(hash).toMatch(/&p=3$/);
    expect(await decodeShare(hash)).toEqual({ text: "x", picture: 2 });
    expect((await decodeShare(await encodeShare("x", 0)))!.picture).toBe(0);
  });

  it("recognises share links, and refuses damaged ones without throwing", async () => {
    expect(isShareHash("#tf1=abc")).toBe(true);
    expect(isShareHash("#other=abc")).toBe(false);
    expect(isShareHash("")).toBe(false);
    expect(await decodeShare("#tf1=notvalid!!")).toBeNull();
    expect(await decodeShare("#tf1=AAAA")).toBeNull();
    const good = await encodeShare("\node {a long enough line of code to compress};\n".repeat(20), 0);
    expect(await decodeShare(good.slice(0, good.length - 12))).toBeNull();
    expect(await decodeShare("#nothing")).toBeNull();
  });
});
