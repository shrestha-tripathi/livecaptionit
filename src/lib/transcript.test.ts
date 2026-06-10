import { describe, it, expect } from "vitest";
import {
  formatTxt,
  formatVtt,
  formatSrt,
  defaultFilename,
  type TranscriptSegment,
} from "./transcript";

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
