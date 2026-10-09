// SPDX-License-Identifier: GPL-3.0-or-later
// The runtime tex.wasm imports: TeX's file system, terminal and clock.
// Adapted from web2js's library.js and TikZJax's browser version of it
// (both GPL-3.0; see DECISIONS.md D67), rewritten for the accurate preview:
// - a file that can't be found is missing, whatever its name (D15 item 4);
//   \filesize gives -1 for it, which our tex.wasm prints as nothing (D59);
// - files are bytes, never strings, and stay cached between compiles;
// - files are looked up through `lookup`, which may answer later (a fetch):
//   TeX is then paused with Binaryen's asyncify and resumed with the answer.

/** Wasm memory pages TeX was built with (web2js's commonMemory.js). */
export const PAGES = 2500;
/** The asyncify data area: the last 100 pages, which TeX doesn't use. */
const DATA_ADDR = (PAGES - 100) * 65536;
const END_ADDR = PAGES * 65536;

interface TexExports {
  main(): void;
  asyncify_start_unwind(addr: number): void;
  asyncify_stop_unwind(): void;
  asyncify_start_rewind(addr: number): void;
  asyncify_stop_rewind(): void;
}

/** A file's bytes, null for a missing file, or a promise of either. */
export type Lookup = (name: string) => Uint8Array | null | Promise<Uint8Array | null>;

export interface TexRunOptions {
  /** What is typed at the terminal, line by line (the first line names the input file). */
  terminal: string;
  /** Files TeX may read that aren't looked up: the input file. */
  files: Map<string, Uint8Array>;
  lookup: Lookup;
  /** TeX's \year, \month, \day and \time. */
  now?: Date;
  /** Called with each piece of terminal output. */
  onOutput?: (text: string) => void;
}

export interface TexRunResult {
  /** Files TeX wrote (input.dvi, input.log, input.aux), by name. */
  written: Map<string, Uint8Array>;
  /** Everything TeX printed on the terminal. */
  transcript: string;
  /** Files TeX looked for and didn't find, in order. */
  missing: string[];
  /** Files TeX read through `lookup`, in order. */
  read: string[];
}

interface OpenFile {
  name: string;
  content: Uint8Array;
  /** Read position for `get`, and write length. */
  position: number;
  /** Read position for `inputln`. */
  position2: number;
  erstat: number;
  eof: boolean;
  eoln: boolean;
  stdin?: boolean;
  stdout?: boolean;
  writable?: boolean;
}

/** The name TeX asks for, cleaned the way web2js does (with D59's fixes): no braces, quotes, areas or padding. */
export function cleanName(raw: string): string {
  let name = raw.replace(/\0+$/, "");
  if (name.startsWith("{")) name = name.slice(1).replace(/}.*/s, "");
  name = name.replace(/ +$/, "").replace(/^\*/, "").replace(/^TeXfonts:/, "").replace(/^TeXinputs:/, "");
  if (name.startsWith('"')) name = name.slice(1).replace(/".*/s, "");
  return name.replace(/ +$/, "").replace(/^\.\//, "");
}

/** Runs TeX once: `memory` must already hold the format (core.dump). */
export async function runTex(module: WebAssembly.Module, memory: WebAssembly.Memory, options: TexRunOptions): Promise<TexRunResult> {
  const files: OpenFile[] = [];
  const written = new Map<string, Uint8Array>();
  const known = new Map<string, Uint8Array | null>(options.files);
  const missing: string[] = [];
  const read: string[] = [];
  const terminal = new TextEncoder().encode(options.terminal);
  const now = options.now ?? new Date();
  let transcript = "";
  let exports: TexExports | null = null;
  let pending: Promise<void> | null = null;
  let rewinding = false;
  const view = new Int32Array(memory.buffer);
  const bytes = () => new Uint8Array(memory.buffer);

  const out = (text: string) => {
    transcript += text;
    options.onOutput?.(text);
  };

  /** The file `name`, if it is known now; undefined if it must be looked up first (TeX is paused). */
  const find = (name: string): Uint8Array | null | undefined => {
    if (rewinding) {
      // Back from a pause: this is the call that paused.
      exports!.asyncify_stop_rewind();
      rewinding = false;
    }
    const w = written.get(name);
    if (w) return w;
    if (known.has(name)) return known.get(name)!;
    // Files TeX writes itself are missing until it writes them.
    if (/\.(aux|log|dvi|toc|lof|lot|out|idx|fls)$/i.test(name) || name === "") return null;
    const answer = options.lookup(name);
    if (!(answer instanceof Promise)) {
      known.set(name, answer);
      (answer ? read : missing).push(name);
      return answer;
    }
    // Pause TeX until the answer comes, then run the same call again.
    pending = answer.then(
      (data) => {
        known.set(name, data);
        (data ? read : missing).push(name);
      },
      () => {
        known.set(name, null);
        missing.push(name);
      },
    );
    view[DATA_ADDR >> 2] = DATA_ADDR + 8;
    view[(DATA_ADDR + 4) >> 2] = END_ADDR;
    exports!.asyncify_start_unwind(DATA_ADDR);
    return undefined;
  };

  const open = (file: Omit<OpenFile, "position" | "position2" | "eof" | "eoln" | "erstat"> & Partial<OpenFile>): number => {
    files.push({ position: 0, position2: 0, erstat: 0, eof: false, eoln: false, ...file });
    return files.length - 1;
  };
  const nameAt = (length: number, pointer: number) => String.fromCharCode(...new Uint8Array(memory.buffer, pointer, length));

  const write = (file: OpenFile, data: Uint8Array) => {
    if (file.stdout) {
      out(new TextDecoder("latin1").decode(data));
      return;
    }
    if (file.position + data.length > file.content.length) {
      const grown = new Uint8Array(Math.max(file.content.length * 2, file.position + data.length, 4096));
      grown.set(file.content.subarray(0, file.position));
      file.content = grown;
    }
    file.content.set(data, file.position);
    file.position += data.length;
    written.set(file.name, file.content.subarray(0, file.position));
  };
  const target = (descriptor: number): OpenFile => (descriptor < 0 ? { name: "stdout", stdout: true } as OpenFile : files[descriptor]!);
  const print = (descriptor: number, text: string) => write(target(descriptor), new TextEncoder().encode(text));

  const library = {
    getCurrentMinutes: () => 60 * now.getHours() + now.getMinutes(),
    getCurrentDay: () => now.getDate(),
    getCurrentMonth: () => now.getMonth() + 1,
    getCurrentYear: () => now.getFullYear(),

    printString(descriptor: number, x: number) {
      const len = bytes()[x]!;
      write(target(descriptor), bytes().slice(x + 1, x + 1 + len));
    },
    printBoolean: (descriptor: number, x: number) => print(descriptor, x ? "TRUE" : "FALSE"),
    printChar: (descriptor: number, x: number) => write(target(descriptor), new Uint8Array([x])),
    printInteger: (descriptor: number, x: number) => print(descriptor, String(x)),
    printFloat: (descriptor: number, x: number) => print(descriptor, String(x)),
    printNewline: (descriptor: number) => print(descriptor, "\n"),

    reset(length: number, pointer: number): number {
      const raw = nameAt(length, pointer);
      const name = cleanName(raw);
      if (name === "TTY:") return open({ name: "stdin", content: terminal, stdin: true });
      if (name === "TeXformats:TEX.POOL") return open({ name, content: new Uint8Array(), erstat: 1, eof: true });
      const data = find(name);
      if (data === undefined) return -1; // paused
      if (data === null) return open({ name, content: new Uint8Array(), erstat: 1, eof: true });
      return open({ name, content: data });
    },
    rewrite(length: number, pointer: number): number {
      const name = cleanName(nameAt(length, pointer));
      if (name === "TTY:") return open({ name: "stdout", content: new Uint8Array(), stdout: true });
      const id = open({ name, content: new Uint8Array(4096), writable: true });
      written.set(name, new Uint8Array());
      return id;
    },
    getfilesize(length: number, pointer: number): number {
      const name = cleanName(nameAt(length, pointer));
      const data = find(name);
      if (data === undefined) return -1; // paused
      return data ? data.length : -1;
    },
    close(_descriptor: number) {
      // Written files stay in `written`.
    },
    eof: (descriptor: number) => (files[descriptor]!.eof ? 1 : 0),
    erstat: (descriptor: number) => files[descriptor]!.erstat,
    eoln: (descriptor: number) => (files[descriptor]!.eoln ? 1 : 0),

    inputln(descriptor: number, bypassEoln: number, bufferp: number, firstp: number, lastp: number, _maxBufStackp: number, bufSize: number): boolean {
      const file = files[descriptor]!;
      const buffer = new Uint8Array(memory.buffer, bufferp, bufSize);
      const first = new Uint32Array(memory.buffer, firstp, 1);
      const last = new Uint32Array(memory.buffer, lastp, 1);
      last[0] = first[0]!;
      if (bypassEoln && !file.eof && file.eoln) file.position2++;
      if (file.eof) return false;
      if (file.position2 >= file.content.length) {
        file.eof = true;
        return false;
      }
      let end = file.content.indexOf(10, file.position2);
      if (end < 0) end = file.content.length;
      let line = file.content.subarray(file.position2, end);
      // Trailing spaces go, as TeX's input_ln drops them; so does a CR (CRLF files).
      let n = line.length;
      while (n > 0 && (line[n - 1] === 32 || line[n - 1] === 13)) n--;
      line = line.subarray(0, Math.min(n, bufSize - first[0]! - 1));
      buffer.set(line, first[0]!);
      last[0] = first[0]! + line.length;
      file.position2 = end;
      file.eoln = true;
      return true;
    },
    get(descriptor: number, pointer: number, length: number) {
      const file = files[descriptor]!;
      const mem = bytes();
      if (file.position >= file.content.length) {
        mem[pointer] = file.stdin ? 13 : 0;
        file.eof = true;
        file.eoln = true;
        return;
      }
      const n = Math.min(length, file.content.length - file.position);
      mem.set(file.content.subarray(file.position, file.position + n), pointer);
      file.eoln = mem[pointer] === 10 || mem[pointer] === 13;
      file.position += length;
    },
    put(descriptor: number, pointer: number, length: number) {
      write(files[descriptor]!, bytes().slice(pointer, pointer + length));
    },
    tex_final_end() {
      // TeX has finished; main() returns next.
    },
  };

  const instance = await WebAssembly.instantiate(module, { library, env: { memory } });
  exports = instance.exports as unknown as TexExports;
  exports.main();
  // main() returned: TeX finished, or paused for a file. Resume until it finishes.
  while (pending) {
    exports.asyncify_stop_unwind();
    const wait: Promise<void> = pending;
    pending = null;
    await wait;
    rewinding = true;
    exports.asyncify_start_rewind(DATA_ADDR);
    exports.main();
  }
  return { written, transcript, missing, read };
}
