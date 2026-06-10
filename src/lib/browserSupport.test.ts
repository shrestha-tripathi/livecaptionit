/**
 * Tests for isMobileDevice() — the mobile-detection heuristic used by
 * CaptionApp.script.ts to (a) default the source to mic, (b) hide PiP UI,
 * (c) skip keyboard shortcut installation.
 *
 * The function combines UA sniff + coarse pointer + narrow viewport. We
 * stub navigator + window.innerWidth + window.matchMedia per test.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isMobileDevice } from "./browserSupport";

type Fixture = {
  ua: string;
  maxTouchPoints?: number;
  width?: number;
  pointerCoarse?: boolean;
};

function setupGlobals(f: Fixture): void {
  (globalThis as unknown as { window: typeof window }).window = {
    innerWidth: f.width ?? 1920,
    matchMedia: (q: string) => ({
      matches: q.includes("pointer: coarse") ? !!f.pointerCoarse : false,
    }),
  } as unknown as typeof window;
  (globalThis as unknown as { navigator: typeof navigator }).navigator = {
    userAgent: f.ua,
    maxTouchPoints: f.maxTouchPoints ?? 0,
  } as unknown as typeof navigator;
}

describe("isMobileDevice", () => {
  beforeEach(() => {
    // Ensure clean slate; isMobileDevice short-circuits when window undefined,
    // so we ALWAYS setup before each test.
  });
  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
    delete (globalThis as unknown as { navigator?: unknown }).navigator;
  });

  it("returns false in SSR (no window)", () => {
    expect(isMobileDevice()).toBe(false);
  });

  it("returns true for iPhone UA", () => {
    setupGlobals({
      ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      width: 390,
      pointerCoarse: true,
    });
    expect(isMobileDevice()).toBe(true);
  });

  it("returns true for Android Chrome UA", () => {
    setupGlobals({
      ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
      width: 412,
      pointerCoarse: true,
    });
    expect(isMobileDevice()).toBe(true);
  });

  it("returns true for iPadOS-as-Mac with touch points", () => {
    // iPadOS 13+ ships a Mac-like UA — disambiguate via maxTouchPoints > 1.
    setupGlobals({
      ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
      maxTouchPoints: 5,
      width: 1024,
      pointerCoarse: true,
    });
    expect(isMobileDevice()).toBe(true);
  });

  it("returns false for desktop Chrome on Windows", () => {
    setupGlobals({
      ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      width: 1920,
      pointerCoarse: false,
    });
    expect(isMobileDevice()).toBe(false);
  });

  it("returns false for desktop Mac WITHOUT touch points (real Mac)", () => {
    setupGlobals({
      ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
      maxTouchPoints: 0,
      width: 1440,
      pointerCoarse: false,
    });
    expect(isMobileDevice()).toBe(false);
  });

  it("returns false for desktop touchscreen at wide viewport (Surface laptop)", () => {
    // Coarse pointer + non-mobile UA + WIDE viewport → desktop. Avoids
    // mis-flipping desktop touchscreens into mobile UX.
    setupGlobals({
      ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      width: 1366,
      pointerCoarse: true,
    });
    expect(isMobileDevice()).toBe(false);
  });

  it("returns true for coarse pointer + narrow viewport (tablet without mobile UA)", () => {
    setupGlobals({
      ua: "Mozilla/5.0 (X11; Linux armv7l) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      width: 600,
      pointerCoarse: true,
    });
    expect(isMobileDevice()).toBe(true);
  });
});
