/**
 * LocalAgreement-2: commit a transcribed word only when two consecutive
 * Whisper hypotheses agree on it at the word-prefix level. Once committed,
 * a word never retracts. The unconfirmed tail of the latest hypothesis
 * becomes the "live line" shown to the user in muted italic.
 *
 * Pure functional state machine — no DOM, no audio. Unit-testable in
 * isolation. See SPEC.md §1.2.4 for the algorithm in plain language.
 */

// At 16kHz Whisper rate, ~400ms of audio per spoken word is a reasonable
// average. Used to trim the rolling buffer behind committed words so memory
// + transcription cost stays bounded.
const AVG_SAMPLES_PER_WORD = 16_000 * 0.4;

function tokenize(s: string): string[] {
  return s.trim().split(/\s+/).filter(Boolean);
}

function commonWordPrefix(a: string[], b: string[]): string[] {
  const out: string[] = [];
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) out.push(a[i]);
    else break;
  }
  return out;
}

export class Agreement {
  /** Words confirmed and emitted, joined with single spaces. */
  committed: string = "";
  /** Unconfirmed tail of the most recent hypothesis. */
  liveLine: string = "";
  /** Words promoted to `committed` during the most recent ingest(). */
  newlyCommitted: string[] = [];
  /** Samples to trim from the front of the rolling buffer after this tick. */
  samplesToTrim: number = 0;

  private lastTokens: string[] = [];
  private committedTokens: string[] = [];

  ingest(hypothesis: string): void {
    this.newlyCommitted = [];
    this.samplesToTrim = 0;
    const tokens = tokenize(hypothesis);

    // Compute commonality with previous hypothesis (LocalAgreement-2)
    const agreed = commonWordPrefix(this.lastTokens, tokens);

    // Only consider promoting words that extend BEYOND already-committed text.
    // Also verify the agreed prefix is consistent with what's already committed
    // (monotonicity guard — committed words never retract).
    if (agreed.length > this.committedTokens.length) {
      const consistent = this.committedTokens.every(
        (w, i) => agreed[i] === w,
      );
      if (consistent) {
        const newWords = agreed.slice(this.committedTokens.length);
        this.committedTokens = agreed;
        this.committed = this.committedTokens.join(" ");
        this.newlyCommitted = newWords;
        this.samplesToTrim = Math.floor(newWords.length * AVG_SAMPLES_PER_WORD);
      }
    }

    // Live line = whatever in the latest hypothesis comes AFTER what's committed.
    // If the latest hypothesis doesn't even agree with the committed prefix,
    // there's no meaningful "tail" to show — keep liveLine empty.
    const hypothesisAgreesWithCommitted =
      tokens.length >= this.committedTokens.length &&
      this.committedTokens.every((w, i) => tokens[i] === w);
    const liveTokens = hypothesisAgreesWithCommitted
      ? tokens.slice(this.committedTokens.length)
      : [];
    this.liveLine = liveTokens.join(" ");

    this.lastTokens = tokens;
  }

  reset(): void {
    this.committed = "";
    this.liveLine = "";
    this.newlyCommitted = [];
    this.samplesToTrim = 0;
    this.lastTokens = [];
    this.committedTokens = [];
  }
}
