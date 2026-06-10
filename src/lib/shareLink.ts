/**
 * Share-a-transcript URL encoding / decoding (v0.4.3, dual-versioned in v0.5).
 *
 * Encode a TranscriptSegment[] (v1) or TranscriptSegment2[] (v2) into a
 * URL-safe string that can be appended to the home page URL as
 * ?t=<payload>&v=1|2. The recipient pastes the URL, app detects ?t= on
 * load, decodes, and shows the transcript in a read-only viewer.
 *
 * v0.5 changes:
 *  - Bundle format gained a `v: 2` variant whose `s` array carries
 *    Word objects per segment instead of bare strings. Per-word timing
 *    survives the round-trip (no synthetic upgrade needed for v2 links).
 *  - Encoder defaults to emitting v: 2 since v0.5+ records always carry
 *    Word[] in agreement.committedItems. A v1 helper is kept (rarely
 *    needed) for callers that explicitly want the smaller wire format.
 *  - Decoder accepts BOTH v: 1 and v: 2 transparently. v1 links created
 *    in v0.4.3+ keep working in v0.5+ readers — they're upgraded to v2
 *    with synthetic uniform per-word timing at expand time.
 *
 * Pipeline (encode):
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
 *  - v: 2 payloads are ~30-50% larger than v: 1 (per-word timing
 *    serializes a numeric pair per word). Still well under the cap for
 *    typical live caption sessions.
 *
 * Browser support:
 *  - CompressionStream: Chrome 80+, Edge 80+, Firefox 113+, Safari 16.4+.
 *    Same baseline as the rest of the app (Document PiP needs newer).
 *  - For unsupported browsers, encodeShareUrl rejects with a helpful error.
 */

import type {
  AnyTranscriptSegment,
  TranscriptSegment,
  TranscriptSegment2,
} from "./transcript";
import { toV2Segments } from "./transcript";
import type { Word } from "./word";

/**
 * Hard cap on the encoded payload. ~16KB leaves headroom under the
 * universal 32KB URL limit even with the rest of the page URL.
 */
export const MAX_PAYLOAD_BYTES = 16384;

/** v1 wire format — bare strings per word, no per-word timing. */
export interface ShareBundleV1 {
  /** Schema version literal. */
  v: 1;
  /** Compact transcript: array of [tMs, words[]] tuples. */
  s: Array<[number, string[]]>;
  /** Optional preview / first-line label. */
  p?: string;
  /** Optional timestamp the original session was recorded. */
  t?: number;
}

/** v2 wire format — Word[] per segment with per-word timing. */
export interface ShareBundleV2 {
  /** Schema version literal. */
  v: 2;
  /**
   * Compact transcript: array of [tMs, words[]] tuples where each word
   * is a tuple `[text, tStartMs, tEndMs, confidence?]`. Tuples vs named
   * objects to keep the payload small — v2 already costs more bytes
   * per word than v1 thanks to timing.
   */
  s: Array<[number, Array<[string, number, number] | [string, number, number, number]>]>;
  /** Optional preview / first-line label. */
  p?: string;
  /** Optional timestamp the original session was recorded. */
  t?: number;
}

export type ShareBundle = ShareBundleV1 | ShareBundleV2;

/**
 * Build a v2 ShareBundle from segments. v1 segments get upgraded with
 * synthetic per-word timing via toV2Segments first. v0.5 encoder always
 * emits v: 2 — keeps the wire format on a clear upgrade path.
 */
export function buildBundle(segments: AnyTranscriptSegment[]): ShareBundleV2 {
  const v2 = toV2Segments(segments);
  const firstWords = v2[0]?.words ?? [];
  const previewText = firstWords.map((w) => w.text.trim()).join(" ").slice(0, 80);
  return {
    v: 2,
    s: v2.map((seg) => [
      seg.tMs,
      seg.words.map((w) =>
        w.confidence !== undefined
          ? ([w.text, w.tStartMs, w.tEndMs, w.confidence] as [string, number, number, number])
          : ([w.text, w.tStartMs, w.tEndMs] as [string, number, number]),
      ),
    ]),
    p: previewText,
    t: Date.now(),
  };
}

/**
 * Legacy v1 builder — kept for callers that explicitly want the smaller
 * wire format. Not used by the default encoder anymore. v2 wire size
 * overhead is ~30-50% so v1 is meaningfully smaller for huge transcripts.
 */
export function buildBundleV1(segments: TranscriptSegment[]): ShareBundleV1 {
  return {
    v: 1,
    s: segments.map((seg) => [seg.tMs, seg.words]),
    p: segments[0]?.words?.join(" ").slice(0, 80),
    t: Date.now(),
  };
}

/** Expand wire format back into TranscriptSegment2[]. Always returns v2
 *  shape (v1 bundles get synthetic per-word timing). */
export function expandBundle(bundle: ShareBundle): TranscriptSegment2[] {
  if (bundle.v === 1) {
    // v1: bare strings → upgrade with synthetic uniform timing.
    return bundle.s.map(([tMs, words]) => {
      if (words.length === 0) return { words: [] as Word[], tMs };
      const SYNTHETIC_SEGMENT_MS = 1000;
      const perWord = SYNTHETIC_SEGMENT_MS / words.length;
      return {
        words: words.map((text, i) => ({
          text,
          tStartMs: Math.round(i * perWord),
          tEndMs: Math.round((i + 1) * perWord),
        })),
        tMs,
      };
    });
  }
  // v2: tuples → Word objects.
  return bundle.s.map(([tMs, words]) => ({
    words: words.map((tup) => {
      const [text, tStartMs, tEndMs, conf] = tup as [string, number, number, number?];
      return conf !== undefined
        ? { text, tStartMs, tEndMs, confidence: conf }
        : { text, tStartMs, tEndMs };
    }),
    tMs,
  }));
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
 *
 * v0.5 emits v: 2 by default (matches the v0.5+ recording shape).
 */
export async function encodeShareUrl(
  segments: AnyTranscriptSegment[],
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
  return `${base}/?t=${encoded}&v=${bundle.v}`;
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
 *   - Unknown version (anything not 1 or 2)
 *
 * v0.5 accepts both v: 1 (legacy, synthesized timing) and v: 2
 * (current). `segments` is ALWAYS returned as TranscriptSegment2[] —
 * callers don't need to discriminate.
 *
 * Caller wraps in try/catch + shows toast on failure.
 */
export async function decodeShareUrl(
  payload: string,
): Promise<{ segments: TranscriptSegment2[]; bundle: ShareBundle }> {
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
  if (!bundle || (bundle.v !== 1 && bundle.v !== 2)) {
    throw new Error(`Share link uses an unsupported version (${(bundle as { v?: unknown })?.v}).`);
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
