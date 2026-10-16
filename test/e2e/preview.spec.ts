// The accurate preview in the app (M3 step 8, D68): TeX's picture over the
// native one, errors with their lines, notices, locked blocks drawn and
// clickable, the Quick switch, and the marker on labels their line runs
// through (D65). Needs the engine (npm run fetch-engines -- engine); the
// TeX-specific tests are skipped without it.
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

async function code(page: Page): Promise<string> {
  return page.evaluate(() => {
    const w = window as unknown as { tikzflow: { store: { editorView: () => { state: { doc: { toString(): string } } } } } };
    return w.tikzflow.store.editorView().state.doc.toString();
  });
}

async function selectedCode(page: Page): Promise<string> {
  return page.evaluate(() => {
    const w = window as unknown as { tikzflow: { store: { editorView: () => { state: { selection: { main: { from: number; to: number } }; sliceDoc(a: number, b: number): string } } } } };
    const s = w.tikzflow.store.editorView().state;
    return s.sliceDoc(s.selection.main.from, s.selection.main.to);
  });
}

const PICTURE = [
  "\\begin{tikzpicture}",
  "\\node[draw] (a) at (0,0) {A};",
  "\\node[draw] (b) at (3,0) {B};",
  "\\draw[->] (a) -- (b);",
  "\\foreach \\i in {0,1,2} \\fill[red] (\\i,-1.5) circle (3pt);",
  "\\end{tikzpicture}",
  "",
].join("\n");

test.describe("with the TeX engine", () => {
  test.skip(!haveEngine, `the engine ${tag} isn't in vendor/engine (npm run fetch-engines -- engine)`);

  test("shows TeX's picture over the native one, lined up, and the native one only answers the pointer", async ({ page }) => {
    await page.goto("/");
    await setCode(page, PICTURE);
    const compiled = page.getByTestId("compiled-picture");
    await expect(compiled).toBeAttached({ timeout: 15_000 });
    await expect(page.getByTestId("native-drawing")).toHaveClass(/ghost/);
    await expect(page.getByTestId("preview-state")).toHaveText("TeX preview");
    // TeX's text is paths: the "A" and "B" are there as glyphs.
    expect(await compiled.locator("use").count()).toBe(2);
    // Without the loop (which only TeX draws), TeX's picture and the native nodes cover the same box on screen.
    await setCode(page, PICTURE.replace(/\\foreach.*\n/, ""));
    // TeX's picture of this code, not the last one patched (D96).
    await expect(page.locator(".tf-compiled-layer:not([data-stale])")).toBeAttached({ timeout: 15_000 });
    await expect(page.getByTestId("locked-block")).toHaveCount(0);
    await expect(compiled.locator("use")).toHaveCount(2);
    await expect(page.getByTestId("native-drawing")).toHaveClass(/ghost/);
    // Measured as the native side is: Playwright's boundingBox() of an SVG group includes what its strokes cover.
    const tex = await compiled.evaluate((g) => {
      const r = g.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    });
    const native = await page.locator(".tf-native [data-node] path").evaluateAll((els) => {
      const rs = els.map((e) => e.getBoundingClientRect());
      return { x: Math.min(...rs.map((r) => r.left)), y: Math.min(...rs.map((r) => r.top)), right: Math.max(...rs.map((r) => r.right)), bottom: Math.max(...rs.map((r) => r.bottom)) };
    });
    expect(Math.abs(tex.x - native.x)).toBeLessThan(2);
    expect(Math.abs(tex.y - native.y)).toBeLessThan(2);
    expect(Math.abs(tex.x + tex.width - native.right)).toBeLessThan(2);
    expect(Math.abs(tex.y + tex.height - native.bottom)).toBeLessThan(2);
    // Clicking the node still selects it: where TeX draws it, the native node (hidden, D108) takes the click.
    const at = await page.locator("[data-node] path").first().evaluate((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    // What the pointer meets there is the native node, unseen.
    const hit = await page.evaluate((p) => {
      const e = document.elementFromPoint(p.x, p.y);
      return { node: e?.closest("[data-node]")?.getAttribute("data-node") ?? null, visibility: e ? getComputedStyle(e).visibility : null };
    }, at);
    expect(hit).toEqual({ node: expect.any(String), visibility: "hidden" });
    await page.mouse.click(at.x, at.y);
    await expect(page.locator("g.tf-node.selected")).toHaveCount(1);
    await expect(page.getByTestId("status")).not.toContainText("Kept as written");
  });

  test("after an edit TeX's last picture stays, with what changed drawn natively over it, until TeX has caught up (D96)", async ({ page }) => {
    await page.goto("/");
    await setCode(page, PICTURE);
    await expect(page.getByTestId("compiled-picture")).toBeAttached({ timeout: 15_000 });
    await expect(page.locator(".tf-compiled-layer[data-stale]")).toHaveCount(0, { timeout: 15_000 });
    // Straight after the edit (TeX waits a quarter of a second before it starts), in the same task.
    const during = await page.evaluate(async (t) => {
      const w = window as unknown as { tikzflow: { store: { replaceDocument: (t: string, n: null, e: string) => void } } };
      w.tikzflow.store.replaceDocument(t, null, "utf-8");
      await new Promise((r) => setTimeout(r, 40));
      const layer = document.querySelector(".tf-compiled-layer");
      const patch = document.querySelector('[data-testid="stale-patch"]');
      return {
        stale: layer?.hasAttribute("data-stale"),
        mask: layer?.getAttribute("mask"),
        glyphs: layer?.querySelectorAll("use").length,
        // The patch draws node b (its new label) and the edge into it, without ids the pointer would find
        // (and node a, which shows only in the sliver the edge's end cuts out of it).
        patched: patch ? [...patch.querySelectorAll(".tf-label")].map((l) => l.textContent) : null,
        ids: patch?.querySelectorAll("[data-node], [data-path], [data-edge]").length,
        ghost: document.querySelector('[data-testid="native-drawing"]')?.getAttribute("class"),
      };
    }, PICTURE.replace("{B}", "{Bee}"));
    expect(during).toEqual({ stale: true, mask: "url(#tf-stale-hide)", glyphs: 2, patched: expect.arrayContaining(["Bee"]), ids: 0, ghost: "tf-native ghost" });
    // Then TeX's own picture of the new code.
    await expect(page.locator(".tf-compiled-layer[data-stale]")).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId("stale-patch")).toHaveCount(0);
    expect(await page.getByTestId("compiled-picture").locator("use").count()).toBe(4);
    await expect(page.getByTestId("native-drawing")).toHaveClass(/ghost/);
  });

  test("while a node is dragged TeX's picture stays, and the node and its edge are drawn natively where they go (D96)", async ({ page }) => {
    await page.goto("/");
    await setCode(page, PICTURE);
    await expect(page.locator(".tf-compiled-layer:not([data-stale])")).toBeAttached({ timeout: 15_000 });
    const b = (await page.locator('.tf-native [data-node="b"] path').first().boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 30, b.y + b.height / 2 + 50, { steps: 5 });
    await expect(page.locator(".tf-compiled-layer[data-stale]")).toBeAttached();
    await expect(page.getByTestId("stale-patch")).toBeAttached();
    await expect(page.getByTestId("native-drawing")).toHaveClass(/ghost/);
    await page.mouse.up();
    await expect(page.getByTestId("status")).toContainText("Wrote");
    await expect(page.locator(".tf-compiled-layer:not([data-stale])")).toBeAttached({ timeout: 15_000 });
    await expect(page.getByTestId("stale-patch")).toHaveCount(0);
  });

  test("a locked block TeX drew can be clicked to show its code", async ({ page }) => {
    await page.goto("/");
    await setCode(page, PICTURE);
    const block = page.getByTestId("locked-block");
    await expect(block).toHaveCount(1, { timeout: 15_000 });
    const box = (await block.boundingBox())!;
    await page.mouse.click(box.x + 3, box.y + box.height / 2);
    await expect(block).toHaveClass(/picked/);
    expect(await selectedCode(page)).toMatch(/^\\foreach .*circle \(3pt\);$/);
    await expect(page.getByTestId("status")).toContainText("Kept as written");
  });

  test("TeX's errors are listed with the user's line; packages it doesn't have and font packages get a note", async ({ page }) => {
    await page.goto("/");
    await setCode(
      page,
      [
        "\\documentclass{article}",
        "\\usepackage{tikz}",
        "\\usepackage{lmodern}",
        "\\usepackage{nosuchpackage}",
        "\\begin{document}",
        "\\begin{tikzpicture}",
        "\\node[draw] (a) {A};",
        "\\node[draw] at (2,0) {\\oops B};",
        "\\end{tikzpicture}",
        "\\end{document}",
        "",
      ].join("\n"),
    );
    const state = page.getByTestId("preview-state");
    await expect(state).toHaveText("TeX: 1 error", { timeout: 15_000 });
    await state.click();
    const errors = page.getByTestId("tex-errors");
    await expect(errors).toContainText("Line 8: Undefined control sequence.");
    const notes = page.getByTestId("preview-notices");
    await expect(notes).toContainText("no nosuchpackage package");
    await expect(notes).toContainText("loads lmodern");
    await errors.getByRole("button", { name: "Line 8" }).click();
    expect(await selectedCode(page)).toBe("\\node[draw] at (2,0) {\\oops B};");
    // What TeX could draw is still shown, under a banner that says it is not to be trusted.
    await expect(page.getByTestId("compiled-picture")).toBeAttached();
    await expect(page.getByTestId("tex-banner")).toContainText("LaTeX found 1 error and would stop at the first; this picture shows what it drew anyway.");
  });

  test("the error banner switches back to the quick preview for this visit only", async ({ page }) => {
    await page.goto("/");
    await setCode(page, PICTURE.replace("{B}", "{\\oops B}"));
    const banner = page.getByTestId("tex-banner");
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("tex-banner-quick").click();
    await expect(banner).toHaveCount(0);
    await expect(page.getByTestId("compiled-picture")).toHaveCount(0);
    await expect(page.getByTestId("preview-toggle")).not.toBeChecked();
    // Not remembered: a new visit starts with TeX's picture again.
    await page.reload();
    await expect(page.getByTestId("preview-toggle")).toBeChecked();
  });

  test("a Beamer document gets a note about fonts", async ({ page }) => {
    await page.goto("/");
    await setCode(page, ["\\documentclass{beamer}", "\\usepackage{tikz}", "\\begin{document}", "\\begin{frame}", "\\begin{tikzpicture}", "\\node[draw] (a) {A};", "\\end{tikzpicture}", "\\end{frame}", "\\end{document}", ""].join("\n"));
    const state = page.getByTestId("preview-state");
    await expect(state).toHaveText("TeX preview: notes", { timeout: 15_000 });
    await state.click();
    await expect(page.getByTestId("preview-notices")).toContainText("Beamer document");
  });

  test("the switch turns the TeX preview off and on, and is remembered", async ({ page }) => {
    await page.goto("/");
    await setCode(page, PICTURE);
    await expect(page.getByTestId("compiled-picture")).toBeAttached({ timeout: 15_000 });
    await page.getByTestId("preview-toggle").uncheck();
    await expect(page.getByTestId("compiled-picture")).toHaveCount(0);
    await expect(page.getByTestId("native-drawing")).not.toHaveClass(/ghost/);
    await page.reload();
    await expect(page.getByTestId("preview-toggle")).not.toBeChecked();
    await page.getByTestId("preview-toggle").check();
    await setCode(page, PICTURE);
    await expect(page.getByTestId("compiled-picture")).toBeAttached({ timeout: 15_000 });
  });
});

test("a label its line runs through after a node move is marked, and one click puts it beside the line (D65)", async ({ page }) => {
  await page.goto("/");
  await setCode(page, "\\begin{tikzpicture}\n\\node[draw] (a) at (0,0) {A};\n\\node[draw] (b) at (0,-3) {B};\n\\draw[->] (a) -- node[above] {x} (b);\n\\end{tikzpicture}\n");
  const mark = page.getByTestId("label-warning");
  await expect(mark).toHaveCount(1);
  await mark.click();
  await page.getByTestId("label-fix-beside").click();
  await expect(mark).toHaveCount(0);
  expect(await code(page)).toContain("node[auto] {x}");
  await expect(page.getByTestId("status")).toContainText("above → auto");
  // One undo step.
  await page.keyboard.press("Control+z");
  expect(await code(page)).toContain("node[above] {x}");
});
