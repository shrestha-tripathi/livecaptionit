/**
 * Caption language selection — persistence + Whisper param mapping.
 *
 * Storage:  localStorage key `livecaptionit:language`
 * Format:   a short code from LANGUAGES ("auto", "en", "hi", …).
 *
 * The model (`onnx-community/whisper-*`) is the MULTILINGUAL Whisper port,
 * not the `.en` English-only variant — it natively covers 99 languages and
 * can auto-detect. This module maps a user-picked code to the string Whisper
 * expects as its `language` decode param (a full lowercase English language
 * name, e.g. "french"). "auto" maps to `undefined`, which tells Whisper to
 * detect the language per audio window.
 *
 * Why pin at all (vs always auto): on code-switching audio — Hinglish is the
 * common India case — per-window auto-detection can flip language mid-stream
 * and adds first-window latency. Pinning gives a stable, lower-latency decode.
 *
 * NOTE: This is TRANSCRIBE-only (caption speech in its own language). We do
 * NOT expose Whisper's `task: "translate"` — it shipped in v0.3.0 and was
 * pulled in v0.3.2 for unshippable real-world quality (see CaptionApp.script.ts
 * note near the old task-toggle removal).
 */

export interface LanguageSpec {
  /** Short code used in the UI + localStorage. */
  code: string;
  /** User-facing label (native script where it helps recognition). */
  label: string;
  /**
   * The exact string passed to Whisper's `language` decode param, or
   * `undefined` for auto-detect. Whisper wants full lowercase English names.
   */
  whisperParam: string | undefined;
}

export const AUTO_CODE = "auto";

/**
 * Curated shortlist — NOT all 99 Whisper languages (a 99-item dropdown is
 * UX noise). Ordered: Auto, English, then Hindi high (India-market wedge),
 * then the rest of the high-volume Whisper languages. Growing this list is a
 * one-line edit here — nothing else needs to change.
 */
export const LANGUAGES: LanguageSpec[] = [
  { code: "auto", label: "Auto-detect", whisperParam: undefined },
  { code: "en", label: "English", whisperParam: "english" },
  { code: "hi", label: "हिन्दी (Hindi)", whisperParam: "hindi" },
  { code: "es", label: "Español (Spanish)", whisperParam: "spanish" },
  { code: "fr", label: "Français (French)", whisperParam: "french" },
  { code: "de", label: "Deutsch (German)", whisperParam: "german" },
  { code: "ru", label: "Русский (Russian)", whisperParam: "russian" },
  { code: "pt", label: "Português (Portuguese)", whisperParam: "portuguese" },
  { code: "it", label: "Italiano (Italian)", whisperParam: "italian" },
  { code: "ja", label: "日本語 (Japanese)", whisperParam: "japanese" },
  { code: "ko", label: "한국어 (Korean)", whisperParam: "korean" },
  { code: "zh", label: "中文 (Chinese)", whisperParam: "chinese" },
  { code: "ar", label: "العربية (Arabic)", whisperParam: "arabic" },
  { code: "nl", label: "Nederlands (Dutch)", whisperParam: "dutch" },
  { code: "tr", label: "Türkçe (Turkish)", whisperParam: "turkish" },
  { code: "pl", label: "Polski (Polish)", whisperParam: "polish" },
  { code: "id", label: "Bahasa Indonesia", whisperParam: "indonesian" },
];

export const DEFAULT_LANGUAGE_CODE = AUTO_CODE;

const STORAGE_KEY = "livecaptionit:language";

/** Look up a language spec by code. Falls back to the Auto spec. */
export function languageByCode(code: string): LanguageSpec {
  return LANGUAGES.find((l) => l.code === code) || LANGUAGES[0];
}

/**
 * The Whisper `language` decode param for a code, or `undefined` for auto
 * (or any unknown code — safest default is let-Whisper-detect).
 */
export function whisperParamFor(code: string): string | undefined {
  return languageByCode(code).whisperParam;
}

/** Read the stored language code. Defaults to "auto" when unset/blocked. */
export function loadLanguage(): string {
  if (typeof localStorage === "undefined") return DEFAULT_LANGUAGE_CODE;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LANGUAGE_CODE;
    // Guard against stale/garbage values — only honour known codes.
    return LANGUAGES.some((l) => l.code === raw) ? raw : DEFAULT_LANGUAGE_CODE;
  } catch {
    return DEFAULT_LANGUAGE_CODE;
  }
}

/**
 * Persist a language code. "auto" (the default) clears the key so we don't
 * leave dead storage around. Unknown codes are coerced to "auto". Returns the
 * code actually stored (post-coercion) for the caller's convenience.
 */
export function saveLanguage(code: string): string {
  const known = LANGUAGES.some((l) => l.code === code) ? code : DEFAULT_LANGUAGE_CODE;
  try {
    if (known === DEFAULT_LANGUAGE_CODE) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, known);
    }
  } catch {
    /* private mode — non-fatal */
  }
  return known;
}
