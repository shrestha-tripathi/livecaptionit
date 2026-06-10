/**
 * Share-a-transcript URL encoding / decoding (v0.4.3).
 *
 * Encode a TranscriptSegment[] into a URL-safe string that can be
 * appended to the home page URL as ?t=<payload>&v=1. The recipient
 * pastes the URL, app detects ?t= on load, decodes, and shows the
 * transcript in a read-only viewer.
 *
 * Pipeline:
 *   segments → JSON → UTF-8 bytes → gzip (CompressionStream) →
 *   base64url (no padding) → URL component
 *
 * Privacy: the URL CONTAINS the transcript. Anyone with the link
 * sees the text. We never upload it anywhere. Document this in the
 * Share dialog UX so users know what they're agreeing to.
 *
 * Limits:
 *  - Most browsers cap URLs at ~32 KB safely. After base64+gzip overhead
 *    that's about 16-22 KB of original transcript text. Way more than
 *    most live caption sessions produce.
 *  - We hard-cap the payload at MAX_PAYLOAD_BYTES to avoid generating
 *    URLs that some browsers/clients will silently truncate.
 *
 * Browser support:
 *  - CompressionStream: Chrome 80+, Edge 80+, Firefox 113+, Safari 16.4+.
 *    Same baseline as the rest of the app (Document PiP needs newer).
 *  - For unsupported browsers, encodeShareUrl rejects with a helpful error.
 */

import type { TranscriptSegment } from "./transcript";

const VERSION = "1";

/**
 * Hard cap on the encoded payload. ~16KB leaves headroom under the
 * universal 32KB URL limit even with the rest of the page URL.
 */
export const MAX_PAYLOAD_BYTES = 16384;

/**
 * Wire format for a shared transcript. Versioned so we can evolve
 * without breaking old links.
 */
export interface ShareBundle {
  /** Schema version literal. Currently 1. */
  v: 1;
  /** Compact transcript: array of [tMs, words[]] tuples.
   *  We chose tuples over named objects to shave bytes. */
  s: Array<[number, string[]]>;
  /** Optional preview / first-line label. */
  p?: string;
  /** Optional timestamp the original session was recorded. */
  t?: number;
}

/** Compact a TranscriptSegment[] into the wire format. */
export function buildBundle(segments: TranscriptSegment[]): ShareBundle {
  return {
    v: 1,
    s: segments.map((seg) => [seg.tMs, seg.words]),
    p: segments[0]?.words?.join(" ").slice(0, 80),
    t: Date.now(),
  };
}

/** Expand wire format back into TranscriptSegment[]. */
export function expandBundle(bundle: ShareBundle): TranscriptSegment[] {
  return bundle.s.map(([tMs, words]) => ({ tMs, words }));
}

/** Base64-URL-safe encoding (no padding). RFC 4648 §5. */
export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Base64-URL-safe decoding (auto-pad). */
export function base64UrlDecode(s: string): Uint8Array {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const std = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(std);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Encode segments into a URL string. Returns the FULL URL the user
 * should share. baseUrl defaults to the current location.origin.
 *
 * Throws if the resulting payload exceeds MAX_PAYLOAD_BYTES (use this
 * to surface "transcript too long to share" UX).
 */
export async function encodeShareUrl(
  segments: TranscriptSegment[],
  baseUrl: string,
): Promise<string> {
  if (typeof CompressionStream === "undefined") {
    throw new Error("Your browser doesn't support compressed share links. Use Export instead.");
  }
  const bundle = buildBundle(segments);
  const json = JSON.stringify(bundle);
  const jsonBytes = new TextEncoder().encode(json);

  const stream = new Blob([jsonBytes as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());

  const encoded = base64UrlEncode(compressed);
  if (encoded.length > MAX_PAYLOAD_BYTES) {
    throw new Error(
      `Transcript too long to share via URL (${encoded.length} bytes, limit ${MAX_PAYLOAD_BYTES}). Use Export to download the file instead.`,
    );
  }
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/?t=${encoded}&v=${VERSION}`;
}

/**
 * Inverse of encodeShareUrl. Reads the `t` param from the URL search
 * (or accepts a raw payload string), decompresses, validates the
 * version, returns the expanded segments + bundle metadata.
 *
 * Throws on:
 *   - Missing/empty payload
 *   - Decompression failure (corrupted URL)
 *   - JSON parse failure
 *   - Unknown version
 *
 * Caller wraps in try/catch + shows toast on failure.
 */
export async function decodeShareUrl(
  payload: string,
): Promise<{ segments: TranscriptSegment[]; bundle: ShareBundle }> {
  if (!payload) throw new Error("Empty share payload.");
  if (typeof DecompressionStream === "undefined") {
    throw new Error("Your browser doesn't support reading compressed share links.");
  }
  let compressed: Uint8Array;
  try {
    compressed = base64UrlDecode(payload);
  } catch {
    throw new Error("Share link is malformed.");
  }
  let decompressed: Uint8Array;
  try {
    const stream = new Blob([compressed as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
    decompressed = new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    throw new Error("Share link is corrupted or truncated.");
  }
  let bundle: ShareBundle;
  try {
    const json = new TextDecoder().decode(decompressed);
    bundle = JSON.parse(json);
  } catch {
    throw new Error("Share link contains invalid data.");
  }
  if (!bundle || bundle.v !== 1) {
    throw new Error(`Share link uses an unsupported version (${bundle?.v}).`);
  }
  if (!Array.isArray(bundle.s)) {
    throw new Error("Share link payload has unexpected shape.");
  }
  return { segments: expandBundle(bundle), bundle };
}

/**
 * Read the `?t=` parameter from the current URL. Returns null if absent.
 * Pure read — does not mutate location.
 */
export function readSharePayloadFromLocation(loc: { search: string }): string | null {
  const params = new URLSearchParams(loc.search);
  return params.get("t");
}
