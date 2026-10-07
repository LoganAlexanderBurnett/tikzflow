// Option lists as text: "draw, fill=blue!20, label={[red]above:x}".
// Used for style bodies, whose text is substituted (#1) before it is read.

export interface KeyValue {
  key: string;
  value?: string;
}

/** Splits at top-level commas, respecting braces. Comments must already be gone. */
export function splitTopLevel(s: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    else if (depth === 0 && s.startsWith(sep, i)) {
      parts.push(s.slice(start, i));
      start = i + sep.length;
      i += sep.length - 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

/** Index of the first top-level occurrence of `needle`, or -1. */
export function indexTopLevel(s: string, needle: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    else if (depth === 0 && s.startsWith(needle, i)) return i;
  }
  return -1;
}

/** Removes TeX comments (an unescaped "%" to the end of the line). */
export function stripComments(s: string): string {
  return s.replace(/(^|[^\\])%[^\n]*/g, "$1");
}

export function parseOptionString(s: string): KeyValue[] {
  const out: KeyValue[] = [];
  for (const part of splitTopLevel(stripComments(s), ",")) {
    const p = part.trim();
    if (!p) continue;
    const eq = indexTopLevel(p, "=");
    if (eq < 0) out.push({ key: p.replace(/\s+/g, " ") });
    else out.push({ key: p.slice(0, eq).trim().replace(/\s+/g, " "), value: p.slice(eq + 1).trim() });
  }
  return out;
}

/** Removes braces around the whole of `s`, as often as they enclose all of it: "{{a}}" → "a", "{a}{b}" stays. */
export function stripBraces(s: string): string {
  let t = s.trim();
  while (t.length >= 2 && t[0] === "{" && t[t.length - 1] === "}" && matchingBrace(t, 0) === t.length - 1) t = t.slice(1, -1).trim();
  return t;
}

/** Index of the brace that closes the one at `open`, or -1. */
export function matchingBrace(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return i;
  }
  return -1;
}
