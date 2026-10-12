// Tabs (M5 step 6, D97): the decisions that need no browser. Which tab a window starts on, and what a
// journal left by a page that closed before its last save comes to on the next start.
import { describe, expect, it } from "vitest";
import { copyTitle, type DocRecord, journalAction, startTab, tabName, worthKeeping } from "../src/ui/docs.ts";
import { templateText } from "../src/templates/index.ts";

const doc = (id: string, over: Partial<DocRecord> = {}): DocRecord => ({
  id,
  title: "Untitled",
  text: `% ${id}\n`,
  savedText: "",
  fileName: null,
  encoding: "utf-8",
  pictureIndex: 0,
  created: 0,
  rev: 1,
  savedAt: 0,
  ...over,
});

describe("journalAction", () => {
  const stored = doc("a", { rev: 4, text: "old" });
  it("stores the journal when its write never landed", () => {
    expect(journalAction({ rec: doc("a", { text: "new" }), baseRev: 4 }, stored)).toBe("apply");
  });
  it("stores it when there is no record at all (never stored, or closed without locks)", () => {
    expect(journalAction({ rec: doc("a", { text: "new" }), baseRev: null }, undefined)).toBe("apply");
    expect(journalAction({ rec: doc("a", { text: "new" }), baseRev: 2 }, undefined)).toBe("apply");
  });
  it("drops it when the record already has it", () => {
    expect(journalAction({ rec: doc("a", { text: "old" }), baseRev: 3 }, stored)).toBe("drop");
  });
  it("keeps it as a copy when the record changed since, differently", () => {
    expect(journalAction({ rec: doc("a", { text: "mine" }), baseRev: 3 }, stored)).toBe("copy");
  });
  it("a change of file name or saved state alone is a change too", () => {
    expect(journalAction({ rec: doc("a", { text: "old", fileName: "x.tex" }), baseRev: 4 }, stored)).toBe("apply");
    expect(journalAction({ rec: doc("a", { text: "old", savedText: "old" }), baseRev: 3 }, stored)).toBe("copy");
  });
});

describe("startTab", () => {
  const docs = [doc("a", { savedAt: 10 }), doc("b", { savedAt: 30 }), doc("c", { savedAt: 20 })];
  it("takes the tab the window showed before a reload", () => {
    expect(startTab(docs, "c", new Set())).toBe("c");
  });
  it("else the most recently edited one", () => {
    expect(startTab(docs, null, new Set())).toBe("b");
    expect(startTab(docs, "gone", new Set())).toBe("b");
  });
  it("never one another window has open", () => {
    expect(startTab(docs, "b", new Set(["b"]))).toBe("c");
    expect(startTab(docs, null, new Set(["b", "c"]))).toBe("a");
  });
  it("none when every tab is open elsewhere, or there are none: a new empty tab", () => {
    expect(startTab(docs, null, new Set(["a", "b", "c"]))).toBeNull();
    expect(startTab([], "a", new Set())).toBeNull();
  });
});

describe("names", () => {
  it("a tab is called by its file, else its title", () => {
    expect(tabName({ fileName: "paper.tex", title: "Pasted diagram" })).toBe("paper.tex");
    expect(tabName({ fileName: null, title: "Hierarchy" })).toBe("Hierarchy");
  });
  it("copies say what they are", () => {
    expect(copyTitle("paper.tex", "conflict")).toBe("paper (your copy)");
    expect(copyTitle("Hierarchy", "recovered")).toBe("Hierarchy (recovered)");
  });
});

describe("worthKeeping", () => {
  it("empty text and untouched templates aren't kept when closed", () => {
    expect(worthKeeping("  \n")).toBe(false);
    expect(worthKeeping(templateText("hierarchy")!)).toBe(false);
    expect(worthKeeping(`% mine\n${templateText("hierarchy")!}`)).toBe(true);
  });
});
