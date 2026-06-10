/**
 * Transcript formatter — turns the in-session commit timeline into
 * downloadable .txt / .vtt / .srt files.
 *
 * Each TranscriptSegment is one batch of words committed by the agreement
 * algorithm at a specific moment relative to session start. We don't have
 * word-level timestamps (transformers.js can produce them but our streaming
 * tick loop discards them), so VTT/SRT precision is at the segment level
 * (~600-1200ms granularity matching the tick interval). Documented in UI.
 */

export interface TranscriptSegment {
  /** Words committed in this batch. */
  words: string[];
  /** Milliseconds since session start when the batch was committed. */
  tMs: number;
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
export function formatTxt(segments: TranscriptSegment[]): string {
  if (segments.length === 0) return "";
  const PARA_GAP_MS = 3000;
  const paragraphs = groupParagraphs(segments, PARA_GAP_MS);
  return (
    paragraphs
      .map((para) => para.flat().join(" "))
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
  segments: TranscriptSegment[],
): Array<{ start: number; end: number; text: string }> {
  return segments
    .filter((s) => s.words.length > 0)
    .map((seg, i, arr) => {
      const next = arr[i + 1];
      const end = next ? next.tMs : seg.tMs + 2000;
      return {
        start: seg.tMs,
        end: Math.max(seg.tMs + 500, end), // minimum 500ms cue duration
        text: seg.words.join(" "),
      };
    });
}

/** .vtt — WebVTT format. */
export function formatVtt(segments: TranscriptSegment[]): string {
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
export function formatSrt(segments: TranscriptSegment[]): string {
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
