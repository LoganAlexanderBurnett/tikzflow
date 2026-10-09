#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Compiles one file with tex.wasm and core.dump, as the browser worker will.
// Adapted from web2js's tex.js (GPL-3.0).
//
//   WEB2JS_DIR=<dir with tex.wasm and commonMemory.js> node compile.cjs <input.tex> <core.dump>
//
// The input continues the preamble saved in core.dump (packages, libraries,
// \begin{document}, the picture, \end{document}). Run it in the input's
// directory. Writes <job>.dvi and <job>.log there, plus <job>.files.json (every
// file TeX read, by the name TeX asked for) and <job>.timing.json. Exits
// non-zero on a TeX error or a missing DVI.
'use strict';

const fs = require('fs');
const path = require('path');

const web2js = process.env.WEB2JS_DIR;
if (!web2js) throw new Error('Set WEB2JS_DIR to the web2js checkout');
const [input, dumpPath] = process.argv.slice(2);
if (!input || !dumpPath) throw new Error('usage: node compile.cjs <input.tex> <core.dump>');
const job = path.basename(input).replace(/\.tex$/, '');

const { texErrors } = require('./run-support.cjs');
const library = require(path.join(web2js, 'library.js'));
const { pages } = require(path.join(web2js, 'commonMemory.js'));

const started = Date.now();
const code = new WebAssembly.Module(fs.readFileSync(path.join(web2js, 'tex.wasm')));
const memory = new WebAssembly.Memory({ initial: pages, maximum: pages });
const dump = fs.readFileSync(dumpPath);
if (dump.length !== pages * 65536) throw new Error(`core.dump is ${dump.length} bytes, expected ${pages * 65536}`);
new Uint8Array(memory.buffer).set(dump);
const loaded = Date.now();

library.setMemory(memory.buffer);
library.setInput(`${path.basename(input)}\n\\end\n`);
const wasm = new WebAssembly.Instance(code, { library, env: { memory } });
library.setWasmExports(wasm.exports);
wasm.exports.main();
const done = Date.now();

const files = library.getUsedFiles();
delete files[path.basename(input)];
for (const name of Object.keys(files)) if (/\.(aux|log|dvi)$/.test(name)) delete files[name];
fs.writeFileSync(`${job}.files.json`, JSON.stringify(files, null, '\t') + '\n');
fs.writeFileSync(
    `${job}.timing.json`,
    JSON.stringify({ loadMs: loaded - started, compileMs: done - loaded }, null, '\t') + '\n'
);

const errors = texErrors();
const dvi = `${job}.dvi`;
const dviSize = fs.existsSync(dvi) ? fs.statSync(dvi).size : 0;
if (errors.length || dviSize === 0) {
    console.error(`\nCOMPILE FAILED: ${errors.length} TeX error(s), DVI ${dviSize} bytes\n${errors.join('\n')}`);
    process.exit(1);
}
console.log(`\nCOMPILE OK: ${dvi} ${dviSize} bytes, ${Object.keys(files).length} files read, ${done - loaded} ms`);
