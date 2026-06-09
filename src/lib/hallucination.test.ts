import { describe, it, expect } from "vitest";
import { looksHallucinated } from "./hallucination";

describe("looksHallucinated — single-word repeats (Layer 1)", () => {
  it("flags classic 'you you you you you' silent-audio garbage", () => {
    expect(looksHallucinated("you you you you you you you you")).toBe(true);
  });

  it("flags exactly 4 repeats (threshold boundary)", () => {
    expect(looksHallucinated("the the the the")).toBe(true);
  });

  it("does NOT flag 3 repeats (below threshold)", () => {
    expect(looksHallucinated("you you you")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(looksHallucinated("You YOU you You you")).toBe(true);
  });

  it("does NOT flag legitimate speech with one repeated word", () => {
    expect(looksHallucinated("the cat sat on the mat")).toBe(false);
  });

  it("does NOT flag legitimate emphasis ('very very nice')", () => {
    expect(looksHallucinated("that was very very nice indeed")).toBe(false);
  });
});

describe("looksHallucinated — n-gram phrase repeats (Layer 2)", () => {
  it("flags the Despacito 'of thug of thug of thug of thug' pattern (n=2)", () => {
    expect(looksHallucinated("of thug of thug of thug of thug")).toBe(true);
  });

  it("flags trigram repeats (n=3)", () => {
    expect(looksHallucinated("go to the go to the go to the go to the")).toBe(true);
  });

  it("flags quadgram repeats (n=4)", () => {
    expect(
      looksHallucinated(
        "one two three four one two three four one two three four one two three four",
      ),
    ).toBe(true);
  });

  it("does NOT flag a single 4-word phrase appearing once", () => {
    expect(looksHallucinated("one two three four five six seven eight")).toBe(false);
  });

  it("does NOT flag a 4-word phrase appearing twice", () => {
    expect(looksHallucinated("one two three four five one two three four six")).toBe(false);
  });

  it("does NOT flag a 4-word phrase appearing three times (still below threshold)", () => {
    expect(looksHallucinated("one two three four one two three four one two three four")).toBe(false);
  });

  it("flags pattern at non-zero offset", () => {
    expect(looksHallucinated("welcome welcome welcome welcome welcome welcome welcome")).toBe(true);
  });

  it("does NOT false-positive on natural song lyrics with internal repetition", () => {
    // "love love love" appears 3 times but is not 4 contiguous repeats
    expect(looksHallucinated("all you need is love love love")).toBe(false);
  });

  it("handles empty / short inputs without throwing", () => {
    expect(looksHallucinated("")).toBe(false);
    expect(looksHallucinated("hello")).toBe(false);
    expect(looksHallucinated("hi hi")).toBe(false);
  });
});

describe("looksHallucinated — custom threshold", () => {
  it("allows tighter detection (threshold=3) when caller wants it", () => {
    expect(looksHallucinated("of thug of thug of thug", 3)).toBe(true);
  });

  it("relaxes detection (threshold=5) when caller wants it", () => {
    expect(looksHallucinated("of thug of thug of thug of thug", 5)).toBe(false);
  });
});
