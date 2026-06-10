import { describe, it, expect } from "vitest";
import { polishPunctuation, polishWords } from "./punctuation";

describe("polishPunctuation", () => {
  it("returns empty string unchanged", () => {
    expect(polishPunctuation("")).toBe("");
  });

  it("collapses double/triple spaces", () => {
    expect(polishPunctuation("hello  world")).toBe("hello world");
    expect(polishPunctuation("a   b    c")).toBe("a b c");
  });

  it("strips stray space before punctuation", () => {
    expect(polishPunctuation("hello , world")).toBe("hello, world");
    expect(polishPunctuation("Wait . What ?")).toBe("Wait. What?");
    expect(polishPunctuation("no ; really : here")).toBe("no; really: here");
  });

  it("inserts missing space after sentence end", () => {
    expect(polishPunctuation("Hi.How are you")).toBe("Hi. How are you");
    expect(polishPunctuation("Stop!Wait")).toBe("Stop! Wait");
    expect(polishPunctuation("Really?Yes")).toBe("Really? Yes");
  });

  it("preserves ellipsis", () => {
    expect(polishPunctuation("hmm... maybe")).toBe("hmm... maybe");
    expect(polishPunctuation("wait...what")).toBe("wait...what");
  });

  it("preserves decimal numbers (no space insertion)", () => {
    expect(polishPunctuation("pi is 3.14")).toBe("pi is 3.14");
    expect(polishPunctuation("$2.99 each")).toBe("$2.99 each");
  });

  it("fixes contractions with stray spaces around apostrophe", () => {
    expect(polishPunctuation("don ' t worry")).toBe("don't worry");
    expect(polishPunctuation("it 's fine")).toBe("it's fine");
    expect(polishPunctuation("don ' t and it 's")).toBe("don't and it's");
  });

  it("capitalises standalone i", () => {
    expect(polishPunctuation("i think")).toBe("I think");
    expect(polishPunctuation("yes i agree")).toBe("yes I agree");
    expect(polishPunctuation("(i mean)")).toBe("(I mean)");
  });

  it("does NOT capitalise i inside words", () => {
    expect(polishPunctuation("is it")).toBe("is it");
    expect(polishPunctuation("interesting if you")).toBe("interesting if you");
    expect(polishPunctuation("ignite")).toBe("ignite");
  });

  it("capitalises first letter after sentence boundary", () => {
    expect(polishPunctuation("Hello. world is here.")).toBe("Hello. World is here.");
    expect(polishPunctuation("Wait! it's me.")).toBe("Wait! It's me.");
    expect(polishPunctuation("Really? maybe.")).toBe("Really? Maybe.");
  });

  it("does not capitalise mid-sentence words", () => {
    expect(polishPunctuation("the quick brown fox")).toBe("the quick brown fox");
  });

  it("handles combined issues in one pass", () => {
    expect(polishPunctuation("hello ,world.how are you ? i don ' t know"))
      .toBe("hello, world. How are you? I don't know");
  });

  it("is idempotent (polish(polish(x)) === polish(x))", () => {
    const inputs = [
      "hello , world",
      "Hi.How are you",
      "i don ' t know",
      "Wait! it's me.",
      "Already clean text here.",
    ];
    for (const input of inputs) {
      const once = polishPunctuation(input);
      const twice = polishPunctuation(once);
      expect(twice).toBe(once);
    }
  });

  it("does NOT capitalise the very start of input (live-tail may not begin a sentence)", () => {
    // This is intentional — a tick result like "and then he said" is a
    // mid-sentence fragment and shouldn't get auto-capped.
    expect(polishPunctuation("and then he said")).toBe("and then he said");
  });

  it("leaves clean input unchanged", () => {
    const clean = "Hello, world. How are you? I'm doing well.";
    expect(polishPunctuation(clean)).toBe(clean);
  });
});

describe("polishWords", () => {
  it("returns empty array unchanged", () => {
    expect(polishWords([])).toEqual([]);
  });

  it("polishes joined string and re-splits on whitespace", () => {
    expect(polishWords(["hello", ",", "world"]))
      .toEqual(["hello,", "world"]);
  });

  it("preserves word boundaries for clean input", () => {
    expect(polishWords(["hello", "world", "how", "are", "you"]))
      .toEqual(["hello", "world", "how", "are", "you"]);
  });

  it("capitalises i correctly when joined", () => {
    expect(polishWords(["yes", "i", "agree"]))
      .toEqual(["yes", "I", "agree"]);
  });
});
