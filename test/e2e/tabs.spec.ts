// Tabs (M5 step 6, D97): each tab's own code, undo history, file and kept copy; closing and Recently
// closed; two windows on the same diagrams (one writer, Edit here); a page closed before its last change
// was saved; the single session of before tabs moved into tabs; the engine stopped while the tab is hidden.
import { expect, type Page, test } from "./base.ts";

const A = ["\\begin{tikzpicture}", "\\node[draw] (a) at (0,0) {Alpha};", "\\end{tikzpicture}", ""].join("\n");
const B = ["\\begin{tikzpicture}", "\\node[draw] (b) at (0,0) {Beta};", "\\end{tikzpicture}", ""].join("\n");

interface Debug {
  store: {
    text: { value: string };
    editLock: { value: string | null };
    replaceDocument: (t: string, n: string | null, e: string) => void;
    editorView: () => { state: { doc: { toString(): string; length: number } }; dispatch: (s: unknown) => void };
    undoEdit: () => void;
  };
  tabs: { activeId: { value: string }; tabs: { value: { id: string }[] }; elsewhere: { value: Set<string> } };
  preview: { engineIdle: { hiddenMs: number }; engineRunning: { value: boolean } };
}
const code = (page: Page) => page.evaluate(() => (window as unknown as { tikzflow: Debug }).tikzflow.store.text.value);
const setCode = (page: Page, t: string, name: string | null = null) =>
  page.evaluate(([t, n]) => (window as unknown as { tikzflow: Debug }).tikzflow.store.replaceDocument(t!, n ?? null, "utf-8"), [t, name] as const);
/** Types at the start of the code, as the keyboard would (one undoable step). */
const type = (page: Page, s: string) =>
  page.evaluate((s) => (window as unknown as { tikzflow: Debug }).tikzflow.store.editorView().dispatch({ changes: { from: 0, to: 0, insert: s }, userEvent: "input.type" }), s);
const tab = (page: Page, i: number) => page.getByTestId("tab").nth(i).locator(".name");
const names = (page: Page) => page.getByTestId("tab").locator(".name");

/** The kept tabs, as IndexedDB has them. */
const storedTexts = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const req = indexedDB.open("tikzflow", 1);
        req.onsuccess = () => {
          const all = req.result.transaction("kv").objectStore("kv").getAll(IDBKeyRange.bound("doc:", "doc:￿"));
          all.onsuccess = () => resolve((all.result as { text: string }[]).map((d) => d.text).sort());
        };
      }),
  );

test("each tab keeps its own code, undo history and file; all of them are kept across a reload", async ({ page }) => {
  await page.goto("/");
  await setCode(page, A, "alpha.tex");
  await page.getByTestId("tab-new").click();
  await expect(page.getByTestId("empty-state")).toBeVisible();
  // Code put into the empty tab stays in it.
  await setCode(page, B);
  await expect(names(page)).toHaveText(["alpha.tex ●", "Untitled"]);
  await type(page, "% b\n");
  await tab(page, 0).click();
  await expect.poll(() => code(page)).toBe(A);
  await type(page, "% a\n");
  await tab(page, 1).click();
  await expect.poll(() => code(page)).toBe(`% b\n${B}`);
  // Undo here undoes this tab's typing, not the other's.
  await page.evaluate(() => (window as unknown as { tikzflow: Debug }).tikzflow.store.undoEdit());
  await expect.poll(() => code(page)).toBe(B);
  await tab(page, 0).click();
  await expect.poll(() => code(page)).toBe(`% a\n${A}`);
  await page.evaluate(() => (window as unknown as { tikzflow: Debug }).tikzflow.store.undoEdit());
  await expect.poll(() => code(page)).toBe(A);
  await expect(page.getByTestId("file-name")).toContainText("alpha.tex");

  await expect.poll(() => storedTexts(page)).toEqual([A, B].sort());
  await page.reload();
  // The window comes back on the tab it showed, with the others beside it.
  await expect(names(page)).toHaveText(["alpha.tex ●", "Untitled"]);
  await expect.poll(() => code(page)).toBe(A);
  await tab(page, 1).click();
  await expect.poll(() => code(page)).toBe(B);
});

test("closing a tab keeps its work in Recently closed; closing the last one leaves a start screen", async ({ page }) => {
  await page.goto("/");
  await setCode(page, A);
  await page.getByTestId("new-button").click();
  await page.getByTestId("new-hierarchy").click();
  await expect(page.getByTestId("tab")).toHaveCount(2);
  // An untouched template isn't work: closed, it is simply gone.
  await page.getByTestId("tab-close").nth(1).click();
  await expect(page.getByTestId("status")).toHaveText("Closed “Hierarchy”.");
  await expect(page.getByTestId("closed-button")).toHaveCount(0);
  await page.getByTestId("tab-close").first().click();
  await expect(page.getByTestId("status")).toHaveText("Closed “Basic process”. Recently closed brings it back.");
  await expect(page.getByTestId("tab")).toHaveCount(1);
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await page.getByTestId("closed-button").click();
  await expect(page.getByTestId("closed-item")).toHaveText(["Basic process"]);
  await page.getByTestId("closed-item").click();
  // Reopened in the empty tab's place? No: in a tab of its own, and the start screen tab stays.
  await expect.poll(() => code(page)).toBe(A);
  await expect(page.getByTestId("tab")).toHaveCount(2);
  await expect(page.getByTestId("status")).toHaveText("Reopened “Basic process”.");
  await page.reload();
  await expect.poll(() => code(page)).toBe(A);
  await expect(page.getByTestId("closed-button")).toHaveCount(0);
});

test("two windows: one edits a diagram, the other shows it read-only and can take it over", async ({ page, context }) => {
  await page.goto("/");
  await setCode(page, A);
  await page.getByTestId("tab-new").click();
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await setCode(page, B);
  await expect.poll(() => storedTexts(page)).toEqual([A, B].sort());

  // A second window starts on the diagram the first one isn't showing.
  const second = await context.newPage();
  await second.goto("/editor/");
  await second.waitForSelector(".cm-editor");
  await expect.poll(() => code(second)).toBe(A);
  await expect(second.getByTestId("lock-banner")).toHaveCount(0);

  // It opens the first window's diagram: read-only, marked, and following its saves.
  await tab(second, 1).click();
  await expect.poll(() => code(second)).toBe(B);
  await expect(second.getByTestId("lock-banner")).toBeVisible();
  await expect(second.locator(".tf-code.readonly")).toHaveCount(1);
  await type(page, "% from the first window\n");
  await expect.poll(() => code(second)).toBe(`% from the first window\n${B}`);
  // Nothing here writes: typing in the code pane, dragging a node, deleting.
  await second.locator(".cm-content").click();
  await second.keyboard.type("xyz");
  await second.locator('[data-node="b"]').first().click();
  await second.keyboard.press("Delete");
  await expect(second.getByTestId("status")).toContainText("read-only here");
  expect(await code(second)).toBe(`% from the first window\n${B}`);
  // Closing it from here is refused too.
  await second.getByTestId("tab-close").nth(1).click();
  await expect(second.getByTestId("status")).toContainText("is open in another window");

  // Edit here: the first window saves and lets go; the second takes the latest version.
  await type(page, "% last word\n");
  await second.getByTestId("edit-here").click();
  await expect(second.getByTestId("lock-banner")).toHaveCount(0);
  await expect.poll(() => code(second)).toBe(`% last word\n% from the first window\n${B}`);
  await expect(page.getByTestId("lock-banner")).toBeVisible();
  await type(second, "% now the second\n");
  await expect.poll(() => code(page)).toBe(`% now the second\n% last word\n% from the first window\n${B}`);
  await expect.poll(() => storedTexts(page)).toEqual([A, `% now the second\n% last word\n% from the first window\n${B}`].sort());

  // The second window closes: the first can edit again once it is in front.
  await second.close();
  await page.bringToFront();
  await expect
    .poll(async () => {
      // The browser lets go of the closed window's lock a moment after it closes.
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      return page.getByTestId("lock-banner").count();
    })
    .toBe(0);
  await type(page, "% mine again\n");
  await expect.poll(() => storedTexts(page)).toEqual([A, `% mine again\n% now the second\n% last word\n% from the first window\n${B}`].sort());
});

test("a page closed right after an edit loses nothing", async ({ page, context }) => {
  await page.goto("/");
  await setCode(page, A);
  await page.waitForTimeout(700);
  // Typed, and the page closed at once: before the half-second save.
  await type(page, "% typed just before closing\n");
  await page.close();
  const next = await context.newPage();
  await next.goto("/editor/");
  await next.waitForSelector(".cm-editor");
  await expect.poll(() => code(next)).toBe(`% typed just before closing\n${A}`);
});

test("a journal left by a page whose last save didn't finish is stored on the next start", async ({ page }) => {
  await page.goto("/");
  await setCode(page, A);
  await expect.poll(() => storedTexts(page)).toEqual([A]);
  const id = await page.evaluate(() => (window as unknown as { tikzflow: Debug }).tikzflow.tabs.activeId.value);
  const rev = await page.evaluate(
    (id) =>
      new Promise<number>((resolve) => {
        const req = indexedDB.open("tikzflow", 1);
        req.onsuccess = () => {
          const g = req.result.transaction("kv").objectStore("kv").get(`doc:${id}`);
          g.onsuccess = () => resolve((g.result as { rev: number }).rev);
        };
      }),
    id,
  );
  // As pagehide leaves it when IndexedDB's write doesn't land: the journal holds a newer version.
  const leave = async (text: string, baseRev: number) => {
    await page.evaluate(
      ([id, text, baseRev]) => {
        const rec = { id, text, savedText: "", fileName: null, encoding: "utf-8", pictureIndex: 0, title: "Basic process", created: 0, rev: 0, savedAt: Date.now() };
        localStorage.setItem(`tikzflow.journal.${id}`, JSON.stringify({ rec, baseRev, fp: "x" }));
      },
      [id, text, baseRev] as const,
    );
  };
  await leave(`% unsaved\n${A}`, rev);
  await page.reload();
  await expect.poll(() => code(page)).toBe(`% unsaved\n${A}`);
  await expect.poll(() => storedTexts(page)).toEqual([`% unsaved\n${A}`]);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("tikzflow.journal.")))).toEqual([]);

  // A journal whose diagram was changed since by someone else: both are kept.
  await leave(`% older change\n${A}`, rev);
  await page.reload();
  await expect(page.getByTestId("status")).toContainText("Both are kept");
  await expect(names(page)).toContainText(["Basic process (recovered)"]);
  await expect.poll(() => storedTexts(page)).toEqual([`% older change\n${A}`, `% unsaved\n${A}`].sort());
});

test("the single session of before tabs becomes a tab, and the work put aside goes to Recently closed", async ({ page }) => {
  await page.goto("/");
  // As an older version of the editor left IndexedDB: no tabs, a session and the work put aside.
  await page.evaluate(
    ([a, b]) =>
      new Promise<void>((resolve) => {
        const req = indexedDB.open("tikzflow", 1);
        req.onsuccess = () => {
          const tx = req.result.transaction("kv", "readwrite");
          const s = tx.objectStore("kv");
          s.delete(IDBKeyRange.bound("doc:", "doc:￿"));
          s.put({ text: a, savedText: a, fileName: "old.tex", encoding: "utf-8", pictureIndex: 0, savedAt: 1 }, "session");
          s.put({ text: b, savedText: "", fileName: null, encoding: "utf-8", pictureIndex: 0, savedAt: 2 }, "previous");
          tx.oncomplete = () => resolve();
        };
      }),
    [A, B],
  );
  await page.evaluate(() => sessionStorage.clear());
  // This page has nothing unsaved, so leaving it writes nothing back.
  await page.reload();
  await expect.poll(() => code(page)).toBe(A);
  await expect(names(page)).toHaveText(["old.tex"]);
  await page.getByTestId("closed-button").click();
  await expect(page.getByTestId("closed-item")).toHaveText(["Previous work"]);
});

test("the TeX engine stops while the browser tab is hidden and starts again when it is shown", async ({ page }) => {
  await page.goto("/");
  const running = () => page.evaluate(() => (window as unknown as { tikzflow: Debug }).tikzflow.preview.engineRunning.value);
  expect(await running()).toBe(true);
  const visibility = (state: "hidden" | "visible") =>
    page.evaluate((state) => {
      Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    }, state);
  await page.evaluate(() => ((window as unknown as { tikzflow: Debug }).tikzflow.preview.engineIdle.hiddenMs = 100));
  await visibility("hidden");
  await expect.poll(running).toBe(false);
  await visibility("visible");
  await expect.poll(running).toBe(true);
});
