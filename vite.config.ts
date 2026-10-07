import { createReadStream, existsSync, statSync } from "node:fs";
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

export default defineConfig({
  plugins: [rawVendor()],
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
