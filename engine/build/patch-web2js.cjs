#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Makes web2js report missing files as missing (D15 item 4), before tex.wasm
// is built, the format dumped and the sample compiled.
//
//   node patch-web2js.cjs <web2js checkout>
//
// Two faults hid missing files, and the 2026 LaTeX kernel trips over both:
// 1. library.js (the file loader). The kernel quotes the names it opens
//    ("name.tex"); when one isn't found, TeX tries again as
//    TeXinputs:"name.tex". library.js strips quotes only from names that start
//    with one, and calls a missing file "present but empty" unless its name
//    ends in .aux/.log/.dvi/.tex, so the retry came back as an empty file.
// 2. \filesize (changes/filesize.ch) printed 0 for a missing file. pdfTeX's
//    \pdffilesize prints nothing, and expl3's \file_if_exist (behind LaTeX's
//    \IfFileExists) relies on that, so every file "existed".
// Together, \usetikzlibrary{arrows.meta} loaded an empty
// tikzlibraryarrows.meta.code.tex (pgf has none; tikz then tries
// pgflibraryarrows.meta.code.tex) and never defined the arrow tips, and the
// format build \input empty .dfu files for encodings that have none.
//
// Each edit must apply exactly as expected, or the script fails.
'use strict';

const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
if (!dir) throw new Error('usage: node patch-web2js.cjs <web2js checkout>');

function patch(file, edits) {
    const full = path.join(dir, file);
    let source = fs.readFileSync(full, 'utf8');
    for (const { from, to, count, why } of edits) {
        const found = source.split(from).length - 1;
        if (found !== count) {
            throw new Error(`patch-web2js: ${file}: expected ${count} of ${JSON.stringify(from)}, found ${found} (${why})`);
        }
        source = source.split(from).join(to);
    }
    fs.writeFileSync(full, source);
    console.log(`patched ${file}: ${edits.map((e) => e.why).join('; ')}`);
}

patch('library.js', [
    {
        why: 'drop the TeXinputs: area before quotes are handled (reset, rewrite)',
        from: `if (filename.startsWith('"')) {`,
        to: `filename = filename.replace(/^TeXinputs:/, '');\n        if (filename.startsWith('"')) {`,
        count: 2
    },
    {
        why: 'a file kpathsea cannot find is missing, whatever its extension',
        from: `erstat: /\\.(aux|log|dvi|tex)$/.test(filename) ? 1 : 0,`,
        to: `erstat: 1,`,
        count: 1
    },
    {
        why: 'getfilesize handles names as reset does',
        from: `filename = filename.replace(/^\\*/, '');\n\n        let format = FILE_FORMAT.TEX;\n        if (filename.startsWith('TeXfonts:')) {`,
        to: `filename = filename.replace(/^\\*/, '');\n        filename = filename.replace(/^TeXinputs:/, '');\n        if (filename.startsWith('"')) filename = filename.replace(/^"/, '').replace(/".*/, '');\n\n        let format = FILE_FORMAT.TEX;\n        if (filename.startsWith('TeXfonts:')) {`,
        count: 1
    },
    {
        why: 'getfilesize returns -1 for a missing file',
        from: `            } catch {\n                return 0;\n            }\n        }\n\n        return 0;`,
        to: `            } catch {\n                return -1;\n            }\n        }\n\n        return -1;`,
        count: 1
    }
]);

patch('changes/filesize.ch', [
    {
        why: '\\filesize prints nothing for a missing file, as pdfTeX does',
        from: `filesize_code: print_int(cur_val);`,
        to: `filesize_code: if cur_val>=0 then print_int(cur_val);`,
        count: 1
    }
]);
