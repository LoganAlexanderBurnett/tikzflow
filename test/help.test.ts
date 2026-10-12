// The help site (M5 step 7, D99): the committed pages are what src/help/*.md makes now (run
// npm run help:build), every link and picture leads somewhere, the search finds what people look
// for, the text is in American English, and the page about saving says what the owner asked (D98).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import MiniSearch from "minisearch";
import { describe, expect, it } from "vitest";
import { buildHelp, readPages, SEARCH_OPTIONS } from "../scripts/lib/help.ts";

const root = join(import.meta.dirname, "..");
const built = buildHelp();
const pages = [...built].filter(([p]) => p.endsWith(".html"));

describe("the help site", () => {
  it.each([...built.keys()])("%s is current (npm run help:build)", (path) => {
    expect(existsSync(join(root, path)), path).toBe(true);
    expect(readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n")).toBe(built.get(path));
  });

  it("every page is a build input and in the sitemap", () => {
    const sitemap = built.get("public/sitemap.xml")!;
    for (const [path] of pages) expect(sitemap).toContain(`https://tikzflow.pages.dev/${path.replace(/index\.html$/, "")}`);
    expect(pages.length).toBe(readPages().length);
  });

  it("every link inside the site leads to a page, and every #anchor to a heading on it", () => {
    const ids = new Map(pages.map(([p, html]) => [`/${p.replace(/index\.html$/, "")}`, new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]!))]));
    const site = new Set(["/", "/editor/", ...ids.keys()]);
    for (const [path, html] of pages) {
      for (const [, href] of html.matchAll(/ href="([^"]+)"/g)) {
        if (/^(https?:|mailto:)/.test(href!) || /\.(svg|png)$/.test(href!)) continue;
        const [to, anchor] = href!.startsWith("#") ? [`/${path.replace(/index\.html$/, "")}`, href!.slice(1)] : href!.split("#");
        expect(site.has(to!), `${path}: ${href}`).toBe(true);
        if (anchor && to !== "/") expect(ids.get(to!)?.has(anchor), `${path}: ${href}`).toBe(true);
      }
    }
  });

  it("every screenshot exists and is used", () => {
    const used = new Set<string>();
    for (const [path, html] of pages) {
      for (const [, src] of html.matchAll(/<img src="([^"]+)"/g)) {
        const file = join(root, path, "..", src!);
        expect(existsSync(file), `${path}: ${src}`).toBe(true);
        used.add(src!.split("/").pop()!);
      }
    }
    expect([...used].sort()).toEqual(["edge-menu.png", "editor.png", "export.png", "layout.png", "properties.png", "read-only.png", "recently-closed.png", "start.png"]);
  });

  it("is written in American English (D86 item 4)", () => {
    for (const p of readPages()) expect(p.body, p.slug).not.toMatch(/\b(colour|grey|centre|behaviour|favourite|organis|recognis|millimetre|licence)/i);
  });

  it("finds the topics people search for", () => {
    const search = MiniSearch.loadJSON<{ url: string }>(built.get("src/help/search-index.json")!, SEARCH_OPTIONS);
    const first = (q: string) => (search.search(q)[0] as unknown as { url: string }).url;
    expect(first("recently closed")).toMatch(/^\/help\/saving\//);
    expect(first("read-only window")).toMatch(/^\/help\/saving\//);
    expect(first("export pdf")).toMatch(/^\/help\/export\//);
    expect(first("swimlane")).toMatch(/^\/help\/layout\//);
    expect(first("mermaid")).toMatch(/^\/help\/import\//);
    expect(first("undo")).toBeDefined();
  });

  it("the saving page says what the owner asked for (D98 item 3)", () => {
    const saving = readPages().find((p) => p.slug === "saving")!.body;
    expect(saving).toMatch(/in this browser's storage on this computer/);
    expect(saving).toMatch(/Clearing this site's data/);
    expect(saving).toMatch(/Another browser, another computer/);
    expect(saving).toMatch(/Save important diagrams as files/);
    expect(saving).toMatch(/## Recently closed/);
    expect(saving).toMatch(/last \*\*20\*\* tabs/);
    expect(saving).toMatch(/\*\*read-only\*\*/);
    expect(saving).toMatch(/\*\*Edit here\*\*/);
    // And the help's front page says it first.
    expect(readPages().find((p) => p.slug === "")!.body).toMatch(/Your work is kept in this browser only/);
  });
});
