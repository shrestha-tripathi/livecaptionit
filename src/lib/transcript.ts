/**
 * Transcript formatter — turns the in-session commit timeline into
 * downloadable .txt / .vtt / .srt files.
 *
 * v0.4.x — `TranscriptSegment` stored `words: string[]` and `tMs` (one
 * timestamp per segment, ~600-1200ms granularity matching the agreement
 * tick interval). VTT/SRT precision was at the segment level.
 *
 * v0.5 (this commit) — adds `TranscriptSegment2 { words: Word[], tMs }`
 * with per-word `tStartMs` + `tEndMs` from the worker's word-timestamps
 * path. Formatters operate on a union type `AnyTranscriptSegment` and
 * use `upgradeSegment()` to synthesize uniform per-word timing for v1
 * segments so .vtt/.srt exports keep working for old (v0.4.x) sessions.
 *
 * v0.4.3: every formatter's text output runs through `polishPunctuation`
 * before being returned. Polish is a pure-function pass that fixes
 * stray-space-before-punctuation, missing-space-after-period, "i" →
 * "I", and a handful of other Whisper output quirks. We polish at the
 * formatter boundary (not on the live caption stream) so the visible
 * DOM stays byte-for-byte what Whisper emitted — only downloaded files
 * get the cleanup. This keeps the live UI's per-word DOM logic
 * unchanged and avoids any risk of regression on the streaming path.
 */

import { polishPunctuation } from "./punctuation";
import type { Word } from "./word";

/** v1 shape (v0.4.x). Preserved for backward-compat reads from
 *  IndexedDB + JSON exports + share URLs created before v0.5. */
export interface TranscriptSegment {
  /** Words committed in this batch. */
  words: string[];
  /** Milliseconds since session start when the batch was committed. */
  tMs: number;
}

/** v2 shape (v0.5+). `words` carries per-word timing + optional confidence
 *  from the WordAgreement.committedItems pipeline. `tMs` retained because
 *  the segment-relative offsets in each Word are window-relative (reset
 *  each tick), so the segment-level `tMs` is still the anchor for
 *  session-absolute time. */
export interface TranscriptSegment2 {
  /** Words committed in this batch, with per-word timing. */
  words: Word[];
  /** Milliseconds since session start when the batch was committed. */
  tMs: number;
}

/** Union accepted by formatters + storage readers. */
export type AnyTranscriptSegment = TranscriptSegment | TranscriptSegment2;

/** Discriminator: true if this is a v2 segment carrying Word[] with timing. */
export function isV2Segment(s: AnyTranscriptSegment): s is TranscriptSegment2 {
  // Empty words[] (either shape) is unambiguously v1 by convention since
  // v2 always emits non-empty (agreement only writes a segment when
  // newlyCommitted.length > 0). For non-empty: check the first element
  // shape — strings vs objects with tStartMs.
  const w = s.words;
  if (!w || w.length === 0) return false;
  const first = w[0] as unknown;
  return typeof first === "object" && first !== null && "text" in first;
}

/** Convert a v1 segment to v2 by synthesizing uniform per-word timing
 *  within the segment. Used for v0.4.x reads in v0.5+ so .vtt/.srt
 *  exports still produce per-word cues for old sessions. Timing is
 *  "fake" (uniform spacing) — accurate enough for human-readable
 *  subtitles, not for audio alignment. */
export function upgradeSegment(s: TranscriptSegment): TranscriptSegment2 {
  if (s.words.length === 0) return { words: [], tMs: s.tMs };
  // Spread across a notional 1000ms window — gives a visible duration
  // for one-word segments and reasonable per-word cues for longer ones.
  // Real per-word timing only flows in for v2-recorded segments.
  const SYNTHETIC_SEGMENT_MS = 1000;
  const perWord = SYNTHETIC_SEGMENT_MS / s.words.length;
  return {
    words: s.words.map((text, i) => ({
      text,
      tStartMs: Math.round(i * perWord),
      tEndMs: Math.round((i + 1) * perWord),
    })),
    tMs: s.tMs,
  };
}

/** Inverse: collapse a v2 segment to v1 (strings only). Used by
 *  formatters whose output is text-only and don't need per-word timing.
 *  v2.words element text comes from worker chunks with leading space
 *  (e.g. " world") — trim each word before storing as a v1 string. */
export function downgradeSegment(s: TranscriptSegment2): TranscriptSegment {
  return {
    words: s.words.map((w) => w.text.trim()),
    tMs: s.tMs,
  };
}

/** Normalize a mixed AnyTranscriptSegment[] to v2 for formatters/readers
 *  that want a uniform shape with per-word data. Cheap (just maps v1 to
 *  v2 with synthetic timing; v2 passes through unchanged). */
export function toV2Segments(segments: AnyTranscriptSegment[]): TranscriptSegment2[] {
  return segments.map((s) => (isV2Segment(s) ? s : upgradeSegment(s)));
}

/** Normalize a mixed AnyTranscriptSegment[] to v1 (strings only) for
 *  formatters that operate on bare text without timing. */
export function toV1Segments(segments: AnyTranscriptSegment[]): TranscriptSegment[] {
  return segments.map((s) => (isV2Segment(s) ? downgradeSegment(s) : s));
}

/** Group consecutive segments into paragraphs separated by silence > gapMs. */
function groupParagraphs(
  segments: TranscriptSegment[],
  gapMs: number,
): string[][][] {
  const groups: string[][][] = [];
  let current: string[][] = [];
  let lastMs = -Infinity;
  for (const seg of segments) {
    if (seg.words.length === 0) continue;
    if (seg.tMs - lastMs > gapMs && current.length > 0) {
      groups.push(current);
      current = [];
    }
    current.push(seg.words);
    lastMs = seg.tMs;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/** .txt — paragraphs joined by blank lines, words by single spaces. */
export function formatTxt(segments: AnyTranscriptSegment[]): string {
  if (segments.length === 0) return "";
  const PARA_GAP_MS = 3000;
  const v1 = toV1Segments(segments);
  const paragraphs = groupParagraphs(v1, PARA_GAP_MS);
  return (
    paragraphs
      .map((para) => polishPunctuation(para.flat().join(" ")))
      .join("\n\n") + "\n"
  );
}

function formatTimestamp(ms: number, sep: "." | ","): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const millis = Math.max(0, ms - totalSec * 1000);
  const hh = Math.floor(totalSec / 3600);
  const mm = Math.floor((totalSec % 3600) / 60);
  const ss = totalSec % 60;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}${sep}${pad(Math.floor(millis), 3)}`;
}

/** Convert segments to cues: one cue per segment, end = next segment start
 *  (or +2s for the final cue so it stays on screen briefly). */
function toCues(
  segments: AnyTranscriptSegment[],
): Array<{ start: number; end: number; text: string }> {
  const v1 = toV1Segments(segments);
  return v1
    .filter((s) => s.words.length > 0)
    .map((seg, i, arr) => {
      const next = arr[i + 1];
      const end = next ? next.tMs : seg.tMs + 2000;
      return {
        start: seg.tMs,
        end: Math.max(seg.tMs + 500, end), // minimum 500ms cue duration
        text: polishPunctuation(seg.words.join(" ")),
      };
    });
}

// ────────────────────────────────────────────────────────────────────────
// v0.5 commit 6 — cue granularity (segment / sentence / word)
// ────────────────────────────────────────────────────────────────────────

/**
 * .vtt/.srt cue granularity. Defaults to "sentence" (v0.5+), which is
 * the most useful for actual subtitling. v0.4.x callers / v1 segments
 * fall back to "segment" automatically since they have no per-word data.
 *
 *  - "segment":  one cue per agreement-tick batch (~600-1200ms each).
 *                v0.4.x behaviour. Coarse but cheap.
 *  - "sentence": group consecutive words into cues at punctuation
 *                boundaries OR when a hard 10s wall is hit OR when
 *                inter-word silence exceeds SENTENCE_SILENCE_GAP_MS.
 *                Forces a hard break at MAX_SENTENCE_CUE_MS so a
 *                wall-of-text monologue still produces readable cues.
 *  - "word":     one cue per Word. Debug-only — produces huge .vtt
 *                files with one entry per spoken word. Useful for
 *                karaoke-style highlighting in custom players.
 */
export type ExportGranularity = "segment" | "sentence" | "word";

/** Sentence-mode tuning constants. Documented inline. */
const MAX_SENTENCE_CUE_MS = 4000;   // soft target — try to break at punctuation before this
const HARD_SENTENCE_BREAK_MS = 10000; // hard break per roadmap OQ #3
const SENTENCE_SILENCE_GAP_MS = 600; // if word-to-word silence > this, treat as sentence end

const PUNCT_END_RE = /[.!?]$/;

interface Cue {
  start: number;
  end: number;
  text: string;
}

/**
 * Flatten v2 segments into a single Word[] timeline with each word
 * carrying an absolute session-time start/end (segment.tMs + word.tStartMs/tEndMs).
 * Used by sentence + word granularity modes which need to operate on
 * a per-word stream rather than per-segment batches.
 */
function flattenToWordTimeline(
  segments: TranscriptSegment2[],
): Array<{ text: string; absStartMs: number; absEndMs: number }> {
  const out: Array<{ text: string; absStartMs: number; absEndMs: number }> = [];
  for (const seg of segments) {
    for (const w of seg.words) {
      out.push({
        text: w.text,
        absStartMs: seg.tMs + w.tStartMs,
        absEndMs: seg.tMs + w.tEndMs,
      });
    }
  }
  return out;
}

/**
 * Group a Word timeline into sentence-sized cues. Boundary conditions
 * (any one fires):
 *   1. Word ends with .!? AND cue has ≥ 2 words (so "Yes." alone doesn't
 *      break out a 300ms cue with just one word, but "How are you?" does
 *      even at 700ms duration).
 *   2. Inter-word silence > SENTENCE_SILENCE_GAP_MS
 *   3. Cue duration would exceed HARD_SENTENCE_BREAK_MS
 *   4. Cue duration > MAX_SENTENCE_CUE_MS AND we've seen at least
 *      8 words (avoid premature breaks during fast speech)
 */
function groupSentenceCues(
  timeline: Array<{ text: string; absStartMs: number; absEndMs: number }>,
): Cue[] {
  if (timeline.length === 0) return [];
  const cues: Cue[] = [];
  let current: typeof timeline = [];
  let cueStartMs = timeline[0].absStartMs;
  let lastWordEndMs = timeline[0].absStartMs;

  function flush(end: number) {
    if (current.length === 0) return;
    const text = polishPunctuation(current.map((w) => w.text.trim()).join(" "));
    cues.push({
      start: cueStartMs,
      end: Math.max(cueStartMs + 500, end),
      text,
    });
    current = [];
  }

  for (let i = 0; i < timeline.length; i++) {
    const word = timeline[i];
    const isFirstInCue = current.length === 0;
    if (isFirstInCue) cueStartMs = word.absStartMs;

    // Check silence-gap break BEFORE pushing this word
    const silenceMs = word.absStartMs - lastWordEndMs;
    if (!isFirstInCue && silenceMs > SENTENCE_SILENCE_GAP_MS) {
      flush(lastWordEndMs);
      cueStartMs = word.absStartMs;
    }

    current.push(word);
    lastWordEndMs = word.absEndMs;

    const cueDurationMs = word.absEndMs - cueStartMs;
    const trimmedText = word.text.trim();
    const endsSentence = PUNCT_END_RE.test(trimmedText);

    // Boundary check: any condition fires → flush
    const shouldBreak =
      cueDurationMs > HARD_SENTENCE_BREAK_MS ||
      (endsSentence && current.length >= 2) ||
      (cueDurationMs > MAX_SENTENCE_CUE_MS && current.length >= 8);

    if (shouldBreak) {
      flush(word.absEndMs);
    }
  }
  flush(lastWordEndMs);
  return cues;
}

/** One cue per word. */
function toWordCues(
  timeline: Array<{ text: string; absStartMs: number; absEndMs: number }>,
): Cue[] {
  return timeline.map((w) => ({
    start: w.absStartMs,
    end: Math.max(w.absStartMs + 200, w.absEndMs),
    text: polishPunctuation(w.text.trim()),
  }));
}

/**
 * Resolve the cue list for a given granularity. v1 segments + "sentence"/"word"
 * granularity fall back to "segment" because v1 has no per-word timing
 * (sentence-grouping over synthesized uniform fake timing would produce
 * nonsense). v2 segments honour the requested granularity exactly.
 */
function cuesForGranularity(
  segments: AnyTranscriptSegment[],
  granularity: ExportGranularity,
): Cue[] {
  if (granularity === "segment") return toCues(segments);
  // sentence + word modes need real per-word timing — only sensible on v2
  const allV2 = segments.every(isV2Segment);
  if (!allV2) {
    // Fall back to segment mode for v1-containing transcripts. Caller
    // can detect this by comparing requested vs effective mode if needed.
    return toCues(segments);
  }
  const timeline = flattenToWordTimeline(segments as TranscriptSegment2[]);
  if (granularity === "word") return toWordCues(timeline);
  return groupSentenceCues(timeline);
}

/** .vtt — WebVTT format. v0.5+ accepts an optional granularity param. */
export function formatVtt(
  segments: AnyTranscriptSegment[],
  granularity: ExportGranularity = "segment",
): string {
  const cues = cuesForGranularity(segments, granularity);
  const lines: string[] = ["WEBVTT", ""];
  cues.forEach((cue, i) => {
    lines.push(String(i + 1));
    lines.push(
      `${formatTimestamp(cue.start, ".")} --> ${formatTimestamp(cue.end, ".")}`,
    );
    lines.push(cue.text);
    lines.push("");
  });
  return lines.join("\n");
}

/** .srt — SubRip format. v0.5+ accepts an optional granularity param. */
export function formatSrt(
  segments: AnyTranscriptSegment[],
  granularity: ExportGranularity = "segment",
): string {
  const cues = cuesForGranularity(segments, granularity);
  const lines: string[] = [];
  cues.forEach((cue, i) => {
    lines.push(String(i + 1));
    lines.push(
      `${formatTimestamp(cue.start, ",")} --> ${formatTimestamp(cue.end, ",")}`,
    );
    lines.push(cue.text);
    lines.push("");
  });
  return lines.join("\n");
}

/** Generate a download filename based on current date/time + format. */
export function defaultFilename(ext: "txt" | "vtt" | "srt", now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = now.getFullYear();
  const mm = pad(now.getMonth() + 1);
  const dd = pad(now.getDate());
  const hh = pad(now.getHours());
  const mi = pad(now.getMinutes());
  return `livecaptionit-${yyyy}-${mm}-${dd}-${hh}${mi}.${ext}`;
}

/** Trigger a download in the browser. Pure DOM, no library. */
export function downloadString(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  // Defer revoke to next tick so Chrome actually starts the download
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}
