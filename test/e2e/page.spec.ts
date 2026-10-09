// The page panel (M3 step 10, D71): the preamble of the user's paper for the
// TeX preview, the page widths it implies, and the width guide on the canvas.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "./base.ts";

const tag = (JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "engine", "release.json"), "utf8")) as { tag: string }).tag;
const haveEngine = existsSync(join(import.meta.dirname, "..", "..", "vendor", "engine", tag, "index.json"));

async function setCode(page: Page, text: string) {
  await page.evaluate((t) => {
    const w = window as unknown as { tikzflow: { store: { replaceDocument: (t: string, n: null, e: string) => void } } };
    w.tikzflow.store.replaceDocument(t, null, "utf-8");
  }, text);
}

/** A figure 4 cm wide (two 1 cm nodes 3 cm apart, centres), bare. */
const FIGURE = ["\\begin{tikzpicture}", "\\node[draw, minimum width=1cm] (a) at (0,0) {A};", "\\node[draw, minimum width=1cm] (b) at (3,0) {B};", "\\draw[->] (a) -- (b);", "\\end{tikzpicture}", ""].join("\n");

async function openPanel(page: Page) {
  await page.getByTestId("page-button").click();
  const panel = page.getByTestId("page-panel");
  await expect(panel).toBeVisible();
  // On top of the page, not clipped by the toolbar it hangs from: the point in its middle belongs to it.
  const onTop = await panel.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + 20));
  });
  expect(onTop).toBe(true);
}

test("a pasted preamble gives the page widths and a guide one column wide, centred on the figure", async ({ page }) => {
  await page.goto("/");
  await setCode(page, FIGURE);
  await expect(page.getByTestId("width-guide")).toHaveCount(0);
  await openPanel(page);
  await page.getByTestId("page-preamble").fill("\\documentclass[twocolumn,a4paper]{article}\n\\usepackage{amsmath}\n");
  // a4, two columns: 452 pt of text, columns 10 pt apart.
  await expect(page.getByTestId("page-widths")).toContainText("221 pt");
  await expect(page.getByTestId("page-widths")).toContainText("452 pt");
  await expect(page.getByTestId("page-button")).toContainText("221 pt");
  const guide = page.getByTestId("width-guide");
  await expect(guide).toHaveCount(1);
  // The two lines are 221 pt apart in canvas units, and the figure (about 4 cm + a stroke) fits.
  const [x1, x2] = await guide.locator("line").evaluateAll((ls) => ls.slice(0, 2).map((l) => Number(l.getAttribute("x1"))));
  expect(Math.abs(x2! - x1!)).toBeCloseTo(221, 1);
  await expect(guide).not.toHaveClass(/over/);
  await expect(page.getByTestId("page-fit")).toContainText("it fits \\columnwidth");
  // Centred on the figure: its left and right ends are the same distance inside the lines.
  const fig = await page.evaluate(() => {
    const els = [...document.querySelectorAll(".tf-native [data-node] path")].map((e) => e.getBoundingClientRect());
    return { left: Math.min(...els.map((r) => r.left)), right: Math.max(...els.map((r) => r.right)) };
  });
  const lines = await guide.locator("line").evaluateAll((ls) => ls.slice(0, 2).map((l) => l.getBoundingClientRect().left));
  expect(Math.abs(fig.left - lines[0]! - (lines[1]! - fig.right))).toBeLessThan(2);
});

test("a figure wider than the column turns the guide red and says by how much", async ({ page }) => {
  await page.goto("/");
  await setCode(page, FIGURE.replace("(3,0)", "(9,0)"));
  await openPanel(page);
  await page.getByTestId("page-preamble").fill("\\documentclass{article}\n\\setlength{\\textwidth}{8cm}\n");
  await page.getByTestId("guide-text").check();
  await expect(page.getByTestId("width-guide")).toHaveClass(/over/);
  await expect(page.getByTestId("page-fit")).toContainText("wider than \\textwidth");
});

test("a typed width works without any preamble, and the guide can be hidden", async ({ page }) => {
  await page.goto("/");
  await setCode(page, FIGURE);
  await openPanel(page);
  await page.getByTestId("guide-custom-width").fill("3.4in");
  await expect(page.getByTestId("width-guide")).toHaveCount(1);
  await expect(page.getByTestId("page-fit")).toContainText("245.7 pt");
  await page.getByTestId("guide-custom-width").fill("wide");
  await expect(page.getByTestId("width-guide")).toHaveCount(0);
  await page.getByTestId("guide-custom-width").fill("8.5cm");
  await expect(page.getByTestId("width-guide")).toHaveCount(1);
  await page.getByTestId("guide-on").uncheck();
  await expect(page.getByTestId("width-guide")).toHaveCount(0);
});

test("a full document's own preamble gives the widths, and the imported one steps aside", async ({ page }) => {
  await page.goto("/");
  await setCode(page, "\\documentclass[12pt]{article}\n\\usepackage{tikz}\n\\begin{document}\n" + FIGURE + "\\end{document}\n");
  await openPanel(page);
  await expect(page.getByTestId("page-source")).toBeVisible();
  await expect(page.getByTestId("page-widths")).toContainText("390 pt");
  await expect(page.getByTestId("width-guide")).toHaveCount(1);
});

test("the preamble and the guide settings are remembered", async ({ page }) => {
  await page.goto("/");
  await setCode(page, FIGURE);
  await openPanel(page);
  await page.getByTestId("page-preamble").fill("\\documentclass[11pt]{article}\n");
  await page.getByTestId("guide-text").check();
  await page.reload();
  await setCode(page, FIGURE);
  await openPanel(page);
  await expect(page.getByTestId("page-preamble")).toHaveValue("\\documentclass[11pt]{article}\n");
  await expect(page.getByTestId("guide-text")).toBeChecked();
  await expect(page.getByTestId("page-widths")).toContainText("360 pt");
  await page.getByTestId("page-clear").click();
  await expect(page.getByTestId("page-preamble")).toHaveValue("");
  await expect(page.getByTestId("width-guide")).toHaveCount(0);
});

test.describe("with the TeX engine", () => {
  test.skip(!haveEngine, `the engine ${tag} isn't in vendor/engine (npm run fetch-engines -- engine)`);

  test("an imported macro is defined for the TeX preview, and its faults are placed in the preamble", async ({ page }) => {
    await page.goto("/");
    await setCode(page, "\\begin{tikzpicture}\n\\node[draw] (a) {\\state{A}};\n\\end{tikzpicture}\n");
    const state = page.getByTestId("preview-state");
    await expect(state).toHaveText("TeX: 1 error", { timeout: 15_000 });
    await openPanel(page);
    await page.getByTestId("page-preamble").fill("\\documentclass{article}\n\\newcommand{\\state}[1]{\\textbf{#1}}\n");
    await expect(state).toHaveText("TeX preview", { timeout: 15_000 });
    await expect(page.getByTestId("tex-banner")).toHaveCount(0);
    // A fault in the preamble says where it is.
    await page.getByTestId("page-preamble").fill("\\documentclass{article}\n\\newcommand{\\state}[1]{\\textbf{#1}}\n\\nosuchcommand\n");
    await expect(state).toHaveText("TeX: 1 error", { timeout: 15_000 });
    await page.getByTestId("page-panel").getByRole("button", { name: "Close" }).click();
    await state.click();
    await expect(page.getByTestId("tex-errors")).toContainText("In the imported preamble, line 3");
  });

  test("a class the preview doesn't have is replaced by article's with a note, not an error banner (D73)", async ({ page }) => {
    await page.goto("/");
    await setCode(page, "\\begin{tikzpicture}\n\\node[draw] (a) {\\state{A}};\n\\end{tikzpicture}\n");
    await openPanel(page);
    // \journal is something the ANS class would define; the preview doesn't have the class.
    await page.getByTestId("page-preamble").fill("\\documentclass[11pt]{ans}\n\\usepackage{amsmath}\n\\journal{Annals}\n\\newcommand{\\state}[1]{\\textbf{#1}}\n");
    const state = page.getByTestId("preview-state");
    await expect(state).toHaveText("TeX preview: notes", { timeout: 15_000 });
    await expect(page.getByTestId("tex-banner")).toHaveCount(0);
    await expect(page.getByTestId("compiled-picture")).toBeAttached();
    await page.getByTestId("page-panel").getByRole("button", { name: "Close" }).click();
    await state.click();
    const notes = page.getByTestId("preview-notices");
    await expect(notes).toContainText("The ans class isn't available in the preview");
    await expect(notes).toContainText("keeps your packages and macros");
    await expect(notes).toContainText("Line 3 of your preamble");
  });
});
