// SPDX-License-Identifier: GPL-3.0-or-later
// Reading TeX's log after a compile (D67): the errors, with the line of
// input.tex each happened on, and the file TeX was reading at the time.

export interface TexError {
  /** The first line of the message, without the "! ". */
  message: string;
  /** The lines TeX printed after it (help is left out). */
  details: string[];
  /** The line TeX was reading (its "l.<n>"), in `file`. */
  line: number | null;
  /** The file TeX was reading: "input.tex" for the compiled picture, else a package's file. */
  file: string | null;
  /** The text of that line up to where TeX stopped. */
  context: string;
}

const FILE_OPEN = /\(([^\s()]+?\.(?:tex|sty|cls|def|cfg|fd|clo|ldf|aux|dfu|cnf))(?=[\s()]|$)/g;

/** The errors in a TeX log, in order. */
export function parseTexLog(log: string): TexError[] {
  const lines = log.split(/\r?\n/);
  const errors: TexError[] = [];
  // Which file TeX is reading, from the "(file" and ")" it prints as files open and close.
  const stack: string[] = [];
  const track = (line: string) => {
    // Box warnings print "(12.3pt too wide)" and the like, and their text, with unbalanced parentheses.
    if (/^(Overfull|Underfull|!|l\.\d+)/.test(line)) return;
    let i = 0;
    while (i < line.length) {
      const c = line[i]!;
      if (c === "(") {
        FILE_OPEN.lastIndex = i;
        const m = FILE_OPEN.exec(line);
        if (m && m.index === i) {
          stack.push(m[1]!.replace(/^\.\//, ""));
          i += m[0].length;
          continue;
        }
        // Not a file: skip to the matching parenthesis on this line, if any.
        const close = line.indexOf(")", i);
        i = close < 0 ? line.length : close + 1;
        continue;
      }
      if (c === ")" && stack.length) stack.pop();
      i++;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.startsWith("! ")) {
      track(line);
      continue;
    }
    const message = line.slice(2).trim();
    const details: string[] = [];
    let at: number | null = null;
    let context = "";
    let j = i + 1;
    for (; j < lines.length && j < i + 40; j++) {
      const l = lines[j]!;
      const m = /^l\.(\d+) (.*)$/.exec(l) ?? /^l\.(\d+)$/.exec(l);
      if (m) {
        at = Number(m[1]);
        context = (m[2] ?? "").replace(/\^\^M$/, "");
        break;
      }
      if (l.startsWith("! ")) {
        j--;
        break;
      }
      // LaTeX's standard help pointers are noise here.
      if (/^(See the .* for explanation\.|Type {2}H <return> {2}for immediate help\.| \.\.\.\s*)$/.test(l) || !l.trim()) continue;
      details.push(l);
    }
    errors.push({ message, details, line: at, file: stack[stack.length - 1] ?? null, context });
    i = j;
  }
  return errors;
}

/** Whether the log says TeX gave up before the end ("job aborted", "Emergency stop"). */
export function texAborted(log: string): boolean {
  return /\*\*\* \(job aborted|Emergency stop|TeX capacity exceeded/.test(log);
}
