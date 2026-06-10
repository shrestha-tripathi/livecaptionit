/**
 * Unit tests for vocabulary normalization. Pure functions only.
 */

import { describe, expect, it, beforeEach } from "vitest";
import {
  countTerms,
  loadVocabulary,
  sanitizeVocabulary,
  saveVocabulary,
  VOCABULARY_MAX_CHARS,
} from "./vocabulary";

class MemStorage {
  private store: Record<string, string> = {};
  getItem(k: string) {
    return Object.prototype.hasOwnProperty.call(this.store, k) ? this.store[k] : null;
  }
  setItem(k: string, v: string) {
    this.store[k] = v;
  }
  removeItem(k: string) {
    delete this.store[k];
  }
}

describe("vocabulary", () => {
  beforeEach(() => {
    (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
  });

  describe("sanitizeVocabulary", () => {
    it("returns empty for empty input", () => {
      expect(sanitizeVocabulary("")).toBe("");
    });

    it("preserves proper-noun casing", () => {
      expect(sanitizeVocabulary("kubectl, ETL, Postgres")).toBe("kubectl, ETL, Postgres");
    });

    it("collapses newlines to comma+space", () => {
      expect(sanitizeVocabulary("foo\nbar\nbaz")).toBe("foo, bar, baz");
    });

    it("collapses runs of whitespace", () => {
      expect(sanitizeVocabulary("foo     bar")).toBe("foo bar");
    });

    it("dedupes commas", () => {
      expect(sanitizeVocabulary("a,,b,,,c")).toBe("a, b, c");
    });

    it("strips leading and trailing commas", () => {
      expect(sanitizeVocabulary(",foo, bar,")).toBe("foo, bar");
    });

    it("caps at max chars", () => {
      const long = "x".repeat(500);
      expect(sanitizeVocabulary(long).length).toBe(VOCABULARY_MAX_CHARS);
    });

    it("normalizes mixed newline + comma input from user paste", () => {
      const messy = `kubernetes
kubectl,
helm

prometheus,grafana
`;
      expect(sanitizeVocabulary(messy)).toBe("kubernetes, kubectl, helm, prometheus, grafana");
    });
  });

  describe("countTerms", () => {
    it("returns 0 for empty", () => {
      expect(countTerms("")).toBe(0);
    });

    it("counts comma-separated terms", () => {
      expect(countTerms("foo, bar, baz")).toBe(3);
    });

    it("ignores blanks between commas", () => {
      expect(countTerms("foo,, bar")).toBe(2);
    });

    it("works on single term", () => {
      expect(countTerms("kubernetes")).toBe(1);
    });
  });

  describe("loadVocabulary / saveVocabulary", () => {
    it("round-trips a vocabulary string", () => {
      const saved = saveVocabulary("foo, bar, baz");
      expect(saved).toBe("foo, bar, baz");
      expect(loadVocabulary()).toBe("foo, bar, baz");
    });

    it("loads empty when unset", () => {
      expect(loadVocabulary()).toBe("");
    });

    it("clearing (empty string) removes the entry", () => {
      saveVocabulary("foo");
      saveVocabulary("");
      expect(loadVocabulary()).toBe("");
    });

    it("saves the sanitized form", () => {
      const out = saveVocabulary("a,,,b\nc");
      expect(out).toBe("a, b, c");
      expect(loadVocabulary()).toBe("a, b, c");
    });
  });
});
