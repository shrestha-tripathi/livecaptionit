import { describe, it, expect, beforeEach, vi } from "vitest";

// Use a stub-able sessionStorage since vitest's `node` environment doesn't
// provide one by default. Set up BEFORE importing the module under test
// so the module's module-level `exposeDebugHelper()` sees our globals.
const storage = new Map<string, string>();
const fakeStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => storage.set(k, v),
  removeItem: (k: string) => storage.delete(k),
  clear: () => storage.clear(),
  length: 0,
  key: (_n: number) => null,
};
(globalThis as unknown as { sessionStorage: Storage }).sessionStorage =
  fakeStorage as unknown as Storage;
// Make `window` resolve to globalThis so debug helper attaches without
// throwing. The error-monitor checks `typeof window !== "undefined"`.
(globalThis as unknown as { window: typeof globalThis }).window = globalThis;

import {
  recordError,
  getErrorBuffer,
  clearErrorBuffer,
} from "./errorMonitor";

beforeEach(() => {
  storage.clear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("recordError + getErrorBuffer", () => {
  it("records an Error with source and message", () => {
    recordError(new Error("boom"), "capture");
    const buf = getErrorBuffer();
    expect(buf).toHaveLength(1);
    expect(buf[0].source).toBe("capture");
    expect(buf[0].message).toBe("boom");
    expect(buf[0].stack).toBeTruthy();
    expect(typeof buf[0].ts).toBe("string");
    expect(Number.isNaN(new Date(buf[0].ts).getTime())).toBe(false);
  });

  it("coerces non-Error inputs to Error", () => {
    recordError("plain string", "other");
    const buf = getErrorBuffer();
    expect(buf[0].message).toBe("plain string");
    expect(buf[0].source).toBe("other");
  });

  it("preserves context object", () => {
    recordError(new Error("e"), "import", { ctx: { fileSize: 1234 } });
    const buf = getErrorBuffer();
    expect(buf[0].ctx).toEqual({ fileSize: 1234 });
  });

  it("appends multiple records in order", () => {
    recordError(new Error("first"), "capture");
    recordError(new Error("second"), "whisper");
    recordError(new Error("third"), "pip");
    const buf = getErrorBuffer();
    expect(buf.map((r) => r.message)).toEqual(["first", "second", "third"]);
    expect(buf.map((r) => r.source)).toEqual(["capture", "whisper", "pip"]);
  });

  it("caps the buffer at MAX_BUFFER (50) — drops oldest", () => {
    for (let i = 0; i < 55; i++) {
      recordError(new Error(`err-${i}`), "other");
    }
    const buf = getErrorBuffer();
    expect(buf.length).toBe(50);
    expect(buf[0].message).toBe("err-5"); // oldest 5 dropped
    expect(buf[49].message).toBe("err-54");
  });

  it("always calls console.error regardless of storage state", () => {
    const spy = console.error as ReturnType<typeof vi.fn>;
    recordError(new Error("x"), "other");
    expect(spy).toHaveBeenCalled();
  });
});

describe("clearErrorBuffer", () => {
  it("removes all records", () => {
    recordError(new Error("e"), "other");
    expect(getErrorBuffer()).toHaveLength(1);
    clearErrorBuffer();
    expect(getErrorBuffer()).toHaveLength(0);
  });

  it("is safe on an empty buffer", () => {
    expect(() => clearErrorBuffer()).not.toThrow();
    expect(getErrorBuffer()).toHaveLength(0);
  });
});

describe("getErrorBuffer", () => {
  it("returns empty array when nothing recorded", () => {
    expect(getErrorBuffer()).toEqual([]);
  });

  it("survives malformed sessionStorage value (defensive)", () => {
    storage.set("livecaptionit:errors", "not-json-{");
    expect(getErrorBuffer()).toEqual([]);
  });

  it("survives non-array sessionStorage value", () => {
    storage.set("livecaptionit:errors", '{"not": "an array"}');
    expect(getErrorBuffer()).toEqual([]);
  });
});
