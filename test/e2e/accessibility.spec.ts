// Milestone 4 step 6: the grayscale and colorblind views, and contrast warnings (D85).
import { expect, type Page, test } from "./base.ts";

async function code(page: Page): Promise<string> {
  return page.evaluate(() => {
    const w = window as unknown as { tikzflow: { store: { editorView: () => { state: { doc: { toString(): string } } } } } };
    return w.tikzflow.store.editorView().state.doc.toString();
  });
}

const DOC = String.raw`\documentclass{article}
\usepackage{tikz}
\usetikzlibrary{positioning}
\begin{document}
\begin{tikzpicture}
\node[draw, fill=red!70!black, text=white] (ok) at (0,0) {Readable};
\node[draw, fill=yellow, text=white, right=of ok] (bad) {Pale};
\end{tikzpicture}
\end{document}
`;

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate((t) => {
    const w = window as unknown as { tikzflow: { store: { replaceDocument: (t: string, n: null, e: string) => void } } };
    w.tikzflow.store.replaceDocument(t, null, "utf-8");
  }, DOC);
  await expect(page.locator('[data-node="bad"]').first()).toBeVisible();
});

test("the views filter the drawing, say so, and leave the code alone", async ({ page }) => {
  const before = await code(page);
  const drawing = page.getByTestId("drawing");
  await expect(drawing).not.toHaveAttribute("filter", /.+/);
  await expect(page.getByTestId("vision-badge")).toHaveCount(0);

  await page.getByTestId("vision-select").selectOption("deuteranopia");
  await expect(drawing).toHaveAttribute("filter", "url(#tf-vision-deuteranopia)");
  await expect(page.locator("#tf-vision-deuteranopia feColorMatrix")).toHaveAttribute("values", /^0\.367322 0\.860646/);
  await expect(page.getByTestId("vision-badge")).toContainText("deuteranopia");
  await expect(page.getByTestId("vision-badge")).toContainText("code and exports are unchanged");

  await page.getByTestId("vision-select").selectOption("grayscale");
  await expect(drawing).toHaveAttribute("filter", "url(#tf-vision-grayscale)");
  expect(await code(page)).toBe(before);

  // The way back, from the note.
  await page.getByTestId("vision-normal").click();
  await expect(drawing).not.toHaveAttribute("filter", /.+/);
  await expect(page.getByTestId("vision-badge")).toHaveCount(0);
  await expect(page.getByTestId("vision-select")).toHaveValue("normal");
});

test("a grayscale view turns the picture's colors grey", async ({ page }) => {
  await page.getByTestId("preview-toggle").uncheck();
  const red = page.locator('[data-node="ok"] path').first();
  await expect(red).toBeVisible();
  const colourOf = async () => {
    // Only the red node: the markers and handles on the canvas keep their own colors.
    const box = (await red.boundingBox())!;
    const png = await page.screenshot({ clip: { x: box.x + 2, y: box.y + 2, width: box.width - 4, height: box.height - 4 } });
    return page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d")!;
      g.drawImage(img, 0, 0);
      // The most saturated pixel anywhere on the canvas.
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let best = 0;
      for (let i = 0; i < d.length; i += 4) best = Math.max(best, Math.max(d[i]!, d[i + 1]!, d[i + 2]!) - Math.min(d[i]!, d[i + 1]!, d[i + 2]!));
      return best;
    }, png.toString("base64"));
  };
  expect(await colourOf()).toBeGreaterThan(60);
  await page.getByTestId("vision-select").selectOption("grayscale");
  await expect.poll(colourOf).toBeLessThan(4);
});

test("text that is hard to read gets a count, a marker, a note and a one-click fix", async ({ page }) => {
  await expect(page.getByTestId("contrast-count")).toHaveText("1 low contrast");
  await expect(page.getByTestId("contrast-mark")).toHaveCount(1);
  await page.getByTestId("contrast-count").click();
  await expect(page.getByTestId("contrast-list")).toContainText("bad");
  await expect(page.getByTestId("contrast-list")).toContainText("WCAG AA asks for 4.5:1");

  // The marker selects the node, and the panel offers the fix.
  await page.getByTestId("contrast-mark").dispatchEvent("pointerdown", { button: 0, bubbles: true });
  await expect(page.getByTestId("contrast-note")).toContainText("Low contrast");
  await expect(page.getByTestId("contrast-fix")).toContainText("Use black text");
  await page.getByTestId("contrast-fix").click();
  expect(await code(page)).toContain("\\node[draw, fill=yellow, text=black, right=of ok] (bad) {Pale};");
  await expect(page.getByTestId("contrast-count")).toHaveCount(0);
  await expect(page.getByTestId("contrast-mark")).toHaveCount(0);

  // One undo brings the warning back.
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("contrast-count")).toHaveText("1 low contrast");
});
