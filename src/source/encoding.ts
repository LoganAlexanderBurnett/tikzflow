// Lossless conversion between file bytes and editor text.
//
// The editor works on JavaScript strings (UTF-16 code units), so loading must
// map bytes to text in a way that saving can reverse exactly:
// - A byte-order mark stays in the text as U+FEFF, so it is written back.
// - UTF-16 files are recognised by their byte-order mark.
// - Bytes that aren't valid UTF-8 are read as ISO-8859-1, which maps every
//   byte to one character, so even unknown 8-bit encodings round-trip.

export type Encoding = "utf-8" | "utf-16le" | "utf-16be" | "latin1";

export interface Decoded {
  text: string;
  encoding: Encoding;
}

export function decode(bytes: Uint8Array): Decoded {
  if (bytes[0] === 0xff && bytes[1] === 0xfe && bytes.length % 2 === 0) {
    return { text: new TextDecoder("utf-16le", { ignoreBOM: true }).decode(bytes), encoding: "utf-16le" };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff && bytes.length % 2 === 0) {
    return { text: new TextDecoder("utf-16be", { ignoreBOM: true }).decode(bytes), encoding: "utf-16be" };
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    let text = "";
    for (let i = 0; i < bytes.length; i += 8192) {
      text += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return { text, encoding: "latin1" };
  }
}

export class UnencodableError extends Error {
  readonly encoding: Encoding;
  readonly offset: number;
  constructor(encoding: Encoding, offset: number) {
    super(`Character at offset ${offset} can't be written as ${encoding}`);
    this.encoding = encoding;
    this.offset = offset;
  }
}

/** Encodes text back to bytes. Throws UnencodableError if a character doesn't fit. */
export function encode(text: string, encoding: Encoding): Uint8Array {
  switch (encoding) {
    case "utf-8":
      return new TextEncoder().encode(text);
    case "latin1": {
      const out = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c > 0xff) throw new UnencodableError(encoding, i);
        out[i] = c;
      }
      return out;
    }
    case "utf-16le":
    case "utf-16be": {
      const out = new Uint8Array(text.length * 2);
      const view = new DataView(out.buffer);
      for (let i = 0; i < text.length; i++) view.setUint16(i * 2, text.charCodeAt(i), encoding === "utf-16le");
      return out;
    }
  }
}
