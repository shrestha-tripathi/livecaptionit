/**
 * Feature detection for LiveCaptionIt's required + nice-to-have browser APIs.
 * Returns plain objects (no React/Astro deps) so they're safe to call from
 * both server-rendered and client-only contexts.
 */

export interface BrowserSupport {
  /** getDisplayMedia + audio tracks. Required for v0.1. Chromium-only realistically. */
  displayMediaAudio: boolean;
  /** Document Picture-in-Picture API. Nice-to-have; degrades to in-page captions. */
  documentPip: boolean;
  /** WebGPU adapter. Strongly recommended; falls back to WASM (slow). */
  webgpu: boolean;
  /** AudioContext (universal in modern browsers). */
  audioContext: boolean;
  /** SharedArrayBuffer (improves transformers.js perf when COOP/COEP headers set). */
  sharedArrayBuffer: boolean;
}

export function detectSupport(): BrowserSupport {
  if (typeof window === "undefined") {
    return {
      displayMediaAudio: false,
      documentPip: false,
      webgpu: false,
      audioContext: false,
      sharedArrayBuffer: false,
    };
  }

  return {
    displayMediaAudio:
      !!navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === "function",
    documentPip: "documentPictureInPicture" in window,
    // WebGPU presence is an async check (requestAdapter); for sync we just look for the API surface.
    webgpu: typeof (navigator as any).gpu !== "undefined",
    audioContext: typeof window.AudioContext !== "undefined" || typeof (window as any).webkitAudioContext !== "undefined",
    sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
  };
}

export async function hasWorkingWebGPU(): Promise<boolean> {
  const gpu = (navigator as any).gpu;
  if (!gpu) return false;
  try {
    const adapter = await gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

/**
 * Best-effort mobile/tablet detection. Used by CaptionApp.script.ts to:
 *  - Default the source toggle to "mic" (mobile has no getDisplayMedia for audio)
 *  - Hide PiP-related UI (Document PiP is desktop-only in 2026)
 *  - Hide keyboard-shortcut affordances (no physical keyboard)
 *
 * Strategy: combine UA sniff (covers iOS/iPadOS/Android) + coarse pointer +
 * narrow viewport. ANY match wins because there is no single reliable signal.
 * Conservative: only `true` when at least one strong indicator is present
 * AND the viewport is genuinely small or pointer is coarse — otherwise a
 * desktop user resizing their browser would incorrectly flip into mobile UX.
 */
export function isMobileDevice(): boolean {
  if (typeof window === "undefined") return false;
  const ua = (navigator.userAgent || "").toLowerCase();
  const uaIsMobile =
    /android|iphone|ipad|ipod|opera mini|iemobile|mobile safari/.test(ua) ||
    // iPadOS 13+ identifies as Mac — disambiguate via touch points
    (/macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1);
  const coarsePointer =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  const narrowViewport = (window.innerWidth || 0) < 768;
  // Require UA hit OR (coarse + narrow). Both safeguards prevent false-positives
  // on desktop touchscreens (Surface laptops report coarse pointer when in
  // tablet mode, but their viewport is rarely < 768).
  return uaIsMobile || (coarsePointer && narrowViewport);
}
