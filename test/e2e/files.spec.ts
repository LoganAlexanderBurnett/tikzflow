// Save and open, and share links (M3 steps 12 and 13, D74): the work kept in
// the browser, opening and saving a file in place (with the File System Access
// pickers replaced by fakes: a real picker needs a person), the download
// fallback, and a link that carries the code.
import { expect, type Page, test } from "@playwright/test";

const FIGURE = ["\\begin{tikzpicture}", "\\node[draw] (a) at (0,0) {Mine};", "\\node[draw] (b) at (3,0) {B};", "\\draw[->] (a) -- (b);", "\\end{tikzpicture}", ""].join("\n");
const OTHER = ["\\begin{tikzpicture}", "\\node[draw] (z) at (0,0) {Other};", "\\end{tikzpicture}", ""].join("\n");

type Store = { replaceDocument: (t: string, n: string | null, e: string) => void; text: { value: string }; fileName: { value: string | null }; editorView: () => { dispatch: (s: unknown) => void } };
const store = (page: Page) => page.evaluate(() => (window as unknown as { tikzflow: { store: Store } }).tikzflow.store.text.value);

async function setCode(page: Page, text: string, name: string | null = null) {
  await page.evaluate(([t, n]) => (window as unknown as { tikzflow: { store: Store } }).tikzflow.store.replaceDocument(t!, n, "utf-8"), [text, name]);
}

/** Fakes for the pickers: a file to open, and every file written, by name. */
async function fakePickers(page: Page, open?: { name: string; text: string }) {
  await page.addInitScript((o) => {
    const written: Record<string, string> = {};
    (window as unknown as { __written: typeof written }).__written = written;
    const handle = (name: string, content: string) => ({
      kind: "file",
      name,
      getFile: async () => new File([content], name),
      createWritable: async () => {
        const chunks: Uint8Array[] = [];
        return {
          write: async (d: Uint8Array) => void chunks.push(d),
          close: async () => {
            written[name] = chunks.map((c) => new TextDecoder().decode(c)).join("");
          },
        };
      },
      queryPermission: async () => "granted",
    });
    (window as unknown as Record<string, unknown>).showOpenFilePicker = async () => [handle(o?.name ?? "paper.tex", o?.text ?? "")];
    (window as unknown as Record<string, unknown>).showSaveFilePicker = async (opts: { suggestedName?: string }) => handle(`new-${opts.suggestedName ?? "diagram.tex"}`, "");
  }, open ?? null);
}

test("the work is kept in the browser as you type, and comes back after a reload", async ({ page }) => {
  await page.goto("/");
  await setCode(page, FIGURE, "mine.tex");
  await page.waitForTimeout(900);
  await page.reload();
  await expect(page.getByTestId("file-name")).toContainText("mine.tex");
  await expect.poll(() => store(page)).toBe(FIGURE);
});

test("Open links the file, Save writes back to it, and Save as writes a new one", async ({ page }) => {
  await fakePickers(page, { name: "paper.tex", text: FIGURE });
  await page.goto("/");
  await page.getByTestId("open-button").click();
  await expect(page.getByTestId("file-name")).toContainText("paper.tex");
  expect(await store(page)).toBe(FIGURE);
  await expect(page.getByTestId("file-name")).not.toContainText("●");

  // Change it: the dot says it differs from the file.
  await page.evaluate(() => {
    const s = (window as unknown as { tikzflow: { store: Store } }).tikzflow.store;
    s.editorView().dispatch({ changes: { from: 0, to: 0, insert: "% edited\n" } });
  });
  await expect(page.getByTestId("file-name")).toContainText("●");
  await page.keyboard.press("Control+s");
  await expect(page.getByTestId("status")).toContainText("Saved paper.tex");
  await expect(page.getByTestId("file-name")).not.toContainText("●");
  const written = await page.evaluate(() => (window as unknown as { __written: Record<string, string> }).__written);
  expect(written["paper.tex"]).toBe(`% edited\n${FIGURE}`);

  await page.getByTestId("save-as-button").click();
  await expect(page.getByTestId("status")).toContainText("Saved new-paper.tex");
  await expect(page.getByTestId("file-name")).toContainText("new-paper.tex");
});

test("without the pickers Open is a file chooser and Save is a download", async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  });
  await page.goto("/");
  await expect(page.getByTestId("save-as-button")).toHaveCount(0);
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("open-button").click();
  await (await chooser).setFiles({ name: "up.tex", mimeType: "application/x-tex", buffer: Buffer.from(FIGURE) });
  await expect(page.getByTestId("file-name")).toContainText("up.tex");
  expect(await store(page)).toBe(FIGURE);
  const download = page.waitForEvent("download");
  await page.getByTestId("save-button").click();
  expect((await download).suggestedFilename()).toBe("up.tex");
  await expect(page.getByTestId("status")).toContainText("Downloaded up.tex");
});

test("opening a file puts the work that was on screen aside, and it can be brought back", async ({ page }) => {
  await fakePickers(page, { name: "paper.tex", text: OTHER });
  await page.goto("/");
  await setCode(page, FIGURE, "mine.tex");
  await page.getByTestId("open-button").click();
  await expect.poll(() => store(page)).toBe(OTHER);
  await page.getByTestId("restore-previous").click();
  await expect.poll(() => store(page)).toBe(FIGURE);
  await expect(page.getByTestId("file-name")).toContainText("mine.tex");
});

test("a share link carries the code: it opens in another page, and the work that was there is kept", async ({ page, context }) => {
  await page.goto("/");
  await setCode(page, FIGURE);
  await page.getByTestId("share-button").click();
  const link = page.getByTestId("share-link");
  await expect(link).toHaveValue(/#tf1=/);
  const url = await link.inputValue();
  await expect(page.getByTestId("share-size")).toContainText("characters");

  // A new visitor (a fresh browser context has none of our storage) opens the link.
  const other = await context.browser()!.newContext({ viewport: { width: 1400, height: 900 } });
  const visitor = await other.newPage();
  await visitor.goto(url);
  await expect.poll(() => store(visitor)).toBe(FIGURE);
  // The fragment is taken off the address so a reload doesn't reopen it over later work.
  expect(new URL(visitor.url()).hash).toBe("");
  await expect(visitor.getByTestId("status")).toContainText("Opened from a link");
  await other.close();

  // On the same page, with other work on screen: a link replaces it, and Restore previous work gets it back.
  await setCode(page, OTHER);
  await page.waitForTimeout(700);
  await page.evaluate((u) => (location.href = u), url);
  await expect.poll(() => store(page)).toBe(FIGURE);
  await page.getByTestId("restore-previous").click();
  await expect.poll(() => store(page)).toBe(OTHER);
});

test("a damaged link says so and leaves the work alone", async ({ page }) => {
  await page.goto("/");
  await setCode(page, FIGURE);
  await page.waitForTimeout(700);
  await page.goto("/#tf1=notvalid!!");
  await expect(page.getByTestId("status")).toContainText("couldn't be read");
  await expect.poll(() => store(page)).toBe(FIGURE);
});
