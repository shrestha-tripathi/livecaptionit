import { describe, it, expect, vi } from "vitest";
import {
  dispatch,
  isTypingContext,
  matchesKey,
  type Shortcut,
} from "./shortcuts";

/** Build a synthetic KeyboardEvent without happy-dom — we only inspect properties. */
function fakeEvent(opts: {
  key: string;
  code?: string;
  target?: EventTarget | null;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}): KeyboardEvent {
  return {
    key: opts.key,
    code: opts.code ?? "",
    target: opts.target ?? null,
    altKey: opts.altKey ?? false,
    ctrlKey: opts.ctrlKey ?? false,
    metaKey: opts.metaKey ?? false,
  } as unknown as KeyboardEvent;
}

describe("matchesKey", () => {
  it("matches Space via event.key=' '", () => {
    expect(matchesKey(fakeEvent({ key: " " }), "Space")).toBe(true);
  });

  it("matches Space via event.code='Space' (some layouts)", () => {
    expect(matchesKey(fakeEvent({ key: "Unidentified", code: "Space" }), "Space")).toBe(true);
  });

  it("matches Escape literal", () => {
    expect(matchesKey(fakeEvent({ key: "Escape" }), "Escape")).toBe(true);
  });

  it("matches single-letter case-insensitively", () => {
    expect(matchesKey(fakeEvent({ key: "P" }), "p")).toBe(true);
    expect(matchesKey(fakeEvent({ key: "p" }), "P")).toBe(true);
  });

  it("does not match different keys", () => {
    expect(matchesKey(fakeEvent({ key: "Enter" }), "Escape")).toBe(false);
  });

  it("matches ? literal", () => {
    expect(matchesKey(fakeEvent({ key: "?" }), "?")).toBe(true);
  });
});

describe("isTypingContext", () => {
  it("returns false for null target", () => {
    expect(isTypingContext(null)).toBe(false);
  });

  it("returns false for non-element target (no matches() fn)", () => {
    expect(isTypingContext({} as EventTarget)).toBe(false);
  });

  it("returns true when matches() returns true", () => {
    const el = { matches: (sel: string) => sel.includes("input") };
    expect(isTypingContext(el as unknown as EventTarget)).toBe(true);
  });

  it("returns false when matches() returns false", () => {
    const el = { matches: () => false };
    expect(isTypingContext(el as unknown as EventTarget)).toBe(false);
  });

  it("swallows matches() throws and returns false", () => {
    const el = { matches: () => { throw new Error("boom"); } };
    expect(isTypingContext(el as unknown as EventTarget)).toBe(false);
  });
});

describe("dispatch", () => {
  const onStop = vi.fn();
  const onPause = vi.fn();
  const onHelp = vi.fn();
  const shortcuts: Shortcut[] = [
    {
      id: "stop",
      key: "Escape",
      contexts: ["active-live"],
      label: "Stop",
      section: "Capture",
      handler: onStop,
    },
    {
      id: "pause",
      key: "Space",
      contexts: ["active-live"],
      label: "Pause/Resume",
      section: "Capture",
      handler: onPause,
    },
    {
      id: "help",
      key: "?",
      contexts: [], // always
      label: "Help",
      section: "Help",
      handler: onHelp,
    },
  ];

  it("matches Escape in active-live context", () => {
    const m = dispatch(fakeEvent({ key: "Escape" }), shortcuts, "active-live");
    expect(m?.label).toBe("Stop");
  });

  it("does not match Escape in idle context (gated)", () => {
    expect(dispatch(fakeEvent({ key: "Escape" }), shortcuts, "idle")).toBeNull();
  });

  it("matches always-shortcuts regardless of context", () => {
    expect(dispatch(fakeEvent({ key: "?" }), shortcuts, "idle")?.label).toBe("Help");
    expect(dispatch(fakeEvent({ key: "?" }), shortcuts, "active-live")?.label).toBe("Help");
  });

  it("returns null when Ctrl/Meta is held (don't hijack browser shortcuts)", () => {
    expect(
      dispatch(fakeEvent({ key: "Escape", ctrlKey: true }), shortcuts, "active-live"),
    ).toBeNull();
    expect(
      dispatch(fakeEvent({ key: "Escape", metaKey: true }), shortcuts, "active-live"),
    ).toBeNull();
  });

  it("returns null when target is a typing element", () => {
    const inputEl = { matches: (sel: string) => sel.includes("input") };
    const m = dispatch(
      fakeEvent({ key: "Escape", target: inputEl as unknown as EventTarget }),
      shortcuts,
      "active-live",
    );
    expect(m).toBeNull();
  });

  it("returns null for unmatched key", () => {
    expect(dispatch(fakeEvent({ key: "x" }), shortcuts, "active-live")).toBeNull();
  });
});

describe("dispatch — active-paused context (v0.4.1 Space pause/resume)", () => {
  const onStop = vi.fn();
  const onPause = vi.fn();
  const onPopOut = vi.fn();
  /**
   * Mirrors the real CaptionApp.script.ts SHORTCUTS array shape for
   * v0.4.1: Stop + Pop out remain valid while paused (user can still
   * fully stop or change PiP state), and Space toggles pause in both
   * active-live and active-paused.
   */
  const shortcuts: Shortcut[] = [
    {
      id: "stop",
      key: "Escape",
      contexts: ["active-live", "active-paused"],
      label: "Stop",
      section: "Capture",
      handler: onStop,
    },
    {
      id: "pause",
      key: "Space",
      contexts: ["active-live", "active-paused"],
      label: "Pause/Resume",
      section: "Capture",
      handler: onPause,
    },
    {
      id: "popout",
      key: "p",
      contexts: ["active-live", "active-paused"],
      label: "Pop out",
      section: "Window",
      handler: onPopOut,
    },
  ];

  it("matches Space in active-live (toggles to paused)", () => {
    expect(
      dispatch(fakeEvent({ key: " " }), shortcuts, "active-live")?.label,
    ).toBe("Pause/Resume");
  });

  it("matches Space in active-paused (toggles to live)", () => {
    expect(
      dispatch(fakeEvent({ key: " " }), shortcuts, "active-paused")?.label,
    ).toBe("Pause/Resume");
  });

  it("does not match Space in idle / loading / active-stopped", () => {
    expect(dispatch(fakeEvent({ key: " " }), shortcuts, "idle")).toBeNull();
    expect(dispatch(fakeEvent({ key: " " }), shortcuts, "loading")).toBeNull();
    expect(
      dispatch(fakeEvent({ key: " " }), shortcuts, "active-stopped"),
    ).toBeNull();
  });

  it("still matches Stop (Escape) in active-paused", () => {
    expect(
      dispatch(fakeEvent({ key: "Escape" }), shortcuts, "active-paused")?.label,
    ).toBe("Stop");
  });

  it("still matches Pop out (P) in active-paused", () => {
    expect(
      dispatch(fakeEvent({ key: "p" }), shortcuts, "active-paused")?.label,
    ).toBe("Pop out");
  });
});
