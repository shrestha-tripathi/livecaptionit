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
