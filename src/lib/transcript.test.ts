import { describe, it, expect } from "vitest";
import {
  formatTxt,
  formatVtt,
  formatSrt,
  defaultFilename,
  isV2Segment,
  upgradeSegment,
  downgradeSegment,
  toV1Segments,
  toV2Segments,
  type TranscriptSegment,
  type TranscriptSegment2,
} from "./transcript";
import type { Word } from "./word";

const segs: TranscriptSegment[] = [
  { words: ["Hello", "world"], tMs: 0 },
  { words: ["how", "are", "you"], tMs: 800 },
  { words: ["doing", "today"], tMs: 1600 },
];

describe("transcript formatters", () => {
  describe("formatTxt", () => {
    it("returns empty string for empty input", () => {
      expect(formatTxt([])).toBe("");
    });

    it("joins words with spaces into one paragraph by default", () => {
      const out = formatTxt(segs);
      expect(out).toBe("Hello world how are you doing today\n");
    });

    it("splits into paragraphs on silence > 3s", () => {
      const withGap: TranscriptSegment[] = [
        { words: ["First", "para"], tMs: 0 },
        { words: ["Second", "para"], tMs: 5000 }, // 5s gap > 3s threshold
      ];
      expect(formatTxt(withGap)).toBe("First para\n\nSecond para\n");
    });

    it("skips empty word arrays", () => {
      const withEmpty: TranscriptSegment[] = [
        { words: ["one"], tMs: 0 },
        { words: [], tMs: 500 },
        { words: ["two"], tMs: 1000 },
      ];
      expect(formatTxt(withEmpty)).toBe("one two\n");
    });
  });

  describe("formatVtt", () => {
    it("starts with WEBVTT header", () => {
      expect(formatVtt(segs).startsWith("WEBVTT\n")).toBe(true);
    });

    it("emits one cue per segment with dot-separated timestamps", () => {
      const out = formatVtt(segs);
      expect(out).toContain("00:00:00.000 --> 00:00:00.800");
      expect(out).toContain("Hello world");
      expect(out).toContain("how are you");
      expect(out).toContain("doing today");
    });

    it("final cue gets a +2s end timestamp", () => {
      const out = formatVtt(segs);
      // Last cue starts at 1600ms = 00:00:01.600, ends at 3600ms = 00:00:03.600
      expect(out).toContain("00:00:01.600 --> 00:00:03.600");
    });

    it("enforces minimum 500ms cue duration", () => {
      // If next segment is < 500ms later, end should still be start + 500
      const fast: TranscriptSegment[] = [
        { words: ["one"], tMs: 0 },
        { words: ["two"], tMs: 200 },
      ];
      const out = formatVtt(fast);
      // Cue 1: start 0, end max(500, 200) = 500
      expect(out).toContain("00:00:00.000 --> 00:00:00.500");
    });

    it("handles hours correctly", () => {
      const longSession: TranscriptSegment[] = [
        { words: ["start"], tMs: 0 },
        { words: ["later"], tMs: 3_661_500 }, // 1h 1m 1.5s
      ];
      const out = formatVtt(longSession);
      expect(out).toContain("01:01:01.500 -->");
    });
  });

  describe("formatSrt", () => {
    it("uses comma-separated milliseconds", () => {
      const out = formatSrt(segs);
      expect(out).toContain("00:00:00,000 --> 00:00:00,800");
      expect(out).not.toContain("WEBVTT");
    });

    it("numbers cues starting from 1", () => {
      const out = formatSrt(segs);
      const lines = out.split("\n");
      expect(lines[0]).toBe("1");
      expect(lines).toContain("2");
      expect(lines).toContain("3");
    });
  });

  describe("defaultFilename", () => {
    it("formats as livecaptionit-YYYY-MM-DD-HHMM.{ext}", () => {
      const fixed = new Date(2026, 5, 9, 14, 30); // June 9 2026 14:30 (month 0-indexed)
      expect(defaultFilename("txt", fixed)).toBe("livecaptionit-2026-06-09-1430.txt");
      expect(defaultFilename("vtt", fixed)).toBe("livecaptionit-2026-06-09-1430.vtt");
      expect(defaultFilename("srt", fixed)).toBe("livecaptionit-2026-06-09-1430.srt");
    });
  });
});

// ────────────────────────────────────────────────────────────────────────
// v0.5 — TranscriptSegment2 (per-word timing) + dual-version helpers
// ────────────────────────────────────────────────────────────────────────

const w = (text: string, tStart: number, tEnd: number, conf?: number): Word => ({
  text,
  tStartMs: tStart,
  tEndMs: tEnd,
  ...(conf !== undefined ? { confidence: conf } : {}),
});

const v2Segs: TranscriptSegment2[] = [
  { tMs: 0, words: [w("Hello", 0, 420), w("world", 420, 840)] },
  { tMs: 800, words: [w("how", 0, 200), w("are", 200, 400), w("you", 400, 600)] },
  { tMs: 1600, words: [w("doing", 0, 400), w("today", 400, 800)] },
];

describe("v0.5 segment shape helpers", () => {
  describe("isV2Segment", () => {
    it("returns true for a v2 segment with Word[] words", () => {
      expect(isV2Segment(v2Segs[0])).toBe(true);
    });

    it("returns false for a v1 segment with string[] words", () => {
      expect(isV2Segment(segs[0])).toBe(false);
    });

    it("returns false for an empty-words segment (unambiguously v1 by convention)", () => {
      expect(isV2Segment({ words: [], tMs: 100 })).toBe(false);
      expect(isV2Segment({ words: [] as Word[], tMs: 100 })).toBe(false);
    });
  });

  describe("upgradeSegment", () => {
    it("synthesizes uniform per-word timing from a v1 segment", () => {
      const v1 = { words: ["one", "two", "three", "four"], tMs: 1000 };
      const v2 = upgradeSegment(v1);
      expect(v2.tMs).toBe(1000);
      expect(v2.words).toHaveLength(4);
      // 1000ms synthetic window / 4 words = 250ms per word
      expect(v2.words[0]).toEqual({ text: "one", tStartMs: 0, tEndMs: 250 });
      expect(v2.words[1]).toEqual({ text: "two", tStartMs: 250, tEndMs: 500 });
      expect(v2.words[3]).toEqual({ text: "four", tStartMs: 750, tEndMs: 1000 });
    });

    it("handles a single-word segment without divide-by-zero", () => {
      const v2 = upgradeSegment({ words: ["lone"], tMs: 500 });
      expect(v2.words).toEqual([{ text: "lone", tStartMs: 0, tEndMs: 1000 }]);
    });

    it("returns empty words for an empty segment", () => {
      expect(upgradeSegment({ words: [], tMs: 500 })).toEqual({ words: [], tMs: 500 });
    });
  });

  describe("downgradeSegment", () => {
    it("collapses v2 → v1 by extracting trimmed text", () => {
      const v2: TranscriptSegment2 = {
        tMs: 100,
        words: [w("hello", 0, 200), w(" world", 200, 400)],
      };
      expect(downgradeSegment(v2)).toEqual({ words: ["hello", "world"], tMs: 100 });
    });

    it("preserves confidence-loss: downgrade is lossy by design", () => {
      const v2: TranscriptSegment2 = {
        tMs: 100,
        words: [w("hi", 0, 100, 0.95)],
      };
      const v1 = downgradeSegment(v2);
      expect(v1.words).toEqual(["hi"]);
      // No confidence in v1 shape — assertion is about API: v1 word IS just a string.
      expect(typeof v1.words[0]).toBe("string");
    });
  });

  describe("toV2Segments / toV1Segments mixed input", () => {
    it("toV2Segments passes v2 through unchanged + upgrades v1 entries", () => {
      const mixed = [segs[0], v2Segs[0]];
      const all = toV2Segments(mixed);
      expect(all).toHaveLength(2);
      // First entry was v1 — upgraded with synthetic timing
      expect(all[0].words[0]).toEqual({ text: "Hello", tStartMs: 0, tEndMs: 500 });
      // Second entry was v2 — passed through unchanged (same reference)
      expect(all[1]).toBe(v2Segs[0]);
    });

    it("toV1Segments downgrades v2 entries + passes v1 through unchanged", () => {
      const mixed = [v2Segs[0], segs[0]];
      const all = toV1Segments(mixed);
      expect(all).toHaveLength(2);
      // First was v2 — downgraded to bare strings
      expect(all[0]).toEqual({ tMs: 0, words: ["Hello", "world"] });
      // Second was v1 — passed through unchanged
      expect(all[1]).toBe(segs[0]);
    });
  });

  describe("formatters accept v2 input", () => {
    it("formatTxt produces same text from v2 as from v1", () => {
      // v1 segs and v2Segs carry identical text per the fixtures above.
      const fromV1 = formatTxt(segs);
      const fromV2 = formatTxt(v2Segs);
      expect(fromV2).toBe(fromV1);
    });

    it("formatVtt produces same output from v2 as from v1 (segment-level cues)", () => {
      // v0.5 commit 6 will add per-word cue granularity; commit 5 keeps
      // formatters segment-level so this equivalence holds.
      const fromV1 = formatVtt(segs);
      const fromV2 = formatVtt(v2Segs);
      expect(fromV2).toBe(fromV1);
    });

    it("formatTxt handles mixed v1+v2 input", () => {
      const mixed = [segs[0], v2Segs[1], segs[2]];
      const out = formatTxt(mixed);
      expect(out).toBe("Hello world how are you doing today\n");
    });

    it("formatSrt handles v2 input correctly (cue numbers + comma timestamps)", () => {
      const out = formatSrt(v2Segs);
      const lines = out.split("\n");
      expect(lines[0]).toBe("1");
      expect(out).toContain("00:00:00,000 --> 00:00:00,800");
      expect(out).toContain("Hello world");
    });
  });
});
