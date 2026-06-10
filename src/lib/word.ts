/**
 * Per-word transcript primitive — shared by:
 *   - public/whisper-worker.js (emits Word[] in result.chunks)
 *   - src/lib/whisperClient.ts (deserializes worker payload)
 *   - src/lib/agreement.ts (LocalAgreement-2 operates on Word[])
 *   - src/lib/transcript.ts (export formatters consume Word[])
 *   - src/lib/sessionStore.ts (persists Word[] in TranscriptSegment.words)
 *
 * v0.4.8 (this commit): added as part of the word-timestamp plumbing
 * migration. v0.5 visible features (sentence-grouped .vtt, confidence-
 * coloured live tail, transcript editor) all consume this shape.
 *
 * Plain object. No methods, no class. Serializes cleanly to JSON for
 * shareLink + sessionStore.
 */
export interface Word {
  /** The word, including leading space if any (matches transformers.js). */
  text: string;
  /** Start of this word in the audio window, in ms from window start. */
  tStartMs: number;
  /** End of this word in the audio window, in ms from window start. */
  tEndMs: number;
  /**
   * Optional [0..1] confidence. Not populated in v0.4.8 (per-word logprob
   * isn't in the transformers.js default output). Will be filled in v0.5
   * commit 7 via stability-based heuristic — words that took many
   * agreement ticks to stabilize are tagged low confidence. See
   * docs/roadmap/v0.5-word-timestamps.md Open Question #2.
   */
  confidence?: number;
}

/**
 * Best-effort runtime guard for Word shape coming off the worker
 * postMessage boundary. Returns true if `x` has the minimum fields we
 * need to feed into agreement + transcript export. Used by whisperClient
 * to filter malformed chunks defensively (rare, but a transformers.js
 * minor-version bump could shift the field names).
 */
export function isWord(x: unknown): x is Word {
  if (!x || typeof x !== "object") return false;
  const w = x as Partial<Word>;
  return (
    typeof w.text === "string" &&
    typeof w.tStartMs === "number" &&
    typeof w.tEndMs === "number" &&
    Number.isFinite(w.tStartMs) &&
    Number.isFinite(w.tEndMs)
  );
}

/**
 * Coerce a possibly-mixed array (after JSON round-trip via worker
 * postMessage, IDB, or shareLink decode) into a clean Word[]. Filters
 * malformed entries instead of throwing — agreement is resilient to
 * missing words, but crashing the worker payload would stall the
 * whole streaming pipeline. Logs a single console.warn per call if
 * any entries were dropped (helps surface transformers.js shape
 * regressions without spamming).
 */
export function coerceWords(input: unknown): Word[] {
  if (!Array.isArray(input)) return [];
  const out: Word[] = [];
  let dropped = 0;
  for (const item of input) {
    if (isWord(item)) {
      out.push(item);
    } else {
      dropped++;
    }
  }
  if (dropped > 0 && typeof console !== "undefined") {
    console.warn(`[whisper] coerceWords dropped ${dropped} malformed chunk(s)`);
  }
  return out;
}
