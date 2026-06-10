/**
 * LocalAgreement-2: commit a transcribed word only when two consecutive
 * Whisper hypotheses agree on it at the word-prefix level. Once committed,
 * a word never retracts. The unconfirmed tail of the latest hypothesis
 * becomes the "live line" shown to the user in muted italic.
 *
 * Pure functional state machine — no DOM, no audio. Unit-testable in
 * isolation. See SPEC.md §1.2.4 for the algorithm in plain language.
 *
 * v0.4.8 — generalised over a tokenizable item type `T`. The streaming
 * caption path uses `Agreement<Word>` (Word from `./word`) so per-word
 * timing + future confidence values flow through the algorithm. Existing
 * string-array callers use `StringAgreement` which wraps strings into
 * `{ text: s }` shapes internally for byte-equivalent behaviour.
 *
 * The `keyFn` argument is load-bearing — it determines what "agreement"
 * means between two items. For Word inputs we use
 * `(w) => w.text.toLowerCase().trim()` so two adjacent ticks with the same
 * word text but different tStartMs (which they will have — windows slide)
 * still get treated as the SAME word for prefix-match purposes. Without
 * this, agreement would compare Word objects by reference and never fire.
 */

import type { Word } from "./word";

// At 16kHz Whisper rate, ~400ms of audio per spoken word is a reasonable
// average. Used to trim the rolling buffer behind committed words so memory
// + transcription cost stays bounded.
const AVG_SAMPLES_PER_WORD = 16_000 * 0.4;

function commonItemPrefix<T>(
  a: T[],
  b: T[],
  keyFn: (x: T) => string,
): T[] {
  const out: T[] = [];
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (keyFn(a[i]) === keyFn(b[i])) out.push(a[i]);
    else break;
  }
  return out;
}

/**
 * Generic LocalAgreement-2 state machine over any tokenizable item type.
 *
 * @typeParam T — the item type (string for legacy, Word for v0.5+)
 */
export class Agreement<T> {
  /**
   * Construct an Agreement.
   *
   * @param keyFn - Extractor that returns a comparable string identity
   *   from an item. Critically, this is what defines "agreement" — two
   *   items are considered equal iff `keyFn(a) === keyFn(b)`. For Words,
   *   pass `(w) => w.text.toLowerCase().trim()` so the same word text
   *   across overlapping windows (different tStartMs) is still agreed-on.
   * @param tokenize - Optional splitter when the source data is a string
   *   that needs to become `T[]`. For string items, this defaults to
   *   whitespace-split; for Word items it must be supplied by the caller
   *   (e.g. take the chunks array directly from the worker payload).
   */
  constructor(
    private readonly keyFn: (item: T) => string,
    private readonly tokenizeStr?: (s: string) => T[],
  ) {}

  /** Items confirmed and emitted, joined with single spaces (via keyFn). */
  committed: string = "";
  /** v0.4.8 — items confirmed, preserved as the full T objects.
   *  This is the field v0.5 consumers read (preserves Word timing). */
  committedItems: T[] = [];
  /** Unconfirmed tail of the most recent hypothesis (joined via keyFn). */
  liveLine: string = "";
  /** v0.4.8 — same as liveLine but as T objects. */
  liveItems: T[] = [];
  /** Items promoted to `committedItems` during the most recent ingest(). */
  newlyCommitted: T[] = [];
  /** Samples to trim from the front of the rolling buffer after this tick. */
  samplesToTrim: number = 0;

  private lastItems: T[] = [];

  /**
   * Feed in the latest hypothesis. Either a string (uses constructor's
   * tokenizeStr if provided) or a pre-tokenized T[].
   */
  ingest(hypothesis: string | T[]): void {
    this.newlyCommitted = [];
    this.samplesToTrim = 0;
    const items: T[] = Array.isArray(hypothesis)
      ? hypothesis
      : this.tokenizeStr
        ? this.tokenizeStr(hypothesis)
        : [];

    // Compute commonality with previous hypothesis (LocalAgreement-2)
    const agreed = commonItemPrefix(this.lastItems, items, this.keyFn);

    // Only consider promoting items that extend BEYOND already-committed text.
    // Also verify the agreed prefix is consistent with what's already committed
    // (monotonicity guard — committed words never retract).
    if (agreed.length > this.committedItems.length) {
      const consistent = this.committedItems.every(
        (w, i) => this.keyFn(agreed[i]) === this.keyFn(w),
      );
      if (consistent) {
        const newItems = agreed.slice(this.committedItems.length);
        this.committedItems = agreed;
        this.committed = this.committedItems.map(this.keyFn).join(" ");
        this.newlyCommitted = newItems;
        this.samplesToTrim = Math.floor(newItems.length * AVG_SAMPLES_PER_WORD);
      }
    }

    // Live line = whatever in the latest hypothesis comes AFTER what's committed.
    // If the latest hypothesis doesn't even agree with the committed prefix,
    // there's no meaningful "tail" to show — keep liveLine empty.
    const hypothesisAgreesWithCommitted =
      items.length >= this.committedItems.length &&
      this.committedItems.every(
        (w, i) => this.keyFn(items[i]) === this.keyFn(w),
      );
    this.liveItems = hypothesisAgreesWithCommitted
      ? items.slice(this.committedItems.length)
      : [];
    this.liveLine = this.liveItems.map(this.keyFn).join(" ");

    this.lastItems = items;
  }

  reset(): void {
    this.committed = "";
    this.committedItems = [];
    this.liveLine = "";
    this.liveItems = [];
    this.newlyCommitted = [];
    this.samplesToTrim = 0;
    this.lastItems = [];
  }
}

// ────────────────────────────────────────────────────────────────────────
// Convenience wrappers
// ────────────────────────────────────────────────────────────────────────

/**
 * String-token Agreement preserving the v0.1 → v0.4.7 API exactly.
 * Existing tests + callers use this and get identical behaviour.
 */
export class StringAgreement extends Agreement<string> {
  constructor() {
    super(
      (s) => s,
      (s) => s.trim().split(/\s+/).filter(Boolean),
    );
  }

  // The base class stores `newlyCommitted` as T[], which for T=string is
  // `string[]` — same shape the v0.1 tests assert against. No override needed.
}

/**
 * v0.4.8 — Word-typed Agreement for the streaming caption path. Agreement
 * is by case-insensitive trimmed text so the same word across overlapping
 * windows (different tStartMs) is correctly identified. Preserves timing
 * + future confidence values through commit promotion.
 */
export class WordAgreement extends Agreement<Word> {
  constructor() {
    super((w) => w.text.toLowerCase().trim());
  }
}
