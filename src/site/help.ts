// The help pages (M5 step 7, D99): static HTML generated from src/help/*.md, with the theme switch,
// the service worker (so they work offline after a visit), and search. The search index and
// MiniSearch are loaded on the first focus of the search box, from this site like everything else.
import "../theme/theme.css";
import "./site.css";
import "./help.css";
import { bindThemeButton } from "../theme/theme.ts";
import { registerServiceWorker } from "../ui/offline.ts";
import indexUrl from "../help/search-index.json?url";
import { SEARCH_OPTIONS } from "./helpsearch.ts";

for (const b of document.querySelectorAll<HTMLElement>("[data-theme-switch]")) bindThemeButton(b);
registerServiceWorker();

interface Hit {
  id: string;
  title: string;
  section: string;
  url: string;
  excerpt: string;
}

type Search = (q: string) => Hit[];
let loading: Promise<Search> | null = null;

/** MiniSearch and the index, once. The options are the ones the index was built with (scripts/lib/help.ts). */
function searcher(): Promise<Search> {
  loading ??= Promise.all([import("minisearch"), fetch(indexUrl).then((r) => r.text())]).then(([{ default: MiniSearch }, json]) => {
    const ms = MiniSearch.loadJSON(json, SEARCH_OPTIONS);
    return (q: string) => ms.search(q).slice(0, 8) as unknown as Hit[];
  });
  return loading;
}

const form = document.querySelector<HTMLFormElement>("[data-help-search]");
const input = form?.querySelector<HTMLInputElement>("input");
const list = form?.querySelector<HTMLUListElement>("[data-help-results]");
const count = form?.querySelector<HTMLElement>("[data-help-count]");

if (form && input && list && count) {
  let seq = 0;
  const show = async () => {
    const q = input.value.trim();
    const mine = ++seq;
    if (!q) {
      list.hidden = true;
      list.replaceChildren();
      count.textContent = "";
      return;
    }
    const hits = (await searcher())(q);
    if (mine !== seq) return;
    list.replaceChildren(
      ...hits.map((h) => {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = h.url;
        const t = document.createElement("strong");
        t.textContent = h.section ? `${h.title}: ${h.section}` : h.title;
        const p = document.createElement("span");
        p.textContent = h.excerpt;
        a.append(t, p);
        li.append(a);
        return li;
      }),
    );
    list.hidden = false;
    count.textContent = hits.length ? `${hits.length} ${hits.length === 1 ? "result" : "results"}` : "Nothing found. Try another word.";
  };
  input.addEventListener("focus", () => void searcher());
  input.addEventListener("input", () => void show());
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const first = list.querySelector("a");
    if (first) location.href = first.href;
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      list.querySelector("a")?.focus();
    } else if (e.key === "Escape") {
      input.value = "";
      void show();
    }
  });
  list.addEventListener("keydown", (e) => {
    const links = [...list.querySelectorAll("a")];
    const i = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (e.key === "ArrowDown" && i < links.length - 1) {
      e.preventDefault();
      links[i + 1]!.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      (i > 0 ? links[i - 1]! : input).focus();
    }
  });
  // "/" anywhere outside a field goes to the search box.
  document.addEventListener("keydown", (e) => {
    const t = e.target as Element | null;
    if (e.key === "/" && !t?.closest("input, textarea, select, [contenteditable]")) {
      e.preventDefault();
      input.focus();
    }
  });
}
