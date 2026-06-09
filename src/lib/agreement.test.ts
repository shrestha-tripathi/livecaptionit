import { describe, it, expect, beforeEach } from "vitest";
import { Agreement } from "./agreement";

describe("Agreement (LocalAgreement-2)", () => {
  let a: Agreement;
  beforeEach(() => {
    a = new Agreement();
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
