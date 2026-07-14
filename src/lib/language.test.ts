import { describe, it, expect, beforeEach } from "vitest";
import {
  LANGUAGES,
  AUTO_CODE,
  DEFAULT_LANGUAGE_CODE,
  languageByCode,
  whisperParamFor,
  loadLanguage,
  saveLanguage,
} from "./language";

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
  clear() {
    this.store = {};
  }
}

describe("language catalog", () => {
  it("starts with Auto and English", () => {
    expect(LANGUAGES[0].code).toBe("auto");
    expect(LANGUAGES[0].whisperParam).toBeUndefined();
    expect(LANGUAGES[1].code).toBe("en");
    expect(LANGUAGES[1].whisperParam).toBe("english");
  });

  it("places Hindi high for the India-market wedge", () => {
    const hiIndex = LANGUAGES.findIndex((l) => l.code === "hi");
    expect(hiIndex).toBeGreaterThan(-1);
    expect(hiIndex).toBeLessThanOrEqual(2);
  });

  it("has unique codes", () => {
    const codes = LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("every non-auto language has a lowercase whisperParam", () => {
    for (const l of LANGUAGES) {
      if (l.code === AUTO_CODE) {
        expect(l.whisperParam).toBeUndefined();
      } else {
        expect(typeof l.whisperParam).toBe("string");
        expect(l.whisperParam).toBe(l.whisperParam!.toLowerCase());
      }
    }
  });
});

describe("languageByCode", () => {
  it("resolves a known code", () => {
    expect(languageByCode("fr").label).toContain("Français");
  });
  it("falls back to Auto for unknown codes", () => {
    expect(languageByCode("garbage").code).toBe("auto");
    expect(languageByCode("").code).toBe("auto");
  });
});

describe("whisperParamFor", () => {
  it("maps auto to undefined", () => {
    expect(whisperParamFor("auto")).toBeUndefined();
  });
  it("maps a language code to Whisper's full name", () => {
    expect(whisperParamFor("fr")).toBe("french");
    expect(whisperParamFor("hi")).toBe("hindi");
  });
  it("maps unknown codes to undefined (safe: let Whisper detect)", () => {
    expect(whisperParamFor("garbage")).toBeUndefined();
  });
});

describe("load/save language (localStorage)", () => {
  beforeEach(() => {
    (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
  });

  it("defaults to auto when unset", () => {
    expect(loadLanguage()).toBe(DEFAULT_LANGUAGE_CODE);
    expect(loadLanguage()).toBe("auto");
  });

  it("persists a pinned language", () => {
    expect(saveLanguage("hi")).toBe("hi");
    expect(loadLanguage()).toBe("hi");
  });

  it("clears storage when set back to auto", () => {
    saveLanguage("fr");
    expect(localStorage.getItem("livecaptionit:language")).toBe("fr");
    saveLanguage("auto");
    expect(localStorage.getItem("livecaptionit:language")).toBeNull();
    expect(loadLanguage()).toBe("auto");
  });

  it("coerces unknown codes to auto on save", () => {
    expect(saveLanguage("garbage")).toBe("auto");
    expect(loadLanguage()).toBe("auto");
  });

  it("ignores a stale/garbage stored value on load", () => {
    localStorage.setItem("livecaptionit:language", "xx-not-real");
    expect(loadLanguage()).toBe("auto");
  });
});
