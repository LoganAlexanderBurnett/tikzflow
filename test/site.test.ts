// The site around the editor (D92): which kept page answers an address offline, and the committed
// pictures are what the engine draws now (regenerate with npm run site:assets).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { engine, haveEngine } from "../scripts/lib/compile.ts";
import { pageFor } from "../src/sw/pages.ts";
import { SAMPLE } from "../src/ui/sample.ts";

describe("the service worker's page for an address", () => {
  const pages = ["./", "editor/", "help/", "help/edges/"];
  it.each([
    ["/", "./"],
    ["/index.html", "./"],
    ["/editor/", "editor/"],
    ["/editor", "editor/"],
    ["/editor/index.html", "editor/"],
    ["/help/edges/", "help/edges/"],
    ["/help/edges", "help/edges/"],
    ["/help/styles/", "help/"],
    ["/no-such-page/", "./"],
    ["/editorial/", "./"],
  ])("%s is answered by %s", (path, page) => {
    expect(pageFor(path, "/", pages)).toBe(page);
  });
  it("follows a site that isn't at the root", () => {
    expect(pageFor("/tf/editor/", "/tf/", ["./", "editor/"])).toBe("editor/");
    expect(pageFor("/other/", "/tf/", ["./", "editor/"])).toBe("./");
  });
});

describe.skipIf(!haveEngine())("the site's committed pictures", () => {
  it("src/site/assets/sample.svg is the sample as the engine draws it now", async () => {
    const tex = await engine();
    const r = await tex.compile(SAMPLE);
    expect(r.errors).toEqual([]);
    expect(readFileSync(join(import.meta.dirname, "..", "src", "site", "assets", "sample.svg"), "utf8"), "run npm run site:assets").toBe(r.svg);
  }, 60_000);
});
