// SPDX-License-Identifier: GPL-3.0-or-later
// Stand-in for kisonecat/node-kpathsea, the native addon web2js's library.js
// uses to find TeX files. It asks the TeX Live installation's own `kpsewhich`
// instead, so the build needs no compiler or kpathsea headers. Only the part
// of the API library.js uses is provided: `new Kpathsea(progname)`,
// `findFile(name, format)` and the TEX, TFM and TEXPOOL formats.
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const FILE_FORMAT = Object.freeze({ TFM: 'tfm', TEX: 'tex', TEXPOOL: 'texpool' });

class Kpathsea {
    constructor(progname) {
        this.progname = progname;
        this.cache = new Map();
    }

    findFile(name, format) {
        if (!name) return undefined;
        // The pool file is written next to tex.p by tangle; library.js passes
        // its path as given.
        if (format === FILE_FORMAT.TEXPOOL) return fs.existsSync(name) ? path.resolve(name) : undefined;
        const key = `${format}:${name}`;
        if (this.cache.has(key)) return this.cache.get(key);
        let found;
        try {
            found = execFileSync('kpsewhich', [`-progname=${this.progname}`, `-format=${format}`, name], {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore']
            }).trim();
        } catch {
            found = '';
        }
        // Only hits are cached: TeX writes files (the .aux) that it looked for
        // earlier and didn't find.
        const result = found ? path.resolve(found.split('\n')[0]) : undefined;
        if (result) this.cache.set(key, result);
        return result;
    }
}

module.exports = { Kpathsea, FILE_FORMAT };
