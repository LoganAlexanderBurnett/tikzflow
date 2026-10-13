// Golden tests for placement links (M6 step 1, D104), on every corpus picture
// and every template: the first draggable node that others are placed against
// is moved on its own (its followers re-attached where they are, as a drag
// does by default), and the same node is detached. In both, every node but the
// dragged one stays exactly where it was (half a point), and the result is
// compared with a golden file. A refusal is a golden result too: its reason.
// Regenerate with UPDATE_GOLDEN=1 npx vitest run test/golden-links.test.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { applyChanges } from "../src/edit/changes.ts";
import { annotationsOf, followsByDesign, keepInPlace, placementLinks, planDetach } from "../src/edit/links.ts";
import { planMove } from "../src/edit/move.ts";
import { analyzeDocument, layoutDocumentPicture } from "../src/model/document.ts";
import { encode, type Encoding } from "../src/source/encoding.ts";
import { TEMPLATES } from "../src/templates/catalog.ts";
import { templateText } from "../src/templates/index.ts";
import type { LaidOutNode, PictureLayout } from "../src/tikz/layout.ts";
import { CM } from "../src/tikz/units.ts";
import { corpusNames, loadCorpusFile } from "./corpus.ts";

const goldenDir = join(import.meta.dirname, "fixtures", "golden", "links");
const update = process.env.UPDATE_GOLDEN === "1";

interface Source {
  name: string;
  text: string;
  encoding: Encoding;
  /** The file, from the repository's root. */
  path: string;
}

const sources: Source[] = [
  ...corpusNames().map((n) => {
    const f = loadCorpusFile(n);
    return { name: n.replace(/\.tex$/, ""), text: f.text, encoding: f.encoding, path: `corpus/${n}` };
  }),
  ...TEMPLATES.map((t) => ({ name: `template-${t.id}`, text: templateText(t.id)!, encoding: "utf-8" as Encoding, path: `src/templates/${t.id}.tex` })),
];

/**
 * One rewritten picture, for the fidelity check (`npm run fidelity`): TeX compiles the source and
 * the golden file, and every node but `moved` must be where TeX put it before.
 */
interface Case {
  file: string;
  source: string;
  picture: number;
  /** The names of the nodes that moved: the dragged one and its annotations (none for Detach). */
  moved: string[];
}
const manifest: Case[] = [];

/**
 * The nodes each picture tests: "first", the first that can be dragged and has others placed against
 * it (often the picture's first node, so its followers have nothing earlier to hold on to); and
 * "middle", the first that is itself placed against another node too (its followers are re-attached
 * to that one first), when it is a different node.
 */
function subjects(text: string, layout: PictureLayout): Array<{ label: string; node: LaidOutNode }> {
  const ok = (n: LaidOutNode) => n.kind === "statement" && !n.locked && n.position.kind !== "fit" && placementLinks(text, layout, n).followers.length > 0;
  const first = layout.nodes.find(ok);
  const middle = layout.nodes.find((n) => ok(n) && placementLinks(text, layout, n).follows.length > 0);
  return [...(first ? [{ label: "first", node: first }] : []), ...(middle && middle !== first ? [{ label: "middle", node: middle }] : [])];
}

/** Every node but those in `except` (the dragged node and its annotations) is where it was; boxes, the coordinates lanes share and nodes on paths follow as always. `ids`: nodes renamed when a chain was written out. */
function expectStill(beforeText: string, before: PictureLayout, text: string, pic: number, except: readonly string[], ids: ReadonlyMap<string, string>) {
  const after = layoutDocumentPicture(analyzeDocument(text), pic)!;
  const design = followsByDesign(beforeText, before);
  for (const n of before.nodes) {
    if (n.kind === "path" || n.lock?.kind === "path" || except.includes(n.id) || design.has(n.id)) continue;
    const m = after.nodes.find((x) => x.id === (ids.get(n.id) ?? n.id));
    expect(m, `${n.id} lost`).toBeDefined();
    expect(Math.hypot(m!.shape.center.x - n.shape.center.x, m!.shape.center.y - n.shape.center.y), `${n.id} moved`).toBeLessThan(0.5);
  }
}

function golden(file: string, src: Source, result: string, isText: boolean) {
  const path = join(goldenDir, file);
  const bytes = Buffer.from(isText ? encode(result, src.encoding) : new TextEncoder().encode(result));
  if (update || !existsSync(path)) {
    if (!update) throw new Error(`missing golden file ${path}; run with UPDATE_GOLDEN=1`);
    mkdirSync(goldenDir, { recursive: true });
    writeFileSync(path, bytes);
  }
  expect(bytes.equals(readFileSync(path)), `differs from ${path}`).toBe(true);
}

// The list of rewritten pictures, in a fixed order, for `npm run fidelity` (D107). Checked like a
// golden file, once every case has run (a run filtered to some tests leaves it alone).
afterAll(() => {
  if (ran !== planned) return;
  const cases = [...manifest].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  const path = join(goldenDir, "cases.json");
  const text = `${JSON.stringify(cases, null, 1)}\n`;
  if (update || !existsSync(path)) {
    if (!update) throw new Error(`missing ${path}; run with UPDATE_GOLDEN=1`);
    writeFileSync(path, text);
  }
  expect(text, `differs from ${path}`).toBe(readFileSync(path, "utf8"));
});
/** Cases collected, and cases that ran to the end. */
let planned = 0;
let ran = 0;

describe.each(sources.map((s) => [s.name, s] as const))("%s", (_, src) => {
  const doc = analyzeDocument(src.text);
  const cases: Array<[string, number, string, string]> = [];
  doc.syntax.pictures.forEach((__, pic) => {
    const layout = layoutDocumentPicture(doc, pic)!;
    for (const { label, node } of subjects(src.text, layout)) cases.push([`picture ${pic}: ${label} ${node.id}`, pic, node.id, label]);
    planned += 2 * subjects(src.text, layout).length;
  });
  if (!cases.length) {
    it("has no node with followers", () => expect(true).toBe(true));
    return;
  }

  it.each(cases)("%s moved alone", (__, pic, id, label) => {
    ran++;
    const layout = layoutDocumentPicture(doc, pic)!;
    const n = layout.nodes.find((x) => x.id === id)!;
    const move = planMove(src.text, pic, id, { x: n.shape.center.x + CM, y: n.shape.center.y + 0.5 * CM });
    if (!move) throw new Error("the move itself couldn't be written");
    // As a drag does: the node's annotations (labels hanging off it alone) move with it (D107).
    const labels = annotationsOf(src.text, layout, [id], followsByDesign(src.text, layout));
    const k = keepInPlace(move.text, pic, layout, new Set([id, ...labels]), new Set(n.position.refs));
    if (!k.ok) {
      golden(`${src.name}.${pic}.${label}.alone.refused.txt`, src, `${k.reason}\n`, false);
      return;
    }
    expect(applyChanges(move.text, k.changes)).toBe(k.text);
    expectStill(src.text, layout, k.text, pic, [id, ...labels], k.ids);
    golden(`${src.name}.${pic}.${label}.alone.tex`, src, k.text, true);
    const names = [n, ...labels.map((x) => layout.nodes.find((m) => m.id === x)!)].flatMap((m) => m.name ?? []);
    manifest.push({ file: `${src.name}.${pic}.${label}.alone.tex`, source: src.path, picture: pic, moved: names });
  });

  it.each(cases)("%s detached", (__, pic, id, label) => {
    ran++;
    const layout = layoutDocumentPicture(doc, pic)!;
    const r = planDetach(src.text, pic, [id]);
    if (!r.ok) {
      golden(`${src.name}.${pic}.${label}.detach.refused.txt`, src, `${r.reason}\n`, false);
      return;
    }
    expect(applyChanges(src.text, r.changes)).toBe(r.text);
    expectStill(src.text, layout, r.text, pic, [], r.ids);
    const after = layoutDocumentPicture(analyzeDocument(r.text), pic)!;
    const links = placementLinks(r.text, after, after.nodes.find((x) => x.id === (r.ids.get(id) ?? id))!);
    expect(links, "still linked after Detach").toEqual({ follows: [], followers: [] });
    golden(`${src.name}.${pic}.${label}.detach.tex`, src, r.text, true);
    manifest.push({ file: `${src.name}.${pic}.${label}.detach.tex`, source: src.path, picture: pic, moved: [] });
  });
});
