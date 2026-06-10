import { describe, it, expect } from "vitest";
import { StabilityTracker, bucketForStreak } from "./confidence";

describe("v0.5 commit 7 — confidence tracker", () => {
  describe("bucketForStreak", () => {
    it("returns low for first sighting", () => {
      expect(bucketForStreak(1)).toBe("low");
    });

    it("returns med for 2-tick survival (LocalAgreement-2 about-to-commit)", () => {
      expect(bucketForStreak(2)).toBe("med");
    });

    it("returns high for 3+ tick survival (committed or imminent)", () => {
      expect(bucketForStreak(3)).toBe("high");
      expect(bucketForStreak(99)).toBe("high");
    });

    it("returns low for zero/negative (defensive)", () => {
      expect(bucketForStreak(0)).toBe("low");
      // Negative shouldn't occur but guard against caller bugs
      expect(bucketForStreak(-1)).toBe("low");
    });
  });

  describe("StabilityTracker.update", () => {
    it("returns all low on first tick (every word freshly appeared)", () => {
      const t = new StabilityTracker();
      const out = t.update(["how", "are", "you"]);
      expect(out).toEqual(["low", "low", "low"]);
    });

    it("graduates to med then high on consecutive identical hypotheses", () => {
      const t = new StabilityTracker();
      const tick1 = t.update(["how", "are", "you"]);
      expect(tick1).toEqual(["low", "low", "low"]);
      const tick2 = t.update(["how", "are", "you"]);
      expect(tick2).toEqual(["med", "med", "med"]);
      const tick3 = t.update(["how", "are", "you"]);
      expect(tick3).toEqual(["high", "high", "high"]);
      // Stays high indefinitely
      const tick4 = t.update(["how", "are", "you"]);
      expect(tick4).toEqual(["high", "high", "high"]);
    });

    it("extending the hypothesis with new tail words preserves the head streak", () => {
      const t = new StabilityTracker();
      t.update(["how", "are"]);
      const out = t.update(["how", "are", "you", "doing"]);
      // 'how' and 'are' kept their positions → med
      // 'you' and 'doing' are new → low
      expect(out).toEqual(["med", "med", "low", "low"]);
    });

    it("a word that survives 3 ticks at the same position is high even as tail grows", () => {
      const t = new StabilityTracker();
      t.update(["how"]);
      t.update(["how", "are"]);
      const out = t.update(["how", "are", "you"]);
      // 'how' has been at position 0 for 3 ticks → high
      // 'are' has been at position 1 for 2 ticks → med
      // 'you' is freshly appeared at position 2 → low
      expect(out).toEqual(["high", "med", "low"]);
    });

    it("changing a word at a position resets its streak", () => {
      const t = new StabilityTracker();
      t.update(["how", "are", "you"]);
      t.update(["how", "are", "you"]);
      const out = t.update(["how", "are", "youse"]); // last word changed
      // 'how' and 'are' kept → high
      // 'youse' is new at position 2 → low
      expect(out).toEqual(["high", "high", "low"]);
    });

    it("position-shifted words restart their streak (LocalAgreement reordering)", () => {
      const t = new StabilityTracker();
      t.update(["how", "are"]);
      t.update(["how", "are"]);
      // Whisper restarts mid-window with different prefix
      const out = t.update(["uh", "how", "are"]);
      // Position 0 now has 'uh' (new) → low
      // Position 1 has 'how' (was at 0 before, now at 1) → low (restart)
      // Position 2 has 'are' (was at 1 before, now at 2) → low (restart)
      expect(out).toEqual(["low", "low", "low"]);
    });

    it("truncated hypothesis drops the bucket for removed tail words", () => {
      const t = new StabilityTracker();
      t.update(["how", "are", "you", "doing"]);
      t.update(["how", "are", "you", "doing"]);
      const out = t.update(["how", "are"]);
      expect(out).toHaveLength(2);
      expect(out).toEqual(["high", "high"]);
    });

    it("returns an empty array for empty hypothesis", () => {
      const t = new StabilityTracker();
      const out = t.update([]);
      expect(out).toEqual([]);
    });

    it("returns empty array AND resets the in-position streaks (gap means restart)", () => {
      const t = new StabilityTracker();
      t.update(["how", "are"]);
      t.update(["how", "are"]);
      t.update([]); // gap tick (silence / non-agreeing hypothesis)
      const out = t.update(["how", "are"]);
      // After the empty tick, the streaks are wiped → these words are
      // freshly appeared again at low.
      expect(out).toEqual(["low", "low"]);
    });
  });

  describe("StabilityTracker.reset", () => {
    it("clears all streaks so the next update returns all low", () => {
      const t = new StabilityTracker();
      t.update(["how", "are"]);
      t.update(["how", "are"]);
      t.reset();
      const out = t.update(["how", "are"]);
      expect(out).toEqual(["low", "low"]);
    });

    it("is idempotent when called on a fresh tracker", () => {
      const t = new StabilityTracker();
      t.reset();
      t.reset();
      const out = t.update(["x"]);
      expect(out).toEqual(["low"]);
    });
  });

  describe("real-world tick sequence (regression scenario)", () => {
    it("models 5 ticks of a settling-then-extending hypothesis correctly", () => {
      const t = new StabilityTracker();
      // Tick 1: Whisper's first partial output
      expect(t.update(["hello"])).toEqual(["low"]);
      // Tick 2: 'hello' confirmed at position 0 + 'world' appears
      expect(t.update(["hello", "world"])).toEqual(["med", "low"]);
      // Tick 3: prefix stable, tail grows
      expect(t.update(["hello", "world", "how"])).toEqual(["high", "med", "low"]);
      // Tick 4: more growth, 'hello' commits internally but is still in
      // liveItems at this point (commit happens in agreement, not here)
      expect(t.update(["hello", "world", "how", "are"])).toEqual(["high", "high", "med", "low"]);
      // Tick 5: 'are' settles
      expect(t.update(["hello", "world", "how", "are", "you"])).toEqual([
        "high",
        "high",
        "high",
        "med",
        "low",
      ]);
    });
  });
});
