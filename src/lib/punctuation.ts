/**
 * Punctuation polish — v0.4.3.
 *
 * Pure-function post-processor that cleans common Whisper output quirks:
 *   - Stray spaces before `,.!?;:` (e.g. "hello , world" → "hello, world")
 *   - Missing space after sentence-ending punctuation (e.g. "Hi.How are
 *     you" → "Hi. How are you")
 *   - "i" as standalone pronoun → "I"
 *   - Double/triple spaces collapsed
 *   - Stray spaces around apostrophes inside contractions (e.g.
 *     "don ' t" → "don't")
 *   - Sentence-start lowercase letter → capital (only after a clear
 *     sentence boundary `.!?` + whitespace; never at start of input
 *     because the live tail may not begin a sentence)
 *
 * What this DELIBERATELY does NOT do:
 *   - Add missing punctuation (Whisper is generally OK at this; faking
 *     it would create false certainty)
 *   - Try to fix grammar (out of scope, risk > reward)
 *   - Normalise quote types (single/double, smart/straight — too easy
 *     to introduce false positives)
 *   - Touch words inside detected URLs or @handles (we don't bother
 *     detecting; the Whisper base model rarely emits these intact)
 *
 * Idempotent: polish(polish(x)) === polish(x).
 */

/** Apply the full polish pipeline. Pure function. */
export function polishPunctuation(input: string): string {
  if (!input) return input;
  let s = input;

  // Step 1: collapse runs of whitespace to single space (preserves newlines).
  // Whisper occasionally double-spaces between words on the boundary
  // where two ticks meet.
  s = s.replace(/[ \t]{2,}/g, " ");

  // Step 2: strip stray space BEFORE punctuation (",.!?;:)").
  // Be defensive: don't touch ellipsis ("..." stays, " ..." → "...").
  s = s.replace(/ +([,.!?;:])/g, "$1");

  // Step 2b: ensure space AFTER comma/semicolon/colon when missing and
  // followed by a letter (e.g. "hello,world" → "hello, world").
  // Skip if next char is whitespace, digit, or punctuation — keeps
  // "3,000" and ",.!" intact.
  s = s.replace(/([,;:])(?=[A-Za-z])/g, "$1 ");

  // Step 3: fix missing space AFTER sentence-ending punctuation when the
  // next char is a letter (mid-paragraph "Hi.How" → "Hi. How"). Skip
  // ellipsis and decimals: don't insert space inside "3.14" or "...".
  // Pattern: a sentence terminator NOT preceded by another terminator,
  // NOT followed by another terminator or whitespace/end, AND followed
  // by an ASCII letter.
  s = s.replace(/(?<![.!?])([.!?])(?=[A-Za-z])/g, "$1 ");

  // Step 4: stray spaces around apostrophes inside contractions.
  // "don ' t" → "don't", "it 's" → "it's". Only when surrounded by
  // word characters on both sides.
  s = s.replace(/(\w) +' +(\w)/g, "$1'$2");
  s = s.replace(/(\w) +'(\w)/g, "$1'$2");
  s = s.replace(/(\w)' +(\w)/g, "$1'$2");

  // Step 5: standalone lowercase "i" → "I". Only when bounded by
  // whitespace (or start) and a non-letter punctuation (or end).
  // Avoids touching the "i" in "is", "if", "into" etc.
  s = s.replace(/(^|[\s(])i(?=[\s,.!?;:)']|$)/g, "$1I");

  // Step 6: capitalise the first letter after a sentence boundary
  // (period/exclaim/question + whitespace). Skip if already capital,
  // skip ellipsis (preceded by another `.`), or non-letter.
  // Idempotent because second pass finds nothing lowercase to change.
  s = s.replace(/(?<![.!?])([.!?])(\s+)([a-z])/g, (_m, p1, p2, p3) => p1 + p2 + p3.toUpperCase());

  return s;
}

/** Same as polishPunctuation but operates on an array of words by
 *  joining with single spaces, polishing, and splitting back. Use this
 *  when the caller has a `string[]` (e.g. TranscriptSegment.words).
 *  Returns words. */
export function polishWords(words: string[]): string[] {
  if (words.length === 0) return words;
  const joined = words.join(" ");
  const polished = polishPunctuation(joined);
  // Split-on-whitespace keeps the contract: words.join(" ") roundtrips
  // for inputs that don't need polishing.
  return polished.split(/\s+/).filter(Boolean);
}
