// SPDX-License-Identifier: GPL-3.0-or-later
// Which kept page answers an address when the network doesn't (D92). Pure, so tests can import it;
// vite.config.ts puts this file in front of sw.ts when it builds dist/sw.js.

/**
 * The kept page for an address: the page itself (`editor`, `editor/` and `editor/index.html` are
 * `editor/`), else the page whose folder holds it, else the home page (`./`).
 */
export function pageFor(pathname: string, basePath: string, pages: readonly string[]): string {
  let rel = pathname.startsWith(basePath) ? pathname.slice(basePath.length) : "";
  rel = rel.replace(/index\.html$/, "");
  if (rel && !rel.endsWith("/")) rel += "/";
  const folders = pages.filter((p) => p !== "./").sort((a, b) => b.length - a.length);
  return folders.find((p) => rel.startsWith(p)) ?? "./";
}
