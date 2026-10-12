// The help search's MiniSearch options (D99): the index is built with them (scripts/lib/help.ts) and
// the help pages load it with them (help.ts). No imports, so both can use it.
export const SEARCH_OPTIONS = {
  fields: ["title", "section", "text"],
  storeFields: ["title", "section", "url", "excerpt"],
  searchOptions: { boost: { title: 3, section: 2 }, prefix: true, fuzzy: 0.2 },
};
