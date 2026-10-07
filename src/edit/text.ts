// Line-level helpers for edits that insert whole lines: where lines start and
// end, their indentation, and which line ending a file uses.

export function lineStart(text: string, pos: number): number {
  return text.lastIndexOf("\n", pos - 1) + 1;
}

/** The position of the line break ending the line at `pos` (before any "\r"), or the end of the text. */
export function lineEnd(text: string, pos: number): number {
  const i = text.indexOf("\n", pos);
  if (i < 0) return text.length;
  return text[i - 1] === "\r" ? i - 1 : i;
}

/** The whitespace at the start of the line containing `pos`. */
export function indentAt(text: string, pos: number): string {
  const s = lineStart(text, pos);
  return /^[ \t]*/.exec(text.slice(s))![0];
}

/** "\r\n" if the text around `pos` (or the whole text) uses it, else "\n". */
export function eolNear(text: string, pos = 0): string {
  const nl = text.indexOf("\n", pos);
  const at = nl >= 0 ? nl : text.lastIndexOf("\n");
  if (at < 0) return "\n";
  return text[at - 1] === "\r" ? "\r\n" : "\n";
}

/** True if only spaces, tabs and a comment follow `pos` on its line. */
export function restOfLineBlank(text: string, pos: number): boolean {
  return /^[ \t]*(%.*)?$/.test(text.slice(pos, lineEnd(text, pos)));
}

/** One level of indentation in the file's style: a tab, or the smallest space indent seen (2 if none). */
export function indentUnit(text: string): string {
  let tabs = 0;
  let spaces = 0;
  let smallest = Infinity;
  for (const m of text.matchAll(/^([ \t]+)\S/gm)) {
    if (m[1]!.startsWith("\t")) tabs++;
    else {
      spaces++;
      smallest = Math.min(smallest, m[1]!.length);
    }
  }
  if (tabs > spaces) return "\t";
  return " ".repeat(Number.isFinite(smallest) ? Math.min(smallest, 4) : 2);
}
