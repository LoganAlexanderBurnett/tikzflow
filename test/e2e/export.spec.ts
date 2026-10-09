// The Export panel (M3 step 11, D72): each format is downloaded and its bytes
// checked. The TeX-drawn formats need the engine (npm run fetch-engines -- engine).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { expect, type Page, test } from "@playwright/test";

const tag = (JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "engine", "release.json"), "utf8")) as { tag: string }).tag;
const haveEngine = existsSync(join(import.meta.dirname, "..", "..", "vendor", "engine", tag, "index.json"));

async function setCode(page: Page, text: string, name: string | null = null) {
  await page.evaluate(
    ([t, n]) => {
      const w = window as unknown as { tikzflow: { store: { replaceDocument: (t: string, n: string | null, e: string) => void } } };
      w.tikzflow.store.replaceDocument(t!, n ?? null, "utf-8");
    },
    [text, name],
  );
}

const BARE = ["\\usetikzlibrary{positioning}", "\\begin{tikzpicture}", "\\node[draw] (a) at (0,0) {A};", "\\node[draw, right=of a] (b) {B};", "\\draw[->] (a) -- (b);", "\\end{tikzpicture}", ""].join("\n");

async function openPanel(page: Page) {
  await page.getByTestId("export-button").click();
  const panel = page.getByTestId("export-panel");
  await expect(panel).toBeVisible();
  const onTop = await panel.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + 20));
  });
  expect(onTop).toBe(true);
}

async function download(page: Page, testId: string): Promise<{ name: string; bytes: Buffer }> {
  const [d] = await Promise.all([page.waitForEvent("download"), page.getByTestId(testId).click()]);
  const path = await d.path();
  return { name: d.suggestedFilename(), bytes: readFileSync(path) };
}

test("the standalone document and the snippet are saved as .tex files", async ({ page }) => {
  await page.goto("/");
  await setCode(page, BARE, "flow.tex");
  await openPanel(page);
  const standalone = await download(page, "export-standalone-download");
  expect(standalone.name).toBe("flow-figure.tex");
  const s = standalone.bytes.toString("utf8");
  expect(s).toContain("\\documentclass[tikz,border=5pt]{standalone}\n\\usetikzlibrary{positioning}\n");
  expect(s).toContain("\\begin{document}\n\\begin{tikzpicture}");
  await expect(page.getByTestId("export-status")).toContainText("Saved flow-figure.tex");
  const snippet = await download(page, "export-snippet-download");
  expect(snippet.name).toBe("flow-snippet.tex");
  expect(snippet.bytes.toString("utf8")).toContain("% \\usetikzlibrary{positioning}\n");
});

test("the snippet can be copied", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await setCode(page, BARE);
  await openPanel(page);
  await page.getByTestId("export-snippet-copy").click();
  await expect(page.getByTestId("export-status")).toContainText("Copied the snippet");
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain("\\begin{tikzpicture}");
  expect(clip).toContain("% The figure:");
});

test("with no picture, the .tex exports say so and are off", async ({ page }) => {
  await page.goto("/");
  await setCode(page, "no picture here\n");
  await openPanel(page);
  await expect(page.getByTestId("export-panel")).toContainText("no picture in the code");
  await expect(page.getByTestId("export-standalone-download")).toBeDisabled();
  await expect(page.getByTestId("export-svg")).toBeDisabled();
});

test.describe("with the TeX engine", () => {
  test.skip(!haveEngine, `the engine ${tag} isn't in vendor/engine (npm run fetch-engines -- engine)`);

  test("SVG: TeX's picture, self-contained, with the margin and without the app's markers", async ({ page }) => {
    await page.goto("/");
    await setCode(page, ["\\begin{tikzpicture}", "\\node[draw] (a) at (0,0) {A};", "\\foreach \\i in {0,1} \\fill (\\i,-1) circle (1pt);", "\\end{tikzpicture}", ""].join("\n"), "flow.tex");
    await openPanel(page);
    await page.getByTestId("export-margin").fill("0");
    const tight = await download(page, "export-svg");
    await page.getByTestId("export-margin").fill("10");
    const padded = await download(page, "export-svg");
    expect(tight.name).toBe("flow.svg");
    const t = tight.bytes.toString("utf8");
    const p = padded.bytes.toString("utf8");
    expect(t.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(t).not.toContain("data-tf");
    expect(t).not.toContain("<text");
    expect(t).toContain("<use");
    const size = (s: string) => /width="([\d.]+)pt" height="([\d.]+)pt"/.exec(s)!.slice(1).map(Number);
    expect(size(p)[0]! - size(t)[0]!).toBeCloseTo(20, 2);
    expect(size(p)[1]! - size(t)[1]!).toBeCloseTo(20, 2);
    // A browser takes it as an image.
    const ok = await page.evaluate(async (svg) => {
      const img = new Image();
      img.src = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      await img.decode();
      return [img.naturalWidth, img.naturalHeight];
    }, p);
    expect(ok[0]).toBeGreaterThan(10);
    await expect(page.getByTestId("export-status")).toContainText("Saved flow.svg");
  });

  test("PNG: the size follows the resolution, and it can be transparent", async ({ page }) => {
    await page.goto("/");
    await setCode(page, BARE, "flow.tex");
    await openPanel(page);
    await page.getByTestId("export-margin").fill("0");
    await page.getByTestId("export-dpi").selectOption("150");
    const a = await download(page, "export-png");
    await page.getByTestId("export-dpi").selectOption("300");
    const b = await download(page, "export-png");
    for (const f of [a, b]) {
      expect(f.name).toBe("flow.png");
      expect([...f.bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    }
    const dims = (buf: Buffer) => [buf.readUInt32BE(16), buf.readUInt32BE(20)];
    expect(dims(b.bytes)[0]! / dims(a.bytes)[0]!).toBeCloseTo(2, 1);
    expect(dims(b.bytes)[1]! / dims(a.bytes)[1]!).toBeCloseTo(2, 1);
    await expect(page.getByTestId("export-status")).toContainText("300 dpi");
    // Transparent: the corner pixel has no alpha; white otherwise.
    const corner = async (transparent: boolean) => {
      await page.getByTestId("export-transparent").setChecked(transparent);
      await page.getByTestId("export-margin").fill("8");
      const f = await download(page, "export-png");
      return page.evaluate(async (b64) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        return [...ctx.getImageData(1, 1, 1, 1).data];
      }, f.bytes.toString("base64"));
    };
    expect(await corner(false)).toEqual([255, 255, 255, 255]);
    expect((await corner(true))[3]).toBe(0);
  });

  test("PDF: one page the size of the picture, with its drawing and no fonts", async ({ page }) => {
    await page.goto("/");
    await setCode(page, BARE, "flow.tex");
    await openPanel(page);
    await page.getByTestId("export-margin").fill("0");
    const svg = await download(page, "export-svg");
    const pdf = await download(page, "export-pdf");
    expect(pdf.name).toBe("flow.pdf");
    const s = pdf.bytes.toString("latin1");
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
    const [w, h] = /width="([\d.]+)pt" height="([\d.]+)pt"/.exec(svg.bytes.toString("utf8"))!.slice(1).map(Number);
    const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(s)!.slice(1).map(Number);
    expect(box[0]).toBeCloseTo(w!, 2);
    expect(box[1]).toBeCloseTo(h!, 2);
    expect(s).not.toContain("/Font");
    // Its content is the drawing: glyph outlines and the rectangle around each node.
    const stream = /stream\n([\s\S]*?)\nendstream/.exec(s)![1]!;
    const content = inflateSync(Buffer.from(stream, "latin1")).toString("latin1");
    expect(content).toMatch(/ c\b/);
    expect(content).toMatch(/ [fB]\b/);
    await expect(page.getByTestId("export-status")).toContainText("Saved flow.pdf");
  });

  test("TeX's errors are reported with the export, which shows what TeX drew", async ({ page }) => {
    await page.goto("/");
    await setCode(page, "\\begin{tikzpicture}\n\\node[draw] (a) {A};\n\\node[draw] at (2,0) {\\oops B};\n\\end{tikzpicture}\n", "bad.tex");
    await openPanel(page);
    const f = await download(page, "export-svg");
    expect(f.bytes.toString("utf8")).toContain("<use");
    await expect(page.getByTestId("export-status")).toContainText("TeX reported 1 error; the file shows what it drew anyway.");
  });

  test("an edit made just before exporting is in the export (it compiles the code as it is)", async ({ page }) => {
    await page.goto("/");
    await setCode(page, BARE, "flow.tex");
    await expect(page.getByTestId("compiled-picture")).toBeAttached({ timeout: 15_000 });
    await setCode(page, BARE.replace("{B}", "{Bee}").replace("{A}", "{Ay}"), "flow.tex");
    await openPanel(page);
    const f = await download(page, "export-svg");
    // Ay, Bee: five glyphs (the first picture had two).
    expect((f.bytes.toString("utf8").match(/<use/g) ?? []).length).toBe(5);
  });
});
