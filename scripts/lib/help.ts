// The help site (M5 step 7, D89 item 6, D99): static pages generated from the Markdown in src/help/,
// committed like the site's pictures (D94) so a build without this script, or a fresh clone, has
// them, and their changes show in review. `npm run help:build` writes them; test/help.test.ts fails
// when they are stale. Search is MiniSearch over an index built here, loaded by the page on first use.
//
// What it writes: help/index.html and help/<slug>/index.html (Vite builds them as pages of the
// site), src/help/search-index.json, and public/sitemap.xml.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Marked, type Tokens } from "marked";
import MiniSearch from "minisearch";
import { SEARCH_OPTIONS } from "../../src/site/helpsearch.ts";
import { SHORTCUT_SECTIONS } from "../../src/ui/shortcutlist.ts";

const root = join(import.meta.dirname, "..", "..");
const SITE = "https://tikzflow.pages.dev";

export interface HelpPage {
  slug: string;
  title: string;
  description: string;
  order: number;
  /** The Markdown after the front matter. */
  body: string;
}

/** The search index's options, shared with the page that loads it. */
export { SEARCH_OPTIONS };

/** Reads src/help/*.md: front matter (title, description, order), then Markdown. `index.md` is /help/. */
export function readPages(dir = join(root, "src", "help")): HelpPage[] {
  const pages: HelpPage[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
    const raw = readFileSync(join(dir, file), "utf8").replace(/\r\n/g, "\n");
    const m = /^---\n([\s\S]*?)\n---\n/.exec(raw);
    if (!m) throw new Error(`${file}: no front matter`);
    const meta = Object.fromEntries(m[1]!.split("\n").map((l) => [l.slice(0, l.indexOf(":")).trim(), l.slice(l.indexOf(":") + 1).trim()]));
    if (!meta.title || !meta.description || !meta.order) throw new Error(`${file}: front matter needs title, description and order`);
    pages.push({ slug: file === "index.md" ? "" : file.slice(0, -3), title: meta.title, description: meta.description, order: Number(meta.order), body: raw.slice(m[0].length) });
  }
  return pages.sort((a, b) => a.order - b.order);
}

/** A heading's id: lower case, words joined by hyphens. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z]+;/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const url = (slug: string) => (slug ? `/help/${slug}/` : "/help/");

/** A PNG's size, from its header. */
function pngSize(path: string): { w: number; h: number } {
  const b = readFileSync(path);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

/** The shortcut list as a table, from the same data as the editor's `?` dialog (Ctrl is Cmd on a Mac). */
function shortcutsHtml(): string {
  const mouse = new Set(["click", "drag", "Right-drag", "Middle-drag", "Wheel", "Right-click", "Double-click", "Middle-click"]);
  const key = (k: string) => (mouse.has(k) ? `<span class="act">${esc(k)}</span>` : `<kbd>${esc(k === "Mod" ? "Ctrl" : k)}</kbd>`);
  return SHORTCUT_SECTIONS.map(
    (s) =>
      `<h2 id="${slugify(s.title)}">${esc(s.title)}</h2>\n` +
      (s.note ? `<p>${esc(s.note)}</p>\n` : "") +
      `<table class="keys">\n<tbody>\n` +
      s.rows.map(([combos, what]) => `<tr><td>${combos.map((c) => c.map(key).join(" + ")).join(" <span class=\"or\">or</span> ")}</td><td>${esc(what.replace("this list", "the shortcut list"))}</td></tr>`).join("\n") +
      `\n</tbody>\n</table>`,
  ).join("\n");
}

interface Rendered {
  html: string;
  /** The page's sections for search: the text before the first h2, then each h2's. */
  sections: Array<{ id: string; title: string; text: string }>;
}

/** Renders one page's Markdown: heading ids, links between pages, screenshots with their size. */
function render(page: HelpPage, pages: HelpPage[]): Rendered {
  const depth = page.slug ? "../../" : "../";
  const known = new Set(pages.map((p) => p.slug));
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading({ tokens, depth: level }: Tokens.Heading) {
        const inner = this.parser.parseInline(tokens);
        const id = slugify(inner);
        return level === 1 ? `<h1>${inner}</h1>\n` : `<h${level} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>${inner}</h${level}>\n`;
      },
      link({ href, title, tokens }: Tokens.Link) {
        const inner = this.parser.parseInline(tokens);
        let to = href;
        const m = /^([a-z0-9-]+)\.md(#.*)?$/.exec(href);
        if (m) {
          const slug = m[1] === "index" ? "" : m[1]!;
          if (!known.has(slug)) throw new Error(`${page.slug || "index"}: a link to ${href}, which isn't a page`);
          to = url(slug) + (m[2] ?? "");
        }
        const external = /^https?:/.test(to);
        return `<a href="${esc(to)}"${title ? ` title="${esc(title)}"` : ""}${external ? ' rel="noopener noreferrer"' : ""}>${inner}</a>`;
      },
      image({ href, text }: Tokens.Image) {
        const m = /^shots\/([a-z0-9-]+\.png)$/.exec(href);
        if (!m) throw new Error(`${page.slug || "index"}: images must be shots/<name>.png, not ${href}`);
        const { w, h } = pngSize(join(root, "src", "help", "shots", m[1]!));
        // Screenshots are taken at twice the size they are shown.
        return `<figure><img src="${depth}src/help/shots/${m[1]}" alt="${esc(text)}" width="${Math.round(w / 2)}" height="${Math.round(h / 2)}" loading="lazy" /><figcaption>${esc(text)}</figcaption></figure>`;
      },
    },
  });
  const body = page.body.replace("<!-- shortcuts -->", () => shortcutsHtml());
  const html = marked.parse(body, { async: false });
  // The sections, from the rendered HTML: text between h2s, tags taken out.
  const sections: Rendered["sections"] = [];
  const parts = html.split(/<h2 id="([^"]+)">(?:<a[^>]*>#<\/a>)?([\s\S]*?)<\/h2>/);
  // Block ends become spaces; inline tags (strong, code, kbd) go without one, so "**Recently closed**:" stays together.
  const text = (s: string) => s.replace(/<\/(p|li|h\d|td|th|tr|pre|blockquote|figcaption)>|<br ?\/?>/g, " ").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
  sections.push({ id: "", title: "", text: text(parts[0]!.replace(/<h1>[\s\S]*?<\/h1>/, "")) });
  for (let i = 1; i < parts.length; i += 3) sections.push({ id: parts[i]!, title: text(parts[i + 1]!), text: text(parts[i + 2] ?? "") });
  return { html, sections };
}

const LOGO = `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="3" width="13" height="10" rx="2" fill="var(--logo-ink)" /><path d="M9.5 13V24H12.5" fill="none" stroke="var(--logo-ink)" stroke-width="2.4" /><path d="M11.5 20.3L16.2 24L11.5 27.7Z" fill="var(--logo-ink)" /><rect x="17.2" y="19.2" width="11.6" height="9.6" rx="2" fill="none" stroke="var(--logo-accent)" stroke-width="2.4" /></svg>`;

/** A whole page: the site's header, the search box, the list of topics, the article, and the footer. */
function pageHtml(page: HelpPage, pages: HelpPage[], content: string): string {
  const depth = page.slug ? "../../" : "../";
  const i = pages.indexOf(page);
  const prev = pages[i - 1];
  const next = pages[i + 1];
  const title = page.slug ? `${page.title} · TikZFlow help` : "TikZFlow help";
  const toc = pages.map((p) => `<li><a href="${url(p.slug)}"${p === page ? ' aria-current="page"' : ""}>${esc(p.title)}</a></li>`).join("\n          ");
  return `<!doctype html>
<!-- Generated from src/help/${page.slug || "index"}.md by npm run help:build (D99). Edit the Markdown, not this file. -->
<html lang="en" data-page="help">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(page.description)}" />
    <link rel="canonical" href="${SITE}${url(page.slug)}" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <script src="/boot.js"></script>
    <script type="module" src="${depth}src/site/help.ts"></script>
  </head>
  <body>
    <a class="skip" href="#main">Skip to content</a>
    <header class="site-head">
      <a class="brand" href="/" aria-label="TikZFlow home">
        ${LOGO}
        <span class="wordmark">TikZ<em>Flow</em></span>
      </a>
      <nav class="site-nav" aria-label="Site">
        <a href="/#templates">Templates</a>
        <a href="/help/"${page.slug ? "" : ' aria-current="page"'}>Help</a>
        <a href="https://github.com/LoganAlexanderBurnett/tikzflow" rel="noopener noreferrer">Source code</a>
      </nav>
      <div class="head-actions">
        <button class="icon-btn" type="button" data-theme-switch aria-label="Theme: system">
          <svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21a9 9 0 1 0 0-18v18Z" /><circle cx="12" cy="12" r="9" fill="none" /></svg>
        </button>
        <a class="btn primary" href="/editor/">Open the editor</a>
      </div>
    </header>
    <div class="help">
      <aside class="help-side">
        <form class="help-search" role="search" data-help-search>
          <label for="help-q">Search the help</label>
          <input id="help-q" type="search" name="q" placeholder="Search the help" autocomplete="off" aria-controls="help-results" />
          <p class="help-count" aria-live="polite" data-help-count></p>
          <ul id="help-results" class="help-results" data-help-results hidden></ul>
        </form>
        <nav class="help-toc" aria-label="Help topics">
          <ul>
          ${toc}
          </ul>
        </nav>
      </aside>
      <main id="main" class="help-main">
        <article class="help-article">
${content.trim().replace(/^/gm, "          ")}
        </article>
        <nav class="help-pager" aria-label="Next and previous topics">
          ${prev ? `<a class="prev" href="${url(prev.slug)}"><span>Previous</span>${esc(prev.title)}</a>` : "<span></span>"}
          ${next ? `<a class="next" href="${url(next.slug)}"><span>Next</span>${esc(next.title)}</a>` : "<span></span>"}
        </nav>
      </main>
    </div>
    <footer class="site-foot">
      <a class="brand small" href="/" aria-label="TikZFlow home">
        ${LOGO}
        <span class="wordmark">TikZ<em>Flow</em></span>
      </a>
      <nav class="foot-links" aria-label="More">
        <a href="/editor/">Editor</a>
        <a href="/help/">Help</a>
        <a href="https://github.com/LoganAlexanderBurnett/tikzflow/issues/new?template=problem.yml" rel="noopener noreferrer">Report a problem</a>
        <a href="https://github.com/LoganAlexanderBurnett/tikzflow" rel="noopener noreferrer">Source code</a>
        <span>GPL-3.0-or-later</span>
      </nav>
    </footer>
  </body>
</html>
`;
}

/** Every file the help site is made of, by path from the repository's root, with its content. */
export function buildHelp(pages = readPages()): Map<string, string> {
  const out = new Map<string, string>();
  const search = new MiniSearch<{ id: string; title: string; section: string; url: string; excerpt: string; text: string }>(SEARCH_OPTIONS);
  for (const page of pages) {
    const { html, sections } = render(page, pages);
    out.set(page.slug ? `help/${page.slug}/index.html` : "help/index.html", pageHtml(page, pages, html));
    for (const s of sections) {
      if (!s.text && !s.title) continue;
      const excerpt = s.text.length > 160 ? `${s.text.slice(0, 157).replace(/\s+\S*$/, "")}…` : s.text;
      search.add({ id: `${page.slug}#${s.id}`, title: page.title, section: s.title, url: url(page.slug) + (s.id ? `#${s.id}` : ""), excerpt, text: s.text });
    }
  }
  out.set("src/help/search-index.json", `${JSON.stringify(search)}\n`);
  const urls = ["/", "/editor/", ...pages.map((p) => url(p.slug))];
  out.set("public/sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${SITE}${u}</loc></url>`).join("\n")}\n</urlset>\n`);
  return out;
}
