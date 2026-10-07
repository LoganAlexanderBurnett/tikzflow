import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const vendorRoot = join(import.meta.dirname, "vendor");

const TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".wasm": "application/wasm",
  ".css": "text/css",
  ".json": "application/json",
};

/**
 * Serves vendor/ (engine binaries, TeX files) byte-for-byte. Vite's static
 * server marks *.gz files as Content-Encoding: gzip, which makes the browser
 * inflate them before the engines' own decompressors see them.
 */
function rawVendor(): Plugin {
  return {
    name: "tikzflow-raw-vendor",
    configureServer(server) {
      server.middlewares.use("/vendor", (req, res, next) => {
        const path = normalize(join(vendorRoot, decodeURIComponent((req.url ?? "/").split("?")[0]!)));
        if (!path.startsWith(vendorRoot + sep)) return next();
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
  let index: Map<string, string> | null = null;
  const buildIndex = () => {
    const map = new Map<string, string>();
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
          index ??= buildIndex();
          // Re-index once on a miss, in case packages were fetched since.
          if (!index.has(name)) index = buildIndex();
          const p = index.get(name);
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
  plugins: [rawVendor(), swiftlatexTexlive()],
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
