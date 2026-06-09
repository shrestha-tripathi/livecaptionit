/**
 * CaptionApp orchestration. Wires audio capture → Whisper worker → DOM
 * caption stream, plus Document PiP open/close.
 *
 * This file is the ONLY place where audio/worker/pip lifecycles intersect.
 * Keep all state machine transitions in `setState()` so the UI never lies
 * about its current state.
 *
 * ── PiP-first flow (v0.1.1) ──
 * Document PiP requires a user gesture. So does getDisplayMedia. Chrome
 * permits chained gesture-gated calls inside the same task (transient
 * activation), so we open the PiP window FIRST (purely synchronous setup)
 * and call getDisplayMedia immediately after, BEFORE awaiting model load.
 *
 * Net effect: user clicks Start → PiP floats over everything → tab picker
 * opens on top → user picks → focus jumps to picked tab → PiP is already
 * floating on top, captions stream straight into it. Zero alt-tabs.
 *
 * Users on Firefox/Safari (no Document PiP) fall back to inline rendering
 * automatically. Users who *prefer* inline can flip the toggle pre-start.
 */

import { startCapture, type CaptureHandle } from "../lib/audioCapture";
import { createWhisperClient, type WhisperClient } from "../lib/whisperClient";
import { openPip, isPipSupported, type PipHandle } from "../lib/pipClient";
import { detectSupport } from "../lib/browserSupport";

type AppState = "idle" | "loading" | "active" | "error";

const MAX_CAPTION_LINES = 25;
const INLINE_PREF_KEY = "captionpip:inline-pref";

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
  const inlineToggle = rootEl.querySelector<HTMLInputElement>("#cp-inline-toggle")!;
  const inlineToggleWrap = rootEl.querySelector<HTMLLabelElement>("#cp-inline-toggle-wrap")!;
  const captionBox = rootEl.querySelector<HTMLDivElement>("#cp-caption-box")!;
  const captionMount = rootEl.querySelector<HTMLDivElement>("#cp-caption-mount")!;
  const captionStream = rootEl.querySelector<HTMLDivElement>("#cp-caption-stream")!;
  const captionStatus = rootEl.querySelector<HTMLDivElement>("#cp-caption-status")!;
  const captionStatusMsg = rootEl.querySelector<HTMLSpanElement>("#cp-caption-status-msg")!;
  const captionStatusBar = rootEl.querySelector<HTMLDivElement>("#cp-caption-status-bar")!;
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
  // Queue of audio chunks captured BEFORE whisper finished loading.
  // Drained when worker emits `ready`. Cap at 5 chunks (~15s) to prevent
  // unbounded growth if model load fails silently.
  let pendingAudio: Float32Array[] = [];
  let whisperReady = false;
  const PENDING_AUDIO_CAP = 5;

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
      "Heads-up: your browser doesn't support the floating Pop-out window. Captions will show in this tab instead. (For floating mode, use Chrome, Edge, or Brave 116+.)";
    supportWarn.classList.remove("hidden");
    // No PiP → hide the inline-mode toggle (inline IS the only mode)
    inlineToggleWrap.classList.add("hidden");
  } else {
    // PiP is supported — restore user's inline preference (default: PiP)
    try {
      inlineToggle.checked = localStorage.getItem(INLINE_PREF_KEY) === "1";
    } catch {
      // private mode etc — ignore
    }
    inlineToggle.addEventListener("change", () => {
      try {
        localStorage.setItem(INLINE_PREF_KEY, inlineToggle.checked ? "1" : "0");
      } catch {}
    });
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

  /**
   * Status banner shown INSIDE the caption box (visible in both the main
   * page mount and the PiP window since the box is the same DOM node).
   * Hidden once first caption arrives.
   */
  function showCaptionStatus(msg: string, progress?: number) {
    captionStatus.classList.remove("hidden");
    captionStatusMsg.textContent = msg;
    if (typeof progress === "number") {
      captionStatusBar.style.width = `${Math.round(progress * 100)}%`;
      captionStatusBar.classList.remove("hidden");
    } else {
      captionStatusBar.classList.add("hidden");
    }
  }

  function hideCaptionStatus() {
    captionStatus.classList.add("hidden");
  }

  function showError(msg: string) {
    errorMsg.textContent = msg;
    setState("error");
  }

  function appendCaption(text: string) {
    // On first real caption, clear the placeholder italic line + status banner
    if (captionCount === 0) {
      captionStream.innerHTML = "";
      hideCaptionStatus();
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

  /** Forwards one audio chunk to whisper. If whisper isn't ready yet,
   *  queues the chunk (capped) so the first seconds of speech aren't lost. */
  async function processChunk(audio: Float32Array) {
    if (!whisper) return;
    if (!whisperReady) {
      if (pendingAudio.length < PENDING_AUDIO_CAP) {
        pendingAudio.push(audio);
      }
      // else: drop oldest behaviour would also work but cheap to just cap
      return;
    }
    try {
      const text = await whisper.transcribe(audio);
      if (text) appendCaption(text);
    } catch (e) {
      console.warn("[CaptionPip] transcribe failed:", e);
    }
  }

  async function drainPendingAudio() {
    if (!whisper || !whisperReady) return;
    const queued = pendingAudio;
    pendingAudio = [];
    for (const audio of queued) {
      try {
        const text = await whisper.transcribe(audio);
        if (text) appendCaption(text);
      } catch (e) {
        console.warn("[CaptionPip] backlog transcribe failed:", e);
      }
    }
  }

  // ── Pipeline ──
  /**
   * The order here is load-bearing — Document PiP and getDisplayMedia BOTH
   * require user activation. We open PiP first (synchronous setup) and call
   * getDisplayMedia immediately after, BEFORE awaiting any slow work like
   * worker init. Chrome's transient activation budget covers both.
   */
  async function startPipeline() {
    setState("loading");
    showLoading("Opening floating window…");

    const usePip = isPipSupported() && !inlineToggle.checked;

    // ── Step 1: open PiP FIRST (must be inside user gesture) ──
    if (usePip) {
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
        // Caption box is now physically inside PiP. Hide the main-page mount.
        captionMount.classList.add("hidden");
        pipPlaceholder.classList.remove("hidden");
        // Seed the caption box with a friendly waiting state
        captionStream.innerHTML = `<p class="text-[var(--color-fg-subtle)] text-sm italic">Waiting for you to pick a tab in the next prompt…</p>`;
        showCaptionStatus("Opening tab picker…");
      } catch (e) {
        // PiP open failed — fall back to inline rendering, don't abort
        console.warn("[CaptionPip] PiP open failed, falling back to inline:", e);
        pipHandle = null;
      }
    }

    // ── Step 2: kick off worker init in the background (no await yet) ──
    // We want it loading WHILE the user is in the tab picker, not after.
    whisperReady = false;
    pendingAudio = [];
    whisper = createWhisperClient("/whisper-worker.js");
    whisper.onStatus((s) => {
      switch (s.type) {
        case "loading":
          if (pipHandle) showCaptionStatus(s.message, s.progress);
          else showLoading(s.message, s.progress);
          break;
        case "ready":
          whisperReady = true;
          if (pipHandle) showCaptionStatus(`Listening… (${s.device.toUpperCase()})`);
          else showLoading(`Model ready (${s.device.toUpperCase()}). Asking for audio source…`);
          // Drain any audio captured while model was loading
          void drainPendingAudio();
          break;
        case "error":
          showError(s.message);
          break;
      }
    });
    const initPromise = whisper.init("Xenova/whisper-base").catch((e) => {
      showError(`Couldn't load Whisper: ${(e as Error).message}`);
    });

    // ── Step 3: ask for screen+audio capture IMMEDIATELY (still inside gesture) ──
    try {
      captureHandle = await startCapture({
        onChunk: (audio) => void processChunk(audio),
        onError: (err) => showError(err.message),
        onSourceEnded: () => {
          stopPipeline("Source ended.");
        },
      });
    } catch (e) {
      // Capture failed — clean up everything we opened
      showError((e as Error).message);
      whisper?.dispose();
      whisper = null;
      if (pipHandle) {
        pipHandle.close();
        pipHandle = null;
      }
      return;
    }

    // ── Step 4: surface active state. Worker may still be loading in
    //    background — captions show "Loading Whisper…" until ready. ──
    captionCount = 0;
    if (pipHandle) {
      // Captions live in PiP; main page just shows the placeholder
      if (!whisperReady) showCaptionStatus("Loading Whisper model… (~75 MB one-time)");
    } else {
      captionStream.innerHTML = `<p class="text-[var(--color-fg-subtle)] text-sm italic">Listening… first caption usually appears within ~3 seconds.</p>`;
      if (!whisperReady) showCaptionStatus("Loading Whisper model… (~75 MB one-time)");
    }
    sourceLabel.textContent = `· ${captureHandle.sourceLabel}`;
    setState("active");

    // Detach: don't await initPromise — UI is already live, worker will
    // emit status events when it's ready and drainPendingAudio() will fire.
    void initPromise;
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
    whisperReady = false;
    pendingAudio = [];
    hideCaptionStatus();
    setState("idle");
  }

  /**
   * Manual PiP toggle — used as ESCAPE HATCH when user started inline
   * and decides mid-session to pop out, OR to pop the captions back in.
   * The primary flow opens PiP automatically inside `startPipeline()`.
   */
  async function togglePip() {
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
  pipBtn.addEventListener("click", () => void togglePip());
  resetBtn.addEventListener("click", () => setState("idle"));

  // Ensure clean shutdown if user closes the tab while capturing
  window.addEventListener("pagehide", () => {
    captureHandle?.stop();
    whisper?.dispose();
  });
})();
