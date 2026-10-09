// SPDX-License-Identifier: GPL-3.0-or-later
// Type 1 fonts (.pfb): the glyph outlines of Computer Modern and the AMS
// fonts, turned into SVG path data at build time (D66), so the accurate
// preview draws text as paths and its SVG needs no web fonts.

export interface Type1Font {
  name: string;
  /** Font units per em (1000 for a FontMatrix of 0.001). */
  unitsPerEm: number;
  /** Character code → glyph name, from the font's own encoding. */
  encoding: Map<number, string>;
  /** Glyph name → SVG path data in font units, y pointing up. */
  glyphs: Map<string, string>;
  /** Glyphs whose charstrings used operators this reader doesn't draw (seac). */
  skipped: string[];
}

/** The clear-text and binary parts of a .pfb file, or of a .pfa/.t1 file as given. */
function segments(data: Uint8Array): { clear: string; binary: Uint8Array } {
  if (data[0] !== 0x80) {
    // PFA: hexadecimal after eexec.
    const text = new TextDecoder("latin1").decode(data);
    const at = text.indexOf("eexec");
    if (at < 0) throw new Error("no eexec section");
    const hex = text.slice(at + 5).replace(/[^0-9a-fA-F]/g, "");
    const binary = new Uint8Array(hex.length >> 1);
    for (let i = 0; i < binary.length; i++) binary[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return { clear: text.slice(0, at + 5), binary };
  }
  let clear = "";
  const parts: Uint8Array[] = [];
  let i = 0;
  while (i < data.length && data[i] === 0x80 && data[i + 1] !== 3) {
    const type = data[i + 1];
    const len = data[i + 2]! | (data[i + 3]! << 8) | (data[i + 4]! << 16) | (data[i + 5]! << 24);
    const body = data.subarray(i + 6, i + 6 + len);
    if (type === 1) clear += new TextDecoder("latin1").decode(body);
    else parts.push(body);
    i += 6 + len;
  }
  const binary = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    binary.set(p, o);
    o += p.length;
  }
  return { clear, binary };
}

/** Type 1 decryption (eexec: r = 55665, charstrings: r = 4330), dropping the first `skip` bytes. */
function decrypt(data: Uint8Array, r: number, skip: number): Uint8Array {
  const out = new Uint8Array(Math.max(0, data.length - skip));
  for (let i = 0; i < data.length; i++) {
    const c = data[i]!;
    if (i >= skip) out[i - skip] = c ^ (r >> 8);
    r = ((c + r) * 52845 + 22719) & 0xffff;
  }
  return out;
}

/** Reads a Type 1 font: encoding, font matrix and every glyph's outline. */
export function parseType1(data: Uint8Array): Type1Font {
  const { clear, binary } = segments(data);
  const name = /\/FontName\s*\/(\S+)/.exec(clear)?.[1] ?? "";
  const matrix = /\/FontMatrix\s*\[\s*([-\d.eE]+)/.exec(clear)?.[1];
  const unitsPerEm = matrix ? Math.round(1 / Number(matrix)) : 1000;
  const encoding = new Map<number, string>();
  if (!/\/Encoding\s+StandardEncoding/.test(clear)) {
    for (const m of clear.matchAll(/dup\s+(\d+)\s*\/(\S+)\s+put/g)) encoding.set(Number(m[1]), m[2]!);
  }

  const priv = decrypt(binary, 55665, 4);
  // Scan the private dictionary as bytes: charstrings are binary and may contain anything.
  const latin = new TextDecoder("latin1").decode(priv);
  const lenIV = Number(/\/lenIV\s+(\d+)/.exec(latin)?.[1] ?? 4);
  const subrs: Uint8Array[] = [];
  const charStrings = new Map<string, Uint8Array>();
  const csStart = latin.indexOf("/CharStrings");
  // `dup <index> <length> RD <bytes>` for subroutines, `/<name> <length> RD <bytes>` for glyphs.
  // RD is also spelled -| (and the like); one space separates it from the bytes.
  const re = /(?:dup\s+(\d+)|\/([^\s/]+))\s+(\d+)\s+(\S+) /g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(latin))) {
    const len = Number(m[3]);
    const at = m.index + m[0].length;
    const bytes = priv.subarray(at, at + len);
    if (m[1] !== undefined && (csStart < 0 || m.index < csStart)) subrs[Number(m[1])] = decrypt(bytes, 4330, lenIV);
    else if (m[2] !== undefined && csStart >= 0 && m.index > csStart) charStrings.set(m[2], decrypt(bytes, 4330, lenIV));
    else continue;
    re.lastIndex = at + len;
  }

  const glyphs = new Map<string, string>();
  const skipped: string[] = [];
  for (const [glyph, cs] of charStrings) {
    const out = drawCharString(cs, subrs);
    if (out === null) skipped.push(glyph);
    else glyphs.set(glyph, out);
  }
  return { name, unitsPerEm, encoding, glyphs, skipped };
}

const num = (v: number) => String(Math.round(v * 100) / 100);

/** Interprets a decrypted Type 1 charstring into SVG path data, or null for one this reader can't draw. */
function drawCharString(cs: Uint8Array, subrs: Uint8Array[]): string | null {
  const stack: number[] = [];
  const psStack: number[] = [];
  const path: string[] = [];
  let x = 0;
  let y = 0;
  let open = false;
  let flex: Array<[number, number]> | null = null;
  let failed = false;
  let done = false;

  const moveTo = (nx: number, ny: number) => {
    x = nx;
    y = ny;
    if (flex) {
      flex.push([x, y]);
      return;
    }
    if (open) path.push("Z");
    path.push(`M${num(x)} ${num(y)}`);
    open = true;
  };
  const lineTo = (nx: number, ny: number) => {
    x = nx;
    y = ny;
    path.push(`L${num(x)} ${num(y)}`);
  };
  const curveTo = (dx1: number, dy1: number, dx2: number, dy2: number, dx3: number, dy3: number) => {
    const x1 = x + dx1;
    const y1 = y + dy1;
    const x2 = x1 + dx2;
    const y2 = y1 + dy2;
    x = x2 + dx3;
    y = y2 + dy3;
    path.push(`C${num(x1)} ${num(y1)} ${num(x2)} ${num(y2)} ${num(x)} ${num(y)}`);
  };

  const run = (code: Uint8Array, depth: number): void => {
    if (depth > 10) {
      failed = true;
      return;
    }
    let i = 0;
    while (i < code.length && !done && !failed) {
      const v = code[i++]!;
      if (v >= 32) {
        if (v <= 246) stack.push(v - 139);
        else if (v <= 250) stack.push((v - 247) * 256 + code[i++]! + 108);
        else if (v <= 254) stack.push(-(v - 251) * 256 - code[i++]! - 108);
        else {
          stack.push(((code[i]! << 24) | (code[i + 1]! << 16) | (code[i + 2]! << 8) | code[i + 3]!) >> 0);
          i += 4;
        }
        continue;
      }
      switch (v) {
        case 1: // hstem
        case 3: // vstem
          stack.length = 0;
          break;
        case 4: // vmoveto
          moveTo(x, y + stack[0]!);
          stack.length = 0;
          break;
        case 5: // rlineto
          lineTo(x + stack[0]!, y + stack[1]!);
          stack.length = 0;
          break;
        case 6: // hlineto
          lineTo(x + stack[0]!, y);
          stack.length = 0;
          break;
        case 7: // vlineto
          lineTo(x, y + stack[0]!);
          stack.length = 0;
          break;
        case 8: // rrcurveto
          curveTo(stack[0]!, stack[1]!, stack[2]!, stack[3]!, stack[4]!, stack[5]!);
          stack.length = 0;
          break;
        case 9: // closepath
          if (open) path.push("Z");
          open = false;
          stack.length = 0;
          break;
        case 10: {
          // callsubr
          const n = stack.pop()!;
          const sub = subrs[n];
          if (!sub) {
            failed = true;
            return;
          }
          run(sub, depth + 1);
          break;
        }
        case 11: // return
          return;
        case 13: // hsbw: left side bearing, width
          x = stack[0]!;
          y = 0;
          stack.length = 0;
          break;
        case 14: // endchar
          done = true;
          break;
        case 21: // rmoveto
          moveTo(x + stack[0]!, y + stack[1]!);
          stack.length = 0;
          break;
        case 22: // hmoveto
          moveTo(x + stack[0]!, y);
          stack.length = 0;
          break;
        case 30: // vhcurveto
          curveTo(0, stack[0]!, stack[1]!, stack[2]!, stack[3]!, 0);
          stack.length = 0;
          break;
        case 31: // hvcurveto
          curveTo(stack[0]!, 0, stack[1]!, stack[2]!, 0, stack[3]!);
          stack.length = 0;
          break;
        case 12: {
          const e = code[i++]!;
          switch (e) {
            case 0: // dotsection
            case 1: // vstem3
            case 2: // hstem3
              stack.length = 0;
              break;
            case 6: // seac: accented characters from StandardEncoding pieces; CM's fonts don't use it
              failed = true;
              return;
            case 7: // sbw
              x = stack[0]!;
              y = stack[1]!;
              stack.length = 0;
              break;
            case 12: {
              // div
              const b = stack.pop()!;
              const a = stack.pop()!;
              stack.push(a / b);
              break;
            }
            case 16: {
              // callothersubr: flex (0, 1, 2) and hint replacement (3); others hand their arguments back
              const other = stack.pop()!;
              const n = stack.pop()!;
              const args = stack.splice(stack.length - n, n);
              if (other === 1) {
                flex = [];
              } else if (other === 0 && flex) {
                // The reference point, then the two curves' control and end points.
                const p = flex;
                flex = null;
                if (p.length >= 7) {
                  const [, a, b, c, d, e2, f] = p as [number, number][];
                  path.push(`C${num(a![0])} ${num(a![1])} ${num(b![0])} ${num(b![1])} ${num(c![0])} ${num(c![1])}`);
                  path.push(`C${num(d![0])} ${num(d![1])} ${num(e2![0])} ${num(e2![1])} ${num(f![0])} ${num(f![1])}`);
                  x = f![0];
                  y = f![1];
                }
                psStack.push(y, x);
              } else if (other === 2) {
                // flex: the next rmoveto adds a point
              } else {
                psStack.push(...args.reverse());
              }
              break;
            }
            case 17: // pop
              stack.push(psStack.pop() ?? 0);
              break;
            case 33: // setcurrentpoint
              x = stack[0]!;
              y = stack[1]!;
              stack.length = 0;
              break;
            default:
              stack.length = 0;
          }
          break;
        }
        default:
          stack.length = 0;
      }
    }
  };
  run(cs, 0);
  if (failed) return null;
  if (open) path.push("Z");
  return path.join("");
}
