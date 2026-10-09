// Checks the built app (dist/) against Cloudflare Pages' limits and against what the app relies on
// (M3 step 14, D75): every file under 25 MiB, fewer than 20,000 files, a _headers file within
// Pages' limits whose rules match files that exist, every file the service worker lists present,
// the engine release the app pins, and no reference to a third-party host in the shipped code
// (the app is client-side only). Run `npm run build` first.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const dist = join(import.meta.dirname, "..", "dist");
if (!existsSync(dist)) {
  console.error("dist/ doesn't exist: run `npm run build` first.");
  process.exit(2);
}

const problems: string[] = [];
const notes: string[] = [];

// Cloudflare Pages: 20,000 files per deployment (free plan), 25 MiB per file, _headers: 100 rules, 2,000 characters per line.
const MAX_FILES = 20_000;
const MAX_BYTES = 25 * 1024 * 1024;

const files: Array<{ path: string; size: number }> = [];
const walk = (dir: string) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else files.push({ path: relative(dist, p).split(sep).join("/"), size: statSync(p).size });
  }
};
walk(dist);

const total = files.reduce((n, f) => n + f.size, 0);
const biggest = files.reduce((a, b) => (b.size > a.size ? b : a));
notes.push(`${files.length} files, ${(total / 1048576).toFixed(1)} MiB; the largest is ${biggest.path} (${(biggest.size / 1048576).toFixed(2)} MiB)`);
if (files.length >= MAX_FILES) problems.push(`${files.length} files: Pages allows fewer than ${MAX_FILES}.`);
for (const f of files) if (f.size >= MAX_BYTES) problems.push(`${f.path} is ${(f.size / 1048576).toFixed(1)} MiB: Pages allows files under 25 MiB.`);

// _headers
const headersPath = join(dist, "_headers");
if (!existsSync(headersPath)) problems.push("dist/_headers is missing (the engine's long cache lives there).");
else {
  const lines = readFileSync(headersPath, "utf8").split(/\r?\n/);
  const rules = lines.filter((l) => l.trim() && !l.startsWith("#") && !/^\s/.test(l));
  if (rules.length > 100) problems.push(`_headers has ${rules.length} rules: Pages allows 100.`);
  for (const l of lines) if (l.length > 2000) problems.push("_headers has a line over 2,000 characters.");
  for (const rule of rules) {
    // A rule is a path pattern; check that it matches at least one built file.
    const re = new RegExp(`^${rule.trim().replace(/^\//, "").replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
    if (!files.some((f) => re.test(f.path))) problems.push(`_headers rule "${rule.trim()}" matches no built file.`);
  }
  notes.push(`_headers: ${rules.length} rule${rules.length === 1 ? "" : "s"}`);
}

// The engine release the app pins must be in the build, with every file its index lists.
const release = JSON.parse(readFileSync(join(import.meta.dirname, "..", "engine", "release.json"), "utf8")) as { tag: string };
const engineIndex = `engine/${release.tag}/index.json`;
if (!files.some((f) => f.path === engineIndex)) problems.push(`${engineIndex} isn't in dist/: run \`npm run fetch-engines -- engine\` before building.`);
else {
  const index = JSON.parse(readFileSync(join(dist, engineIndex), "utf8")) as { texFiles: string[]; fonts: string[] };
  const need = ["tex.wasm.gz", "core.dump.gz", ...index.texFiles.map((n) => `tex_files/${n}.gz`), ...index.fonts.map((n) => `fonts/${n}.json.gz`)];
  const have = new Set(files.map((f) => f.path));
  const missing = need.filter((n) => !have.has(`engine/${release.tag}/${n}`));
  if (missing.length) problems.push(`${missing.length} engine files its index lists are missing from dist/, e.g. ${missing[0]}.`);
  notes.push(`engine ${release.tag}: ${need.length} files listed, ${need.length - missing.length} present`);
}

// The service worker caches what its list names.
const swPath = join(dist, "sw.js");
if (!existsSync(swPath)) problems.push("dist/sw.js is missing: the app wouldn't work offline.");
else {
  const sw = readFileSync(swPath, "utf8");
  const listed = [...sw.matchAll(/"((?:assets\/|index\.html|katex)[^"]*)"/g)].map((m) => m[1]!);
  const gone = listed.filter((n) => !files.some((f) => f.path === n.replace(/^\//, "")));
  if (gone.length) problems.push(`sw.js lists files that aren't in dist/: ${gone.slice(0, 3).join(", ")}.`);
  notes.push(`sw.js lists ${listed.length} app files`);
}

// Client-side only: the shipped code and page must not name a third-party host to fetch from.
const THIRD_PARTY = /https?:\/\/(?!localhost|127\.0\.0\.1|www\.w3\.org|w3\.org|github\.com\/LoganAlexanderBurnett|katex\.org|www\.latex-project\.org|ctan\.org|tug\.org|mirrors\.ctan\.org|developer\.mozilla\.org|tikzflow)[\w.-]+/g;
const external = new Map<string, Set<string>>();
for (const f of files) {
  if (!/\.(html|js|css|webmanifest)$/.test(f.path) || f.path.startsWith("engine/")) continue;
  const text = readFileSync(join(dist, f.path), "utf8");
  for (const m of text.matchAll(THIRD_PARTY)) {
    if (!external.has(m[0])) external.set(m[0], new Set());
    external.get(m[0])!.add(f.path);
  }
}
if (external.size) notes.push(`URLs in the shipped code (check that none is fetched at run time): ${[...external.keys()].slice(0, 12).join(", ")}${external.size > 12 ? ", …" : ""}`);

for (const n of notes) console.log(n);
if (problems.length) {
  for (const p of problems) console.error(`PROBLEM: ${p}`);
  process.exit(1);
}
console.log("dist/ is within Cloudflare Pages' limits and complete.");
