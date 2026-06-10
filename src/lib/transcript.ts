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

/** .vtt — WebVTT format. */
export function formatVtt(segments: AnyTranscriptSegment[]): string {
  const cues = toCues(segments);
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

/** .srt — SubRip format. */
export function formatSrt(segments: AnyTranscriptSegment[]): string {
  const cues = toCues(segments);
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
