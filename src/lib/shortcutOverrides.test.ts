/**
 * Unit tests for the shortcut overrides layer (pure functions only).
 */

import { describe, expect, it, beforeEach } from "vitest";
import type { Shortcut } from "./shortcuts";
import {
  applyOverrides,
  clearAllOverrides,
  clearOverride,
  detectConflict,
  displayKey,
  loadOverrides,
  normalizeKey,
  saveOverride,
  type ShortcutOverrides,
} from "./shortcutOverrides";

// Minimal in-memory localStorage shim for node env.
// (vitest runs `environment: "node"` per vitest.config.ts.)
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

const noop = () => undefined;

function mkShortcuts(): Shortcut[] {
  return [
    { id: "start", key: "Enter", contexts: ["idle"], label: "Start", section: "Navigation", handler: noop },
    { id: "stop", key: "Escape", contexts: ["active-live", "active-paused"], label: "Stop", section: "Capture", handler: noop },
    { id: "pause", key: "Space", contexts: ["active-live", "active-paused"], label: "Pause", section: "Capture", handler: noop },
    { id: "popout", key: "p", contexts: ["active-live", "active-paused"], label: "Pop out", section: "Window", handler: noop },
    { id: "help", key: "?", contexts: [], label: "Help", section: "Help", handler: noop },
  ];
}

describe("shortcutOverrides", () => {
  beforeEach(() => {
    // Each test gets a clean MemStorage attached to global.
    (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
  });

  describe("normalizeKey", () => {
    function mkEvt(props: Partial<KeyboardEvent>): KeyboardEvent {
      return {
        key: "",
        code: "",
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        ...props,
      } as KeyboardEvent;
    }

    it("flags modifier-only press as not assignable", () => {
      const r = normalizeKey(mkEvt({ key: "Shift" }));
      expect(r?.modifier).toBe(true);
    });

    it("blocks Tab as reserved", () => {
      const r = normalizeKey(mkEvt({ key: "Tab" }));
      expect(r?.reserved).toBe(true);
    });

    it("blocks function keys as reserved", () => {
      const r = normalizeKey(mkEvt({ key: "F5" }));
      expect(r?.reserved).toBe(true);
    });

    it("returns null for modifier+key combos (we don't support chords)", () => {
      expect(normalizeKey(mkEvt({ key: "k", ctrlKey: true }))).toBeNull();
      expect(normalizeKey(mkEvt({ key: "k", metaKey: true }))).toBeNull();
    });

    it("canonicalizes Space", () => {
      expect(normalizeKey(mkEvt({ key: " ", code: "Space" }))?.key).toBe("Space");
    });

    it("canonicalizes Enter / Escape / ?", () => {
      expect(normalizeKey(mkEvt({ key: "Enter" }))?.key).toBe("Enter");
      expect(normalizeKey(mkEvt({ key: "Escape" }))?.key).toBe("Escape");
      expect(normalizeKey(mkEvt({ key: "?" }))?.key).toBe("?");
    });

    it("lowercases single-letter keys", () => {
      expect(normalizeKey(mkEvt({ key: "P" }))?.key).toBe("p");
      expect(normalizeKey(mkEvt({ key: "a" }))?.key).toBe("a");
    });

    it("preserves multi-char names like arrows", () => {
      expect(normalizeKey(mkEvt({ key: "ArrowDown" }))?.key).toBe("ArrowDown");
    });
  });

  describe("loadOverrides / saveOverride / clearOverride", () => {
    it("returns {} when nothing stored", () => {
      expect(loadOverrides()).toEqual({});
    });

    it("round-trips a single override", () => {
      saveOverride("pause", "k");
      expect(loadOverrides()).toEqual({ pause: "k" });
    });

    it("clearOverride removes a single key", () => {
      saveOverride("pause", "k");
      saveOverride("stop", "x");
      clearOverride("pause");
      expect(loadOverrides()).toEqual({ stop: "x" });
    });

    it("clearAllOverrides wipes everything", () => {
      saveOverride("pause", "k");
      saveOverride("stop", "x");
      clearAllOverrides();
      expect(loadOverrides()).toEqual({});
    });

    it("silently drops malformed entries on load", () => {
      // Force a bad value into storage.
      (globalThis as unknown as { localStorage: MemStorage }).localStorage.setItem(
        "livecaptionit:shortcut-overrides",
        JSON.stringify({ valid: "x", bad: 42, also_bad: null }),
      );
      expect(loadOverrides()).toEqual({ valid: "x" });
    });

    it("returns {} on JSON parse error", () => {
      (globalThis as unknown as { localStorage: MemStorage }).localStorage.setItem(
        "livecaptionit:shortcut-overrides",
        "not-json",
      );
      expect(loadOverrides()).toEqual({});
    });
  });

  describe("applyOverrides", () => {
    it("swaps key for matching id, leaves others alone", () => {
      const out = applyOverrides(mkShortcuts(), { pause: "k" });
      expect(out.find((s) => s.id === "pause")?.key).toBe("k");
      expect(out.find((s) => s.id === "stop")?.key).toBe("Escape");
    });

    it("ignores override for unknown id", () => {
      const out = applyOverrides(mkShortcuts(), { ghost: "g" });
      expect(out.map((s) => s.key)).toEqual(["Enter", "Escape", "Space", "p", "?"]);
    });

    it("returns a new array — original untouched", () => {
      const orig = mkShortcuts();
      const out = applyOverrides(orig, { pause: "k" });
      expect(out).not.toBe(orig);
      expect(orig.find((s) => s.id === "pause")?.key).toBe("Space"); // original intact
    });
  });

  describe("detectConflict", () => {
    it("returns null when no conflict", () => {
      expect(detectConflict("pause", "k", mkShortcuts(), {})).toBeNull();
    });

    it("flags conflict with overlapping contexts", () => {
      // Both pause and popout fire in active-live + active-paused.
      // Remapping popout to Space would collide with pause.
      expect(detectConflict("popout", "Space", mkShortcuts(), {})).toBe("pause");
    });

    it("allows same key when contexts don't overlap", () => {
      // start is idle-only, pause is active-only — different contexts, no conflict.
      expect(detectConflict("start", "Space", mkShortcuts(), {})).toBeNull();
    });

    it("empty contexts (always) conflicts with any key match", () => {
      // help is always-on with ?. Remapping start to ? conflicts.
      expect(detectConflict("start", "?", mkShortcuts(), {})).toBe("help");
    });

    it("respects existing overrides when checking", () => {
      // Override pause to k. Now Space is free. Remapping popout to Space should be OK.
      const overrides: ShortcutOverrides = { pause: "k" };
      expect(detectConflict("popout", "Space", mkShortcuts(), overrides)).toBeNull();
    });

    it("ignores the shortcut being remapped (no self-conflict)", () => {
      // Re-binding pause to its current key (Space) is not a conflict with itself.
      expect(detectConflict("pause", "Space", mkShortcuts(), {})).toBeNull();
    });
  });

  describe("displayKey", () => {
    it("uppercases single chars", () => {
      expect(displayKey("p")).toBe("P");
      expect(displayKey("k")).toBe("K");
    });
    it("passes Space + multi-char through", () => {
      expect(displayKey("Space")).toBe("Space");
      expect(displayKey("Escape")).toBe("Escape");
      expect(displayKey("ArrowDown")).toBe("ArrowDown");
    });
    it("translates raw space char to Space", () => {
      expect(displayKey(" ")).toBe("Space");
    });
  });
});
