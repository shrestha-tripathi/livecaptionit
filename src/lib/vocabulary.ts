/**
 * Custom vocabulary persistence + sanitization.
 *
 * Storage:  localStorage key `livecaptionit:vocabulary`
 * Format:   plain string (Whisper's initial_prompt is a string, not a list).
 *           Users enter comma- or newline-separated terms in the UI; we
 *           normalize to a single comma-separated string for the model.
 *
 * Why a string (and not a Set<string>):
 *   Whisper's initial_prompt is consumed as a tokenized prefix to the
 *   decoder. The decoder doesn't care about list structure — it just
 *   sees tokens. Storing as a string preserves the exact text the user
 *   typed (capitalization, special chars), which matters for proper
 *   nouns like "kubectl" or "₹" that change tokenization based on form.
 */

const STORAGE_KEY = "livecaptionit:vocabulary";

/** Hard cap on the stored string. Matches the worker-side cap. */
export const VOCABULARY_MAX_CHARS = 200;

/** Read the stored vocabulary string. Empty string if unset. */
export function loadVocabulary(): string {
  if (typeof localStorage === "undefined") return "";
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Persist a vocabulary string. Sanitizes + caps before saving. */
export function saveVocabulary(text: string): string {
  const cleaned = sanitizeVocabulary(text);
  try {
    if (cleaned) {
      localStorage.setItem(STORAGE_KEY, cleaned);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* private mode */
  }
  return cleaned;
}

/**
 * Sanitize a free-form vocabulary string:
 *  - Collapse runs of whitespace and newlines into single spaces.
 *  - Comma-normalize: turn newlines into commas, dedupe commas, trim.
 *  - Cap at VOCABULARY_MAX_CHARS.
 *
 * Pure function — fully testable. Does NOT lowercase (proper nouns must
 * keep their casing for tokenization purposes).
 */
export function sanitizeVocabulary(text: string): string {
  if (!text) return "";
  const oneLine = text
    .replace(/[\r\n\t]+/g, ", ")
    .replace(/\s{2,}/g, " ")
    .trim();
  // Dedupe sequential commas: "a,,b" → "a, b".
  const normalized = oneLine
    .replace(/\s*,\s*/g, ", ")
    .replace(/(?:,\s*){2,}/g, ", ")
    .replace(/^,\s*/, "")
    .replace(/,\s*$/, "")
    .trim();
  return normalized.slice(0, VOCABULARY_MAX_CHARS);
}

/**
 * Count "effective terms" for the UI counter. Comma-split + filter empty.
 * Pure function.
 */
export function countTerms(text: string): number {
  if (!text) return 0;
  return text
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0).length;
}
