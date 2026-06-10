/**
 * Session search — v0.4.2.
 *
 * Pure-functional filter over `StoredSession[]`. No IndexedDB access,
 * no DOM, no I/O. The caller (CaptionApp.script.ts) loads sessions
 * via listSessions(), pipes the result through searchSessions(...)
 * on every keystroke (debounced ~150ms), and re-renders.
 *
 * Matching rules (kept deliberately simple — full-text search is
 * overkill for ≤20 stored sessions and would warrant indexedDB-FTS
 * which we don't have):
 *
 *   - Empty / whitespace-only query → return input unchanged
 *   - Query is lowercased + split on whitespace into terms
 *   - A session matches if EVERY term appears as a substring (case-
 *     insensitive) in the session's haystack
 *   - Haystack = preview text + joined transcript words + sourceLabel
 *     + ISO date string of startedAt + modelId
 *   - Result preserves the input order (caller already sorted)
 *
 * Why "every term" (AND) instead of "any term" (OR):
 *   AND matches user mental model — "search for 'standup tuesday'"
 *   should return only sessions containing BOTH, not anything matching
 *   either word. This is also Google-default behaviour for unquoted
 *   multi-word queries.
 */

import type { SessionSource, StoredSession } from "./sessionStore";

/**
 * Build a single lowercased haystack string for one session.
 * Exposed so callers can also use it for highlighting if desired.
 * Pure function.
 */
export function sessionHaystack(s: StoredSession): string {
  const transcript = s.transcript.map((seg) => seg.words.join(" ")).join(" ");
  const isoDate = (() => {
    try {
      return new Date(s.startedAt).toISOString();
    } catch {
      return "";
    }
  })();
  // sourceLabel is the human label for the source enum — searching for
  // "mic" or "sample" should surface those sessions.
  const sourceLabel = labelForSource(s.source);
  return [s.preview, transcript, sourceLabel, isoDate, s.modelId]
    .join(" ")
    .toLowerCase();
}

function labelForSource(s: SessionSource): string {
  if (s === "mic") return "mic microphone";
  if (s === "sample") return "sample demo";
  return "tab screen";
}

/**
 * Filter sessions by query. Returns the matching subset preserving
 * input order. Pure function.
 *
 * @param sessions ordered list of sessions (caller already sorted)
 * @param query user input string — empty/whitespace returns input unchanged
 */
export function searchSessions(
  sessions: StoredSession[],
  query: string,
): StoredSession[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return sessions;
  return sessions.filter((s) => {
    const hay = sessionHaystack(s);
    return terms.every((t) => hay.includes(t));
  });
}

/**
 * Debounce helper for the search-input handler. Returns a wrapped
 * function that invokes fn after `wait` ms of inactivity.
 * Pure-ish (uses setTimeout but no closure over external state).
 *
 * Kept here (not in a shared utils module) because (a) it's the only
 * caller currently, and (b) inlining keeps the search module
 * self-contained for testing.
 */
export function debounce<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  wait: number,
): (...args: TArgs) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: TArgs) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  };
}
