/**
 * Whisper hallucination detection — pure utility module, no DOM.
 *
 * Whisper (especially small/multilingual variants) is known to emit
 * deterministic-looking garbage on inputs that fall outside its training
 * distribution:
 *
 *   - Silent / near-silent audio → "you you you you you" filler chain,
 *     "Thanks for watching!" / "Please subscribe" (YouTube contamination),
 *     "♪" / "." / "-" repeats.
 *   - Music with rhythmic vocals → "of thug of thug of thug" / "go to the
 *     go to the go to the" — the decoder locks onto a 2/3-word beat and
 *     loops it.
 *   - Long sustained tones / autotuned vowels → same effect.
 *
 * Greedy decode (`num_beams=1, temperature=0`) does NOT help here — the
 * determinism IS the problem (Whisper reliably produces the SAME garbage
 * on the SAME silent/musical input). Sampling would mask the issue but
 * break LocalAgreement-2.
 *
 * The right defence is downstream: when we see one of these patterns,
 * drop the tick output rather than commit it to the visible caption
 * stream. This module exposes the pure detection logic so it can be
 * unit-tested in isolation.
 */

/** Default threshold: 4+ consecutive identical n-grams = hallucination.
 *  Keep this in sync with HALLUCINATION_MAX_REPEAT in CaptionApp.script.ts. */
export const DEFAULT_REPEAT_THRESHOLD = 4;

/** Maximum n-gram size to scan for. Speech rarely has true 5+ word
 *  phrase repeats inside a single ~10s tick window; capping at 4
 *  keeps the scan O(N · 4) instead of O(N^2). */
export const MAX_NGRAM_SIZE = 4;

/**
 * Returns true if `text` looks like a Whisper hallucination — specifically,
 * if it contains a contiguous run of `threshold` or more occurrences of
 * any single token OR of any n-gram (n ∈ [1..MAX_NGRAM_SIZE]).
 *
 * Token comparison is lowercased + whitespace-collapsed; punctuation is
 * preserved (so "you, you, you, you, you" still triggers, but "you, you,
 * you the cat" does not).
 *
 * @param text  Candidate transcript text.
 * @param threshold  Run length that triggers the flag. Default 4.
 *                   2 = strict (false positives likely on real speech),
 *                   3 = balanced, 4 = lenient (default — only catches
 *                   obvious garbage).
 */
export function looksHallucinated(
  text: string,
  threshold: number = DEFAULT_REPEAT_THRESHOLD,
): boolean {
  const tokens = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length < threshold) return false;

  // Layer 1: single-word repeats — "you you you you you"
  {
    let run = 1;
    for (let i = 1; i < tokens.length; i++) {
      if (tokens[i] === tokens[i - 1]) {
        run++;
        if (run >= threshold) return true;
      } else {
        run = 1;
      }
    }
  }

  // Layer 2: n-gram phrase repeats — "of thug of thug of thug of thug"
  // For each n in [2..MAX_NGRAM_SIZE], scan for any contiguous run of
  // >= threshold identical non-overlapping n-grams starting from each
  // possible offset.
  for (let n = 2; n <= MAX_NGRAM_SIZE; n++) {
    if (tokens.length < n * threshold) continue;
    for (let start = 0; start <= tokens.length - n; start++) {
      const ngram = tokens.slice(start, start + n).join(" ");
      let run = 1;
      let pos = start + n;
      while (pos + n <= tokens.length) {
        const next = tokens.slice(pos, pos + n).join(" ");
        if (next !== ngram) break;
        run++;
        if (run >= threshold) return true;
        pos += n;
      }
    }
  }
  return false;
}
