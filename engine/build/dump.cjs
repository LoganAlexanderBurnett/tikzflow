#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Dumps the engine's format: runs tex.wasm as INITEX on latex.ltx, then loads
// that format, reads the preamble every compile shares, and saves the whole
// wasm memory as core.dump. Adapted from web2js's initex.js (GPL-3.0), with
// the PGF driver as a parameter.
//
//   WEB2JS_DIR=<web2js checkout with tex.wasm and tex.pool> node dump.cjs [driver]
//
// TeX's clock reads SOURCE_DATE_EPOCH when it is set, so a rebuild from the
// same inputs gives the same core.dump, byte for byte (D66).
//
// Run it in an empty working directory: TeX writes latex.fmt and its logs
// there. Writes core.dump and dump-files.json (every file TeX read, by name).
'use strict';

const fs = require('fs');
const path = require('path');

const web2js = process.env.WEB2JS_DIR;
if (!web2js) throw new Error('Set WEB2JS_DIR to the web2js checkout');
const driver = process.argv[2] || 'pgfsys-tikzflow.def';

const { texErrors } = require('./run-support.cjs');
const library = require(path.join(web2js, 'library.js'));
const { pages } = require(path.join(web2js, 'commonMemory.js'));
library.setTexPool(path.join(web2js, 'tex.pool'));

// The import object: web2js's library, with a fixed clock when asked for one.
const epoch = process.env.SOURCE_DATE_EPOCH;
const now = () => (epoch ? new Date(Number(epoch) * 1000) : new Date());
const imports = Object.assign({}, library, {
    getCurrentMinutes: () => 60 * now().getUTCHours() + now().getUTCMinutes(),
    getCurrentDay: () => now().getUTCDate(),
    getCurrentMonth: () => now().getUTCMonth() + 1,
    getCurrentYear: () => now().getUTCFullYear()
});

const code = new WebAssembly.Module(fs.readFileSync(path.join(web2js, 'tex.wasm')));
const started = Date.now();

// Stage 1: INITEX reads latex.ltx and dumps latex.fmt.
const initexMemory = new WebAssembly.Memory({ initial: pages, maximum: pages });
library.setMemory(initexMemory.buffer);
library.setInput('\n*latex.ltx\n\\dump\n\n', () => {});
let wasm = new WebAssembly.Instance(code, { library: imports, env: { memory: initexMemory } });
library.setWasmExports(wasm.exports);
wasm.exports.main();
if (!fs.existsSync('latex.fmt') || texErrors().length) {
    console.error(`\nDUMP FAILED: INITEX on latex.ltx\n${texErrors().join('\n')}`);
    process.exit(1);
}
const stage1 = Date.now();

// Stage 2: load the format, read the shared preamble, and save the memory
// when TeX asks for the next line.
const preamble =
    // dvisvgm: graphics, xcolor and expl3 load their dvisvgm back ends.
    '\\documentclass[dvisvgm,margin=0pt]{standalone}\n' +
    // pgfsys.sty turns the class option dvisvgm into pgfsys-dvisvgm.def, so
    // the driver is set again just before pgf reads \pgfsysdriver.
    `\\def\\pgfsysdriver{${driver}}\n` +
    `\\AddToHook{file/pgfsys.code.tex/before}{\\def\\pgfsysdriver{${driver}}}\n` +
    '\\usepackage[svgnames]{xcolor}\n' +
    '\\usepackage{tikz}\n\n' +
    '\\DeclareGraphicsExtensions{}\n';
const memory = new WebAssembly.Memory({ initial: pages, maximum: pages });
library.setMemory(memory.buffer);
library.setInput('\n&latex\n' + preamble, () => {
    library.tex_final_end();
    const errors = texErrors();
    if (errors.length) {
        console.error(`\nDUMP FAILED: ${errors.length} TeX error(s) in the preamble:\n${errors.join('\n')}`);
        process.exit(1);
    }
    if (!Object.keys(library.getUsedFiles()).some((name) => name.replace(/"/g, '').endsWith(driver))) {
        console.error(`\nDUMP FAILED: pgf did not load the driver ${driver}`);
        process.exit(1);
    }
    fs.writeFileSync('core.dump', new Uint8Array(memory.buffer));
    fs.writeFileSync('dump-files.json', JSON.stringify(library.getUsedFiles(), null, '\t') + '\n');
    const done = Date.now();
    fs.writeFileSync(
        'dump-timing.json',
        JSON.stringify({ driver, pages, stage1Ms: stage1 - started, stage2Ms: done - stage1 }, null, '\t') + '\n'
    );
    console.log(`\nDUMP OK: driver ${driver}, ${pages} pages, ${stage1 - started} ms + ${done - stage1} ms`);
    process.exit(0);
});
wasm = new WebAssembly.Instance(code, { library: imports, env: { memory } });
library.setWasmExports(wasm.exports);
wasm.exports.main();

// TeX stopped before reading the whole preamble (a fatal error).
console.error('\nDUMP FAILED: TeX ended before the preamble was read');
process.exit(1);
