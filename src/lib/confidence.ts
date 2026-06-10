/**
 * v0.5 commit 7 — Confidence-coloured live tail
 * ────────────────────────────────────────────────────────────────────────
 *
 * Computes per-word "confidence" buckets ("low" | "med" | "high") from
 * the stream of liveItems hypotheses emitted by the Whisper agreement
 * loop. This is a STABILITY-BASED heuristic — we never look at logprob /
 * model probabilities (transformers.js doesn't expose them in a stable
 * way, see roadmap OQ #2).
 *
 * The intuition: every ~700ms tick produces a new hypothesis. A word
 * that appears at position N in the live tail and STAYS at position N
 * across multiple consecutive ticks is more likely to be correct than
 * a word that appears once and gets replaced next tick. We track how
 * many ticks each (position, key) pair has survived in liveItems and
 * map that to a bucket.
 *
 *   - First tick:                   "low"  (just appeared, no evidence)
 *   - 2 consecutive ticks:          "med"  (still here, settling)
 *   - 3+ consecutive ticks:         "high" (LocalAgreement-2 will commit
 *                                          it on the next stable tick;
 *                                          this is the "about to commit"
 *                                          visual cue).
 *
 * Note: committed words (read from agreement.committedItems) are always
 * "high" by definition — once LocalAgreement-2 commits, those words
 * never retract. The bucket calculation here is ONLY for the live tail.
 *
 * Pure-function design. No DOM, no state outside the StabilityTracker
 * class. Fully unit-testable in node-environment vitest.
 *
 * Why not transformers.js logprob? The roadmap OQ #2 spelled it out:
 * patching the worker to surface logprobs requires forking the model
 * pipeline + emitting an extra per-token probability stream + plumbing
 * it through Word objects. Adds ~150 LOC, breaks the worker API, and
 * the stability heuristic captures ~80% of the same signal for ~5% of
 * the code. Defer logprob to v0.6+ if real demand emerges.
 */

/** Confidence bucket. UI maps these to colour intensity via CSS. */
export type ConfidenceBucket = "low" | "med" | "high";

/**
 * Number of consecutive ticks a (position, key) pair must survive in
 * liveItems to graduate to the next bucket. Tuned to match
 * LocalAgreement-2 (N=2): a word that holds for 2 ticks IS about to be
 * committed, so it visually previews the commit by jumping to "high".
 */
const HIGH_STREAK_THRESHOLD = 3;
const MED_STREAK_THRESHOLD = 2;

/**
 * Compute the bucket for a given streak count.
 *
 * Exposed for unit testing + so the renderer can short-circuit when
 * confidence display is disabled (always returns "high" in that case
 * because the caller skips this function entirely — but it's cheap
 * enough that we don't optimize that path).
 */
export function bucketForStreak(streak: number): ConfidenceBucket {
  if (streak >= HIGH_STREAK_THRESHOLD) return "high";
  if (streak >= MED_STREAK_THRESHOLD) return "med";
  return "low";
}

/**
 * Tracks per-position streaks across consecutive liveItems hypotheses.
 *
 * Usage:
 *   const tracker = new StabilityTracker();
 *   // each tick after agreement.ingest():
 *   const buckets = tracker.update(
 *     agreement.liveItems.map(w => w.text.toLowerCase().trim()),
 *   );
 *   // buckets[i] is the bucket for liveItems[i]
 *   // Call tracker.reset() at session boundaries (start/clear/silence-reset).
 *
 * Position-keyed because two adjacent ticks like:
 *   tick N:   ["how", "are", "you"]
 *   tick N+1: ["how", "are", "you", "doing"]
 * should give "how"@0 a streak of 2, "are"@1 a streak of 2, "you"@2 a
 * streak of 2, "doing"@3 a streak of 1.
 *
 * Whereas:
 *   tick N:   ["how", "are"]
 *   tick N+1: ["this", "is", "different"]
 * resets all positions because the keys at every position changed.
 */
export class StabilityTracker {
  /**
   * Streak history keyed by `${position}:${key}`. Map is small (≤
   * MAX_LIVE_WORDS, ~20 entries) and is wiped on every update because
   * we rebuild it from the new liveItems. No memory growth concern.
   */
  private streaks = new Map<string, number>();

  /**
   * Ingest the latest liveItems keys + return the bucket for each.
   *
   * @param keys Normalised keys (same shape Agreement.keyFn produces:
   *   `word.text.toLowerCase().trim()`). The caller MUST pass the
   *   normalised form, not the display form, so case-fluctuation
   *   between ticks doesn't break the streak.
   * @returns Array of buckets, same length as `keys`.
   */
  update(keys: string[]): ConfidenceBucket[] {
    const nextStreaks = new Map<string, number>();
    const buckets: ConfidenceBucket[] = new Array(keys.length);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const slotKey = `${i}:${key}`;
      const prev = this.streaks.get(slotKey) ?? 0;
      const next = prev + 1;
      nextStreaks.set(slotKey, next);
      buckets[i] = bucketForStreak(next);
    }
    this.streaks = nextStreaks;
    return buckets;
  }

  /** Clear all streak state. Call at session boundaries. */
  reset(): void {
    this.streaks.clear();
  }
}
