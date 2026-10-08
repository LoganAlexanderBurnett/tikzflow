// SPDX-License-Identifier: GPL-3.0-or-later
// Shared by dump.cjs and compile.cjs.
'use strict';

const fs = require('fs');

// web2js's library.js writes a closed output file (latex.fmt, the DVI) with
// fs.write and fs.close, asynchronously, so a later stage in the same process
// could read it half written. Make both synchronous; this must run before
// library.js is loaded, and library.js calls them as fs.write(fd, buffer, cb).
fs.write = (fd, buffer, ...rest) => {
    const cb = rest.pop();
    let error = null;
    try {
        fs.writeSync(fd, buffer);
    } catch (e) {
        error = e;
    }
    if (typeof cb === 'function') cb(error);
};
fs.close = (fd, cb) => {
    let error = null;
    try {
        fs.closeSync(fd);
    } catch (e) {
        error = e;
    }
    if (typeof cb === 'function') cb(error);
};

// Keep a copy of the terminal output, to catch TeX errors: in error-stop mode
// an error asks for terminal input, which ends the run like a finished one.
const transcript = [];
const write = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...rest) => {
    transcript.push(String(chunk));
    return write(chunk, ...rest);
};

function texErrors() {
    return transcript
        .join('')
        .split('\n')
        .filter((line) => line.startsWith('! '));
}

function terminalOutput() {
    return transcript.join('');
}

module.exports = { texErrors, terminalOutput };
