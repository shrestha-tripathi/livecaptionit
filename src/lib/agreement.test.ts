import { describe, it, expect, beforeEach } from "vitest";
import { Agreement, StringAgreement, WordAgreement } from "./agreement";
import type { Word } from "./word";

describe("Agreement (LocalAgreement-2) — string mode", () => {
  let a: StringAgreement;
  beforeEach(() => {
    a = new StringAgreement();
  });

  it("starts empty", () => {
    expect(a.committed).toBe("");
    expect(a.liveLine).toBe("");
    expect(a.newlyCommitted).toEqual([]);
  });

  it("first tick: no commit, live shows hypothesis", () => {
    a.ingest("Hello");
    expect(a.committed).toBe("");
    expect(a.liveLine).toBe("Hello");
    expect(a.newlyCommitted).toEqual([]);
  });

  it("two ticks with matching prefix commits the prefix", () => {
    a.ingest("Hello");
    a.ingest("Hello world");
    expect(a.committed).toBe("Hello");
    expect(a.liveLine).toBe("world");
    expect(a.newlyCommitted).toEqual(["Hello"]);
  });

  it("growing prefix commits incrementally", () => {
    a.ingest("Hello world");
    a.ingest("Hello world how");
    expect(a.committed).toBe("Hello world");
    expect(a.newlyCommitted).toEqual(["Hello", "world"]);

    a.ingest("Hello world how are");
    expect(a.committed).toBe("Hello world how");
    expect(a.newlyCommitted).toEqual(["how"]);
  });

  it("disagreement on prefix: no new commit, live updates", () => {
    a.ingest("Hello world");
    a.ingest("Hello world");
    // committed = "Hello world", live = ""
    a.ingest("Goodbye now");
    expect(a.committed).toBe("Hello world");
    expect(a.newlyCommitted).toEqual([]);
    // live line is what's after committed in latest hypothesis (none agrees) — empty
    expect(a.liveLine).toBe("");
  });

  it("monotonicity: committed words never retract", () => {
    a.ingest("the quick brown");
    a.ingest("the quick brown fox");
    expect(a.committed).toBe("the quick brown");
    a.ingest("the slow brown fox"); // hypothesis disagrees with committed
    // committed remains, no rollback
    expect(a.committed).toBe("the quick brown");
  });

  it("word-boundary safe: partial word match does not commit", () => {
    a.ingest("Hello wor");
    a.ingest("Hello world");
    // "Hello" agrees, "wor" vs "world" disagrees at word level
    expect(a.committed).toBe("Hello");
    expect(a.newlyCommitted).toEqual(["Hello"]);
  });

  it("handles empty hypothesis gracefully", () => {
    a.ingest("Hello world");
    a.ingest("");
    expect(a.committed).toBe("");
    expect(a.newlyCommitted).toEqual([]);
    expect(a.liveLine).toBe("");
  });

  it("trims leading/trailing whitespace before comparison", () => {
    a.ingest("  Hello  ");
    a.ingest(" Hello world ");
    expect(a.committed).toBe("Hello");
  });

  it("case-sensitive matching (Whisper is deterministic with temp=0)", () => {
    a.ingest("hello");
    a.ingest("Hello"); // capitalized differs — no agreement
    expect(a.committed).toBe("");
  });

  it("newlyCommitted is the per-tick delta only", () => {
    a.ingest("a b c");
    a.ingest("a b c d");
    expect(a.newlyCommitted).toEqual(["a", "b", "c"]);

    a.ingest("a b c d e");
    expect(a.newlyCommitted).toEqual(["d"]);
  });

  it("liveLine ends without trailing whitespace", () => {
    a.ingest("foo bar");
    a.ingest("foo bar baz");
    expect(a.liveLine).toBe("baz");
    expect(a.liveLine.endsWith(" ")).toBe(false);
  });

  it("samplesToTrim reports samples behind newly-committed words", () => {
    a.ingest("hello world");
    a.ingest("hello world how are you");
    // 2 committed words ("hello", "world"). Should report positive sample count.
    expect(a.samplesToTrim).toBeGreaterThan(0);
  });

  it("reset clears all state", () => {
    a.ingest("hello");
    a.ingest("hello world");
    a.reset();
    expect(a.committed).toBe("");
    expect(a.liveLine).toBe("");
    expect(a.newlyCommitted).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────
// v0.4.8 — Word-typed Agreement
// ────────────────────────────────────────────────────────────────────────

describe("WordAgreement (LocalAgreement-2 over Word[])", () => {
  let a: WordAgreement;
  beforeEach(() => {
    a = new WordAgreement();
  });

  const w = (text: string, tStart: number, tEnd: number, conf?: number): Word => ({
    text,
    tStartMs: tStart,
    tEndMs: tEnd,
    ...(conf !== undefined ? { confidence: conf } : {}),
  });

  it("agrees on identical Word text across windows with different timing", () => {
    // Same word "hello" appears in two consecutive windows with different
    // tStartMs values (because the window slides). Agreement key is
    // text.toLowerCase().trim() so these still match.
    a.ingest([w("hello", 0, 420)]);
    a.ingest([w("hello", 100, 520), w("world", 520, 940)]);
    expect(a.committed).toBe("hello");
    expect(a.committedItems).toEqual([w("hello", 0, 420)]);
    expect(a.newlyCommitted).toEqual([w("hello", 0, 420)]);
  });

  it("preserves timing on committed Word items (from first observation)", () => {
    a.ingest([w("hello", 0, 420)]);
    a.ingest([w("hello", 100, 520), w("world", 520, 940)]);
    // Committed item should have the FIRST observation's timing (0, 420),
    // not the second tick's (100, 520) — agreement keeps the original.
    expect(a.committedItems[0].tStartMs).toBe(0);
    expect(a.committedItems[0].tEndMs).toBe(420);
  });

  it("preserves confidence values through commit promotion", () => {
    a.ingest([w("hello", 0, 420, 0.92)]);
    a.ingest([w("hello", 100, 520, 0.95), w("world", 520, 940)]);
    expect(a.committedItems[0].confidence).toBe(0.92);
  });

  it("liveItems carries the unconfirmed Word tail with full timing", () => {
    a.ingest([w("hello", 0, 420), w("world", 420, 840)]);
    a.ingest([w("hello", 100, 520), w("world", 520, 940), w("how", 940, 1080)]);
    expect(a.committed).toBe("hello world");
    expect(a.committedItems).toHaveLength(2);
    expect(a.liveLine).toBe("how");
    expect(a.liveItems).toEqual([w("how", 940, 1080)]);
    expect(a.liveItems[0].tStartMs).toBe(940);
  });

  it("case-insensitive + trim agreement key (text != exact match still agrees)", () => {
    // Whisper sometimes capitalizes or adds leading-space differently across
    // windows. The WordAgreement keyFn normalizes to lowercase + trim so
    // these are considered the same word.
    a.ingest([w("Hello", 0, 420)]);
    a.ingest([w(" hello", 100, 520), w("world", 520, 940)]);
    expect(a.committed).toBe("hello"); // joined via keyFn output
    expect(a.committedItems).toHaveLength(1);
  });

  it("monotonicity holds on Word inputs (committed Words never retract)", () => {
    a.ingest([w("the", 0, 200), w("quick", 200, 500), w("brown", 500, 800)]);
    a.ingest([w("the", 0, 200), w("quick", 200, 500), w("brown", 500, 800), w("fox", 800, 1000)]);
    expect(a.committed).toBe("the quick brown");
    // Disagreement on the prefix — committed must not retract
    a.ingest([w("the", 0, 200), w("slow", 200, 500), w("brown", 500, 800), w("fox", 800, 1000)]);
    expect(a.committed).toBe("the quick brown");
    expect(a.committedItems).toHaveLength(3);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Generic Agreement<T> direct usage — sanity-check that the abstraction
// itself is well-formed for custom T types (e.g. future per-token data).
// ────────────────────────────────────────────────────────────────────────

describe("Agreement<T> generic", () => {
  it("works with a custom keyFn that ignores irrelevant fields", () => {
    type Token = { word: string; tag: string };
    const a = new Agreement<Token>((t) => t.word);
    a.ingest([{ word: "foo", tag: "NOUN" }]);
    a.ingest([{ word: "foo", tag: "VERB" }, { word: "bar", tag: "NOUN" }]);
    // foo agrees (tag is irrelevant per keyFn) → committed
    expect(a.committed).toBe("foo");
    expect(a.committedItems).toEqual([{ word: "foo", tag: "NOUN" }]);
  });
});
