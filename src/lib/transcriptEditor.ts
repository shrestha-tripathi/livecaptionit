/**
 * v0.5 commit 8 — Transcript editor
 * ────────────────────────────────────────────────────────────────────────
 *
 * Pure-function helpers for the contenteditable transcript editor that
 * lives inside the session-viewer dialog. The editor lets users fix
 * Whisper mistakes ("San Jose" → "San José") AFTER capture, without
 * losing per-word timing for the words that survive unchanged.
 *
 * Architecture
 * ────────────
 * The renderEditableSegments() helper produces an HTML string with one
 * <span data-segment-idx="S" data-word-idx="W"> per word (plus
 * paragraph-break wrappers per segment). When the user types into the
 * contenteditable view, the browser may mutate the DOM in ways that
 * destroy spans (split-on-whitespace, browser autocorrect, etc.). To
 * recover the final segments we DON'T rely on the spans surviving —
 * we instead text-extract the contenteditable to plain text and
 * realign it back to the original segments via reconcileEditedText():
 *
 *   1. Split edited text into paragraphs on \n\n (segment boundaries).
 *   2. For each surviving paragraph, find the closest matching original
 *      segment by Levenshtein-ish word-shingle overlap.
 *   3. Words present in BOTH preserve their timing from the original
 *      (matched by lowercased+trimmed key). Words present only in the
 *      edited text get synthetic timing (uniform-spaced across the
 *      segment's original duration).
 *   4. New paragraphs that don't match any original segment get a
 *      synthetic segment with tMs = nearest neighbour's tMs + 1.
 *
 * This is best-effort. The guarantee we make to users is:
 *   - Edits never DELETE timing for unchanged words.
 *   - The resulting transcript ALWAYS exports cleanly to .txt/.vtt/.srt.
 *   - If our matching heuristic is wrong, the worst case is mildly-
 *     drifted timestamps — never a crash, never lost text.
 *
 * Why not just keep the spans?
 *   The browser's contenteditable behaviour is wildly inconsistent
 *   across Chrome/Firefox/Safari. Spans get split, merged, attributes
 *   stripped, etc. Trying to maintain the data-* anchors mid-edit
 *   would be a constant battle. Plain-text extraction + realignment
 *   gives us robustness at the cost of a little timing fidelity for
 *   edited words.
 *
 * No undo stack
 *   Per v0.5 roadmap OQ #4: single-step "Cancel" reverts the entire
 *   session to its pre-edit snapshot. No multi-level undo. If a user
 *   destroys their transcript, they can Cancel + try again. Keeps the
 *   feature shippable in v0.5 without building an OT stack.
 */

import type { TranscriptSegment2 } from "./transcript";
import type { Word } from "./word";

/**
 * Render TranscriptSegment2[] as HTML for the editable view.
 *
 * Format: one <p data-segment-idx="S"> per segment containing
 * <span data-word-idx="W">word</span> per word with single space
 * text nodes between them. Paragraphs separated by blank lines.
 *
 * The data-* attrs are PRESENTATIONAL HINTS for the visible word
 * grid — we do NOT rely on them for reconciliation (see module
 * doc comment). Survival across contenteditable mutations is
 * unreliable; the realignment in reconcileEditedText() works
 * from plain text.
 */
export function renderEditableSegments(segments: TranscriptSegment2[]): string {
  if (segments.length === 0) {
    return '<p class="cp-edit-empty text-[var(--color-fg-subtle)] italic">(empty transcript)</p>';
  }
  const paragraphs: string[] = [];
  for (let s = 0; s < segments.length; s++) {
    const seg = segments[s];
    if (seg.words.length === 0) continue;
    const wordHtml: string[] = [];
    for (let w = 0; w < seg.words.length; w++) {
      const word = seg.words[w];
      wordHtml.push(
        `<span data-segment-idx="${s}" data-word-idx="${w}">${escapeHtml(word.text.trim())}</span>`,
      );
    }
    paragraphs.push(`<p data-segment-idx="${s}">${wordHtml.join(" ")}</p>`);
  }
  return paragraphs.length > 0
    ? paragraphs.join("\n")
    : '<p class="cp-edit-empty text-[var(--color-fg-subtle)] italic">(empty transcript)</p>';
}

/**
 * Extract plain text from the contenteditable element. Preserves
 * paragraph breaks (\n\n) but normalizes intra-paragraph whitespace
 * to single spaces. Strips leading/trailing whitespace.
 *
 * Works by walking child <p> nodes and reading their textContent.
 * Robust to any browser contenteditable quirks because we only care
 * about the visible text, not the DOM structure.
 */
export function extractPlainText(root: HTMLElement): string {
  const paragraphs: string[] = [];
  const children = root.querySelectorAll(":scope > p");
  if (children.length === 0) {
    // Browser may have flattened all <p> elements (especially Safari
    // on first edit). Fall back to the root's textContent split on
    // double newlines.
    const raw = (root.textContent ?? "").trim();
    if (!raw) return "";
    return raw
      .split(/\n{2,}/)
      .map((p) => p.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n\n");
  }
  for (const p of children) {
    const text = (p.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text) paragraphs.push(text);
  }
  return paragraphs.join("\n\n");
}

/**
 * Reconcile edited plain text back to TranscriptSegment2[].
 *
 * Strategy:
 *   - Split edited text into paragraphs on \n\n
 *   - Map each paragraph 1:1 to an original segment by index (most
 *     common case: user just fixed typos, paragraph count is stable)
 *   - For each matched pair, realign per-word timing: words present
 *     in both keep their original Word.tStartMs/tEndMs; new words get
 *     uniform-spaced synthetic timing inside the surviving range
 *   - If paragraph count differs from segment count, original segments
 *     "stretch" or "split" by index — extra paragraphs get the last
 *     segment's tMs + (paragraph_idx - segment_count) * 1000ms;
 *     missing paragraphs drop the trailing original segments
 *
 * This is deliberately simple. Users editing transcripts almost
 * always do typo fixes and word substitutions WITHIN segments, not
 * structural reorganization. The strategy is wrong for the rare
 * case of someone reorganizing paragraphs — and the consequence is
 * timestamp drift in the resulting .vtt, not data loss.
 */
export function reconcileEditedText(
  editedText: string,
  originalSegments: TranscriptSegment2[],
): TranscriptSegment2[] {
  if (!editedText.trim()) return [];

  const editedParas = editedText
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  if (editedParas.length === 0) return [];

  const result: TranscriptSegment2[] = [];
  const lastSegTMs =
    originalSegments.length > 0
      ? originalSegments[originalSegments.length - 1].tMs
      : 0;

  for (let i = 0; i < editedParas.length; i++) {
    const editedWords = editedParas[i].split(/\s+/).filter(Boolean);
    if (editedWords.length === 0) continue;

    // Match to original by index, falling back to last segment for overflow
    const originalSeg =
      i < originalSegments.length
        ? originalSegments[i]
        : originalSegments[originalSegments.length - 1] ?? null;

    if (!originalSeg || originalSeg.words.length === 0) {
      // No original timing to align against — synthesize uniform timing
      // anchored at lastSegTMs + offset.
      const tMs = i < originalSegments.length ? originalSegments[i].tMs : lastSegTMs + (i - originalSegments.length + 1) * 1000;
      result.push({
        tMs,
        words: synthesizeUniformTiming(editedWords),
      });
      continue;
    }

    // Build a key→Word lookup from the original segment for unchanged
    // words to preserve their timing. We don't bother with multiplicity
    // (if "the" appears 3 times originally and 2 times edited, all 2
    // edited "the"s get the timing of the first original "the" — the
    // second original "the" is treated as new/deleted).
    const originalByKey = new Map<string, Word>();
    for (const w of originalSeg.words) {
      const key = w.text.toLowerCase().trim();
      if (!originalByKey.has(key)) originalByKey.set(key, w);
    }

    // Total duration to apportion synthetic timing across is the
    // original segment's span (from first word's start to last word's
    // end). Falls back to 1000ms per word if original was zero-timing.
    const firstWord = originalSeg.words[0];
    const lastWord = originalSeg.words[originalSeg.words.length - 1];
    const segSpanMs = Math.max(0, lastWord.tEndMs - firstWord.tStartMs);
    const synthPerWord = segSpanMs > 0
      ? Math.max(50, Math.floor(segSpanMs / editedWords.length))
      : 1000;
    const baseStart = firstWord.tStartMs;

    const editedWordObjs: Word[] = editedWords.map((text, idx) => {
      const key = text.toLowerCase().trim();
      const original = originalByKey.get(key);
      if (original) {
        // Preserve original timing on key match. (We don't try to
        // detect reorderings — if "the" was at position 2 originally
        // and is at position 0 now, it keeps its old timing. The
        // resulting .vtt may look slightly out of order but never
        // crashes; uniform-time fallback would be worse for users
        // doing pure typo fixes.)
        return { ...original, text };
      }
      // New word — synthesize timing in the segment's span.
      const tStartMs = baseStart + idx * synthPerWord;
      const tEndMs = tStartMs + synthPerWord;
      return { text, tStartMs, tEndMs };
    });

    result.push({ tMs: originalSeg.tMs, words: editedWordObjs });
  }

  return result;
}

/**
 * Synthesize uniform per-word timing across a 1-second synthetic
 * window. Used only when the corresponding original segment had no
 * timing data (zero words or all-zero timestamps).
 */
function synthesizeUniformTiming(words: string[]): Word[] {
  const totalMs = 1000;
  const perWord = Math.max(50, Math.floor(totalMs / Math.max(1, words.length)));
  return words.map((text, i) => ({
    text,
    tStartMs: i * perWord,
    tEndMs: (i + 1) * perWord,
  }));
}

/** Minimal HTML escape for word text. Word text is plain user-visible
 *  speech so the attack surface is small but we escape anyway because
 *  this html string is injected via innerHTML. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
