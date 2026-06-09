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
 * ── Rolling-window streaming (v0.1.2) ──
 * Captured audio is piped continuously into a RollingBuffer. A 600ms
 * tick scheduler snapshots the buffer and asks the worker to transcribe
 * the entire window. The transcription feeds the Agreement state machine:
 * stable prefix gets committed (appended to the caption stream as plain
 * text), unconfirmed tail shows as a muted-italic "live line" that
 * refreshes in place each tick. Tick rate adapts to observed inference
 * latency so slow WebGPU/WASM devices don't backlog the worker.
 */

import {
  startCapture,
  createRollingBuffer,
  TICK_INTERVAL_MS,
  MIN_AUDIO_SECONDS,
  type CaptureHandle,
} from "../lib/audioCapture";
import { createWhisperClient, type WhisperClient } from "../lib/whisperClient";
import { openPip, isPipSupported, type PipHandle } from "../lib/pipClient";
import { detectSupport } from "../lib/browserSupport";
import { Agreement } from "../lib/agreement";

type AppState = "idle" | "loading" | "active" | "error";

const MAX_CAPTION_LINES = 25;
const MAX_LINE_WORDS = 14; // committed words per paragraph before starting a new one
const MAX_TICK_MS = 2000; // hard cap on adaptive tick interval
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
  const captionLive = rootEl.querySelector<HTMLParagraphElement>("#cp-caption-live")!;
  const captionStatus = rootEl.querySelector<HTMLDivElement>("#cp-caption-status")!;
  const captionStatusMsg = rootEl.querySelector<HTMLSpanElement>("#cp-caption-status-msg")!;
  const captionStatusBar = rootEl.querySelector<HTMLDivElement>("#cp-caption-status-bar")!;
  const sourceLabel = rootEl.querySelector<HTMLSpanElement>("#cp-source-label")!;
  const loadingMsg = rootEl.querySelector<HTMLSpanElement>("#cp-loading-msg")!;
  const loadingBar = rootEl.querySelector<HTMLDivElement>("#cp-loading-bar")!;
  const errorMsg = rootEl.querySelector<HTMLParagraphElement>("#cp-error-msg")!;
  const supportWarn = rootEl.querySelector<HTMLDivElement>("#cp-support-warn")!;
  const pipPlaceholder = rootEl.querySelector<HTMLDivElement>("#cp-pip-placeholder")!;

  // ── Lifecycle state ──
  let captureHandle: CaptureHandle | null = null;
  let whisper: WhisperClient | null = null;
  let pipHandle: PipHandle | null = null;
  let captionCount = 0;
  let whisperReady = false;

  // Rolling-window state
  const rolling = createRollingBuffer();
  const agreement = new Agreement();
  let tickTimer: number | null = null;
  let inFlight = false;
  let nextTickMs = TICK_INTERVAL_MS;

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

  /**
   * Single source of truth for "is the caption box currently inside PiP?".
   * Updates the data attr on the caption box, swaps placeholder visibility
   * on the main page, AND hides the Pop-out button while inside PiP (you
   * can't "pop out" what's already popped out — the window's own close
   * button + the "Stop" button are the right controls there).
   */
  function setPipMode(inPip: boolean) {
    captionBox.dataset.pipMode = inPip ? "true" : "false";
    if (inPip) {
      captionMount.classList.add("hidden");
      pipPlaceholder.classList.remove("hidden");
      pipBtn.classList.add("hidden");
    } else {
      captionMount.classList.remove("hidden");
      pipPlaceholder.classList.add("hidden");
      pipBtn.classList.remove("hidden");
    }
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

  /**
   * Append newly-committed words to the caption stream. Words are appended
   * to the LAST <p> until it hits MAX_LINE_WORDS, then a new <p> starts —
   * keeps lines visually bounded without doing heavy sentence segmentation.
   */
  function appendCommittedWords(words: string[]) {
    if (words.length === 0) return;
    // On first commit, clear placeholder + hide status banner
    if (captionCount === 0) {
      captionStream.innerHTML = "";
      hideCaptionStatus();
    }
    let lastP = captionStream.lastElementChild as HTMLParagraphElement | null;
    for (const word of words) {
      const lastWordCount = lastP
        ? (lastP.textContent || "").split(/\s+/).filter(Boolean).length
        : MAX_LINE_WORDS;
      if (!lastP || lastWordCount >= MAX_LINE_WORDS) {
        lastP = document.createElement("p");
        lastP.className = "mb-2";
        captionStream.appendChild(lastP);
      }
      lastP.textContent = (lastP.textContent ? lastP.textContent + " " : "") + word;
      captionCount++;
    }
    // Cap paragraph history
    while (captionStream.childElementCount > MAX_CAPTION_LINES) {
      captionStream.firstElementChild?.remove();
    }
    // Auto-scroll to latest
    captionBox.scrollTop = captionBox.scrollHeight;
  }

  /** Refresh the in-place "live" (uncommitted) line. Hidden when empty. */
  function renderLiveLine(text: string) {
    if (!text) {
      captionLive.classList.add("hidden");
      captionLive.textContent = "";
      return;
    }
    captionLive.textContent = text;
    captionLive.classList.remove("hidden");
    // Keep view glued to the live tail
    captionBox.scrollTop = captionBox.scrollHeight;
  }

  // ── Tick scheduler ──

  function scheduleNextTick() {
    if (tickTimer !== null) {
      clearTimeout(tickTimer);
    }
    tickTimer = window.setTimeout(() => {
      tickTimer = null;
      void tick();
    }, nextTickMs);
  }

  async function tick() {
    if (!whisper || !whisperReady || inFlight) {
      scheduleNextTick();
      return;
    }
    if (rolling.durationSeconds() < MIN_AUDIO_SECONDS) {
      scheduleNextTick();
      return;
    }

    inFlight = true;
    try {
      const audio = rolling.snapshot();
      const audioWasOverCap = rolling.isOverCap();
      const { text, durationMs } = await whisper.transcribeWindow(audio);

      // Adapt tick interval — never tick faster than 1.2× last inference,
      // never slower than MAX_TICK_MS. Keeps slow WebGPU/WASM devices
      // from queueing ticks the worker can't drain.
      nextTickMs = Math.min(
        MAX_TICK_MS,
        Math.max(TICK_INTERVAL_MS, Math.ceil(durationMs * 1.2)),
      );

      if (text) {
        agreement.ingest(text);
        if (agreement.newlyCommitted.length > 0) {
          appendCommittedWords(agreement.newlyCommitted);
        }
        renderLiveLine(agreement.liveLine);
      }

      // Force-commit guard: if buffer has grown past the soft cap and we
      // STILL haven't committed enough words to drain it via agreement,
      // promote the entire live hypothesis to committed and reset the
      // buffer. Better to risk one slightly-wrong line than let the
      // window grow forever (which would make every transcribe call
      // re-process the same 20+ seconds of audio and feel hung).
      if (audioWasOverCap) {
        const liveTokens = agreement.liveLine.trim().split(/\s+/).filter(Boolean);
        if (liveTokens.length > 0) appendCommittedWords(liveTokens);
        agreement.reset();
        rolling.reset();
        renderLiveLine("");
      }
    } catch (e) {
      console.warn("[CaptionPip] tick failed:", e);
    } finally {
      inFlight = false;
      scheduleNextTick();
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

    // Reset all streaming state from any previous run
    whisperReady = false;
    rolling.reset();
    agreement.reset();
    nextTickMs = TICK_INTERVAL_MS;
    captionLive.classList.add("hidden");
    captionLive.textContent = "";

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
            setPipMode(false);
          },
        });
        // Caption box is now physically inside PiP. Hide the main-page mount.
        setPipMode(true);
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
    whisper = createWhisperClient("/whisper-worker.js");
    whisper.onStatus((s) => {
      switch (s.type) {
        case "loading":
          if (pipHandle || captureHandle) showCaptionStatus(s.message, s.progress);
          else showLoading(s.message, s.progress);
          break;
        case "ready":
          whisperReady = true;
          if (pipHandle || captureHandle) showCaptionStatus("Listening…");
          else showLoading(`Model ready (${s.device.toUpperCase()}). Asking for audio source…`);
          // Worker is ready — first tick will fire on the existing schedule
          break;
        case "error":
          showError(s.message);
          break;
      }
    });
    const initPromise = whisper.init().catch((e) => {
      showError(`Couldn't load Whisper: ${(e as Error).message}`);
    });

    // ── Step 3: ask for screen+audio capture IMMEDIATELY (still inside gesture) ──
    try {
      captureHandle = await startCapture({
        onAudio: (samples) => rolling.append(samples),
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

    // ── Step 4: surface active state + start the tick loop. Worker may
    //    still be loading; tick() guards on whisperReady. ──
    captionCount = 0;
    // Clear the "Waiting for picker" seed text now that user has picked.
    captionStream.innerHTML = "";
    if (whisperReady) {
      showCaptionStatus("Listening…");
    } else {
      showCaptionStatus("Loading Whisper model… (~75 MB one-time)");
    }
    sourceLabel.textContent = `· ${captureHandle.sourceLabel}`;
    setState("active");

    scheduleNextTick();

    // Detach: don't await initPromise — UI is already live, worker will
    // emit status events when it's ready and the next tick will pick up.
    void initPromise;
  }

  function stopPipeline(_reason?: string) {
    if (tickTimer !== null) {
      clearTimeout(tickTimer);
      tickTimer = null;
    }
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
    inFlight = false;
    rolling.reset();
    agreement.reset();
    renderLiveLine("");
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
          setPipMode(false);
        },
      });
      setPipMode(true);
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
    if (tickTimer !== null) clearTimeout(tickTimer);
    captureHandle?.stop();
    whisper?.dispose();
  });
})();
