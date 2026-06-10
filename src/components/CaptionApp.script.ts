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
  startMicCapture,
  createRollingBuffer,
  TARGET_SAMPLE_RATE,
  TICK_INTERVAL_MS,
  MIN_AUDIO_SECONDS,
  type CaptureHandle,
} from "../lib/audioCapture";
import { startSampleCapture } from "../lib/sampleFeed";
import {
  install as installShortcuts,
  type Shortcut,
  type ShortcutContext,
} from "../lib/shortcuts";
import {
  createWhisperClient,
  AVAILABLE_MODELS,
  DEFAULT_MODEL_ID,
  modelById,
  isModelCached,
  type WhisperClient,
  type ModelSpec,
} from "../lib/whisperClient";
import { openPip, isPipSupported, type PipHandle } from "../lib/pipClient";
import { detectSupport } from "../lib/browserSupport";
import { Agreement } from "../lib/agreement";
import { looksHallucinated } from "../lib/hallucination";
import {
  formatTxt,
  formatVtt,
  formatSrt,
  defaultFilename,
  downloadString,
  type TranscriptSegment,
} from "../lib/transcript";

type AppState = "idle" | "loading" | "active" | "error";

const MAX_CAPTION_LINES = 4; // visible committed paragraphs in the history (older drops off)
const MAX_LINE_WORDS = 12; // committed words per paragraph before starting a new one
const MAX_TICK_MS = 2000; // hard cap on adaptive tick interval
const FORCE_COMMIT_KEEP_SECONDS = 2; // keep this much trailing audio after force-commit
const SILENCE_RMS_THRESHOLD = 0.005; // below this = treated as silence (skip transcription)
const SILENCE_RESET_SECONDS = 2.5; // sustained silence longer than this → wipe buffer + agreement (kills Whisper hallucinations)
const HALLUCINATION_MAX_REPEAT = 4; // kept in sync with DEFAULT_REPEAT_THRESHOLD in lib/hallucination.ts — bump both together if the threshold needs tuning
const INLINE_PREF_KEY = "livecaptionit:inline-pref";
const PIP_PREFS_KEY = "livecaptionit:pip-prefs";
const MODEL_PREF_KEY = "livecaptionit:model-pref";
const CAPTION_STYLE_KEY = "livecaptionit:caption-style";
const SOURCE_PREF_KEY = "livecaptionit:source-pref";

type SourceKind = "tab" | "mic";
function loadSourcePref(): SourceKind {
  try {
    const raw = localStorage.getItem(SOURCE_PREF_KEY);
    if (raw === "tab" || raw === "mic") return raw;
  } catch {}
  return "tab";
}
function saveSourcePref(v: SourceKind) {
  try { localStorage.setItem(SOURCE_PREF_KEY, v); } catch {}
}

// NOTE: v0.3.0 shipped a translate task toggle (Transcribe vs Translate → English)
// backed by `livecaptionit:task` localStorage. Removed in v0.3.2 because Whisper's
// translate quality on real-world music + non-English speech wasn't good enough
// to ship as a feature (Despacito → "of thug of thug" loops; Hindi lyrics →
// hallucinated brand names). The decoder-side `no_repeat_ngram_size: 3` and
// the lib/hallucination.ts filter both stay — they help transcribe-mode too.
// If a future revival happens (better Whisper model? IndicWhisper v2?), the
// pattern was: `task` is a per-call param on `pipeline()`, not per-init, so
// no model reload needed; UI was a second `.cp-segment-radio` group with
// mid-session reset of agreement + rolling.

interface CaptionStyle {
  /** Font size scale (0.8 – 2.0). */
  fontScale: number;
  /** Base font weight (400/500/600). Confirmed words auto-bump +300. */
  fontWeight: 400 | 500 | 600;
  /** Vertical alignment of content within the caption box. */
  position: "top" | "middle" | "bottom";
  /** Whether to apply text-shadow (boosts legibility over bright video). */
  textShadow: boolean;
}
const CAPTION_STYLE_DEFAULTS: CaptionStyle = {
  fontScale: 1,
  fontWeight: 400,
  position: "top",
  textShadow: true,
};
function loadCaptionStyle(): CaptionStyle {
  try {
    const raw = localStorage.getItem(CAPTION_STYLE_KEY);
    if (!raw) return { ...CAPTION_STYLE_DEFAULTS };
    const parsed = JSON.parse(raw);
    const fontWeight = parsed.fontWeight === 500 || parsed.fontWeight === 600
      ? parsed.fontWeight
      : 400;
    const position = parsed.position === "middle" || parsed.position === "bottom"
      ? parsed.position
      : "top";
    return {
      fontScale: clamp(Number(parsed.fontScale) || CAPTION_STYLE_DEFAULTS.fontScale, 0.8, 2.0),
      fontWeight,
      position,
      textShadow: parsed.textShadow !== false, // default true
    };
  } catch {
    return { ...CAPTION_STYLE_DEFAULTS };
  }
}
function saveCaptionStyle(s: CaptionStyle) {
  try {
    localStorage.setItem(CAPTION_STYLE_KEY, JSON.stringify(s));
  } catch {}
}

function loadModelPref(): ModelSpec["id"] {
  try {
    const raw = localStorage.getItem(MODEL_PREF_KEY);
    if (raw === "tiny" || raw === "base" || raw === "small") return raw;
  } catch {}
  return DEFAULT_MODEL_ID;
}
function saveModelPref(id: ModelSpec["id"]) {
  try {
    localStorage.setItem(MODEL_PREF_KEY, id);
  } catch {}
}

interface PipPrefs {
  /** Width as percentage of screen.width (1–100). */
  widthPct: number;
  /** Height as percentage of screen.height (1–100). */
  heightPct: number;
}
const PIP_DEFAULTS: PipPrefs = { widthPct: 60, heightPct: 18 };

function loadPipPrefs(): PipPrefs {
  try {
    const raw = localStorage.getItem(PIP_PREFS_KEY);
    if (!raw) return { ...PIP_DEFAULTS };
    const parsed = JSON.parse(raw);
    // Forward-compat: ignore any legacy px / opacity fields the old
    // schema had — only widthPct + heightPct are read here.
    return {
      widthPct: clamp(Number(parsed.widthPct) || PIP_DEFAULTS.widthPct, 15, 100),
      heightPct: clamp(Number(parsed.heightPct) || PIP_DEFAULTS.heightPct, 10, 80),
    };
  } catch {
    return { ...PIP_DEFAULTS };
  }
}
function savePipPrefs(p: PipPrefs) {
  try {
    localStorage.setItem(PIP_PREFS_KEY, JSON.stringify(p));
  } catch {}
}
function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

/** Resolve the user's percentage prefs to pixel dimensions based on the
 *  current screen. We use window.screen (not innerWidth) so the size is
 *  relative to the OS display, not the browser viewport — gives the user
 *  a consistent "% of my monitor" mental model regardless of how big
 *  their browser window is. */
function prefsToPixels(p: PipPrefs): { width: number; height: number } {
  // Some users have multi-monitor setups; screen.availWidth excludes
  // OS taskbars / docks so the PiP doesn't get clipped behind them.
  const screenW = (window.screen && window.screen.availWidth) || window.innerWidth || 1280;
  const screenH = (window.screen && window.screen.availHeight) || window.innerHeight || 720;
  return {
    width: Math.max(200, Math.round((p.widthPct / 100) * screenW)),
    height: Math.max(120, Math.round((p.heightPct / 100) * screenH)),
  };
}

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
  const sampleBtn = rootEl.querySelector<HTMLButtonElement>("#cp-sample-btn")!;
  const sampleAudioEl = rootEl.querySelector<HTMLAudioElement>("#cp-sample-audio")!;
  const stopBtn = rootEl.querySelector<HTMLButtonElement>("#cp-stop-btn")!;
  const restartBtn = rootEl.querySelector<HTMLButtonElement>("#cp-restart-btn")!;
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

  // ── PiP preferences (collapsible panel on idle screen) ──
  const prefWidthInput = rootEl.querySelector<HTMLInputElement>("#cp-pref-width")!;
  const prefHeightInput = rootEl.querySelector<HTMLInputElement>("#cp-pref-height")!;
  const prefWidthVal = rootEl.querySelector<HTMLSpanElement>("#cp-pref-width-val")!;
  const prefHeightVal = rootEl.querySelector<HTMLSpanElement>("#cp-pref-height-val")!;
  const prefPixels = rootEl.querySelector<HTMLParagraphElement>("#cp-pref-pixels")!;
  const prefResetBtn = rootEl.querySelector<HTMLButtonElement>("#cp-pref-reset")!;
  const modelList = rootEl.querySelector<HTMLDivElement>("#cp-model-list")!;
  const styleFontScale = rootEl.querySelector<HTMLInputElement>("#cp-style-fontscale")!;
  const styleFontScaleVal = rootEl.querySelector<HTMLSpanElement>("#cp-style-fontscale-val")!;
  const styleShadow = rootEl.querySelector<HTMLInputElement>("#cp-style-shadow")!;
  const styleResetBtn = rootEl.querySelector<HTMLButtonElement>("#cp-style-reset")!;
  const downloadBar = rootEl.querySelector<HTMLDivElement>("#cp-download-bar")!;
  const dlTxtBtn = rootEl.querySelector<HTMLButtonElement>("#cp-dl-txt")!;
  // Shortcuts dialog lives at the section root, not inside .cp-active panel.
  const shortcutsHelpDialog = rootEl.querySelector<HTMLDialogElement>("#cp-shortcuts-help")!;
  const dlVttBtn = rootEl.querySelector<HTMLButtonElement>("#cp-dl-vtt")!;
  const dlSrtBtn = rootEl.querySelector<HTMLButtonElement>("#cp-dl-srt")!;
  const dlClearBtn = rootEl.querySelector<HTMLButtonElement>("#cp-dl-clear")!;
  // Source toggle (Tab / Mic) — radios in the idle screen
  const sourceRadios = rootEl.querySelectorAll<HTMLInputElement>('input[name="cp-source-toggle"]');

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
  // Silence tracking — RMS samples come from the capture's onLevel callback.
  // We keep a sliding window of recent RMS values to know "how long has it
  // been quiet?" so we can prevent Whisper from hallucinating on silent audio.
  let lastNonSilentMs = 0;
  // Transcript recording — every committed batch gets pushed here with its
  // timestamp relative to sessionStartMs. Cleared on Start/Reset, used by
  // the download buttons that appear in the active panel after Stop.
  let transcriptSegments: TranscriptSegment[] = [];
  let sessionStartMs = 0;

  // ── Initial support detection ──
  const support = detectSupport();
  // Hoist currentSource before support check so we can force-set it to "mic"
  // when display capture isn't available. Restored to saved pref below if
  // support is fine.
  let currentSource: SourceKind = loadSourcePref();
  if (!support.displayMediaAudio) {
    // No tab-audio capture, but mic mode still works via getUserMedia.
    // Force mic source + show explainer instead of disabling Start entirely.
    supportWarn.textContent =
      "Your browser doesn't support tab/screen audio capture. Microphone-only mode is still available — pick 'Microphone' above.";
    supportWarn.classList.remove("hidden");
    // Force the Tab radio off + Mic radio on (and disable the tab radio).
    sourceRadios.forEach((r) => {
      if (r.value === "tab") {
        r.disabled = true;
        r.checked = false;
        const wrap = r.closest("label");
        if (wrap) wrap.classList.add("opacity-40", "cursor-not-allowed");
      }
      if (r.value === "mic") r.checked = true;
    });
    currentSource = "mic";
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

  // ── PiP prefs: load saved values, render into the form, persist on change.
  //    Pixel preview updates live so the user sees exactly what size they'll get. ──
  let pipPrefs: PipPrefs = loadPipPrefs();
  function renderPrefsUI() {
    prefWidthInput.value = String(pipPrefs.widthPct);
    prefHeightInput.value = String(pipPrefs.heightPct);
    prefWidthVal.textContent = `${pipPrefs.widthPct}%`;
    prefHeightVal.textContent = `${pipPrefs.heightPct}%`;
    const px = prefsToPixels(pipPrefs);
    prefPixels.textContent = `≈ ${px.width} × ${px.height} px at your current screen`;
  }
  renderPrefsUI();
  prefWidthInput.addEventListener("input", () => {
    pipPrefs.widthPct = clamp(Number(prefWidthInput.value), 15, 100);
    prefWidthVal.textContent = `${pipPrefs.widthPct}%`;
    const px = prefsToPixels(pipPrefs);
    prefPixels.textContent = `≈ ${px.width} × ${px.height} px at your current screen`;
    savePipPrefs(pipPrefs);
    // Note: takes effect on NEXT PiP open — browsers don't expose
    // a resize-PiP API to opener context.
  });
  prefHeightInput.addEventListener("input", () => {
    pipPrefs.heightPct = clamp(Number(prefHeightInput.value), 10, 80);
    prefHeightVal.textContent = `${pipPrefs.heightPct}%`;
    const px = prefsToPixels(pipPrefs);
    prefPixels.textContent = `≈ ${px.width} × ${px.height} px at your current screen`;
    savePipPrefs(pipPrefs);
  });
  prefResetBtn.addEventListener("click", () => {
    pipPrefs = { ...PIP_DEFAULTS };
    savePipPrefs(pipPrefs);
    renderPrefsUI();
  });

  // ── Model picker: render the radio list with size + cache indicators ──
  //   Cache check is async → render once synchronously (no checks), then
  //   re-render after the cache probes resolve so the indicators light up.
  let selectedModelId: ModelSpec["id"] = loadModelPref();
  let modelCacheStatus: Record<string, boolean> = {};
  function renderModelList() {
    modelList.innerHTML = "";
    for (const m of AVAILABLE_MODELS) {
      const isSelected = m.id === selectedModelId;
      const isCached = modelCacheStatus[m.hfId] === true;
      const item = document.createElement("label");
      item.className =
        "flex items-start gap-3 px-2 py-2 rounded-md cursor-pointer transition-colors " +
        (isSelected
          ? "bg-[var(--color-brand-soft)]"
          : "hover:bg-[var(--color-surface-strong)]");
      item.innerHTML = `
        <input
          type="radio"
          name="cp-model"
          value="${m.id}"
          class="mt-1 accent-[var(--color-brand)] cursor-pointer"
          ${isSelected ? "checked" : ""}
        />
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
            <span>${m.label}</span>
            <span class="font-normal text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
              isCached
                ? "bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]"
                : "bg-[var(--color-surface-strong)] text-[var(--color-fg-muted)]"
            }">
              ${isCached ? `✓ ${m.sizeMb} MB cached` : `↓ ${m.sizeMb} MB download`}
            </span>
          </div>
          <p class="mt-0.5 text-xs text-[var(--color-fg-muted)] leading-snug">${m.hint}</p>
        </div>
      `;
      const radio = item.querySelector<HTMLInputElement>("input")!;
      radio.addEventListener("change", () => {
        if (radio.checked) {
          selectedModelId = m.id;
          saveModelPref(m.id);
          renderModelList(); // refresh selected highlight
        }
      });
      modelList.appendChild(item);
    }
  }
  renderModelList();
  // Probe cache status in parallel, then re-render to light up indicators
  (async () => {
    const results = await Promise.all(
      AVAILABLE_MODELS.map(async (m) => [m.hfId, await isModelCached(m.hfId)] as const),
    );
    for (const [hfId, cached] of results) modelCacheStatus[hfId] = cached;
    renderModelList();
  })();

  // ── Caption style prefs: drive CSS custom properties on the caption box
  //    so changes apply LIVE to both inline and PiP rendering. Position
  //    swaps a utility class for flex alignment. ──
  let captionStyle: CaptionStyle = loadCaptionStyle();
  function applyCaptionStyle(s: CaptionStyle) {
    captionBox.style.setProperty("--caption-font-scale", String(s.fontScale));
    captionBox.style.setProperty("--caption-font-weight", String(s.fontWeight));
    captionBox.style.setProperty(
      "--caption-text-shadow",
      s.textShadow
        ? "0 1px 3px rgba(0, 0, 0, 0.45), 0 0 6px rgba(0, 0, 0, 0.25)"
        : "none",
    );
    captionStream.classList.remove(
      "caption-position-top",
      "caption-position-middle",
      "caption-position-bottom",
    );
    captionStream.classList.add(`caption-position-${s.position}`);
  }
  function renderStyleUI() {
    styleFontScale.value = String(Math.round(captionStyle.fontScale * 100));
    styleFontScaleVal.textContent = `${Math.round(captionStyle.fontScale * 100)}%`;
    styleShadow.checked = captionStyle.textShadow;
    // Reset radio checked state to match current captionStyle
    rootEl
      .querySelectorAll<HTMLInputElement>('input[name="cp-style-fontweight"]')
      .forEach((r) => (r.checked = Number(r.value) === captionStyle.fontWeight));
    rootEl
      .querySelectorAll<HTMLInputElement>('input[name="cp-style-position"]')
      .forEach((r) => (r.checked = r.value === captionStyle.position));
  }
  // Initial: apply saved style + sync UI to it
  renderStyleUI();
  applyCaptionStyle(captionStyle);

  // Wire live updates
  styleFontScale.addEventListener("input", () => {
    captionStyle.fontScale = clamp(Number(styleFontScale.value) / 100, 0.8, 2.0);
    styleFontScaleVal.textContent = `${Math.round(captionStyle.fontScale * 100)}%`;
    applyCaptionStyle(captionStyle);
    saveCaptionStyle(captionStyle);
  });
  rootEl
    .querySelectorAll<HTMLInputElement>('input[name="cp-style-fontweight"]')
    .forEach((r) => {
      r.addEventListener("change", () => {
        if (!r.checked) return;
        const v = Number(r.value);
        if (v === 400 || v === 500 || v === 600) {
          captionStyle.fontWeight = v;
          applyCaptionStyle(captionStyle);
          saveCaptionStyle(captionStyle);
        }
      });
    });
  rootEl
    .querySelectorAll<HTMLInputElement>('input[name="cp-style-position"]')
    .forEach((r) => {
      r.addEventListener("change", () => {
        if (!r.checked) return;
        const v = r.value;
        if (v === "top" || v === "middle" || v === "bottom") {
          captionStyle.position = v;
          applyCaptionStyle(captionStyle);
          saveCaptionStyle(captionStyle);
        }
      });
    });
  styleShadow.addEventListener("change", () => {
    captionStyle.textShadow = styleShadow.checked;
    applyCaptionStyle(captionStyle);
    saveCaptionStyle(captionStyle);
  });
  styleResetBtn.addEventListener("click", () => {
    captionStyle = { ...CAPTION_STYLE_DEFAULTS };
    saveCaptionStyle(captionStyle);
    renderStyleUI();
    applyCaptionStyle(captionStyle);
  });

  // Source toggle: restore saved + persist on change
  sourceRadios.forEach((r) => {
    r.checked = (r.value as SourceKind) === currentSource;
    r.addEventListener("change", () => {
      if (!r.checked) return;
      const v = r.value as SourceKind;
      currentSource = v;
      saveSourcePref(v);
    });
  });

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
    // v0.4.0: also mirror keyboard shortcuts into the PiP window's document
    // so Esc/P inside the floating window work as expected. When inPip is
    // true and pipHandle is set, install on pipHandle.pipWindow.document;
    // otherwise uninstall (close cleanup).
    setPipShortcuts(inPip && pipHandle ? pipHandle : null);
  }

  function setState(state: AppState) {
    rootEl.dataset.state = state;
    panels.idle.classList.toggle("hidden", state !== "idle");
    panels.loading.classList.toggle("hidden", state !== "loading");
    panels.active.classList.toggle("hidden", state !== "active");
    panels.error.classList.toggle("hidden", state !== "error");
    currentState = state;
  }
  /** Cached for getShortcutContext() — the source of truth is the dataset
   *  attribute but reading it on every keydown adds overhead. */
  let currentState: AppState = "idle";

  /** Active-panel substate: "live" while captioning, "stopped" after Stop
   *  when transcript has content (so user can still see history + download).
   *  Elements with `data-when="live"` / `data-when="stopped"` toggle visibility
   *  via the `.hidden` class — covers the LIVE/STOPPED indicators, the Stop
   *  button label swap (Stop → Done), Pop Out (hidden when stopped), and
   *  the "Start new" button (only visible when stopped).
   *
   *  IMPORTANT: query from `document`, NOT `rootEl`. The caption-box header
   *  (which contains most of the `data-when` elements) gets physically moved
   *  into the Document PiP window via appendChild while PiP is open, so it's
   *  no longer a descendant of rootEl during a live session. Querying rootEl
   *  would silently match zero elements and leave the previous stopped/live
   *  indicators stuck on whatever they were before PiP opened. This caused
   *  the v0.3.1 regression where "Start new → Start" left the STOPPED label
   *  showing inside PiP. */
  type Substate = "live" | "stopped";
  let currentSubstate: Substate = "live";
  function setSubstate(s: Substate) {
    currentSubstate = s;
    rootEl.dataset.substate = s;
    document.querySelectorAll<HTMLElement>("[data-when]").forEach((el) => {
      el.classList.toggle("hidden", el.dataset.when !== s);
    });
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
   * Append newly-committed words to the caption stream. Committed words
   * are rendered bold; the live (uncommitted) tail flows inline after
   * them as a muted span. When a new paragraph starts, the live tail
   * follows the cursor to the new paragraph.
   *
   * Words are appended to the LAST <p> until it hits MAX_LINE_WORDS,
   * then a new <p> starts — keeps lines visually bounded without doing
   * heavy sentence segmentation.
   */
  function appendCommittedWords(words: string[]) {
    if (words.length === 0) return;
    // Record into transcript log first (the source of truth for downloads).
    transcriptSegments.push({
      words: [...words],
      tMs: sessionStartMs ? performance.now() - sessionStartMs : 0,
    });
    // On first commit, clear placeholder + hide status banner
    if (captionCount === 0) {
      captionStream.innerHTML = "";
      hideCaptionStatus();
    }
    let lastP = captionStream.lastElementChild as HTMLParagraphElement | null;
    // If the last paragraph ends with a live-tail span, strip it so we
    // can append plain text to its end (then re-add the live tail in
    // renderLiveLine()).
    if (lastP) stripLiveTail(lastP);

    for (const word of words) {
      // Count only the bold (committed) words for line-break math
      const committedWordCount = lastP
        ? committedWordsIn(lastP)
        : MAX_LINE_WORDS;
      if (!lastP || committedWordCount >= MAX_LINE_WORDS) {
        lastP = document.createElement("p");
        lastP.className = "mb-2";
        captionStream.appendChild(lastP);
      }
      const strong = document.createElement("strong");
      strong.className = "font-semibold";
      strong.textContent = (committedWordsIn(lastP) > 0 ? " " : "") + word;
      lastP.appendChild(strong);
      captionCount++;
    }
    // Cap paragraph history — only show last N committed lines
    while (captionStream.childElementCount > MAX_CAPTION_LINES) {
      captionStream.firstElementChild?.remove();
    }
    captionStream.scrollTop = captionStream.scrollHeight;
  }

  /** Count the number of committed (<strong>) word elements in a paragraph. */
  function committedWordsIn(p: HTMLParagraphElement): number {
    return p.querySelectorAll("strong").length;
  }

  /** Remove the muted live-tail span from a paragraph if it has one. */
  function stripLiveTail(p: HTMLParagraphElement) {
    const tail = p.querySelector(":scope > span.live-tail");
    if (tail) tail.remove();
  }

  /**
   * Refresh the in-place "live" (uncommitted) tail. Appends as a muted
   * span at the END of the current (last) paragraph so committed +
   * live read as one continuous sentence with two visual weights.
   */
  function renderLiveLine(text: string) {
    // Always start by clearing the previous tail (from any paragraph,
    // in case the cursor moved to a new line on the last commit).
    captionStream.querySelectorAll<HTMLSpanElement>("span.live-tail").forEach((el) => el.remove());

    if (!text) {
      captionStream.scrollTop = captionStream.scrollHeight;
      return;
    }

    let lastP = captionStream.lastElementChild as HTMLParagraphElement | null;
    // No committed text yet → first run, hide placeholder + create a fresh paragraph
    if (!lastP || lastP.tagName !== "P" || lastP.querySelector("strong") === null) {
      if (captionCount === 0) {
        captionStream.innerHTML = "";
        hideCaptionStatus();
      }
      lastP = document.createElement("p");
      lastP.className = "mb-2";
      captionStream.appendChild(lastP);
    }
    const span = document.createElement("span");
    span.className = "live-tail text-[var(--color-fg-subtle)] font-normal";
    span.textContent = (committedWordsIn(lastP) > 0 ? " " : "") + text;
    lastP.appendChild(span);

    captionStream.scrollTop = captionStream.scrollHeight;
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

  /** Detect Whisper hallucinations — extracted to `lib/hallucination.ts`
   *  so it can be unit-tested in isolation. See that module for the full
   *  doc + threshold semantics. The inline copy was Layer-1-only; the
   *  module adds Layer 2 (n-gram phrase repeats) for music content. */

  /** Promote whatever's currently sitting in the live tail to committed
   *  words. Used at "natural break" boundaries — silence-reset, user-stop,
   *  force-commit — where letting the live tail vanish would mean lost
   *  captions the user already SAW on screen (in muted italic).
   *
   *  Skips obvious hallucinations so we don't bold "you you you you" runs.
   *  This is the user-visibility-preserving counterpart to agreement.reset(). */
  function flushLiveTailToCommitted() {
    const liveText = agreement.liveLine;
    if (!liveText) return;
    if (looksHallucinated(liveText)) return;
    const liveTokens = liveText.trim().split(/\s+/).filter(Boolean);
    if (liveTokens.length > 0) appendCommittedWords(liveTokens);
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

    // ── Silence guard ──
    // If audio has been quiet for SILENCE_RESET_SECONDS, nuke the buffer,
    // clear any pending live line, and skip this tick. Otherwise Whisper
    // will confidently hallucinate "you you you you you" / "thanks for
    // watching" / silence-token chains on the trailing silence. This is
    // the actual source of the post-stop / post-pause garbage output.
    //
    // CRITICAL: flush the live tail to committed FIRST. Otherwise any
    // words the user was watching refine in muted italic get nuked
    // without ever becoming bold — the "skipped words" bug.
    const silenceMs = performance.now() - lastNonSilentMs;
    if (silenceMs > SILENCE_RESET_SECONDS * 1000) {
      if (rolling.length() > 0) {
        flushLiveTailToCommitted();
        rolling.reset();
        agreement.reset();
        renderLiveLine("");
      }
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

      // Drop obvious hallucinations (repeated-word runs).
      if (text && !looksHallucinated(text)) {
        agreement.ingest(text);
        if (agreement.newlyCommitted.length > 0) {
          appendCommittedWords(agreement.newlyCommitted);
        }
        renderLiveLine(agreement.liveLine);
      }

      // Force-commit guard: if buffer has grown past the soft cap and we
      // STILL haven't committed enough words to drain it via agreement,
      // promote the entire live hypothesis to committed and trim the
      // buffer (keeping the last ~2s so the next tick has audio context
      // and we don't get a perceptible gap before captions resume).
      if (audioWasOverCap) {
        flushLiveTailToCommitted();
        agreement.reset();
        // Trim everything EXCEPT the trailing FORCE_COMMIT_KEEP_SECONDS so
        // the next tick has context to transcribe instead of silence-starting.
        const keepSamples = FORCE_COMMIT_KEEP_SECONDS * TARGET_SAMPLE_RATE;
        const trimAmount = Math.max(0, rolling.length() - keepSamples);
        if (trimAmount > 0) rolling.trimFront(trimAmount);
        renderLiveLine("");
      }
    } catch (e) {
      console.warn("[LiveCaptionIt] tick failed:", e);
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
    // Flip substate IMMEDIATELY — if a previous session left us in
    // "stopped" substate (Stop → Done → Start new), the caption-box
    // header still has STOPPED + Done labels visible. Flip back to
    // "live" before opening PiP so the moment-of-PiP-open is clean.
    setSubstate("live");
    showLoading("Opening floating window…");

    // Reset all streaming state from any previous run
    whisperReady = false;
    rolling.reset();
    agreement.reset();
    nextTickMs = TICK_INTERVAL_MS;
    // New session — fresh transcript log.
    transcriptSegments = [];
    sessionStartMs = performance.now();
    downloadBar.classList.add("hidden");
    // Treat the moment Start was clicked as "fresh audio incoming" so the
    // silence-reset guard doesn't fire on the first tick before any RMS
    // callbacks have come in.
    lastNonSilentMs = performance.now();
    captionStream.innerHTML = "";

    const usePip = isPipSupported() && !inlineToggle.checked;

    // ── Step 1: open PiP FIRST (must be inside user gesture) ──
    if (usePip) {
      try {
        const { width, height } = prefsToPixels(pipPrefs);
        pipHandle = await openPip({
          movableEl: captionBox,
          homeMount: captionMount,
          width,
          height,
          onClose: () => {
            pipHandle = null;
            setPipMode(false);
          },
        });
        // Caption box is now physically inside PiP. Hide the main-page mount.
        setPipMode(true);
        // Seed the caption box with a friendly waiting state. Copy varies
        // by source: tab capture has a picker, mic just asks for permission.
        if (currentSource === "mic") {
          captionStream.innerHTML = `<p class="text-[var(--color-fg-subtle)] text-sm italic">Waiting for microphone permission…</p>`;
          showCaptionStatus("Requesting microphone…");
        } else {
          captionStream.innerHTML = `<p class="text-[var(--color-fg-subtle)] text-sm italic">Waiting for you to pick a tab in the next prompt…</p>`;
          showCaptionStatus("Opening tab picker…");
        }
      } catch (e) {
        // PiP open failed — fall back to inline rendering, don't abort
        console.warn("[LiveCaptionIt] PiP open failed, falling back to inline:", e);
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
    // Resolve user's model preference to its HF ID + pass to worker init.
    // Re-read pref at start time so changes made in the prefs panel since
    // the page loaded take effect on this run.
    const activeModel = modelById(loadModelPref());
    const initPromise = whisper.init(activeModel.hfId).catch((e) => {
      showError(`Couldn't load Whisper: ${(e as Error).message}`);
    });

    // ── Step 3: ask for screen+audio capture (or mic) IMMEDIATELY (still inside gesture) ──
    try {
      const captureFn = currentSource === "mic" ? startMicCapture : startCapture;
      captureHandle = await captureFn({
        onAudio: (samples) => rolling.append(samples),
        onLevel: (rms) => {
          // RMS callback fires ~10Hz from audioCapture. Record the last
          // time the input was above the silence floor so tick() can
          // decide whether to skip transcription / reset state.
          if (rms > SILENCE_RMS_THRESHOLD) lastNonSilentMs = performance.now();
        },
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
    setSubstate("live");

    scheduleNextTick();

    // Detach: don't await initPromise — UI is already live, worker will
    // emit status events when it's ready and the next tick will pick up.
    void initPromise;
  }

  /**
   * v0.4.0 onboarding shortcut. Plays a bundled MP3 through the SAME
   * pipeline as live capture — no `getDisplayMedia` / `getUserMedia`
   * prompts. First-time visitors see captions within ~2-3s of click.
   *
   * Reuses `startSampleCapture` (a `CaptureHandle`-shaped adapter around
   * sampleFeed) so the rest of the pipeline doesn't know or care it's a
   * sample — auto-stops on `ended` via `onSourceEnded`, same as real
   * tab-ended / mic-revoked teardown.
   *
   * Forces inline mode (no PiP for the sample) so there's zero permission
   * surface; opens audio, model load, transcription all happen in-tab.
   */
  async function startSampleSession() {
    setState("loading");
    setSubstate("live");
    showLoading("Loading sample…");

    // Same reset as startPipeline.
    whisperReady = false;
    rolling.reset();
    agreement.reset();
    nextTickMs = TICK_INTERVAL_MS;
    transcriptSegments = [];
    sessionStartMs = performance.now();
    downloadBar.classList.add("hidden");
    lastNonSilentMs = performance.now();
    captionStream.innerHTML = "";

    // Sample plays inline regardless of inline-pref to keep the demo
    // friction-free (PiP opening would steal focus from caption stream).
    pipHandle = null;
    setPipMode(false);

    // Kick off worker init in background (same model preference as live).
    whisper = createWhisperClient("/whisper-worker.js");
    whisper.onStatus((s) => {
      switch (s.type) {
        case "loading":
          showCaptionStatus(s.message, s.progress);
          break;
        case "ready":
          whisperReady = true;
          showCaptionStatus("Listening to sample…");
          break;
        case "error":
          showError(s.message);
          break;
      }
    });
    const activeModel = modelById(loadModelPref());
    const initPromise = whisper.init(activeModel.hfId).catch((e) => {
      showError(`Couldn't load Whisper: ${(e as Error).message}`);
    });

    // Start the sample as if it were live capture.
    try {
      captureHandle = await startSampleCapture(sampleAudioEl, "/sample.mp3", {
        onAudio: (samples) => rolling.append(samples),
        onLevel: (rms) => {
          if (rms > SILENCE_RMS_THRESHOLD) lastNonSilentMs = performance.now();
        },
        onError: (err) => showError(err.message),
        onSourceEnded: () => {
          stopPipeline("Sample ended.");
        },
      });
    } catch (e) {
      showError((e as Error).message);
      whisper?.dispose();
      whisper = null;
      return;
    }

    captionCount = 0;
    captionStream.innerHTML = "";
    if (whisperReady) {
      showCaptionStatus("Listening to sample…");
    } else {
      showCaptionStatus("Loading Whisper model… (~75 MB one-time)");
    }
    sourceLabel.textContent = `· ${captureHandle.sourceLabel}`;
    setState("active");
    setSubstate("live");

    scheduleNextTick();
    void initPromise;
  }

  function stopPipeline(_reason?: string) {
    if (tickTimer !== null) {
      clearTimeout(tickTimer);
      tickTimer = null;
    }
    // Preserve any in-flight live tail words the user was just watching
    // refine in muted italic — bold-promote them BEFORE wiping state.
    // Without this, words shown but never agreed-upon (the last 1-2s of
    // captions) vanish without trace when the user hits Stop.
    flushLiveTailToCommitted();
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
    // If the user captured any words this session, surface the download
    // buttons + KEEP the active panel visible so they can read what they
    // captured AND save it. Reset button (Clear) clears everything.
    if (transcriptSegments.length > 0) {
      downloadBar.classList.remove("hidden");
      sourceLabel.textContent = "";
      // Stay on "active" panel so caption history is still visible,
      // but flip substate so the header (LIVE → STOPPED, Stop → Done,
      // Pop Out hidden, Start new shown) reflects that capture ended.
      setSubstate("stopped");
    } else {
      // Nothing captured (e.g. they cancelled the picker) — back to idle
      setState("idle");
    }
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
      const { width, height } = prefsToPixels(pipPrefs);
      pipHandle = await openPip({
        movableEl: captionBox,
        homeMount: captionMount,
        width,
        height,
        onClose: () => {
          pipHandle = null;
          setPipMode(false);
        },
      });
      setPipMode(true);
    } catch (e) {
      console.error("[LiveCaptionIt] PiP open failed:", e);
      alert((e as Error).message);
    }
  }

  // ── Event wiring ──
  startBtn.addEventListener("click", () => void startPipeline());
  sampleBtn.addEventListener("click", () => void startSampleSession());

  // ── Keyboard shortcuts (v0.4.0) ──
  function getShortcutContext(): ShortcutContext {
    if (currentState === "loading") return "loading";
    if (currentState === "active") {
      return currentSubstate === "stopped" ? "active-stopped" : "active-live";
    }
    return "idle";
  }
  function toggleShortcutsHelp() {
    if (shortcutsHelpDialog.open) shortcutsHelpDialog.close();
    else shortcutsHelpDialog.showModal();
  }
  const SHORTCUTS: Shortcut[] = [
    {
      key: "Enter",
      contexts: ["idle"],
      label: "Start captions",
      section: "Navigation",
      handler: () => startBtn.click(),
    },
    {
      key: "Escape",
      contexts: ["active-live"],
      label: "Stop capture",
      section: "Capture",
      handler: () => stopBtn.click(),
    },
    {
      key: "p",
      contexts: ["active-live"],
      label: "Pop out / close pop-out",
      section: "Window",
      handler: () => pipBtn.click(),
    },
    {
      key: "r",
      contexts: ["active-stopped"],
      label: "Start new session",
      section: "Navigation",
      handler: () => restartBtn.click(),
    },
    {
      key: "d",
      contexts: ["active-stopped"],
      label: "Download transcript (.txt)",
      section: "Navigation",
      handler: () => dlTxtBtn.click(),
    },
    {
      key: "?",
      contexts: [], // always
      label: "Toggle help",
      section: "Help",
      handler: toggleShortcutsHelp,
    },
  ];
  // Always install on the main document.
  installShortcuts(document, SHORTCUTS, getShortcutContext);
  /** Currently-installed PiP shortcut uninstaller. Resetting it lets us
   *  cleanly swap when PiP closes + reopens during one page session. */
  let pipShortcutsUninstall: (() => void) | null = null;
  /** Install/uninstall keyboard shortcuts on the PiP window document.
   *  Called from setPipMode(true/false). When PiP is focused, keydown
   *  events fire on pipWindow.document only — without this, Esc/P inside
   *  the floating window would do nothing. */
  function setPipShortcuts(handle: { pipWindow: Window } | null) {
    if (pipShortcutsUninstall) {
      pipShortcutsUninstall();
      pipShortcutsUninstall = null;
    }
    if (handle) {
      pipShortcutsUninstall = installShortcuts(
        handle.pipWindow.document,
        SHORTCUTS,
        getShortcutContext,
      );
    }
  }
  stopBtn.addEventListener("click", () => {
    if (currentSubstate === "stopped") {
      // "Done" — user has reviewed/downloaded transcript, ready to go home.
      // Don't auto-clear the transcript — they may not have downloaded yet
      // and we don't want to surprise-wipe data. The "Clear" button in the
      // download bar exists for that.
      setState("idle");
      return;
    }
    stopPipeline("User stop");
  });
  restartBtn.addEventListener("click", () => {
    // Return to idle so user can pick fresh source + start over.
    // Same caveat — don't auto-clear transcript; that's Clear's job.
    setState("idle");
  });
  pipBtn.addEventListener("click", () => void togglePip());
  resetBtn.addEventListener("click", () => setState("idle"));

  // Download buttons (visible after Stop when transcript has content)
  dlTxtBtn.addEventListener("click", () => {
    if (transcriptSegments.length === 0) return;
    downloadString(defaultFilename("txt"), formatTxt(transcriptSegments), "text/plain;charset=utf-8");
  });
  dlVttBtn.addEventListener("click", () => {
    if (transcriptSegments.length === 0) return;
    downloadString(defaultFilename("vtt"), formatVtt(transcriptSegments), "text/vtt;charset=utf-8");
  });
  dlSrtBtn.addEventListener("click", () => {
    if (transcriptSegments.length === 0) return;
    downloadString(defaultFilename("srt"), formatSrt(transcriptSegments), "application/x-subrip;charset=utf-8");
  });
  dlClearBtn.addEventListener("click", () => {
    transcriptSegments = [];
    captionStream.innerHTML = "";
    captionCount = 0;
    downloadBar.classList.add("hidden");
    setState("idle");
  });

  // Ensure clean shutdown if user closes the tab while capturing
  window.addEventListener("pagehide", () => {
    if (tickTimer !== null) clearTimeout(tickTimer);
    captureHandle?.stop();
    whisper?.dispose();
  });
})();
