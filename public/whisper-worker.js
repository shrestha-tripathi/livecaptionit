// LiveCaptionIt — Whisper transcription worker.
//
// Runs in a Web Worker spawned by src/lib/whisperClient.ts.
// Loads transformers.js from CDN (jsDelivr ESM) so we don't bundle the ~15MB
// runtime ourselves. The actual Whisper model is downloaded lazily from
// Hugging Face Hub and cached in browser IndexedDB.
//
// IMPORTANT: model choice + engine family (v0.7.0)
//   Two engine families ship, both from onnx-community/* (NOT Xenova/* — that
//   port silently hangs on missing dtype files):
//     - Whisper (whisper-tiny/base/small/large-v3-turbo): multilingual, accepts
//       the full Whisper decode param set (language, task, chunk_length_s,
//       initial_prompt). 30s padded window.
//     - Moonshine (moonshine-tiny-ONNX/moonshine-base-ONNX): English-ONLY,
//       variable-length short-form transcriber. Does NOT accept Whisper's
//       language/task/chunk/prompt params — feed a window, get text. Lower
//       latency on short rolling chunks. See SPEC.md v0.7.0.
//   The onnx-community ports ship every dtype variant (fp32, fp16, q4, q8) so
//   per-component WebGPU dtypes "just work" for BOTH families. This matches
//   Xenova's realtime-whisper-webgpu + webml-community/moonshine-web demos.
//   `familyOf(model)` below branches dtype + decode-call shape on the family.
//
// Message protocol:
//   incoming: { type: "init", model?: string }
//             { type: "transcribe", audio: Float32Array, id?: number }
//             { type: "dispose" }
//   outgoing: { type: "loading", message: string, progress?: number }
//             { type: "ready", model: string, device: "webgpu" | "wasm" }
//             { type: "result", text: string, chunks: [], id?: number, durationMs: number }
//             { type: "error", message: string }
//
//   `chunks` is always [] as of v0.6.2 — streaming decodes text-only
//   (return_timestamps:false) because every model we ship has a quantized
//   decoder that can't produce real word timestamps. The parent synthesizes
//   uniform per-word timing for .vtt/.srt exports. The field is retained in
//   the message shape only for wire-compat with stale cached parent bundles.

import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5/dist/transformers.min.js";

env.allowLocalModels = false;
env.useBrowserCache = true;

let asr = null;
let currentModel = "";

// v0.4.3 — custom vocabulary biasing.
// Whisper takes an `initial_prompt` string per call that's prepended to
// the decoder context. Terms in the prompt are tokenized once and seen
// by the decoder, so it's much more likely to emit them when audio
// resembles them. Examples: brand names, acronyms, technical jargon,
// non-English proper nouns that English Whisper would otherwise butcher.
//
// Storage = a single string set by `setVocabulary` from the parent.
// Empty string disables (default). Capped at ~200 chars to avoid eating
// the whisper context window (decoder has finite room — prompts that
// are too long crowd out the actual audio's transcription budget).
let vocabularyPrompt = "";

// v0.6.0 — caption language.
// The onnx-community/whisper-* models are the MULTILINGUAL ports (not `.en`),
// so they natively cover 99 languages + auto-detect. `languageParam` is the
// string passed to Whisper's `language` decode option:
//   - undefined  → auto-detect (Whisper picks per window; default)
//   - "french" / "hindi" / …  → pin decode to that language (stable, lower
//     first-window latency, no mid-stream language flipping on Hinglish etc.)
// Set by `setLanguage` from the parent. TRANSCRIBE-only — we do NOT expose
// `task: "translate"` (shipped v0.3.0, pulled v0.3.2 for bad quality).
let languageParam = undefined;

// Default model — onnx-community port has all dtype variants.
const DEFAULT_MODEL = "onnx-community/whisper-base";

// v0.7.0 — engine family detection from the model id string. Moonshine models
// are English-only and use a different decode contract than Whisper (see the
// header comment + runAsr). Anything not matching /moonshine/ is treated as
// Whisper (the default + safest assumption for the four whisper-* tiers).
function familyOf(model) {
  return /moonshine/i.test(model || "") ? "moonshine" : "whisper";
}

// Wrap an async operation in a timeout so silent hangs surface as errors.
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `Timed out after ${Math.round(ms / 1000)}s waiting for ${label}. ` +
                `Check network (model files load from huggingface.co) or try refreshing.`,
            ),
          ),
        ms,
      ),
    ),
  ]);
}

function buildProgressCallback() {
  return (data) => {
    if (!data) return;
    if (data.status === "ready") return; // pipeline emits its own "ready" — we send our own after load completes
    // Possible statuses: "initiate" | "download" | "downloading" | "progress" | "done"
    const file = data.file || data.name || "";
    const pct =
      typeof data.progress === "number"
        ? Math.round(data.progress)
        : undefined;
    let msg;
    if (data.status === "progress" && pct !== undefined) {
      msg = `Downloading ${file} — ${pct}%`;
    } else if (data.status === "done") {
      msg = `Loaded ${file}`;
    } else if (data.status === "initiate" || data.status === "download" || data.status === "downloading") {
      msg = `Fetching ${file}…`;
    } else {
      msg = file ? `${data.status} ${file}` : data.status;
    }
    self.postMessage({
      type: "loading",
      message: msg,
      progress: pct !== undefined ? pct / 100 : undefined,
    });
  };
}

async function init(model = DEFAULT_MODEL, opts = {}) {
  if (asr && currentModel === model) {
    self.postMessage({ type: "ready", model: currentModel, device: "webgpu" });
    return;
  }
  currentModel = model;
  const progress_callback = buildProgressCallback();

  // v0.4.3 / v0.7.0 — model-aware dtype selection.
  // tiny/base/small + BOTH Moonshine tiers: encoder fp32 + decoder q4 (proven
  //   config from the realtime-whisper-webgpu + moonshine-web demos — fast,
  //   high quality). Moonshine is small (27M/61M params) so it slots into the
  //   same non-large branch as whisper tiny/base with no special-casing.
  // large-v3-turbo:  encoder q4f16 + decoder q4f16 (~537 MB total).
  //   fp32 encoder for large-v3-turbo would be 2.5 GB, which is too
  //   much for browser memory + first-load patience. q4f16 keeps the
  //   download manageable while preserving large-model quality lift.
  const isLargeTurbo = /whisper-large/i.test(model);
  const dtype = isLargeTurbo
    ? { encoder_model: "q4f16", decoder_model_merged: "q4f16" }
    : { encoder_model: "fp32", decoder_model_merged: "q4" };
  // Larger models need more init time — bump timeout from 120s → 240s
  // for the large tier. WebGPU model load includes weight transfer to
  // GPU, which takes longer for 500MB+ payloads.
  const initTimeout = isLargeTurbo ? 240_000 : 120_000;

  // v0.5.1 — `forceDevice: "wasm"` lets the parent skip the WebGPU
  // adapter probe entirely. On mobile (Android Chrome / iOS Safari)
  // `navigator.gpu` exists but the adapter is unreliable — many devices
  // either return null after a long timeout, or return an adapter that
  // OOMs during weight transfer. The parent passes forceDevice: "wasm"
  // when isMobileDevice() so we don't waste 120s + risk a GPU OOM.
  // Desktop ALWAYS goes through the WebGPU-first path (better perf).
  const forceWasm = opts && opts.forceDevice === "wasm";

  // Try WebGPU first — fastest path. Per-component dtype matches the
  // realtime-whisper-webgpu reference demo. Skipped entirely when the
  // parent explicitly asks for WASM (mobile, or future opt-out toggle).
  if (!forceWasm) {
    try {
      self.postMessage({
        type: "loading",
        message: "Initializing WebGPU pipeline…",
      });
      asr = await withTimeout(
        pipeline("automatic-speech-recognition", model, {
          device: "webgpu",
          dtype,
          progress_callback,
        }),
        initTimeout,
        "WebGPU model load (encoder/decoder weights from huggingface.co)",
      );
      self.postMessage({ type: "ready", model: currentModel, device: "webgpu" });
      return;
    } catch (gpuErr) {
      // WebGPU not available, or load failed. Fall back to WASM.
      self.postMessage({
        type: "loading",
        message:
          "WebGPU unavailable or failed — falling back to WASM (slower). " +
          `(${(gpuErr && gpuErr.message) || gpuErr})`,
      });
    }
  } else {
    self.postMessage({
      type: "loading",
      message: "Loading model (WASM mode for mobile compatibility)…",
    });
  }

  // WASM fallback / forced path.
  //
  // v0.5.3 — explicit q4 dtype on WASM. Previously we passed no `dtype`
  // and let transformers.js pick its default — which for tiny on WASM
  // loaded the fp32 encoder (~25 MB on disk, ~80 MB peak in WASM heap
  // during InferenceSession construction). On iOS Safari/Chrome with
  // a ~200-300 MB per-tab WebKit budget, that peak crossed the jetsam
  // threshold and the OS killed the tab silently — appearing to the
  // user as "page crashed after model loaded to 100%".
  //
  // Forcing q4 on both encoder + decoder cuts the in-heap peak to
  // ~25-30 MB. Quality loss vs fp32 encoder is minor for tiny (1-2%
  // WER bump on noisy audio) — acceptable trade for "actually works
  // without crashing on iOS." Large-v3-turbo already uses q4f16 above.
  //
  // For large-v3-turbo, bump WASM timeout to 360s — large model on
  // CPU WASM is slow to load (3-5 minutes on lower-end machines).
  try {
    const wasmDtype = isLargeTurbo
      ? { encoder_model: "q4f16", decoder_model_merged: "q4f16" }
      : { encoder_model: "q4", decoder_model_merged: "q4" };
    // v0.5.3 — bracket the pipeline() call with explicit logs. The
    // construction step itself (loading ONNX weights into the WASM
    // heap + building compute graphs + allocating activation buffers)
    // is the highest-memory-pressure moment and can take 5-15s on
    // mobile WASM. Silent during this window without these logs.
    self.postMessage({
      type: "loading",
      message: `Constructing WASM InferenceSession (dtype=${JSON.stringify(wasmDtype)})…`,
    });
    asr = await withTimeout(
      pipeline("automatic-speech-recognition", model, {
        device: "wasm",
        dtype: wasmDtype,
        progress_callback,
      }),
      isLargeTurbo ? 360_000 : 180_000,
      "WASM model load (slower than WebGPU)",
    );
    self.postMessage({
      type: "loading",
      message: "WASM InferenceSession constructed.",
    });
    self.postMessage({ type: "ready", model: currentModel, device: "wasm" });
  } catch (wasmErr) {
    self.postMessage({
      type: "error",
      message:
        (forceWasm ? "WASM" : "Both WebGPU and WASM") + " pipeline init failed. " +
        `Last error: ${(wasmErr && wasmErr.message) || wasmErr}`,
    });
  }
}

async function transcribe(audio, id) {
  if (!asr) {
    self.postMessage({ type: "error", message: "Worker not initialized." });
    return;
  }
  const start = performance.now();
  try {
    const result = await runAsr(audio);
    const text = (result && result.text ? result.text : "").trim();
    const durationMs = Math.round(performance.now() - start);
    // v0.6.2 — text-only streaming (see runAsr). No per-word chunks: our
    // quantized decoders can't produce real word timestamps, and the parent
    // synthesizes uniform timing for exports. Kept `chunks: []` in the
    // message for wire-compat with any stale cached parent bundle.
    self.postMessage({ type: "result", text, chunks: [], id, durationMs });
  } catch (e) {
    self.postMessage({ type: "error", message: (e && e.message) || String(e) });
  }
}

// Streaming ASR decode — text-only, fast path (v0.6.2 / v0.7.0).
//
// v0.7.0 — model-family-aware. Whisper and Moonshine take DIFFERENT decode
// options:
//   - Whisper: the full param set below (chunk_length_s/stride for the 30s
//     padded window, language pin, task, initial_prompt vocab biasing). Byte-
//     identical to the smooth v0.1–v0.4.7 config. Do NOT re-add
//     return_timestamps:"word" — every shipped Whisper decoder is quantized
//     (base=q4, large-turbo=q4f16) and its ONNX export drops the cross-attention
//     outputs word timestamps need (that was the v0.6.1 perf regression, ripped
//     out in v0.6.2). Per-word timing for .vtt/.srt is synthesized parent-side.
//   - Moonshine: a MINIMAL call. Moonshine is a short-form, variable-length
//     transcriber that does NOT accept Whisper's language/task/chunk_length_s/
//     stride_length_s/initial_prompt params. Passing them either errors or is
//     silently ignored, so we pass NONE of them. languageParam + vocabularyPrompt
//     are stored (setLanguage/setVocabulary still arrive) but are no-ops for
//     Moonshine decode — it's English-only and has no prompt-biasing hook.
async function runAsr(audio) {
  if (familyOf(currentModel) === "moonshine") {
    // English-only short-form transcriber — feed the window, get text.
    return await asr(audio, {
      return_timestamps: false,
    });
  }
  // Whisper — unchanged multilingual decode.
  return await asr(audio, {
    chunk_length_s: 30,
    stride_length_s: 5,
    language: languageParam,
    task: "transcribe",
    num_beams: 1,
    temperature: 0,
    no_repeat_ngram_size: 3,
    initial_prompt: vocabularyPrompt || undefined,
    return_timestamps: false,
  });
}

self.onmessage = async (e) => {
  const data = e.data || {};
  switch (data.type) {
    case "init":
      await init(data.model, { forceDevice: data.forceDevice });
      break;
    case "transcribe":
      await transcribe(data.audio, data.id);
      break;
    case "dispose":
      asr = null;
      currentModel = "";
      break;
    case "setVocabulary":
      // Cap at 200 chars to avoid crowding Whisper's decoder context.
      // We could let it grow, but past ~200 chars the prompt starts
      // displacing audio transcription budget for no quality gain.
      vocabularyPrompt = (data.text && typeof data.text === "string"
        ? data.text.slice(0, 200).trim()
        : "");
      break;
    case "setLanguage":
      // v0.6.0 — pin decode language, or auto-detect. `param` is the Whisper
      // full-name string ("french") or undefined/"" for auto. Coerced to a
      // non-empty string else undefined so `language: languageParam` cleanly
      // means "detect" when unset. Safe pre-init (worker just stores it).
      languageParam =
        data.param && typeof data.param === "string" ? data.param : undefined;
      break;
    default:
      // ignore unknown
      break;
  }
};

// Surface any uncaught errors inside the worker — otherwise they vanish
// and look like a silent hang from the parent's perspective.
self.addEventListener("error", (e) => {
  self.postMessage({
    type: "error",
    message: `Worker uncaught error: ${e.message || String(e)}`,
  });
});
self.addEventListener("unhandledrejection", (e) => {
  const reason = e.reason;
  self.postMessage({
    type: "error",
    message: `Worker unhandled rejection: ${(reason && reason.message) || String(reason)}`,
  });
});
