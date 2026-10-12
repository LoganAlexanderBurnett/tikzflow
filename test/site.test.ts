// The site around the editor (D92): which kept page answers an address offline. The committed
// pictures are checked in templates.test.ts (D95).
import { describe, expect, it } from "vitest";
import { pageFor } from "../src/sw/pages.ts";

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
