import { describe, it, expect } from "vitest";
import { renderEditableSegments, reconcileEditedText } from "./transcriptEditor";
import type { TranscriptSegment2 } from "./transcript";
import type { Word } from "./word";

function w(text: string, tStartMs: number, tEndMs: number): Word {
  return { text, tStartMs, tEndMs };
}

const segs: TranscriptSegment2[] = [
  { tMs: 0, words: [w("Hello", 0, 400), w("world", 400, 800)] },
  { tMs: 1500, words: [w("How", 0, 200), w("are", 200, 400), w("you", 400, 700)] },
  { tMs: 2500, words: [w("Fine", 0, 400), w("thanks", 400, 900)] },
];

describe("v0.5 commit 8 — transcript editor helpers", () => {
  describe("renderEditableSegments", () => {
    it("produces empty-state markup for empty input", () => {
      const html = renderEditableSegments([]);
      expect(html).toContain("(empty transcript)");
      expect(html).toContain("cp-edit-empty");
    });

    it("wraps each word in a span with segment + word indices", () => {
      const html = renderEditableSegments(segs);
      expect(html).toContain('data-segment-idx="0"');
      expect(html).toContain('data-segment-idx="1"');
      expect(html).toContain('data-segment-idx="2"');
      expect(html).toContain('data-word-idx="0"');
      // 'world' is at segment 0, word 1
      expect(html).toContain('data-segment-idx="0" data-word-idx="1">world</span>');
      // 'you' is at segment 1, word 2
      expect(html).toContain('data-segment-idx="1" data-word-idx="2">you</span>');
    });

    it("emits one <p data-segment-idx=N> per segment", () => {
      const html = renderEditableSegments(segs);
      const paraCount = (html.match(/<p data-segment-idx=/g) || []).length;
      expect(paraCount).toBe(3);
    });

    it("escapes HTML in word text (defense vs accidental injection)", () => {
      const malicious: TranscriptSegment2[] = [
        { tMs: 0, words: [w('<script>alert("x")</script>', 0, 100)] },
      ];
      const html = renderEditableSegments(malicious);
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
      expect(html).toContain("&quot;");
    });

    it("skips empty-word segments", () => {
      const withEmpty: TranscriptSegment2[] = [
        { tMs: 0, words: [w("one", 0, 100)] },
        { tMs: 500, words: [] },
        { tMs: 1000, words: [w("two", 0, 100)] },
      ];
      const html = renderEditableSegments(withEmpty);
      const paraCount = (html.match(/<p data-segment-idx=/g) || []).length;
      expect(paraCount).toBe(2); // segment 1 with empty words is skipped
    });

    it("falls back to empty-state if ALL segments are empty", () => {
      const allEmpty: TranscriptSegment2[] = [
        { tMs: 0, words: [] },
        { tMs: 500, words: [] },
      ];
      const html = renderEditableSegments(allEmpty);
      expect(html).toContain("(empty transcript)");
    });
  });

  describe("reconcileEditedText", () => {
    it("returns empty array for empty edited text", () => {
      expect(reconcileEditedText("", segs)).toEqual([]);
      expect(reconcileEditedText("   \n\n  ", segs)).toEqual([]);
    });

    it("preserves timing for unchanged words (pure roundtrip)", () => {
      // Render then trivially text-extract = same content as original
      const editedText = "Hello world\n\nHow are you\n\nFine thanks";
      const result = reconcileEditedText(editedText, segs);
      expect(result).toHaveLength(3);
      // tMs anchors preserved
      expect(result[0].tMs).toBe(0);
      expect(result[1].tMs).toBe(1500);
      expect(result[2].tMs).toBe(2500);
      // Word timing preserved on unchanged words
      expect(result[0].words[0]).toMatchObject({ text: "Hello", tStartMs: 0, tEndMs: 400 });
      expect(result[1].words[2]).toMatchObject({ text: "you", tStartMs: 400, tEndMs: 700 });
    });

    it("preserves timing on case-fluctuation (key is lowercased)", () => {
      const editedText = "HELLO world\n\nHow are You\n\nFine thanks";
      const result = reconcileEditedText(editedText, segs);
      // Edited text "HELLO" matches original "Hello" by lowercased key
      expect(result[0].words[0].tStartMs).toBe(0);
      expect(result[0].words[0].tEndMs).toBe(400);
      // Display text reflects user's edit (preserves case as typed)
      expect(result[0].words[0].text).toBe("HELLO");
      // "You" matches "you" (lowercased)
      expect(result[1].words[2].tStartMs).toBe(400);
      expect(result[1].words[2].text).toBe("You");
    });

    it("typo fix on a single word synthesizes timing for the replacement", () => {
      // Replace "thanks" → "thx" in segment 2
      const editedText = "Hello world\n\nHow are you\n\nFine thx";
      const result = reconcileEditedText(editedText, segs);
      expect(result[2].words[0].text).toBe("Fine");
      expect(result[2].words[0].tStartMs).toBe(0); // unchanged
      expect(result[2].words[1].text).toBe("thx");
      // New word — synthetic timing within original segment's span
      // (segment 2 original span: 0 to 900 = 900ms across 2 words = 450ms per word, min 50)
      expect(result[2].words[1].tStartMs).toBeGreaterThan(0);
      expect(result[2].words[1].tEndMs).toBeGreaterThan(result[2].words[1].tStartMs);
    });

    it("adding a new word at the end of a segment extends the word list", () => {
      const editedText = "Hello world wow\n\nHow are you\n\nFine thanks";
      const result = reconcileEditedText(editedText, segs);
      expect(result[0].words).toHaveLength(3);
      // Original 2 words keep their original timing
      expect(result[0].words[0]).toMatchObject({ text: "Hello", tStartMs: 0, tEndMs: 400 });
      expect(result[0].words[1]).toMatchObject({ text: "world", tStartMs: 400, tEndMs: 800 });
      // New word "wow" gets synthetic timing
      expect(result[0].words[2].text).toBe("wow");
    });

    it("removing a word from a segment shortens the word list cleanly", () => {
      const editedText = "Hello\n\nHow are you\n\nFine thanks";
      const result = reconcileEditedText(editedText, segs);
      expect(result[0].words).toHaveLength(1);
      expect(result[0].words[0].text).toBe("Hello");
    });

    it("removing a whole paragraph drops the trailing segments", () => {
      const editedText = "Hello world\n\nHow are you";
      const result = reconcileEditedText(editedText, segs);
      expect(result).toHaveLength(2);
      expect(result[0].tMs).toBe(0);
      expect(result[1].tMs).toBe(1500);
    });

    it("adding a new paragraph synthesizes timing past the last segment", () => {
      const editedText =
        "Hello world\n\nHow are you\n\nFine thanks\n\nA new paragraph here";
      const result = reconcileEditedText(editedText, segs);
      expect(result).toHaveLength(4);
      // The 4th paragraph re-uses the last segment's tMs because of
      // index-overflow fallback (most original segment available).
      expect(result[3].tMs).toBe(2500);
      expect(result[3].words.map((w) => w.text)).toEqual([
        "A",
        "new",
        "paragraph",
        "here",
      ]);
    });

    it("handles all-new content (every word replaced) without crashing", () => {
      const editedText =
        "completely different text\n\nnothing matches\n\nat all here";
      const result = reconcileEditedText(editedText, segs);
      expect(result).toHaveLength(3);
      expect(result[0].words.map((w) => w.text)).toEqual([
        "completely",
        "different",
        "text",
      ]);
      // Even with full replacement, tMs anchors preserved
      expect(result[0].tMs).toBe(0);
      expect(result[1].tMs).toBe(1500);
      expect(result[2].tMs).toBe(2500);
    });

    it("handles whitespace-only edits via paragraph reformat", () => {
      // Triple newlines collapse to one paragraph break
      const editedText = "Hello world\n\n\n\nHow are you\n\n\nFine thanks";
      const result = reconcileEditedText(editedText, segs);
      expect(result).toHaveLength(3);
    });

    it("works when original segments is empty (all new text)", () => {
      const editedText = "Brand new text here\n\nAnd more";
      const result = reconcileEditedText(editedText, []);
      expect(result).toHaveLength(2);
      // Both paragraphs get synthetic uniform timing
      expect(result[0].words).toHaveLength(4);
      expect(result[0].words[0].text).toBe("Brand");
      // First paragraph gets tMs = 1000 (lastSegTMs=0 + 1*1000) per overflow rule
      expect(result[0].tMs).toBeGreaterThanOrEqual(0);
    });

    it("collapses multiple internal whitespace to single spaces", () => {
      const editedText = "Hello    world\n\nHow\tare\tyou\n\nFine     thanks";
      const result = reconcileEditedText(editedText, segs);
      expect(result[0].words).toHaveLength(2);
      expect(result[1].words).toHaveLength(3);
      expect(result[2].words).toHaveLength(2);
    });
  });

  describe("renderEditableSegments + reconcileEditedText roundtrip", () => {
    it("identity edit produces identical structure (modulo word-text trimming)", () => {
      // Simulating the no-op edit: render → extract paragraph text → reconcile
      // We can't go through extractPlainText (DOM-dependent), but we can
      // manually build the equivalent plain-text string.
      const editedText = segs
        .map((seg) => seg.words.map((w) => w.text.trim()).join(" "))
        .join("\n\n");
      const result = reconcileEditedText(editedText, segs);
      expect(result).toHaveLength(segs.length);
      for (let i = 0; i < segs.length; i++) {
        expect(result[i].tMs).toBe(segs[i].tMs);
        expect(result[i].words.length).toBe(segs[i].words.length);
        for (let j = 0; j < segs[i].words.length; j++) {
          expect(result[i].words[j].text).toBe(segs[i].words[j].text);
          expect(result[i].words[j].tStartMs).toBe(segs[i].words[j].tStartMs);
          expect(result[i].words[j].tEndMs).toBe(segs[i].words[j].tEndMs);
        }
      }
    });
  });
});
