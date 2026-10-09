// A new node must never land on an existing node, however many are added
// beside the same one (found on the owner's research figure: Enter pressed
// repeatedly gave seven copies of `right=6mm of latent`).
import { describe, expect, it } from "vitest";
import { applyChanges } from "../src/edit/changes.ts";
import { defaultEntry, paletteEntries, planCreate, type Placement } from "../src/edit/create.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import { SAMPLE } from "../src/ui/sample.ts";
import { loadCorpusFile } from "./corpus.ts";

/** Pairs of nodes whose centres coincide. */
function stacked(text: string, pic = 0): string[] {
  const l = layoutDocumentPicture(analyzeDocument(text), pic)!;
  const out: string[] = [];
  const nodes = l.nodes.filter((n) => n.kind === "statement" && !n.lock);
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      if (Math.abs(a.shape.center.x - b.shape.center.x) < 0.5 && Math.abs(a.shape.center.y - b.shape.center.y) < 0.5) out.push(`${a.name ?? a.id} / ${b.name ?? b.id}`);
    }
  }
  return out;
}

function add(text: string, kind: "sibling" | "child", of: string): { text: string; written: string } | { reason: string } {
  const doc = analyzeDocument(text);
  const l = layoutDocumentPicture(doc, 0)!;
  const entry = defaultEntry(paletteEntries(doc, doc.syntax.pictures[0]!, l), doc, doc.syntax.pictures[0]!, l);
  const parent = l.nodes.find((n) => n.name === of)!;
  const placement: Placement = { kind, of: parent.id };
  const r = planCreate(text, 0, { entry, label: "Added", placement });
  return r.ok ? { text: applyChanges(text, r.changes), written: r.written } : { reason: r.reason };
}

function press(text: string, kind: "sibling" | "child", of: string, times: number): { stacked: string[]; written: string[]; refused: string | null } {
  const before = stacked(text);
  const written: string[] = [];
  for (let i = 0; i < times; i++) {
    const r = add(text, kind, of);
    if ("reason" in r) return { stacked: [], written, refused: r.reason };
    text = r.text;
    written.push(r.written);
    const now = stacked(text);
    if (now.length > before.length) return { stacked: now, written, refused: null };
  }
  return { stacked: [], written, refused: null };
}

describe("new nodes never land on existing ones", () => {
  for (const name of ["spatial", "latent", "temporal"]) {
    for (const kind of ["sibling", "child"] as const) {
      it(`${kind} of ${name} in the research figure, pressed ten times`, () => {
        const r = press(loadCorpusFile("self-hybrid-surrogate.tex").text, kind, name, 10);
        expect(r.stacked, r.written.join("\n")).toEqual([]);
        expect(r.refused, r.written.join("\n")).toBeNull();
      });
    }
  }

  it("a sibling in the sample, pressed ten times", () => {
    const r = press(SAMPLE, "sibling", "rec", 10);
    expect(r.stacked, r.written.join("\n")).toEqual([]);
    expect(r.refused, r.written.join("\n")).toBeNull();
  });
});
