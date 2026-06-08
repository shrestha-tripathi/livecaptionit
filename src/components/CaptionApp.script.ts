/**
 * CaptionApp orchestration. Wires audio capture → Whisper worker → DOM
 * caption stream, plus Document PiP open/close.
 *
 * This file is the ONLY place where audio/worker/pip lifecycles intersect.
 * Keep all state machine transitions in `setState()` so the UI never lies
 * about its current state.
 */

import { startCapture, type CaptureHandle } from "../lib/audioCapture";
import { createWhisperClient, type WhisperClient } from "../lib/whisperClient";
import { openPip, isPipSupported, type PipHandle } from "../lib/pipClient";
import { detectSupport } from "../lib/browserSupport";

type AppState = "idle" | "loading" | "active" | "error";

const MAX_CAPTION_LINES = 25;

(function init() {
  const root = document.getElementById("caption-app");
  if (!root) return;
  // Narrow for closures: capture as non-null after the guard
  const rootEl: HTMLElement = root;

  // ── DOM references ──
  const panels = {
    idle: rootEl.querySelector<HTMLDivElement>('[data-panel="idle"]')!,
    loading: rootEl.querySelector<HTMLDivElement>('[data-panel="loading"]')!,
    active: rootEl.querySelector<HTMLDivElement>('[data-panel="active"]')!,
    error: rootEl.querySelector<HTMLDivElement>('[data-panel="error"]')!,
  };
  const startBtn = rootEl.querySelector<HTMLButtonElement>("#cp-start-btn")!;
  const stopBtn = rootEl.querySelector<HTMLButtonElement>("#cp-stop-btn")!;
  const pipBtn = rootEl.querySelector<HTMLButtonElement>("#cp-pip-btn")!;
  const resetBtn = rootEl.querySelector<HTMLButtonElement>("#cp-reset-btn")!;
  const captionBox = rootEl.querySelector<HTMLDivElement>("#cp-caption-box")!;
  const captionMount = rootEl.querySelector<HTMLDivElement>("#cp-caption-mount")!;
  const captionStream = rootEl.querySelector<HTMLDivElement>("#cp-caption-stream")!;
  const sourceLabel = rootEl.querySelector<HTMLSpanElement>("#cp-source-label")!;
  const loadingMsg = rootEl.querySelector<HTMLSpanElement>("#cp-loading-msg")!;
  const loadingBar = rootEl.querySelector<HTMLDivElement>("#cp-loading-bar")!;
  const errorMsg = rootEl.querySelector<HTMLParagraphElement>("#cp-error-msg")!;
  const supportWarn = rootEl.querySelector<HTMLDivElement>("#cp-support-warn")!;
  const pipPlaceholder = rootEl.querySelector<HTMLDivElement>("#cp-pip-placeholder")!;

  // ── Lifecycle state (not the same as visible state) ──
  let captureHandle: CaptureHandle | null = null;
  let whisper: WhisperClient | null = null;
  let pipHandle: PipHandle | null = null;
  let captionCount = 0;

  // ── Initial support detection ──
  const support = detectSupport();
  if (!support.displayMediaAudio) {
    supportWarn.textContent =
      "Your browser doesn't support screen + audio capture. CaptionPip needs Chrome, Edge, or Brave 116+ on desktop.";
    supportWarn.classList.remove("hidden");
    startBtn.disabled = true;
    startBtn.classList.add("opacity-50", "cursor-not-allowed");
  } else if (!support.documentPip) {
    supportWarn.textContent =
      "Heads-up: the floating Pop-out window needs Chrome/Edge/Brave 116+. Captions still work in this tab.";
    supportWarn.classList.remove("hidden");
  }

  function setState(state: AppState) {
    rootEl.dataset.state = state;
    panels.idle.classList.toggle("hidden", state !== "idle");
    panels.loading.classList.toggle("hidden", state !== "loading");
    panels.active.classList.toggle("hidden", state !== "active");
    panels.error.classList.toggle("hidden", state !== "error");
  }

  function showLoading(msg: string, progress?: number) {
    loadingMsg.textContent = msg;
    if (typeof progress === "number") {
      loadingBar.style.width = `${Math.round(progress * 100)}%`;
    }
  }

  function showError(msg: string) {
    errorMsg.textContent = msg;
    setState("error");
  }

  function appendCaption(text: string) {
    // On first caption, clear the placeholder italic line
    if (captionCount === 0) {
      captionStream.innerHTML = "";
    }
    const p = document.createElement("p");
    p.className = "mb-2";
    p.textContent = text;
    captionStream.appendChild(p);
    captionCount++;

    // Cap line history
    while (captionStream.childElementCount > MAX_CAPTION_LINES) {
      captionStream.firstElementChild?.remove();
    }

    // Auto-scroll to latest. Use the closest scroll container (the caption box).
    const scroller = captionBox; // caption box owns the overflow
    scroller.scrollTop = scroller.scrollHeight;
  }

  // ── Pipeline ──
  async function startPipeline() {
    setState("loading");
    showLoading("Initializing transcription engine…");

    // 1. spin up worker
    whisper = createWhisperClient("/whisper-worker.js");
    whisper.onStatus((s) => {
      switch (s.type) {
        case "loading":
          showLoading(s.message, s.progress);
          break;
        case "ready":
          showLoading(`Model ready (${s.device.toUpperCase()}). Asking for audio source…`);
          break;
        case "error":
          showError(s.message);
          break;
      }
    });

    try {
      await whisper.init("Xenova/whisper-base");
    } catch (e) {
      showError(`Couldn't load Whisper: ${(e as Error).message}`);
      return;
    }

    // 2. ask for screen+audio capture (this triggers permission prompt)
    let inflightTranscriptions = 0;
    try {
      captureHandle = await startCapture({
        onChunk: async (audio) => {
          if (!whisper) return;
          inflightTranscriptions++;
          try {
            const text = await whisper.transcribe(audio);
            if (text) appendCaption(text);
          } catch (e) {
            // Single-chunk failures shouldn't kill the session; log only
            console.warn("[CaptionPip] transcribe failed:", e);
          } finally {
            inflightTranscriptions--;
          }
        },
        onError: (err) => showError(err.message),
        onSourceEnded: () => {
          // User clicked browser's native "Stop sharing"
          stopPipeline("Source ended.");
        },
      });
    } catch (e) {
      showError((e as Error).message);
      // worker may already be running — clean up
      whisper?.dispose();
      whisper = null;
      return;
    }

    captionCount = 0;
    captionStream.innerHTML = `<p class="text-[var(--color-fg-subtle)] text-sm italic">Listening… first caption usually appears within ~3 seconds.</p>`;
    sourceLabel.textContent = `· ${captureHandle.sourceLabel}`;
    setState("active");
  }

  function stopPipeline(_reason?: string) {
    if (captureHandle) {
      captureHandle.stop();
      captureHandle = null;
    }
    if (whisper) {
      whisper.dispose();
      whisper = null;
    }
    if (pipHandle) {
      pipHandle.close();
      pipHandle = null;
    }
    setState("idle");
  }

  async function popOut() {
    if (!isPipSupported()) {
      alert("Pop-out window needs Chrome, Edge, or Brave 116+.");
      return;
    }
    if (pipHandle) {
      pipHandle.close();
      pipHandle = null;
      return;
    }
    try {
      pipHandle = await openPip({
        movableEl: captionBox,
        homeMount: captionMount,
        width: 480,
        height: 260,
        onClose: () => {
          pipHandle = null;
          pipPlaceholder.classList.add("hidden");
          captionMount.classList.remove("hidden");
        },
      });
      // Hide main-page caption box, show placeholder
      captionMount.classList.add("hidden");
      pipPlaceholder.classList.remove("hidden");
    } catch (e) {
      console.error("[CaptionPip] PiP open failed:", e);
      alert((e as Error).message);
    }
  }

  // ── Event wiring ──
  startBtn.addEventListener("click", () => void startPipeline());
  stopBtn.addEventListener("click", () => stopPipeline("User stop"));
  pipBtn.addEventListener("click", () => void popOut());
  resetBtn.addEventListener("click", () => setState("idle"));

  // Ensure clean shutdown if user closes the tab while capturing
  window.addEventListener("pagehide", () => {
    captureHandle?.stop();
    whisper?.dispose();
  });
})();
