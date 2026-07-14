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
  loadOverrides as loadShortcutOverrides,
  saveOverride as saveShortcutOverride,
  clearOverride as clearShortcutOverride,
  clearAllOverrides as clearAllShortcutOverrides,
  detectConflict as detectShortcutConflict,
  normalizeKey as normalizeShortcutKey,
  displayKey as displayShortcutKey,
} from "../lib/shortcutOverrides";
import {
  loadVocabulary,
  saveVocabulary,
  countTerms as countVocabTerms,
  VOCABULARY_MAX_CHARS,
} from "../lib/vocabulary";
import {
  LANGUAGES,
  loadLanguage,
  saveLanguage,
  languageByCode,
  whisperParamFor,
} from "../lib/language";
import {
  decodeShareUrl,
  encodeShareUrl,
  readSharePayloadFromLocation,
} from "../lib/shareLink";
import {
  saveSession,
  listSessions,
  getSession,
  deleteSession,
  clearAll as clearAllSessions,
  exportAllSessions,
  importSessions,
  validateExportBundle,
  type StoredSession,
  type SessionSource,
} from "../lib/sessionStore";
import { searchSessions, debounce } from "../lib/sessionSearch";
import { toast } from "../lib/toast";
import { initErrorMonitor, recordError } from "../lib/errorMonitor";
import { initPwaInstall } from "../lib/pwaInstall";
import { initOnboardingTour, startTour } from "../lib/onboardingTour";
import {
  createWhisperClient,
  AVAILABLE_MODELS,
  DEFAULT_MODEL_ID,
  MOBILE_DEFAULT_MODEL_ID,
  modelById,
  isModelCached,
  type WhisperClient,
  type ModelSpec,
} from "../lib/whisperClient";
import { openPip, isPipSupported, type PipHandle } from "../lib/pipClient";
import { detectSupport, isMobileDevice } from "../lib/browserSupport";
import { featureFlags } from "../lib/featureFlags";
import { getDebugPanel } from "../lib/debugPanel";
import { WordAgreement } from "../lib/agreement";
import type { Word } from "../lib/word";
import { looksHallucinated } from "../lib/hallucination";
import { StabilityTracker } from "../lib/confidence";
import {
  renderEditableSegments,
  extractPlainText,
  reconcileEditedText,
} from "../lib/transcriptEditor";
import {
  formatTxt,
  formatVtt,
  formatSrt,
  defaultFilename,
  downloadString,
  isV2Segment,
  type AnyTranscriptSegment,
  type TranscriptSegment2,
  type ExportGranularity,
} from "../lib/transcript";

type AppState = "idle" | "loading" | "active" | "error";

const MAX_CAPTION_LINES = 4; // visible committed paragraphs in the history (older drops off)
const MAX_LINE_WORDS = 12; // committed words per paragraph before starting a new one
const MAX_TICK_MS = 2000; // hard cap on adaptive tick interval
const FORCE_COMMIT_KEEP_SECONDS = 2; // keep this much trailing audio after force-commit
const SILENCE_RMS_THRESHOLD = 0.005; // below this = treated as silence (skip transcription)
const SILENCE_RESET_SECONDS = 2.5; // sustained silence longer than this → wipe buffer + agreement (kills Whisper hallucinations)
/** v0.4.3: gap-based turn detection. Silence longer than this triggers
 *  a fresh paragraph on the NEXT committed batch — visually marks where
 *  a conversation likely pivoted (someone finished speaking, another
 *  voice took over). Calibrated SHORTER than SILENCE_RESET_SECONDS so
 *  most natural conversational pauses produce paragraph breaks BEFORE
 *  the buffer-reset guard fires. */
const TURN_GAP_SECONDS = 1.5;
// HALLUCINATION_MAX_REPEAT = 4 — kept in sync with DEFAULT_REPEAT_THRESHOLD in
// lib/hallucination.ts (single source of truth lives there now). Bump both if
// the threshold needs tuning. Constant kept as a documentation reference only.
const INLINE_PREF_KEY = "livecaptionit:inline-pref";
const PIP_PREFS_KEY = "livecaptionit:pip-prefs";
const MODEL_PREF_KEY = "livecaptionit:model-pref";
const CAPTION_STYLE_KEY = "livecaptionit:caption-style";
const SOURCE_PREF_KEY = "livecaptionit:source-pref";
// v0.5 commit 6: .vtt/.srt cue granularity preference.
// Values: "segment" | "sentence" | "word". Default "sentence" for v2
// transcripts (best for actual subtitling). v1 transcripts silently
// fall back to "segment" since they have no per-word data.
const EXPORT_GRANULARITY_KEY = "livecaptionit:export-granularity";
// v0.5 commit 7: show confidence-tint on live tail words.
// Boolean. Default OFF — opt-in because (a) some users find the
// tinting distracting, (b) it's a power-user signal that explains
// why text sometimes mutates mid-tail. When ON, words in the live
// tail get a `data-confidence="low|med|high"` attribute that CSS
// maps to opacity/desaturation. Committed words are always full-strength.
const SHOW_CONFIDENCE_KEY = "livecaptionit:show-confidence";

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

/** v0.5 commit 6 — export-granularity prefs (segment / sentence / word). */
function loadExportGranularity(): ExportGranularity {
  try {
    const raw = localStorage.getItem(EXPORT_GRANULARITY_KEY);
    if (raw === "segment" || raw === "sentence" || raw === "word") return raw;
  } catch {}
  // Default "sentence" — best for actual subtitling. v1 transcripts
  // silently fall back to "segment" inside cuesForGranularity().
  return "sentence";
}
function saveExportGranularity(v: ExportGranularity) {
  try { localStorage.setItem(EXPORT_GRANULARITY_KEY, v); } catch {}
}

/** v0.5 commit 7 — confidence-tint pref (boolean, default OFF).
 *  Stored as the string "1" for true / absent for false to avoid the
 *  "true" vs "True" vs JSON-parse-roundtrip churn of boolean storage. */
function loadShowConfidence(): boolean {
  try {
    return localStorage.getItem(SHOW_CONFIDENCE_KEY) === "1";
  } catch {
    return false;
  }
}
function saveShowConfidence(v: boolean) {
  try {
    if (v) localStorage.setItem(SHOW_CONFIDENCE_KEY, "1");
    else localStorage.removeItem(SHOW_CONFIDENCE_KEY);
  } catch {}
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
  /** v0.4.3: caption color preset. Independent of the page's light/dark theme. */
  theme: CaptionTheme;
}

/**
 * Caption color themes (v0.4.3). Each theme defines a backdrop + text
 * colour pair applied via CSS custom properties on the caption box.
 *  - default    → transparent in PiP, neutral surface inline (legacy)
 *  - sepia      → warm cream backdrop, dark brown text
 *  - hi-contrast → pure black backdrop, pure white text
 *  - terminal   → deep navy backdrop, cyan text
 */
export type CaptionTheme = "default" | "sepia" | "hi-contrast" | "terminal";
const CAPTION_THEMES: ReadonlyArray<CaptionTheme> = [
  "default",
  "sepia",
  "hi-contrast",
  "terminal",
];

const CAPTION_STYLE_DEFAULTS: CaptionStyle = {
  fontScale: 1,
  fontWeight: 400,
  position: "top",
  textShadow: true,
  theme: "default",
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
    const theme: CaptionTheme =
      CAPTION_THEMES.includes(parsed.theme as CaptionTheme)
        ? (parsed.theme as CaptionTheme)
        : "default";
    return {
      fontScale: clamp(Number(parsed.fontScale) || CAPTION_STYLE_DEFAULTS.fontScale, 0.8, 2.0),
      fontWeight,
      position,
      textShadow: parsed.textShadow !== false, // default true
      theme,
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

function loadModelPref(isMobile = false): ModelSpec["id"] {
  try {
    const raw = localStorage.getItem(MODEL_PREF_KEY);
    if (raw === "tiny" || raw === "base" || raw === "small" || raw === "large-turbo") return raw;
  } catch {}
  // v0.5.1 — mobile gets `tiny` (39 MB) by default to fit inside the
  // mobile JS heap budget. Desktop keeps the v0.4.0 default (`base`,
  // 74 MB). User can still override via the model picker; we only
  // pick the default when no pref is stored.
  return isMobile ? MOBILE_DEFAULT_MODEL_ID : DEFAULT_MODEL_ID;
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
  // v0.4.3: install global error handlers + expose __lcDebugErrors().
  // Safe to call before DOM ready.
  initErrorMonitor();

  // v0.4.3: PWA install prompt orchestrator. Safe before DOM ready
  // (registers `beforeinstallprompt` / `appinstalled` listeners, no DOM reads).
  initPwaInstall();

  // v0.4.3: First-run onboarding tour. Auto-starts only if never seen.
  // Exposes window.__lcResetTour() for debugging.
  initOnboardingTour();

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
  // v0.5 commit 7: confidence-tint checkbox. Default unchecked; flips
  // `showConfidence` + persists pref. Live-applies on next tick.
  const styleConfidence = rootEl.querySelector<HTMLInputElement>("#cp-style-confidence")!;
  const styleTheme = rootEl.querySelector<HTMLSelectElement>("#cp-style-theme")!;
  const styleResetBtn = rootEl.querySelector<HTMLButtonElement>("#cp-style-reset")!;
  const downloadBar = rootEl.querySelector<HTMLDivElement>("#cp-download-bar")!;
  const dlTxtBtn = rootEl.querySelector<HTMLButtonElement>("#cp-dl-txt")!;
  // Shortcuts dialog lives at the section root, not inside .cp-active panel.
  const shortcutsHelpDialog = rootEl.querySelector<HTMLDialogElement>("#cp-shortcuts-help")!;
  // v0.4.3 — replay-tour button inside the shortcuts dialog
  const replayTourBtn = rootEl.querySelector<HTMLButtonElement>("#cp-replay-tour-btn");
  replayTourBtn?.addEventListener("click", () => {
    shortcutsHelpDialog.close();
    // Delay slightly so the modal close animation finishes before the tour opens.
    setTimeout(() => startTour({ force: true }), 200);
  });
  // v0.4.0 — session history UI refs
  const historyPanel = rootEl.querySelector<HTMLDivElement>("#cp-history-panel")!;
  const historyList = rootEl.querySelector<HTMLUListElement>("#cp-history-list")!;
  const historyClearBtn = rootEl.querySelector<HTMLButtonElement>("#cp-history-clear")!;
  // v0.4.2 — session search UI refs
  const historySearchWrap = rootEl.querySelector<HTMLDivElement>("#cp-history-search-wrap")!;
  const historySearchInput = rootEl.querySelector<HTMLInputElement>("#cp-history-search")!;
  const historyEmpty = rootEl.querySelector<HTMLParagraphElement>("#cp-history-empty")!;
  // v0.4.2 — export/import UI refs
  const historyExportBtn = rootEl.querySelector<HTMLButtonElement>("#cp-history-export")!;
  const historyImportBtn = rootEl.querySelector<HTMLButtonElement>("#cp-history-import")!;
  const historyImportFile = rootEl.querySelector<HTMLInputElement>("#cp-history-import-file")!;
  const historyEmptyZero = rootEl.querySelector<HTMLParagraphElement>("#cp-history-empty-zero")!;
  const sessionViewDialog = rootEl.querySelector<HTMLDialogElement>("#cp-session-view")!;
  const sessionViewMeta = rootEl.querySelector<HTMLSpanElement>("#cp-session-view-meta")!;
  const sessionViewBody = rootEl.querySelector<HTMLDivElement>("#cp-session-view-body")!;
  const sessionViewDlTxt = rootEl.querySelector<HTMLButtonElement>("#cp-session-view-dl-txt")!;
  const sessionViewDlVtt = rootEl.querySelector<HTMLButtonElement>("#cp-session-view-dl-vtt")!;
  const sessionViewDlSrt = rootEl.querySelector<HTMLButtonElement>("#cp-session-view-dl-srt")!;
  const sessionViewDelete = rootEl.querySelector<HTMLButtonElement>("#cp-session-view-delete")!;
  // v0.5 commit 8 — transcript editor refs. The dialog gets two action
  // rows (read-only with .txt/.vtt/.srt/Edit/Delete vs edit-mode with
  // Save/Cancel). Edit button is hidden by default + only shown for v2
  // sessions (per-word timing available). Save persists back to IDB;
  // Cancel re-renders from the pre-edit snapshot.
  const sessionViewActions = rootEl.querySelector<HTMLDivElement>("#cp-session-view-actions")!;
  const sessionViewEditActions = rootEl.querySelector<HTMLDivElement>("#cp-session-view-edit-actions")!;
  const sessionViewEditBtn = rootEl.querySelector<HTMLButtonElement>("#cp-session-view-edit")!;
  const sessionViewSaveBtn = rootEl.querySelector<HTMLButtonElement>("#cp-session-view-save")!;
  const sessionViewCancelBtn = rootEl.querySelector<HTMLButtonElement>("#cp-session-view-cancel")!;
  const sessionViewCloseBtn = rootEl.querySelector<HTMLButtonElement>("#cp-session-view-close")!;
  const dlVttBtn = rootEl.querySelector<HTMLButtonElement>("#cp-dl-vtt")!;
  const dlSrtBtn = rootEl.querySelector<HTMLButtonElement>("#cp-dl-srt")!;
  const dlShareBtn = rootEl.querySelector<HTMLButtonElement>("#cp-dl-share")!;
  const dlClearBtn = rootEl.querySelector<HTMLButtonElement>("#cp-dl-clear")!;
  // v0.5 commit 6 — .vtt/.srt cue granularity radio. Lives inside the
  // download bar; visibility tracks the bar itself. Stored pref drives
  // the initial checked state at script init; user changes persist back.
  const granularityWrap = rootEl.querySelector<HTMLDivElement>("#cp-export-granularity-wrap")!;
  const granularityRadios = rootEl.querySelectorAll<HTMLInputElement>('input[name="cp-export-granularity"]');
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
  // v0.4.8 — agreement now operates on Word[] from the worker's chunks
  // payload (was: string[] from text). Live caption UX is byte-equivalent
  // — we just convert Words back to bare text strings at the rendering
  // call sites for now. v0.5 commit 6 onwards reads Word.tStartMs +
  // confidence directly. See docs/roadmap/v0.5-word-timestamps.md.
  const agreement = new WordAgreement();
  let tickTimer: number | null = null;
  let inFlight = false;
  // v0.5.2 debug — count inferences so we can identify "crash on first
  // inference" vs "crash on 5th inference" (different root causes).
  let inferenceCount = 0;
  let nextTickMs = TICK_INTERVAL_MS;
  /** v0.4.1: paused state for Space pause/resume. When true the tick
   *  scheduler still re-arms but skips Whisper calls, and the active
   *  panel switches to the "paused" substate so the header reflects it. */
  let isPaused = false;
  // Silence tracking — RMS samples come from the capture's onLevel callback.
  // We keep a sliding window of recent RMS values to know "how long has it
  // been quiet?" so we can prevent Whisper from hallucinating on silent audio.
  let lastNonSilentMs = 0;
  /** v0.4.3: when audio crosses the TURN_GAP_SECONDS threshold of silence,
   *  the NEXT appendCommittedWords() call starts a fresh paragraph.
   *  Reset to false the moment we honour it (one-shot). */
  let pendingTurnBreak = false;
  // Transcript recording — every committed batch gets pushed here with its
  // timestamp relative to sessionStartMs. Cleared on Start/Reset, used by
  // the download buttons that appear in the active panel after Stop.
  let transcriptSegments: TranscriptSegment2[] = [];
  let sessionStartMs = 0;
  /** v0.4.0: source-of-truth for THIS session's source — "tab" | "mic" | "sample".
   *  Different from currentSource (which is the user's persistent preference)
   *  because the sample button can override mid-flight. Recorded into IndexedDB. */
  let currentSessionSource: SessionSource = "tab";

  // ── Initial support detection ──
  const support = detectSupport();
  const isMobile = isMobileDevice();
  // Mobile WebGPU is technically present (iOS Safari 18.2+, Chrome Android
  // 121+) but unreliable: adapter probe can hang ~120s, GPU buffers fight
  // the page heap, drivers crash. We force WASM on mobile by default. The
  // build-time PUBLIC_ALLOW_MOBILE_WEBGPU flag opts a deploy into the
  // WebGPU path for testing — see docs/BUILD_FLAGS.md.
  const forceWasmOnMobile = isMobile && !featureFlags.allowMobileWebGPU;
  // v0.5.2 — diagnostic panel. Active only when ?debug=1 is in the URL.
  // Logs each lifecycle checkpoint so we can see EXACTLY where mobile
  // sessions fail without needing remote DevTools / desktop USB tooling.
  // Zero perf cost when the URL flag isn't present (factory returns a stub).
  const debug = getDebugPanel();
  if (debug.enabled) {
    debug.log("UA", navigator.userAgent);
    debug.log("isMobile", isMobile);
    debug.log("flag PUBLIC_ALLOW_MOBILE_WEBGPU", featureFlags.allowMobileWebGPU);
    debug.log("→ forceWasmOnMobile", forceWasmOnMobile);
    debug.log("viewport", `${window.innerWidth}x${window.innerHeight}`);
    debug.log("devicePixelRatio", window.devicePixelRatio);
    debug.log("support", {
      webgpu: support.webgpu,
      displayMediaAudio: support.displayMediaAudio,
      documentPip: support.documentPip,
      audioContext: support.audioContext,
      sharedArrayBuffer: support.sharedArrayBuffer,
    });
    try {
      debug.log(
        "stored model pref",
        localStorage.getItem(MODEL_PREF_KEY) ?? "(none)",
      );
    } catch {
      debug.log("stored model pref", "(localStorage blocked)");
    }
    // performance.memory only exists on Chromium-based browsers; not Safari.
    // Useful for diagnosing Chrome Android specifically.
    interface PerformanceWithMemory {
      memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
    }
    const mem = (performance as unknown as PerformanceWithMemory).memory;
    if (mem) {
      debug.log("JS heap", {
        usedMB: Math.round(mem.usedJSHeapSize / 1024 / 1024),
        limitMB: Math.round(mem.jsHeapSizeLimit / 1024 / 1024),
      });
    } else {
      debug.log("JS heap", "(unavailable on this browser)");
    }
  }
  // Mark the document root for CSS-driven mobile tweaks (bigger tap targets,
  // hiding PiP-irrelevant UI). One class — global.css owns the visual rules.
  if (isMobile) {
    document.documentElement.classList.add("is-mobile");
  }
  // Hoist currentSource before support check so we can force-set it to "mic"
  // when display capture isn't available. Restored to saved pref below if
  // support is fine.
  let currentSource: SourceKind = loadSourcePref();
  // v0.5 commit 6 — current cue granularity for .vtt/.srt exports.
  // Loaded from localStorage at startup; updated via the radio control
  // in the download bar; written back to localStorage on change.
  let currentGranularity: ExportGranularity = loadExportGranularity();
  // v0.5 commit 7 — confidence-tint state for live-tail rendering.
  // `showConfidence` mirrors the pref toggle; `stabilityTracker` keeps
  // per-tick streak history so the same word at the same position
  // graduates from low → med → high across consecutive hypotheses.
  // Tracker is reset at every session boundary (start / clear / silence).
  let showConfidence: boolean = loadShowConfidence();
  const stabilityTracker = new StabilityTracker();
  if (!support.displayMediaAudio) {
    // No tab-audio capture, but mic mode still works via getUserMedia.
    // Force mic source + show explainer instead of disabling Start entirely.
    // On mobile we use a SOFTER message because tab/screen capture isn't a
    // browser bug — it's a platform limitation; users shouldn't feel like
    // their device is broken. v0.5.1 also tells mobile users WHY we use
    // Tiny + WASM defaults so they understand the trade-off (smaller
    // model + slower CPU runtime, but no OOM crashes mid-capture).
    supportWarn.textContent = isMobile
      ? "On mobile, captioning uses your microphone — point it at any audio source (speaker, headphones, another device). We use the Tiny model + CPU-mode by default for memory safety; switch to Base/Small in the model picker if your device has plenty of RAM."
      : "Your browser doesn't support tab/screen audio capture. Microphone-only mode is still available — pick 'Microphone' above.";
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

  // v0.4.3 — Resizable PiP: capture the user's manual resizes and write
  // them back to pipPrefs so the size persists across sessions. Browsers
  // don't expose a PiP "moved/resized" event to the opener, so we sample
  // the actual outerWidth/outerHeight at close time PLUS install a
  // debounced resize listener on the PiP window itself for cases where
  // the opener tab is closed first (we still get one final sample then).
  let pipResizeSaveTimer: ReturnType<typeof setTimeout> | null = null;
  function persistPipDimensionsFromHandle(handle: PipHandle | null): void {
    if (!handle?.pipWindow) return;
    try {
      const w = handle.pipWindow.outerWidth || handle.pipWindow.innerWidth || 0;
      const h = handle.pipWindow.outerHeight || handle.pipWindow.innerHeight || 0;
      if (w < 100 || h < 80) return; // ignore unreasonable readings
      const screenW = window.screen?.width || 1920;
      const screenH = window.screen?.height || 1080;
      const widthPct = clamp(Math.round((w / screenW) * 100), 15, 100);
      const heightPct = clamp(Math.round((h / screenH) * 100), 10, 80);
      // Only persist if it actually changed (avoid pointless localStorage
      // writes on close-without-resize).
      if (widthPct === pipPrefs.widthPct && heightPct === pipPrefs.heightPct) return;
      pipPrefs = { widthPct, heightPct };
      savePipPrefs(pipPrefs);
      renderPrefsUI();
    } catch {
      /* ignore — pipWindow may already be closing */
    }
  }
  function wirePipResizeAutosave(handle: PipHandle | null): void {
    if (!handle?.pipWindow) return;
    const onResize = () => {
      if (pipResizeSaveTimer) clearTimeout(pipResizeSaveTimer);
      pipResizeSaveTimer = setTimeout(() => {
        persistPipDimensionsFromHandle(handle);
      }, 400);
    };
    try {
      handle.pipWindow.addEventListener("resize", onResize);
    } catch {
      /* ignore — pipWindow may be cross-origin-restricted (shouldn't be, but safe) */
    }
  }

  // ── Model picker: render the radio list with size + cache indicators ──
  //   Cache check is async → render once synchronously (no checks), then
  //   re-render after the cache probes resolve so the indicators light up.
  let selectedModelId: ModelSpec["id"] = loadModelPref(isMobile);
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
        if (!radio.checked) return;
        // v0.4.3 — confirm the heavy download before committing to large tier.
        // Only prompt if NOT already cached (in which case selecting it is free).
        if (m.large && !isCached) {
          const ok = window.confirm(
            `Switch to ${m.label}?\n\nFirst-time download: ${m.sizeMb} MB. ` +
            `Cached in your browser after that — subsequent sessions are instant.\n\n` +
            `Recommended only if Base/Small aren't accurate enough on your audio.`,
          );
          if (!ok) {
            // Revert the radio state — keep the previous selection highlighted.
            renderModelList();
            return;
          }
        }
        selectedModelId = m.id;
        saveModelPref(m.id);
        renderModelList(); // refresh selected highlight
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

  // v0.4.3 — Custom vocabulary panel wiring.
  // Persists to localStorage on input (debounced). Worker is told the
  // sanitized version every save AND at the top of every startPipeline().
  // The textarea displays the raw string the user typed; sanitization
  // happens only on save / on send-to-worker so the user's cursor +
  // typing flow aren't disrupted mid-edit.
  const vocabInput = rootEl.querySelector<HTMLTextAreaElement>("#cp-vocab-input");
  const vocabChars = rootEl.querySelector<HTMLSpanElement>("#cp-vocab-chars");
  const vocabCount = rootEl.querySelector<HTMLSpanElement>("#cp-vocab-count");
  const vocabClearBtn = rootEl.querySelector<HTMLButtonElement>("#cp-vocab-clear");

  function renderVocabCounter(text: string): void {
    const n = countVocabTerms(text);
    if (vocabChars) {
      vocabChars.textContent = `${text.length} / ${VOCABULARY_MAX_CHARS} characters`;
    }
    if (vocabCount) {
      vocabCount.textContent = n > 0 ? `(${n})` : "";
    }
  }

  let vocabSaveTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleVocabSave(): void {
    if (vocabSaveTimer) clearTimeout(vocabSaveTimer);
    vocabSaveTimer = setTimeout(() => {
      const text = vocabInput?.value ?? "";
      const cleaned = saveVocabulary(text);
      // Push to worker if one exists. Safe to call even if worker is
      // mid-init — worker just stores the string, doesn't act on it.
      whisper?.setVocabulary(cleaned);
    }, 300);
  }

  if (vocabInput) {
    vocabInput.value = loadVocabulary();
    renderVocabCounter(vocabInput.value);
    vocabInput.addEventListener("input", () => {
      renderVocabCounter(vocabInput.value);
      scheduleVocabSave();
    });
  }
  vocabClearBtn?.addEventListener("click", () => {
    if (vocabInput) {
      vocabInput.value = "";
      renderVocabCounter("");
    }
    saveVocabulary("");
    whisper?.setVocabulary("");
    toast.success("Vocabulary cleared");
  });

  // ── Caption language (v0.6.0): auto-detect default, user can pin ──
  //   The onnx-community/whisper-* models are multilingual; we simply pass a
  //   `language` decode param (or omit it for auto). Applies immediately —
  //   pinning mid-session flushes the rolling buffer + agreement so we don't
  //   blend two-language partial state into one line.
  const languageSelect = rootEl.querySelector<HTMLSelectElement>("#cp-language-select");
  const languageCurrent = rootEl.querySelector<HTMLSpanElement>("#cp-language-current");

  function renderLanguageSummary(code: string): void {
    if (languageCurrent) {
      const spec = languageByCode(code);
      languageCurrent.textContent = code === "auto" ? "" : `(${spec.label})`;
    }
  }

  if (languageSelect) {
    // Populate options from the catalog.
    languageSelect.innerHTML = "";
    for (const l of LANGUAGES) {
      const opt = document.createElement("option");
      opt.value = l.code;
      opt.textContent = l.label;
      languageSelect.appendChild(opt);
    }
    const savedLang = loadLanguage();
    languageSelect.value = savedLang;
    renderLanguageSummary(savedLang);

    languageSelect.addEventListener("change", () => {
      const code = saveLanguage(languageSelect.value);
      // Coercion may have reset an unknown value to auto — reflect it.
      if (languageSelect.value !== code) languageSelect.value = code;
      renderLanguageSummary(code);
      const param = whisperParamFor(code);
      whisper?.setLanguage(param);
      // Mid-session: flush so the next window decodes cleanly in the new
      // language instead of blending the tail of the previous language.
      if (whisperReady && rolling.length() > 0) {
        flushLiveTailToCommitted();
        rolling.reset();
        agreement.reset();
        stabilityTracker.reset();
        renderLiveLine("");
      }
      toast.success(
        code === "auto"
          ? "Language: Auto-detect"
          : `Language pinned: ${languageByCode(code).label}`,
      );
    });
  }

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
    // v0.4.3: theme — swap the data attribute so CSS selectors target
    // the right preset. Themes are defined in global.css under the
    // `[data-caption-theme="..."]` blocks so they cascade into PiP too
    // (pipClient.ts copies the global stylesheet on open).
    captionBox.dataset.captionTheme = s.theme;
  }
  function renderStyleUI() {
    styleFontScale.value = String(Math.round(captionStyle.fontScale * 100));
    styleFontScaleVal.textContent = `${Math.round(captionStyle.fontScale * 100)}%`;
    styleShadow.checked = captionStyle.textShadow;
    styleTheme.value = captionStyle.theme;
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
  // v0.5 commit 7 — confidence-tint init + live persist.
  styleConfidence.checked = showConfidence;
  styleConfidence.addEventListener("change", () => {
    showConfidence = styleConfidence.checked;
    saveShowConfidence(showConfidence);
    // Re-render the current live line with the new mode so the toggle
    // takes immediate visual effect (instead of waiting for the next
    // tick to roll in). Pass the same items/text that's currently in
    // play. If nothing's currently in the live tail, this is a no-op.
    renderLiveLine(agreement.liveLine, agreement.liveItems);
  });
  // v0.4.3: theme picker
  styleTheme.addEventListener("change", () => {
    const v = styleTheme.value as CaptionTheme;
    if (CAPTION_THEMES.includes(v)) {
      captionStyle.theme = v;
      applyCaptionStyle(captionStyle);
      saveCaptionStyle(captionStyle);
    }
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

  // v0.5 commit 6 — export-granularity radio: restore saved pref + persist
  // on change. Visibility of the whole wrap is controlled separately by
  // setGranularityVisibility() which runs alongside showDownloadBar() so
  // the radio only appears when the user actually has a transcript to
  // export AND that transcript carries per-word timing (v2 segments).
  granularityRadios.forEach((r) => {
    r.checked = (r.value as ExportGranularity) === currentGranularity;
    r.addEventListener("change", () => {
      if (!r.checked) return;
      const v = r.value as ExportGranularity;
      currentGranularity = v;
      saveExportGranularity(v);
    });
  });

  /** v0.5 commit 6 — show the granularity radio iff (a) the download
   *  bar is showing, (b) we have at least one segment, and (c) every
   *  segment in the active transcript is v2 (has per-word timing).
   *  For mixed or pure-v1 transcripts the radio is hidden because
   *  sentence/word modes would silently fall back to segment anyway. */
  function setGranularityVisibility(segments: AnyTranscriptSegment[]): void {
    const hasV2 = segments.length > 0 && segments.every(isV2Segment);
    if (hasV2) {
      granularityWrap.classList.remove("hidden");
    } else {
      granularityWrap.classList.add("hidden");
    }
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

  /** v0.4.3: shared onLevel handler — updates lastNonSilentMs and sets
   *  pendingTurnBreak when crossing the silence → speech transition
   *  AFTER >= TURN_GAP_SECONDS of silence. Used by both startCapture
   *  (tab/display) and startMicCapture wirings. */
  function handleLevel(rms: number) {
    if (rms > SILENCE_RMS_THRESHOLD) {
      const now = performance.now();
      const silentMs = now - lastNonSilentMs;
      // Only set the flag if (a) we already have committed words (no
      // point breaking before anything was said) and (b) silence
      // exceeded TURN_GAP_SECONDS but stayed under SILENCE_RESET_SECONDS
      // (the buffer-reset already handles the longer-silence case by
      // flushing the live tail).
      if (
        captionCount > 0 &&
        silentMs > TURN_GAP_SECONDS * 1000 &&
        silentMs < SILENCE_RESET_SECONDS * 1000
      ) {
        pendingTurnBreak = true;
      }
      lastNonSilentMs = now;
    }
  }

  /** Active-panel substate: "live" while captioning, "paused" while
   *  user has hit Space (v0.4.1), "stopped" after Stop when transcript
   *  has content (so user can still see history + download).
   *  Elements with `data-when="..."` toggle visibility via the `.hidden`
   *  class. v0.4.1 extends this so `data-when` may contain MULTIPLE
   *  space-separated substates — e.g. `data-when="live paused"` for
   *  controls that should be visible in both running and paused
   *  capture (Stop button, Pop out, source label).
   *
   *  IMPORTANT: query from `document`, NOT `rootEl`. The caption-box header
   *  (which contains most of the `data-when` elements) gets physically moved
   *  into the Document PiP window via appendChild while PiP is open, so it's
   *  no longer a descendant of rootEl during a live session. Querying rootEl
   *  would silently match zero elements and leave the previous stopped/live
   *  indicators stuck on whatever they were before PiP opened. This caused
   *  the v0.3.1 regression where "Start new → Start" left the STOPPED label
   *  showing inside PiP. */
  type Substate = "live" | "paused" | "stopped";
  let currentSubstate: Substate = "live";
  function setSubstate(s: Substate) {
    currentSubstate = s;
    rootEl.dataset.substate = s;
    document.querySelectorAll<HTMLElement>("[data-when]").forEach((el) => {
      const allowed = (el.dataset.when || "").split(/\s+/).filter(Boolean);
      el.classList.toggle("hidden", !allowed.includes(s));
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
   *
   * v0.5: takes Word[] (was string[]) so per-word timing is preserved
   * into transcriptSegments. Display still uses Word.text.trim() so the
   * rendered captions are byte-identical to v0.4.x. The v2 segment
   * shape (`{ words: Word[], tMs }`) flows through into sessionStore +
   * shareLink + .vtt/.srt exports.
   */
  function appendCommittedWords(words: Word[]) {
    if (words.length === 0) return;
    // Record into transcript log first (the source of truth for downloads).
    // v0.5: persist Word[] (not bare strings) so per-word timing is
    // available downstream. Defensive copy because agreement may reuse
    // its internal array across ticks.
    transcriptSegments.push({
      words: words.map((w) => ({ ...w })),
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

    // v0.4.3: gap-based turn detection — if the silence-to-speech
    // transition flagged a turn break, force a fresh <p> so the new
    // committed batch lands in a NEW paragraph instead of appending
    // to the previous one. One-shot: cleared the moment we honour it.
    if (pendingTurnBreak && lastP && committedWordsIn(lastP) > 0) {
      lastP = null; // signal the loop below to allocate a fresh <p>
    }
    pendingTurnBreak = false;

    for (const word of words) {
      const displayText = word.text.trim();
      if (!displayText) continue;
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
      strong.textContent = (committedWordsIn(lastP) > 0 ? " " : "") + displayText;
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
   *
   * v0.5 commit 7: optional `items` arg powers per-word confidence
   * tinting when `showConfidence` is true. Each word becomes its own
   * `<span class="live-tail-word" data-confidence="low|med|high">`,
   * with CSS varying opacity/colour by bucket. Empty items → falls
   * back to the simple-text path (no per-word spans). Passing items
   * without `showConfidence` enabled also takes the simple path —
   * the per-word spans are slightly heavier (3× more DOM nodes) so
   * we don't pay the cost when the user opted out.
   */
  function renderLiveLine(text: string, items: Word[] = []) {
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
    const tail = document.createElement("span");
    tail.className = "live-tail font-normal";

    // v0.5 commit 7 — confidence-tint branch. We only render per-word
    // spans when (a) the user opted in AND (b) we have items to bucket.
    // The simple-text path remains the v0.4.x behaviour byte-for-byte.
    const wantConfidence = showConfidence && items.length > 0;
    if (wantConfidence) {
      const keys = items.map((w) => w.text.toLowerCase().trim());
      const buckets = stabilityTracker.update(keys);
      const leadingSpace = committedWordsIn(lastP) > 0 ? " " : "";
      // Build textually-spaced word spans. The container span carries
      // the v0.4.x .text-[var(--color-fg-subtle)] muted class as a
      // baseline; per-word data-confidence layers an opacity multiplier
      // on top so committed words still look fully bright after commit.
      tail.classList.add("text-[var(--color-fg-subtle)]");
      if (leadingSpace) tail.appendChild(document.createTextNode(leadingSpace));
      for (let i = 0; i < items.length; i++) {
        if (i > 0) tail.appendChild(document.createTextNode(" "));
        const wordSpan = document.createElement("span");
        wordSpan.className = "live-tail-word";
        wordSpan.dataset.confidence = buckets[i];
        wordSpan.textContent = items[i].text.trim();
        tail.appendChild(wordSpan);
      }
    } else {
      // Legacy text-only path — preserves v0.4.x rendering exactly.
      tail.classList.add("text-[var(--color-fg-subtle)]");
      tail.textContent = (committedWordsIn(lastP) > 0 ? " " : "") + text;
    }

    lastP.appendChild(tail);
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
   *  This is the user-visibility-preserving counterpart to agreement.reset().
   *
   *  v0.5: synthesizes Word[] with zero per-word timing from the live tail
   *  text since the live tail doesn't have committed per-word timing yet.
   *  The segment-level tMs anchor is what matters for export — synthetic
   *  per-word timing within a flush-segment is downstream-friendly. */
  function flushLiveTailToCommitted() {
    const liveText = agreement.liveLine;
    if (!liveText) return;
    if (looksHallucinated(liveText)) return;
    const liveTokens = liveText.trim().split(/\s+/).filter(Boolean);
    if (liveTokens.length === 0) return;
    const liveWords: Word[] = liveTokens.map((text) => ({
      text,
      tStartMs: 0,
      tEndMs: 0,
    }));
    appendCommittedWords(liveWords);
  }

  async function tick() {
    if (!whisper || !whisperReady || inFlight) {
      scheduleNextTick();
      return;
    }
    // v0.4.1: paused state — skip Whisper call so no new committed text
    // appears and no GPU/CPU is burned re-transcribing the frozen buffer.
    // Still re-arm so the scheduler picks up immediately on resume.
    if (isPaused) {
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
        stabilityTracker.reset();
        renderLiveLine("");
      }
      scheduleNextTick();
      return;
    }

    inFlight = true;
    try {
      const audio = rolling.snapshot();
      const audioWasOverCap = rolling.isOverCap();
      inferenceCount++;
      const isFirstInference = inferenceCount === 1;
      if (debug.enabled && isFirstInference) {
        // First inference is the highest-memory-pressure moment of the
        // session — encoder forward pass allocates ~3-5x the model weights
        // in transient WASM heap. If iOS OOM-kills, it kills here. Log
        // audio length + heap so we can correlate with crash reports.
        interface PerformanceWithMemory {
          memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
        }
        const mem = (performance as unknown as PerformanceWithMemory).memory;
        debug.log("first inference start", {
          audioSec: Math.round(rolling.durationSeconds() * 10) / 10,
          samples: audio.length,
          heapMB: mem ? Math.round(mem.usedJSHeapSize / 1024 / 1024) : "n/a",
        });
      }
      // v0.4.8 — switched from transcribeWindow() (text only) to
      // transcribeWindow2() which exposes per-word chunks: Word[].
      // We pass chunks to agreement (WordAgreement) instead of the
      // tokenized text string. The agreement key is text.toLowerCase()
      // .trim() so prefix-match behaviour is unchanged from v0.4.7.
      // text is kept around for hallucination detection (looksHallucinated
      // works on strings) and as a fallback when chunks is empty.
      const { text, chunks, durationMs } = await whisper.transcribeWindow2(audio);
      if (debug.enabled && isFirstInference) {
        interface PerformanceWithMemory {
          memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
        }
        const mem = (performance as unknown as PerformanceWithMemory).memory;
        debug.log("first inference done", {
          durationMs,
          textLen: text?.length ?? 0,
          chunks: chunks?.length ?? 0,
          heapMB: mem ? Math.round(mem.usedJSHeapSize / 1024 / 1024) : "n/a",
        });
      }

      // Adapt tick interval — never tick faster than 1.2× last inference,
      // never slower than MAX_TICK_MS. Keeps slow WebGPU/WASM devices
      // from queueing ticks the worker can't drain.
      nextTickMs = Math.min(
        MAX_TICK_MS,
        Math.max(TICK_INTERVAL_MS, Math.ceil(durationMs * 1.2)),
      );

      // Drop obvious hallucinations (repeated-word runs).
      if (text && !looksHallucinated(text)) {
        // If chunks came back empty (older transformers.js, silent audio,
        // or extractWordChunks defensive bailout), synthesize a minimal
        // Word[] from text so the agreement loop stays operational. This
        // is the v0.4.8 safety hatch — without it, an upstream regression
        // in word-timestamps would silently stop captions entirely.
        const items = chunks.length > 0
          ? chunks
          : text.trim().split(/\s+/).filter(Boolean).map((w) => ({
              text: w,
              tStartMs: 0,
              tEndMs: 0,
            }));
        agreement.ingest(items);
        if (agreement.newlyCommitted.length > 0) {
          // v0.5 — pass Word[] straight through (was string[] mapping
          // in v0.4.8). The Word objects carry per-word timing into
          // transcriptSegments + sessionStore + share URLs.
          appendCommittedWords(agreement.newlyCommitted);
        }
        renderLiveLine(agreement.liveLine, agreement.liveItems);
      }

      // Force-commit guard: if buffer has grown past the soft cap and we
      // STILL haven't committed enough words to drain it via agreement,
      // promote the entire live hypothesis to committed and trim the
      // buffer (keeping the last ~2s so the next tick has audio context
      // and we don't get a perceptible gap before captions resume).
      if (audioWasOverCap) {
        flushLiveTailToCommitted();
        agreement.reset();
        stabilityTracker.reset();
        // Trim everything EXCEPT the trailing FORCE_COMMIT_KEEP_SECONDS so
        // the next tick has context to transcribe instead of silence-starting.
        const keepSamples = FORCE_COMMIT_KEEP_SECONDS * TARGET_SAMPLE_RATE;
        const trimAmount = Math.max(0, rolling.length() - keepSamples);
        if (trimAmount > 0) rolling.trimFront(trimAmount);
        renderLiveLine("");
      }
    } catch (e) {
      recordError(e, "whisper", { ctx: { phase: "tick" } });
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
    inferenceCount = 0;
    rolling.reset();
    agreement.reset();
    stabilityTracker.reset();
    nextTickMs = TICK_INTERVAL_MS;
    isPaused = false; // v0.4.1: fresh session always starts running
    pendingTurnBreak = false; // v0.4.3: turn detection starts disarmed
    // New session — fresh transcript log.
    transcriptSegments = [];
    sessionStartMs = performance.now();
    currentSessionSource = currentSource === "mic" ? "mic" : "tab";
    downloadBar.classList.add("hidden");
    setGranularityVisibility(transcriptSegments);
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
            // v0.4.3 — capture final dimensions BEFORE pipHandle nulls,
            // so a user who manually resized the PiP keeps their size on
            // next open. Browsers don't fire 'resize' on PiP windows for
            // the opener — so we sample at close time as the next best
            // signal.
            persistPipDimensionsFromHandle(pipHandle);
            pipHandle = null;
            setPipMode(false);
          },
        });
        // v0.4.3 — also wire a 'resize' listener on the PiP window itself
        // so we capture intermediate sizes (e.g. if the user resizes,
        // closes the parent tab, we still get the final size). Debounced
        // so we're not hammering localStorage on every drag pixel.
        wirePipResizeAutosave(pipHandle);
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
        recordError(e, "pip", { ctx: { fallback: "inline" } });
        pipHandle = null;
      }
    }

    // ── Step 2: kick off worker init in the background (no await yet) ──
    // We want it loading WHILE the user is in the tab picker, not after.
    // v0.5.4: do NOT pass an explicit URL here — the default argument
    // in createWhisperClient() embeds the `?v=${WORKER_VERSION}` query
    // string that busts the CDN cache. Passing a bare URL bypasses
    // that bust and forces returning users onto stale workers.
    whisper = createWhisperClient();
    // v0.4.3 — push current vocabulary BEFORE init resolves so the first
    // transcribe call already has it. setVocabulary is safe pre-init (worker
    // just stores the string until transcribe needs it).
    whisper.setVocabulary(loadVocabulary());
    // v0.6.0 — push current language (auto by default) BEFORE init resolves so
    // the first transcribe call already decodes in the right language.
    whisper.setLanguage(whisperParamFor(loadLanguage()));
    whisper.onStatus((s) => {
      switch (s.type) {
        case "loading":
          if (debug.enabled) debug.log("worker loading", s.message);
          if (pipHandle || captureHandle) showCaptionStatus(s.message, s.progress);
          else showLoading(s.message, s.progress);
          break;
        case "ready":
          whisperReady = true;
          if (debug.enabled) debug.log("worker ready", { device: s.device, model: s.model });
          // v0.5.4 — defensive: if we asked for WASM on mobile but the worker
          // came back with webgpu, we have a stale worker (pre-v0.5.1 cached
          // by CDN/browser). The webgpu inference path on iOS WebKit OOMs.
          // Surface this loudly in the debug panel so we can diagnose vs
          // silently letting the tab die during first inference.
          //
          // Skip this check when PUBLIC_ALLOW_MOBILE_WEBGPU is on — in that
          // case `device === "webgpu"` on mobile is the intended outcome,
          // not a stale-cache bug.
          if (debug.enabled && forceWasmOnMobile && s.device === "webgpu") {
            debug.error(
              "STALE WORKER",
              "Mobile session got device=webgpu but forceDevice=wasm was requested. " +
                "This means the browser/CDN cached a pre-v0.5.1 worker that " +
                "doesn't honor forceDevice. Hard-refresh (or wait 4h for CDN) to fix.",
            );
          }
          if (pipHandle || captureHandle) showCaptionStatus("Listening…");
          else showLoading(`Model ready (${s.device.toUpperCase()}). Asking for audio source…`);
          // Worker is ready — first tick will fire on the existing schedule
          break;
        case "error":
          if (debug.enabled) debug.error("worker error", s.message);
          showError(s.message);
          break;
      }
    });
    // Resolve user's model preference to its HF ID + pass to worker init.
    // Re-read pref at start time so changes made in the prefs panel since
    // the page loaded take effect on this run.
    const activeModel = modelById(loadModelPref(isMobile));
    if (debug.enabled) {
      debug.log("start pipeline", {
        source: currentSource,
        model: activeModel.id,
        hfId: activeModel.hfId,
        forceWasm: forceWasmOnMobile,
      });
    }
    // v0.5.1: on mobile, force the worker to skip the WebGPU adapter
    // probe entirely. Mobile WebGPU was the silent 120s hang masquerading
    // as a page crash — Chrome Android sometimes returns a working
    // adapter, sometimes hangs, sometimes returns one that OOMs during
    // weight transfer. WASM is consistently slower but consistently
    // works. Desktop still tries WebGPU first.
    //
    // Build flag `PUBLIC_ALLOW_MOBILE_WEBGPU=true` lets a deploy opt
    // back into mobile WebGPU for testing — see docs/BUILD_FLAGS.md.
    const initPromise = whisper.init(
      activeModel.hfId,
      forceWasmOnMobile ? { forceDevice: "wasm" } : undefined,
    ).catch((e) => {
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
          handleLevel(rms);
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
    inferenceCount = 0;
    rolling.reset();
    agreement.reset();
    stabilityTracker.reset();
    nextTickMs = TICK_INTERVAL_MS;
    isPaused = false; // v0.4.1: fresh session always starts running
    pendingTurnBreak = false; // v0.4.3: turn detection starts disarmed
    transcriptSegments = [];
    sessionStartMs = performance.now();
    currentSessionSource = "sample";
    downloadBar.classList.add("hidden");
    setGranularityVisibility(transcriptSegments);
    lastNonSilentMs = performance.now();
    captionStream.innerHTML = "";

    // Sample plays inline regardless of inline-pref to keep the demo
    // friction-free (PiP opening would steal focus from caption stream).
    pipHandle = null;
    setPipMode(false);

    // Kick off worker init in background (same model preference as live).
    // v0.5.4: do NOT pass an explicit URL here — the default argument
    // in createWhisperClient() embeds the `?v=${WORKER_VERSION}` query
    // string that busts the CDN cache. Passing a bare URL bypasses
    // that bust and forces returning users onto stale workers.
    whisper = createWhisperClient();
    // v0.4.3 — push current vocabulary BEFORE init (same as live path).
    whisper.setVocabulary(loadVocabulary());
    // v0.6.0 — push language too (same as live path).
    whisper.setLanguage(whisperParamFor(loadLanguage()));
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
    const activeModel = modelById(loadModelPref(isMobile));
    // v0.5.1: on mobile, force the worker to skip the WebGPU adapter
    // probe entirely. Mobile WebGPU was the silent 120s hang masquerading
    // as a page crash — Chrome Android sometimes returns a working
    // adapter, sometimes hangs, sometimes returns one that OOMs during
    // weight transfer. WASM is consistently slower but consistently
    // works. Desktop still tries WebGPU first.
    //
    // Build flag `PUBLIC_ALLOW_MOBILE_WEBGPU=true` lets a deploy opt
    // back into mobile WebGPU for testing — see docs/BUILD_FLAGS.md.
    const initPromise = whisper.init(
      activeModel.hfId,
      forceWasmOnMobile ? { forceDevice: "wasm" } : undefined,
    ).catch((e) => {
      showError(`Couldn't load Whisper: ${(e as Error).message}`);
    });

    // Start the sample as if it were live capture.
    try {
      captureHandle = await startSampleCapture(sampleAudioEl, "/sample.mp3", {
        onAudio: (samples) => rolling.append(samples),
        onLevel: (rms) => {
          handleLevel(rms);
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
    inferenceCount = 0;
    inFlight = false;
    isPaused = false; // v0.4.1: stopping clears paused state
    pendingTurnBreak = false; // v0.4.3: turn detection cleared on stop
    rolling.reset();
    agreement.reset();
    stabilityTracker.reset();
    renderLiveLine("");
    hideCaptionStatus();
    // If the user captured any words this session, surface the download
    // buttons + KEEP the active panel visible so they can read what they
    // captured AND save it. Reset button (Clear) clears everything.
    if (transcriptSegments.length > 0) {
      downloadBar.classList.remove("hidden");
      setGranularityVisibility(transcriptSegments);
      sourceLabel.textContent = "";
      // Stay on "active" panel so caption history is still visible,
      // but flip substate so the header (LIVE → STOPPED, Stop → Done,
      // Pop Out hidden, Start new shown) reflects that capture ended.
      setSubstate("stopped");
      // v0.4.0: persist this session to IndexedDB history (best-effort —
      // never crash the UI on storage failure; just log). Minimum 5 words
      // total to avoid cluttering history with accidental clicks or
      // 1-word silence-hallucinations.
      const totalWords = transcriptSegments.reduce(
        (sum, s) => sum + s.words.length,
        0,
      );
      if (totalWords >= 5) {
        const endedAt = Date.now();
        const startedAt = endedAt - (performance.now() - sessionStartMs);
        const modelId = loadModelPref(isMobile);
        void saveSession({
          startedAt,
          endedAt,
          source: currentSessionSource,
          modelId,
          transcript: [...transcriptSegments],
        })
          .then(() => renderHistory())
          .catch((err) => {
            recordError(err, "sessionStore", { ctx: { op: "saveSession" } });
          });
      }
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
      toast.error("Pop-out window needs Chrome, Edge, or Brave 116+.");
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
          // v0.4.3 — also capture final size on mid-session "Pop out" close path.
          persistPipDimensionsFromHandle(pipHandle);
          pipHandle = null;
          setPipMode(false);
        },
      });
      wirePipResizeAutosave(pipHandle);
      setPipMode(true);
    } catch (e) {
      recordError(e, "pip", { ctx: { op: "open" } });
      toast.error((e as Error).message);
    }
  }

  // ── Event wiring ──
  startBtn.addEventListener("click", () => void startPipeline());
  sampleBtn.addEventListener("click", () => void startSampleSession());

  // ── Keyboard shortcuts (v0.4.0 + v0.4.1 Space pause/resume) ──
  function getShortcutContext(): ShortcutContext {
    if (currentState === "loading") return "loading";
    if (currentState === "active") {
      if (currentSubstate === "stopped") return "active-stopped";
      if (currentSubstate === "paused") return "active-paused";
      return "active-live";
    }
    return "idle";
  }
  function toggleShortcutsHelp() {
    if (shortcutsHelpDialog.open) shortcutsHelpDialog.close();
    else shortcutsHelpDialog.showModal();
  }
  /**
   * v0.4.1: Space pause/resume. Flips isPaused, calls the capture
   * handle's pause/resume (which suspends/resumes the AudioContext —
   * worklet stops emitting frames, RollingBuffer freezes), and swaps
   * substate so the header reflects PAUSED. Safe to invoke from
   * either the main document or the PiP document (handler is identical
   * because we install on both via setPipShortcuts).
   *
   * No-ops outside the active state — the shortcut contexts in
   * SHORTCUTS already gate this, but defense-in-depth so an accidental
   * direct call doesn't desync UI vs capture state.
   */
  async function togglePause() {
    if (currentState !== "active") return;
    if (!captureHandle) return;
    if (currentSubstate === "stopped") return; // can't pause a stopped session
    if (isPaused) {
      // Resume
      isPaused = false;
      setSubstate("live");
      showCaptionStatus("Listening…");
      // Hide status banner shortly after — gives the user visual confirm.
      window.setTimeout(() => {
        // Don't override a real status (e.g. error / model load) that
        // landed in the meantime.
        if (!isPaused) hideCaptionStatus();
      }, 800);
      try {
        await captureHandle.resume();
      } catch (err) {
        recordError(err, "capture", { ctx: { op: "resume" } });
      }
    } else {
      // Pause
      isPaused = true;
      setSubstate("paused");
      showCaptionStatus("Paused — press Space to resume");
      try {
        await captureHandle.pause();
      } catch (err) {
        recordError(err, "capture", { ctx: { op: "pause" } });
      }
    }
  }
  const SHORTCUTS: Shortcut[] = [
    {
      id: "start",
      key: "Enter",
      contexts: ["idle"],
      label: "Start captions",
      section: "Navigation",
      handler: () => startBtn.click(),
    },
    {
      id: "stop",
      key: "Escape",
      contexts: ["active-live", "active-paused"],
      label: "Stop capture",
      section: "Capture",
      handler: () => stopBtn.click(),
    },
    {
      id: "pause",
      key: "Space",
      contexts: ["active-live", "active-paused"],
      label: "Pause / resume capture",
      section: "Capture",
      handler: () => void togglePause(),
    },
    {
      id: "popout",
      key: "p",
      contexts: ["active-live", "active-paused"],
      label: "Pop out / close pop-out",
      section: "Window",
      handler: () => pipBtn.click(),
    },
    {
      id: "restart",
      key: "r",
      contexts: ["active-stopped"],
      label: "Start new session",
      section: "Navigation",
      handler: () => restartBtn.click(),
    },
    {
      id: "download-txt",
      key: "d",
      contexts: ["active-stopped"],
      label: "Download transcript (.txt)",
      section: "Navigation",
      handler: () => dlTxtBtn.click(),
    },
    {
      id: "help",
      key: "?",
      contexts: [], // always
      label: "Toggle help",
      section: "Help",
      handler: toggleShortcutsHelp,
    },
  ];
  // v0.4.3: apply user overrides to the SHORTCUTS array IN PLACE so both
  // main-window and PiP-window installs see the same effective keys.
  // We mutate vs replace so existing references (`SHORTCUTS` captured in
  // `setPipShortcuts`'s closure) stay in sync after re-render.
  function applyShortcutOverrides(): void {
    const overrides = loadShortcutOverrides();
    for (const s of SHORTCUTS) {
      const def = SHORTCUT_DEFAULT_KEYS.get(s.id);
      if (def === undefined) continue;
      s.key = overrides[s.id] ?? def;
    }
  }
  // Capture default keys BEFORE first override pass so we can revert.
  const SHORTCUT_DEFAULT_KEYS = new Map(SHORTCUTS.map((s) => [s.id, s.key]));
  applyShortcutOverrides();

  // v0.4.3 — UI for remapping shortcuts inside the help dialog.
  // Each .cp-kbd-btn has data-shortcut-id matching a Shortcut.id. Click puts
  // the button into "listening" mode; the next non-modifier keypress remaps it.
  // Esc cancels. Conflicts are detected and the user sees a brief error label
  // before the button returns to its previous key.
  const kbdButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".cp-kbd-btn[data-shortcut-id]"),
  );

  /** Refresh button labels from current SHORTCUTS state. */
  function renderShortcutButtons(): void {
    for (const btn of kbdButtons) {
      const id = btn.dataset.shortcutId;
      if (!id) continue;
      const s = SHORTCUTS.find((x) => x.id === id);
      if (!s) continue;
      btn.textContent = displayShortcutKey(s.key);
      btn.removeAttribute("data-listening");
      btn.removeAttribute("data-error");
      btn.removeAttribute("title");
    }
  }

  /** Currently-listening button + its capture cleanup (null if none). */
  let listeningCleanup: (() => void) | null = null;

  function cancelListening(): void {
    if (listeningCleanup) {
      listeningCleanup();
      listeningCleanup = null;
    }
  }

  function startListening(btn: HTMLButtonElement): void {
    // Always cancel a prior listen first.
    cancelListening();
    const id = btn.dataset.shortcutId;
    if (!id) return;
    btn.dataset.listening = "true";
    btn.textContent = "Press a key…";

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // Esc cancels (without changing the binding).
      if (e.key === "Escape") {
        cleanup();
        renderShortcutButtons();
        return;
      }
      const norm = normalizeShortcutKey(e);
      if (!norm) {
        // Modifier+key chord — swallow and keep listening.
        return;
      }
      if (norm.modifier) {
        // Pure modifier press — wait for an actual key.
        return;
      }
      if (norm.reserved) {
        flashError(btn, `${norm.key} is reserved`);
        return;
      }
      const conflictId = detectShortcutConflict(
        id,
        norm.key,
        SHORTCUTS,
        loadShortcutOverrides(),
      );
      if (conflictId && conflictId !== id) {
        const other = SHORTCUTS.find((s) => s.id === conflictId);
        flashError(btn, `Used by: ${other?.label ?? conflictId}`);
        return;
      }
      // Commit. If the new key equals the default, clear the override
      // entry (keeps localStorage clean and lets future default changes
      // take effect).
      const def = SHORTCUT_DEFAULT_KEYS.get(id);
      if (norm.key === def) {
        clearShortcutOverride(id);
      } else {
        saveShortcutOverride(id, norm.key);
      }
      applyShortcutOverrides();
      cleanup();
      renderShortcutButtons();
      toast.success(`Shortcut updated`);
    };

    // Listen globally so we capture keys even if focus drifts.
    document.addEventListener("keydown", onKeyDown, true);
    listeningCleanup = () => {
      document.removeEventListener("keydown", onKeyDown, true);
      btn.removeAttribute("data-listening");
    };
    function cleanup() {
      cancelListening();
    }
  }

  function flashError(btn: HTMLButtonElement, msg: string): void {
    btn.dataset.error = "true";
    btn.textContent = msg;
    setTimeout(() => {
      btn.removeAttribute("data-error");
      // Don't call renderShortcutButtons() — we may still be listening for
      // the user to pick a different key. Restore just this button's label.
      const id = btn.dataset.shortcutId;
      if (id) {
        const s = SHORTCUTS.find((x) => x.id === id);
        if (s && btn.dataset.listening === "true") {
          btn.textContent = "Press a key…";
        } else if (s) {
          btn.textContent = displayShortcutKey(s.key);
        }
      }
    }, 1800);
  }

  for (const btn of kbdButtons) {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (btn.dataset.listening === "true") {
        cancelListening();
        renderShortcutButtons();
      } else {
        startListening(btn);
      }
    });
  }

  // Reset-to-defaults button.
  const resetShortcutsBtn = rootEl.querySelector<HTMLButtonElement>("#cp-reset-shortcuts-btn");
  resetShortcutsBtn?.addEventListener("click", () => {
    cancelListening();
    clearAllShortcutOverrides();
    applyShortcutOverrides();
    renderShortcutButtons();
    toast.success("Shortcuts reset to defaults");
  });

  // Cancel any listening session when the help dialog closes.
  shortcutsHelpDialog.addEventListener("close", () => {
    cancelListening();
    renderShortcutButtons();
  });

  // Initial paint so any localStorage-persisted overrides show up in the UI
  // (in case the user opens the dialog later — we already applied them).
  renderShortcutButtons();
  // Always install on the main document — UNLESS we're on mobile, where
  // there's no physical keyboard to fire any of these. Skipping the install
  // avoids a wasted listener and keeps the help dialog (`?`) unreachable
  // (which is correct — it has no purpose on touch devices).
  if (!isMobile) {
    installShortcuts(document, SHORTCUTS, getShortcutContext);
  }
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
    downloadString(defaultFilename("vtt"), formatVtt(transcriptSegments, currentGranularity), "text/vtt;charset=utf-8");
  });
  dlSrtBtn.addEventListener("click", () => {
    if (transcriptSegments.length === 0) return;
    downloadString(defaultFilename("srt"), formatSrt(transcriptSegments, currentGranularity), "application/x-subrip;charset=utf-8");
  });
  // v0.4.3 — Share via URL (transcript encoded into the URL itself,
  // gzipped + base64url, no upload). Copies to clipboard + flashes toast.
  dlShareBtn.addEventListener("click", async () => {
    if (transcriptSegments.length === 0) return;
    try {
      const url = await encodeShareUrl(transcriptSegments, window.location.origin);
      await navigator.clipboard.writeText(url);
      toast.success("Share link copied to clipboard");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create share link.");
    }
  });
  dlClearBtn.addEventListener("click", () => {
    transcriptSegments = [];
    captionStream.innerHTML = "";
    captionCount = 0;
    downloadBar.classList.add("hidden");
    setGranularityVisibility(transcriptSegments);
    setState("idle");
  });

  // ── v0.4.0: session history (Recent sessions list on idle screen) ──
  /** Currently-viewed session id, set by `viewSession()` so download/delete
   *  buttons inside the dialog know which session to operate on. */
  let viewingSessionId: string | null = null;

  // ─ v0.5 commit 8 — transcript editor state ─────────────────────────
  /** Pre-edit snapshot of the active session. Used by Cancel to revert
   *  and by viewSession() to track whether Edit mode is even available
   *  for the current session (must be all-v2 segments). */
  let editorOriginalSegments: TranscriptSegment2[] | null = null;
  /** Edit-mode flag — true between Edit-click and Save/Cancel/Close. */
  let editorActive = false;

  /** Exit Edit mode without saving: re-render the read-only body from
   *  the snapshot, hide Save/Cancel, show Edit/Download/Delete. Called
   *  by Cancel, by Save (after persist), and by dialog-close (defensive
   *  — avoids leaving the next session-view in editor state). */
  function exitEditorMode() {
    editorActive = false;
    sessionViewBody.contentEditable = "false";
    sessionViewBody.classList.remove("cp-edit-active");
    sessionViewEditActions.classList.add("hidden");
    sessionViewActions.classList.remove("hidden");
    if (editorOriginalSegments) {
      sessionViewBody.textContent = formatTxt(editorOriginalSegments) || "(empty session)";
    }
  }

  /** Format epoch ms as a friendly relative time ("2 min ago", "3 hours ago",
   *  "yesterday"). Defaults to date for >7 days ago. Pure-ish (uses Date.now). */
  function relativeTime(t: number): string {
    const diffSec = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (diffSec < 60) return "just now";
    if (diffSec < 3600) return `${Math.round(diffSec / 60)} min ago`;
    if (diffSec < 86400) return `${Math.round(diffSec / 3600)} hr ago`;
    if (diffSec < 7 * 86400) return `${Math.round(diffSec / 86400)} days ago`;
    return new Date(t).toLocaleDateString();
  }

  /** Label a SessionSource enum for the list view. */
  function sourceLabelFor(s: SessionSource): string {
    if (s === "mic") return "Mic";
    if (s === "sample") return "Sample";
    return "Tab";
  }

  /** v0.4.2: cached snapshot of the most recent listSessions() result.
   *  applySearchFilter() reads from here so keystrokes don't hammer IDB. */
  let cachedSessions: StoredSession[] = [];
  /** v0.4.2: current search query (lowercased, debounced from input). */
  let currentQuery = "";

  /** Fetch sessions + repopulate the Recent panel. Idempotent. */
  async function renderHistory() {
    let sessions: StoredSession[];
    try {
      sessions = await listSessions();
    } catch (err) {
      recordError(err, "sessionStore", { ctx: { op: "listSessions" } });
      historyPanel.classList.add("hidden");
      return;
    }
    cachedSessions = sessions;
    applySearchFilter();
  }

  /** v0.4.2: re-render the visible history list from `cachedSessions`
   *  filtered by `currentQuery`. Cheap — no IDB access, just an Array filter.
   *  Also manages: panel show/hide, search input visibility (≥3 session
   *  threshold so the search box doesn't add friction on fresh installs),
   *  and the empty-state messaging (no sessions vs no-match). */
  function applySearchFilter() {
    if (cachedSessions.length === 0) {
      // v0.4.2: keep the panel visible (so Import is reachable for a user
      // restoring a backup on a fresh device) but strip everything else.
      historyPanel.classList.remove("hidden");
      historyList.innerHTML = "";
      historyEmpty.classList.add("hidden");
      historyEmptyZero.classList.remove("hidden");
      historySearchWrap.classList.add("hidden");
      historyExportBtn.classList.add("hidden");
      historyClearBtn.classList.add("hidden");
      // Reset search state so a future post-recording panel reopen starts clean.
      currentQuery = "";
      historySearchInput.value = "";
      return;
    }
    historyPanel.classList.remove("hidden");
    historyExportBtn.classList.remove("hidden");
    historyClearBtn.classList.remove("hidden");
    historyEmptyZero.classList.add("hidden");
    // Search input only shows once we have enough sessions for it to be
    // useful — under 3 entries the user can just scan the list.
    historySearchWrap.classList.toggle("hidden", cachedSessions.length < 3);

    const matched = searchSessions(cachedSessions, currentQuery);
    if (matched.length === 0) {
      historyList.innerHTML = "";
      historyEmpty.classList.remove("hidden");
      return;
    }
    historyEmpty.classList.add("hidden");
    // Render top 5 of the filtered set (compact panel).
    const shown = matched.slice(0, 5);
    historyList.innerHTML = shown
      .map((s) => {
        const meta = `${relativeTime(s.startedAt)} · ${sourceLabelFor(s.source)}`;
        // Defensive HTML escape — preview is user-generated transcript text.
        const safePreview = (s.preview || "(empty)")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
        return `<li class="px-4 py-2.5 text-xs hover:bg-[var(--color-surface-strong)] transition-colors">
          <button type="button" data-session-id="${s.id}" class="cp-history-item w-full text-left flex flex-col gap-0.5">
            <span class="text-[var(--color-fg-muted)]">${meta}</span>
            <span class="text-[var(--color-fg)] line-clamp-2 italic">${safePreview}</span>
          </button>
        </li>`;
      })
      .join("");
    // Wire each item button (event delegation would also work — list is short)
    historyList.querySelectorAll<HTMLButtonElement>(".cp-history-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.sessionId;
        if (id) void viewSession(id);
      });
    });
  }

  // v0.4.2: search input — debounced so we re-filter at most ~6 times/sec
  // during sustained typing. Filtering is pure-functional + cached, so
  // even without debounce this would be cheap; debounce just avoids
  // visual flicker as the user types.
  const onSearchInput = debounce((q: string) => {
    currentQuery = q;
    applySearchFilter();
  }, 150);
  historySearchInput.addEventListener("input", (e) => {
    onSearchInput((e.currentTarget as HTMLInputElement).value);
  });

  /** Open the viewer dialog with the given session id. */
  async function viewSession(id: string) {
    let s: StoredSession | undefined;
    try {
      s = await getSession(id);
    } catch (err) {
      recordError(err, "sessionStore", { ctx: { op: "getSession" } });
      return;
    }
    if (!s) return;
    viewingSessionId = id;
    const startDate = new Date(s.startedAt);
    const durSec = Math.max(1, Math.round((s.endedAt - s.startedAt) / 1000));
    sessionViewMeta.textContent = `${startDate.toLocaleString()} · ${sourceLabelFor(s.source)} · ${durSec}s · model: ${s.modelId}`;
    sessionViewBody.textContent = formatTxt(s.transcript) || "(empty session)";

    // v0.5 commit 8 — Edit button visibility. Only show for v2 sessions
    // (per-word timing available). Mixed/v1 sessions get the read-only
    // path because the editor's realignment heuristic needs per-word
    // timestamps to gracefully preserve timing on unchanged words.
    const allV2 = s.transcript.length > 0 && s.transcript.every(isV2Segment);
    if (allV2) {
      editorOriginalSegments = s.transcript as TranscriptSegment2[];
      sessionViewEditBtn.classList.remove("hidden");
    } else {
      editorOriginalSegments = null;
      sessionViewEditBtn.classList.add("hidden");
    }
    // Defensive — if a previous dialog session left editor mode on
    // (shouldn't happen because close handlers exit it, but belt-and-
    // suspenders), reset state cleanly.
    if (editorActive) exitEditorMode();

    sessionViewDialog.showModal();
  }

  /** v0.4.3 — Open the viewer dialog with a transcript decoded from a
   *  share URL. We mark viewingSessionId = null so the download buttons
   *  inside the dialog still work via a synthetic StoredSession path
   *  (see downloadSharedTranscript). The Delete button is suppressed in
   *  shared-view mode. */
  let sharedTranscriptSegments: typeof transcriptSegments | null = null;
  async function openSharedTranscript(payload: string): Promise<void> {
    let decoded: Awaited<ReturnType<typeof decodeShareUrl>>;
    try {
      decoded = await decodeShareUrl(payload);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't open shared transcript.");
      return;
    }
    sharedTranscriptSegments = decoded.segments;
    viewingSessionId = null;
    const sourceLabel = "shared link";
    const dateLabel = decoded.bundle.t
      ? new Date(decoded.bundle.t).toLocaleString()
      : "received via link";
    sessionViewMeta.textContent = `${dateLabel} · ${sourceLabel}`;
    sessionViewBody.textContent =
      formatTxt(decoded.segments) || "(empty shared transcript)";
    // Hide the Delete button in shared mode — there's nothing to delete
    // (the transcript only exists in this page session).
    sessionViewDelete.classList.add("hidden");
    // v0.5 commit 8 — also hide Edit in shared mode. Edits couldn't be
    // persisted back to IDB (no viewingSessionId) and surfacing the
    // button would mislead users into thinking their fixes save.
    sessionViewEditBtn.classList.add("hidden");
    editorOriginalSegments = null;
    if (editorActive) exitEditorMode();
    sessionViewDialog.showModal();
    // Restore Delete button visibility next time the dialog opens via
    // viewSession() — listen once. (Edit button visibility is re-set
    // by viewSession() based on v2-ness, so no restore needed here.)
    const restore = () => {
      sessionViewDelete.classList.remove("hidden");
      sharedTranscriptSegments = null;
    };
    sessionViewDialog.addEventListener("close", restore, { once: true });
  }

  /** Active-on-click: read viewingSessionId, refetch, then download in given format.
   *  v0.4.3 — also handles the shared-transcript path (viewingSessionId === null
   *  but sharedTranscriptSegments is populated).
   *  v0.5 commit 6 — .vtt/.srt paths honour currentGranularity. */
  function downloadCurrentSession(
    fmt: "txt" | "vtt" | "srt",
  ): void {
    const mime =
      fmt === "txt"
        ? "text/plain;charset=utf-8"
        : fmt === "vtt"
          ? "text/vtt;charset=utf-8"
          : "application/x-subrip;charset=utf-8";
    const fmtSegments = (segs: AnyTranscriptSegment[]): string => {
      if (fmt === "txt") return formatTxt(segs);
      if (fmt === "vtt") return formatVtt(segs, currentGranularity);
      return formatSrt(segs, currentGranularity);
    };
    // Shared-transcript branch: no IDB lookup, segments held in memory.
    if (sharedTranscriptSegments && !viewingSessionId) {
      const stamp = new Date().toISOString().replace(/[T:.]/g, "-").slice(0, 19);
      const name = `livecaptionit-shared-${stamp}.${fmt}`;
      downloadString(name, fmtSegments(sharedTranscriptSegments), mime);
      return;
    }
    if (!viewingSessionId) return;
    void getSession(viewingSessionId)
      .then((s) => {
        if (!s) return;
        const stamp = new Date(s.startedAt)
          .toISOString()
          .replace(/[T:.]/g, "-")
          .slice(0, 19);
        const name = `livecaptionit-${stamp}.${fmt}`;
        downloadString(name, fmtSegments(s.transcript), mime);
      })
      .catch((err) => recordError(err, "export", { ctx: { op: "download" } }));
  }

  sessionViewDlTxt.addEventListener("click", () => downloadCurrentSession("txt"));
  sessionViewDlVtt.addEventListener("click", () => downloadCurrentSession("vtt"));
  sessionViewDlSrt.addEventListener("click", () => downloadCurrentSession("srt"));
  sessionViewDelete.addEventListener("click", () => {
    if (!viewingSessionId) return;
    void deleteSession(viewingSessionId)
      .then(() => {
        viewingSessionId = null;
        sessionViewDialog.close();
        void renderHistory();
      })
      .catch((err) => recordError(err, "sessionStore", { ctx: { op: "delete" } }));
  });

  // ─ v0.5 commit 8 — transcript editor handlers ─────────────────────────
  // Edit: swap body into contenteditable HTML view + swap action rows
  // from read-only (.txt/.vtt/.srt/Edit/Delete) to edit-mode (Cancel/Save).
  // Disables the Close [✕] button while editing — closing mid-edit would
  // silently discard work; user must explicitly Cancel or Save first.
  sessionViewEditBtn.addEventListener("click", () => {
    if (!editorOriginalSegments || editorActive) return;
    editorActive = true;
    // Render per-word spans via the pure helper so the data-* anchors
    // are present for debugging + potential future per-word click-to-edit.
    sessionViewBody.innerHTML = renderEditableSegments(editorOriginalSegments);
    sessionViewBody.contentEditable = "true";
    sessionViewBody.classList.add("cp-edit-active");
    sessionViewActions.classList.add("hidden");
    sessionViewEditActions.classList.remove("hidden");
    sessionViewCloseBtn.disabled = true;
    sessionViewCloseBtn.classList.add("opacity-50", "pointer-events-none");
    // Auto-focus the body so the user can start typing immediately.
    sessionViewBody.focus();
  });

  // Cancel: discard edits, revert to read-only snapshot. No undo stack
  // per roadmap OQ #4 — single-step.
  sessionViewCancelBtn.addEventListener("click", () => {
    if (!editorActive) return;
    exitEditorMode();
    sessionViewCloseBtn.disabled = false;
    sessionViewCloseBtn.classList.remove("opacity-50", "pointer-events-none");
  });

  // Save: extract plain text → reconcile back to TranscriptSegment2[] →
  // persist to IDB → refresh sessions list. On any error, surface a
  // toast and stay in edit mode so the user can retry without losing work.
  sessionViewSaveBtn.addEventListener("click", () => {
    if (!editorActive || !editorOriginalSegments || !viewingSessionId) return;
    void (async () => {
      const id = viewingSessionId;
      if (!id) return;
      const editedText = extractPlainText(sessionViewBody);
      const newSegments = reconcileEditedText(editedText, editorOriginalSegments!);

      // Fetch + write back. We re-fetch instead of holding the StoredSession
      // in editorOriginalSegments because the session may have been
      // mutated by another tab between viewSession() and Save (rare but
      // possible). The transcript field is the only thing we touch.
      try {
        const s = await getSession(id);
        if (!s) {
          toast.error("Session no longer exists — your edits weren't saved.");
          exitEditorMode();
          return;
        }
        const updated: StoredSession = {
          ...s,
          transcript: newSegments,
        };
        await saveSession(updated);
        // Adopt the new segments as the post-save snapshot so subsequent
        // re-edits in the same dialog session compare against fresh data.
        editorOriginalSegments = newSegments;
        exitEditorMode();
        sessionViewCloseBtn.disabled = false;
        sessionViewCloseBtn.classList.remove("opacity-50", "pointer-events-none");
        toast.success("Transcript saved.");
        // Refresh the recent-sessions list to update the preview text.
        void renderHistory();
      } catch (err) {
        recordError(err, "sessionStore", { ctx: { op: "saveEdit" } });
        toast.error("Couldn't save edits. Please try again.");
      }
    })();
  });

  // Dialog close — defensive cleanup. If somehow the dialog closes while
  // edit mode is active (e.g. Escape key bypassing the disabled Close
  // button — most browsers honour disabled on submit buttons but Escape
  // closes <dialog> independently), revert to the snapshot so the next
  // viewSession() doesn't inherit a stale state.
  sessionViewDialog.addEventListener("close", () => {
    if (editorActive) {
      exitEditorMode();
      sessionViewCloseBtn.disabled = false;
      sessionViewCloseBtn.classList.remove("opacity-50", "pointer-events-none");
    }
  });
  historyClearBtn.addEventListener("click", () => {
    if (!confirm("Clear all session history? This can't be undone.")) return;
    void clearAllSessions()
      .then(() => renderHistory())
      .catch((err) => recordError(err, "sessionStore", { ctx: { op: "clearAll" } }));
  });

  // ── v0.4.2: JSON export / import ──
  // Export: serialize the current store to a JSON file. No confirmation
  // needed — export is non-destructive. Filename uses YYYY-MM-DD so the
  // user has a sortable history of backups.
  historyExportBtn.addEventListener("click", () => {
    void (async () => {
      try {
        const bundle = await exportAllSessions();
        if (bundle.sessions.length === 0) {
          toast.info("No sessions to export yet — record at least one session first.");
          return;
        }
        const yyyymmdd = new Date().toISOString().slice(0, 10);
        const filename = `livecaptionit-history-${yyyymmdd}.json`;
        downloadString(
          filename,
          JSON.stringify(bundle, null, 2),
          "application/json;charset=utf-8",
        );
      } catch (err) {
        recordError(err, "export", { ctx: { op: "exportAll" } });
        toast.error(
          `Couldn't export sessions: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    })();
  });

  // Import: button click triggers the hidden <input type=file>. The file
  // change handler reads, parses, validates, imports, then re-renders.
  // Non-destructive by default (skip-on-duplicate-id).
  historyImportBtn.addEventListener("click", () => {
    // Reset value so picking the SAME file twice still fires `change`.
    historyImportFile.value = "";
    historyImportFile.click();
  });
  historyImportFile.addEventListener("change", () => {
    const file = historyImportFile.files?.[0];
    if (!file) return;
    void (async () => {
      try {
        const text = await file.text();
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new Error("File isn't valid JSON. Make sure you picked a LiveCaptionIt export.");
        }
        validateExportBundle(parsed); // throws with user-friendly message
        const result = await importSessions(parsed);
        await renderHistory();
        const parts = [`${result.imported} imported`];
        if (result.skipped > 0) parts.push(`${result.skipped} skipped (already present)`);
        if (result.pruned > 0) parts.push(`${result.pruned} pruned (over 20-session cap)`);
        toast.success(`Import complete: ${parts.join(", ")}.`);
      } catch (err) {
        recordError(err, "import");
        toast.error(
          `Couldn't import sessions: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    })();
  });
  // Initial render on page load
  void renderHistory();

  // v0.4.3 — if the page was opened with ?t=<payload>, decode it and
  // pop the session viewer with the shared transcript. Strip the param
  // afterwards so reloading doesn't re-open the dialog AND so the URL
  // shown to the user looks clean. Done after renderHistory() so the
  // viewer dialog overlays a populated idle screen, not an empty one.
  const sharedPayload = readSharePayloadFromLocation(window.location);
  if (sharedPayload !== null) {
    void openSharedTranscript(sharedPayload).finally(() => {
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete("t");
        url.searchParams.delete("v");
        const cleaned = url.pathname + (url.search ? url.search : "") + url.hash;
        window.history.replaceState(null, "", cleaned);
      } catch {
        /* ignore */
      }
    });
  }

  // Ensure clean shutdown if user closes the tab while capturing
  window.addEventListener("pagehide", () => {
    if (tickTimer !== null) clearTimeout(tickTimer);
    captureHandle?.stop();
    whisper?.dispose();
  });
})();
