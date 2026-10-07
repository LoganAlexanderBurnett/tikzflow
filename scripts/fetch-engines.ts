// Fetches the Milestone 0 engine binaries and TeX packages into vendor/
// (gitignored, see DECISIONS.md D8). Downloads already present with the
// recorded size are skipped. Pure Node, so it runs the same on Windows.
//
// Usage: node scripts/fetch-engines.ts [group ...]
//   groups: tikzjax busytex swiftlatex texmf (default: all)

import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { unzipSync } from "fflate";
import * as tar from "tar";
import xz from "xz-decompress";
import { DOWNLOADS, type Download } from "./engine-manifest.ts";

const root = join(import.meta.dirname, "..", "vendor");
const lockPath = join(root, "LOCK.json");

interface LockEntry {
  url: string;
  finalUrl: string;
  bytes: number;
  sha256: string;
  fetchedAt: string;
}

const lock: Record<string, LockEntry> = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, "utf8")) : {};

async function download(d: Download): Promise<string> {
  const file = join(root, "downloads", d.group, basename(new URL(d.url).pathname));
  const known = lock[d.url];
  if (known && existsSync(file) && statSync(file).size === known.bytes) {
    console.log(`  cached      ${basename(file)}`);
    return file;
  }
  const res = await fetch(d.url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${d.url}: HTTP ${res.status}`);
  const data = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
  lock[d.url] = {
    url: d.url,
    finalUrl: res.url,
    bytes: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
    fetchedAt: new Date().toISOString(),
  };
  console.log(`  downloaded  ${basename(file)}  ${(data.length / 1048576).toFixed(2)} MB  (from ${new URL(res.url).host})`);
  return file;
}

async function extract(d: Download, file: string): Promise<void> {
  const dest = join(root, d.group);
  mkdirSync(dest, { recursive: true });
  switch (d.extract) {
    case "none":
      writeFileSync(join(dest, basename(file)), readFileSync(file));
      return;
    case "tgz":
      await tar.x({ file, cwd: dest });
      return;
    case "tar.xz": {
      const stream = new xz.XzReadableStream(Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>);
      await pipeline(Readable.fromWeb(stream as unknown as WebReadableStream<Uint8Array>), tar.x({ cwd: dest }));
      return;
    }
    case "zip":
      for (const [name, bytes] of Object.entries(unzipSync(readFileSync(file)))) {
        if (name.endsWith("/")) continue;
        const out = join(dest, name);
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, bytes);
      }
      return;
  }
}

const wanted = new Set(process.argv.slice(2));
const selected = DOWNLOADS.filter((d) => wanted.size === 0 || wanted.has(d.group));
const totalMB = selected.reduce((sum, d) => sum + d.approxMB, 0);
console.log(`Fetching ${selected.length} files (about ${totalMB.toFixed(0)} MB) into ${root}`);

for (const d of selected) {
  const file = await download(d);
  await extract(d, file);
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
}
console.log("Done. Sizes and SHA-256 hashes are in vendor/LOCK.json.");
