// Share links (M3 step 13, D74): the code, compressed, in the URL's fragment.
// A fragment is never sent to a server, so a link carries the picture with no
// upload and nothing stored anywhere: whoever has the link has the code.
//
// Format: `#tf1=<base64url of the deflate-raw of the UTF-8 code>` and, for a
// file with several pictures, `&p=<number>` (1-based) for the one to show. The
// version in the name lets a later format sit beside this one.

const KEY = "tf1";

const b64 = (bytes: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64 = (t: string): Uint8Array => {
  const s = atob(t.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>));
  return new Uint8Array(await out.arrayBuffer());
}

/** Share links need the browser's CompressionStream (every current browser has it). */
export const canShare = (): boolean => typeof CompressionStream === "function" && typeof DecompressionStream === "function";

/** The fragment (without the #) that carries `code`, and picture number `picture` (0-based) when it isn't the first. */
export async function encodeShare(code: string, picture = 0): Promise<string> {
  const packed = await pipe(new TextEncoder().encode(code), new CompressionStream("deflate-raw"));
  return `${KEY}=${b64(packed)}${picture > 0 ? `&p=${picture + 1}` : ""}`;
}

/** Reads a fragment (with or without its #). Null when it isn't a share link or is damaged. */
export async function decodeShare(hash: string): Promise<{ text: string; picture: number } | null> {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const data = params.get(KEY);
  if (!data || !canShare()) return null;
  try {
    const bytes = await pipe(unb64(data), new DecompressionStream("deflate-raw"));
    const p = Number(params.get("p") ?? "1");
    return { text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes), picture: Number.isInteger(p) && p >= 1 ? p - 1 : 0 };
  } catch {
    return null;
  }
}

/** Whether the fragment looks like a share link, so the page can say it couldn't read a damaged one. */
export const isShareHash = (hash: string): boolean => new URLSearchParams(hash.replace(/^#/, "")).has(KEY);

/** The whole link for the code, on this page. */
export async function shareLink(code: string, picture: number): Promise<string> {
  const url = new URL(location.href);
  url.hash = await encodeShare(code, picture);
  // Not the visitor's own settings: the link is the code only.
  url.searchParams.delete("engine");
  return url.toString();
}
