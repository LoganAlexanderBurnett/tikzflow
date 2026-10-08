#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Fixes web2js's library.js file loader before the format is dumped and the
// sample compiled (D15 item 4: report missing files as missing).
//
//   node patch-web2js.cjs <web2js>/library.js
//
// Since 2025 the LaTeX kernel quotes the names it opens ("name.tex"). When a
// file isn't found, TeX tries again as TeXinputs:"name.tex". library.js
// strips quotes only from names that start with one, and calls a missing file
// "present but empty" unless its name ends in .aux/.log/.dvi/.tex, so the
// retry came back as an empty file. That breaks every existence test: for
// \usetikzlibrary{arrows.meta}, tikz checks tikzlibraryarrows.meta.code.tex
// (which doesn't exist) before pgflibraryarrows.meta.code.tex, got an empty
// file, and never defined the arrow tips.
//
// Each edit must apply exactly as expected, or the script fails.
'use strict';

const fs = require('fs');

const file = process.argv[2];
if (!file) throw new Error('usage: node patch-web2js.cjs <library.js>');
let source = fs.readFileSync(file, 'utf8');

function replaceExactly(from, to, count, why) {
    const found = source.split(from).length - 1;
    if (found !== count) throw new Error(`patch-web2js: expected ${count} of ${JSON.stringify(from)}, found ${found} (${why})`);
    source = source.split(from).join(to);
}

// 1. Drop TeX's TeXinputs: area before the quotes are handled (reset and rewrite).
replaceExactly(
    `if (filename.startsWith('"')) {`,
    `filename = filename.replace(/^TeXinputs:/, '');\n        if (filename.startsWith('"')) {`,
    2,
    'TeXinputs: prefix'
);

// 2. A file kpathsea can't find is missing, whatever its extension.
replaceExactly(
    `erstat: /\\.(aux|log|dvi|tex)$/.test(filename) ? 1 : 0,`,
    `erstat: 1,`,
    1,
    'missing files'
);

// 3. getfilesize (\filesize) gets the same name handling as reset.
replaceExactly(
    `filename = filename.replace(/^\\*/, '');\n\n        let format = FILE_FORMAT.TEX;\n        if (filename.startsWith('TeXfonts:')) {`,
    `filename = filename.replace(/^\\*/, '');\n        filename = filename.replace(/^TeXinputs:/, '');\n        if (filename.startsWith('"')) filename = filename.replace(/^"/, '').replace(/".*/, '');\n\n        let format = FILE_FORMAT.TEX;\n        if (filename.startsWith('TeXfonts:')) {`,
    1,
    'getfilesize names'
);

fs.writeFileSync(file, source);
console.log(`patched ${file}`);
