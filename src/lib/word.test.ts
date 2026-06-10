import { describe, expect, it, vi } from "vitest";
import { coerceWords, isWord, type Word } from "./word";

describe("isWord", () => {
  it("accepts a minimal valid Word", () => {
    const w: Word = { text: "hello", tStartMs: 0, tEndMs: 420 };
    expect(isWord(w)).toBe(true);
  });

  it("accepts a Word with optional confidence", () => {
    const w: Word = { text: "world", tStartMs: 420, tEndMs: 840, confidence: 0.95 };
    expect(isWord(w)).toBe(true);
  });

  it("rejects null and undefined", () => {
    expect(isWord(null)).toBe(false);
    expect(isWord(undefined)).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(isWord("hello")).toBe(false);
    expect(isWord(42)).toBe(false);
    expect(isWord(true)).toBe(false);
  });

  it("rejects objects missing required fields", () => {
    expect(isWord({})).toBe(false);
    expect(isWord({ text: "hi" })).toBe(false);
    expect(isWord({ text: "hi", tStartMs: 0 })).toBe(false);
    expect(isWord({ tStartMs: 0, tEndMs: 100 })).toBe(false);
  });

  it("rejects objects with wrong field types", () => {
    expect(isWord({ text: 42, tStartMs: 0, tEndMs: 100 })).toBe(false);
    expect(isWord({ text: "hi", tStartMs: "0", tEndMs: 100 })).toBe(false);
    expect(isWord({ text: "hi", tStartMs: 0, tEndMs: "100" })).toBe(false);
  });

  it("rejects non-finite numbers (NaN / Infinity)", () => {
    expect(isWord({ text: "hi", tStartMs: NaN, tEndMs: 100 })).toBe(false);
    expect(isWord({ text: "hi", tStartMs: 0, tEndMs: Infinity })).toBe(false);
    expect(isWord({ text: "hi", tStartMs: -Infinity, tEndMs: 100 })).toBe(false);
  });

  it("accepts zero-width words (tStart === tEnd)", () => {
    // The worker preserves zero-width chunks from transformers.js because
    // agreement uses text only and trimming would break index alignment.
    const w: Word = { text: ".", tStartMs: 1000, tEndMs: 1000 };
    expect(isWord(w)).toBe(true);
  });

  it("accepts negative tStartMs (window-relative timing edge case)", () => {
    // Worker emits all-positive offsets but downstream might compose
    // multiple windows; defensive coding accepts this.
    expect(isWord({ text: "ok", tStartMs: -50, tEndMs: 50 })).toBe(true);
  });
});

describe("coerceWords", () => {
  it("returns empty array for non-array input", () => {
    expect(coerceWords(null)).toEqual([]);
    expect(coerceWords(undefined)).toEqual([]);
    expect(coerceWords("hello")).toEqual([]);
    expect(coerceWords({})).toEqual([]);
    expect(coerceWords(42)).toEqual([]);
  });

  it("returns empty array for empty array input", () => {
    expect(coerceWords([])).toEqual([]);
  });

  it("passes through a clean Word[] unchanged", () => {
    const words: Word[] = [
      { text: "hello", tStartMs: 0, tEndMs: 420 },
      { text: " world", tStartMs: 420, tEndMs: 840 },
    ];
    expect(coerceWords(words)).toEqual(words);
  });

  it("preserves Words with optional confidence", () => {
    const words: Word[] = [
      { text: "hi", tStartMs: 0, tEndMs: 100, confidence: 0.9 },
      { text: " there", tStartMs: 100, tEndMs: 250, confidence: 0.7 },
    ];
    expect(coerceWords(words)).toEqual(words);
  });

  it("filters malformed entries while keeping valid ones", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const input = [
      { text: "ok", tStartMs: 0, tEndMs: 100 },
      null,
      { text: "broken" }, // missing timestamps
      { text: " also", tStartMs: 100, tEndMs: 200 },
      "stray string",
    ];
    const out = coerceWords(input);
    expect(out).toEqual([
      { text: "ok", tStartMs: 0, tEndMs: 100 },
      { text: " also", tStartMs: 100, tEndMs: 200 },
    ]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/dropped 3 malformed chunk/);
    warnSpy.mockRestore();
  });

  it("does not warn when nothing was dropped", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    coerceWords([{ text: "hi", tStartMs: 0, tEndMs: 100 }]);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("returns an empty array (not throw) when every entry is malformed", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = coerceWords([null, undefined, 1, "foo", {}]);
    expect(out).toEqual([]);
    expect(warnSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });
});
