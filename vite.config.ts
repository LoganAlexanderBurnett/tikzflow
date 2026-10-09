import { cpSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { gzipSync } from "node:zlib";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const vendorRoot = join(import.meta.dirname, "vendor");

const TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".wasm": "application/wasm",
  ".css": "text/css",
  ".json": "application/json",
};

/** File name → path for everything in the CTAN tree (vendor/texmf), first match wins. */
let texmfIndexCache: Map<string, string> | null = null;
let texmfIndexBuiltAt = 0;
function texmfLookup(name: string): string | undefined {
  const build = () => {
    const map = new Map<string, string>();
    const texmf = join(vendorRoot, "texmf");
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (!map.has(entry)) map.set(entry, path);
      }
    };
    for (const sub of ["tex", "fonts", "dvips"]) if (existsSync(join(texmf, sub))) walk(join(texmf, sub));
    return map;
  };
  if (!texmfIndexCache) {
    texmfIndexCache = build();
    texmfIndexBuiltAt = Date.now();
  }
  // Re-index on a miss in case packages were fetched since, but at most every
  // 10 s: engines probe for many files that don't exist, and a full walk on
  // each miss added ~150 ms to every TikZJax compile.
  if (!texmfIndexCache.has(name) && Date.now() - texmfIndexBuiltAt > 10_000) {
    texmfIndexCache = build();
    texmfIndexBuiltAt = Date.now();
  }
  return texmfIndexCache.get(name);
}

const TIKZJAX_DIST = `${sep}tikzjax${sep}package${sep}dist${sep}`;

/**
 * Serves vendor/ (engine binaries, TeX files) byte-for-byte. Vite's static
 * server marks *.gz files as Content-Encoding: gzip, which makes the browser
 * inflate them before the engines' own decompressors see them.
 *
 * TikZJax asks for TeX files it doesn't bundle by bare name next to its worker
 * (after tex_files/<name>.gz misses). Those are served from the CTAN tree, to
 * test loading packages at compile time. In production they would be extra
 * files hosted alongside the engine.
 */
function rawVendor(): Plugin {
  return {
    name: "tikzflow-raw-vendor",
    configureServer(server) {
      server.middlewares.use("/vendor", (req, res, next) => {
        let path = normalize(join(vendorRoot, decodeURIComponent((req.url ?? "/").split("?")[0]!)));
        if (!path.startsWith(vendorRoot + sep)) return next();
        const rel = path.slice(vendorRoot.length);
        // TikZJax only loads extra files correctly from tex_files/<name>.gz: its
        // uncompressed fallback stores the response as a string and crashes.
        // So serve CTAN files there, gzipped on the fly.
        const texFiles = `${TIKZJAX_DIST}tex_files${sep}`;
        if (!existsSync(path) && rel.startsWith(texFiles) && rel.endsWith(".gz")) {
          const name = rel.slice(texFiles.length, -3);
          const fromCtan = name.includes(sep) ? undefined : texmfLookup(name);
          if (fromCtan) {
            server.config.logger.info(`[vendor] tikzjax runtime file from CTAN: ${name}`);
            const body = gzipSync(readFileSync(fromCtan));
            res.writeHead(200, {
              "Content-Type": "application/octet-stream",
              "Content-Length": body.length,
              "Cache-Control": "no-cache",
              "Cross-Origin-Embedder-Policy": "require-corp",
              "Cross-Origin-Resource-Policy": "same-origin",
            });
            res.end(body);
            return;
          }
        }
        if (!existsSync(path) || !statSync(path).isFile()) {
          // A real 404, not Vite's index.html fallback: engines probe for
          // optional files and must see them as missing.
          server.config.logger.info(`[vendor] 404 ${req.url}`);
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader("Content-Type", TYPES[extname(path)] ?? "application/octet-stream");
        res.setHeader("Content-Length", statSync(path).size);
        res.setHeader("Cache-Control", "no-cache");
        // A cross-origin-isolated page only runs worker scripts that opt in.
        res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
        res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
        createReadStream(path).pipe(res);
      });
    },
  };
}

/**
 * The accurate preview's engine (D67): vendor/engine/<tag>/ (from `npm run
 * fetch-engines`, or a CI run staged with scripts/stage-engine-ci.ts) served
 * as /engine/<tag>/ byte for byte, and copied into the build. Its .gz files
 * must reach the worker gzipped: no Content-Encoding, ever (D12).
 */
function engineFiles(): Plugin {
  const engineRoot = join(vendorRoot, "engine");
  let outDir = "dist";
  let building = false;
  return {
    name: "tikzflow-engine-files",
    configResolved(config) {
      outDir = join(config.root, config.build.outDir);
      building = config.command === "build" && !process.env.VITEST;
    },
    configureServer(server) {
      server.middlewares.use("/engine", (req, res, next) => {
        const path = normalize(join(engineRoot, decodeURIComponent((req.url ?? "/").split("?")[0]!)));
        if (!path.startsWith(engineRoot + sep)) return next();
        // Not an engine folder (the repo's own engine/release.json, imported by the app): Vite's.
        const folder = path.slice(engineRoot.length + 1).split(sep)[0]!;
        if (!existsSync(join(engineRoot, folder)) || !statSync(join(engineRoot, folder)).isDirectory()) return next();
        if (!existsSync(path) || !statSync(path).isFile()) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader("Content-Type", TYPES[extname(path)] ?? "application/octet-stream");
        res.setHeader("Content-Length", statSync(path).size);
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
        createReadStream(path).pipe(res);
      });
    },
    closeBundle() {
      if (!building) return;
      const release = JSON.parse(readFileSync(join(import.meta.dirname, "engine", "release.json"), "utf8")) as { tag: string };
      const from = join(engineRoot, release.tag);
      if (!existsSync(join(from, "index.json"))) {
        this.warn(`The engine ${release.tag} isn't in vendor/engine: the build has no accurate preview. Run npm run fetch-engines -- engine first.`);
        return;
      }
      cpSync(from, join(outDir, "engine", release.tag), { recursive: true });
    },
  };
}

// kpathsea file-format numbers SwiftLaTeX sends, and the suffix each implies
// when the requested name has none.
const KPSE_SUFFIX: Record<string, string> = {
  "3": ".tfm", "10": ".fmt", "11": ".map", "26": ".tex", "32": ".pfb", "33": ".vf", "44": ".enc",
};

/**
 * Dev-only stand-in for SwiftLaTeX's TeX Live file server, backed by the CTAN
 * packages in vendor/texmf. GET /swiftlatex-texlive/pdftex/<format>/<name>
 * looks the file up by name; pdftex.map is generated from the dvips map files.
 * POST /swiftlatex-texlive/fmt stores a format built in the browser.
 */
function swiftlatexTexlive(): Plugin {
  const texmf = join(vendorRoot, "texmf");
  const fmtDir = join(vendorRoot, "swiftlatex-fmt");
  const pdftexMap = () =>
    ["lm/lm.map", "amsfonts/cm.map", "amsfonts/cmextra.map", "amsfonts/symbols.map", "amsfonts/euler.map", "amsfonts/latxfont.map"]
      .map((m) => join(texmf, "fonts", "map", "dvips", m))
      .filter(existsSync)
      .map((p) => readFileSync(p, "latin1"))
      .join("\n");

  return {
    name: "tikzflow-swiftlatex-texlive",
    configureServer(server) {
      server.middlewares.use("/swiftlatex-texlive", (req, res) => {
        const headers = { "Cross-Origin-Resource-Policy": "same-origin", "Cache-Control": "no-cache" };
        if (req.method === "POST" && req.url === "/fmt") {
          const chunks: Buffer[] = [];
          req.on("data", (c: Buffer) => chunks.push(c));
          req.on("end", () => {
            mkdirSync(fmtDir, { recursive: true });
            writeFileSync(join(fmtDir, "swiftlatexpdftex.fmt"), Buffer.concat(chunks));
            res.writeHead(204, headers).end();
          });
          return;
        }
        const m = /^\/pdftex\/(\d+)\/([^/?]+)/.exec(req.url ?? "");
        if (!m) return void res.writeHead(404, headers).end();
        const [, format, raw] = m;
        let name = decodeURIComponent(raw!);
        if (!name.includes(".") && KPSE_SUFFIX[format!]) name += KPSE_SUFFIX[format!];
        let body: Buffer | null = null;
        if (name === "pdftex.map") body = Buffer.from(pdftexMap(), "latin1");
        // hyphen-base's language.dat lists every language; we ship only US English
        // patterns, as a minimal TeX Live install would generate.
        else if (name === "language.dat")
          body = Buffer.from("english hyphen.tex\n=usenglish\n=USenglish\n=american\nnohyphenation zerohyph.tex\n");
        else if (name === "language.def")
          body = Buffer.from("%% e-TeX V2.0\n\\addlanguage {USenglish}{hyphen}{}{2}{3} %%% This MUST be the first non-comment line of the file\n");
        else if (name === "swiftlatexpdftex.fmt") {
          const p = join(fmtDir, name);
          body = existsSync(p) ? readFileSync(p) : null;
        } else {
          const p = texmfLookup(name);
          body = p ? readFileSync(p) : null;
        }
        if (!body) {
          server.config.logger.info(`[swiftlatex-texlive] miss ${format}/${name}`);
          // SwiftLaTeX caches a miss only when the server answers 301.
          return void res.writeHead(301, headers).end();
        }
        server.config.logger.info(`[swiftlatex-texlive] hit  ${format}/${name}`);
        res.writeHead(200, {
          ...headers,
          "Content-Type": "application/octet-stream",
          "Content-Length": body.length,
          // The worker saves each file in its cache under this id. It must be the
          // bare name: TeX derives the job (and so the .fmt) name from it.
          fileid: name,
        });
        res.end(body);
      });
    },
  };
}

export default defineConfig({
  plugins: [rawVendor(), engineFiles(), swiftlatexTexlive()],
  oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
  server: {
    watch: { ignored: ["**/vendor/**"] },
    // Cross-origin isolation, so engines can use SharedArrayBuffer if they need it.
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  test: {
    include: ["spike/**/*.test.ts", "src/**/*.test.ts", "test/**/*.test.ts"],
  },
});
