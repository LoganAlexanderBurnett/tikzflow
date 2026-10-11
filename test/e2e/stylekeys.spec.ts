// Milestone 4 step 7: a style named like a TikZ key gets a warning in the summary (D83 item 3, D87).
import { expect, test } from "./base.ts";

const DOC = String.raw`\documentclass{article}
\usepackage{tikz}
\tikzset{step/.style={draw, fill=blue!10}, box/.style={draw}}
\begin{document}
\begin{tikzpicture}
\node[step] (a) at (0,0) {A};
\node[box] (b) at (2,0) {B};
\end{tikzpicture}
\end{document}
`;

test("the summary names the style, says what it replaces, and shows its definition", async ({ page }) => {
  await page.goto("/");
  await page.evaluate((t) => {
    const w = window as unknown as { tikzflow: { store: { replaceDocument: (t: string, n: null, e: string) => void } } };
    w.tikzflow.store.replaceDocument(t, null, "utf-8");
  }, DOC);
  const count = page.getByTestId("key-style-count");
  await expect(count).toHaveText("Style step is a TikZ key");
  await count.click();
  const list = page.getByTestId("key-style-list");
  await expect(list).toContainText("TikZ's own step key (the grid's spacing) is replaced by this style");
  await expect(list).toContainText("TeX stops with an error");
  await expect(list.locator("li")).toHaveCount(1);
  await list.getByRole("button", { name: "step" }).click();
  const selected = await page.evaluate(() => {
    const w = window as unknown as { tikzflow: { store: { editorView: () => { state: { sliceDoc(a: number, b: number): string; selection: { main: { from: number; to: number } } } } } } };
    const s = w.tikzflow.store.editorView().state;
    return s.sliceDoc(s.selection.main.from, s.selection.main.to);
  });
  expect(selected).toBe("step/.style={draw, fill=blue!10}");
});
