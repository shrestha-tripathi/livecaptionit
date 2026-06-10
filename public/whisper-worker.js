// LiveCaptionIt — Whisper transcription worker.
//
// Runs in a Web Worker spawned by src/lib/whisperClient.ts.
// Loads transformers.js from CDN (jsDelivr ESM) so we don't bundle the ~15MB
// runtime ourselves. The actual Whisper model is downloaded lazily from
// Hugging Face Hub and cached in browser IndexedDB.
//
// IMPORTANT: model choice
//   We use onnx-community/whisper-base — NOT Xenova/whisper-base.
//   The onnx-community port ships every dtype variant (fp32, fp16, q4, q8)
//   so per-component WebGPU dtypes "just work". The Xenova port only has
//   fp32 + quantized, so dtype: "fp16" silently hangs (404 on a file the
//   library waits for forever). This matches Xenova's realtime-whisper-webgpu
//   reference demo configuration.
//
// Message protocol:
//   incoming: { type: "init", model?: string }
//             { type: "transcribe", audio: Float32Array, id?: number }
//             { type: "dispose" }
//   outgoing: { type: "loading", message: string, progress?: number }
//             { type: "ready", model: string, device: "webgpu" | "wasm" }
//             { type: "result", text: string, chunks: Word[], id?: number, durationMs: number }
//             { type: "error", message: string }
//
// Word: { text: string, tStartMs: number, tEndMs: number }
//   Per-word timing emitted by transformers.js when return_timestamps:"word"
//   is set (v0.4.8+). Downstream consumers may ignore `chunks` and read only
//   `text` to preserve v0.4.3- behaviour during incremental migration.

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

// Default model — onnx-community port has all dtype variants.
const DEFAULT_MODEL = "onnx-community/whisper-base";

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

async function init(model = DEFAULT_MODEL) {
  if (asr && currentModel === model) {
    self.postMessage({ type: "ready", model: currentModel, device: "webgpu" });
    return;
  }
  currentModel = model;
  const progress_callback = buildProgressCallback();

  // v0.4.3 — model-aware dtype selection.
  // tiny/base/small: encoder fp32 + decoder q4 (proven config from the
  //   reference realtime-whisper-webgpu demo — fast, high quality)
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

  // Try WebGPU first — fastest path. Per-component dtype matches the
  // realtime-whisper-webgpu reference demo.
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

  // WASM fallback — uses default q8 quantization, works everywhere.
  // For large-v3-turbo, bump WASM timeout to 360s — large model on
  // CPU WASM is slow to load (3-5 minutes on lower-end machines).
  try {
    asr = await withTimeout(
      pipeline("automatic-speech-recognition", model, {
        device: "wasm",
        progress_callback,
      }),
      isLargeTurbo ? 360_000 : 180_000,
      "WASM model load (slower than WebGPU)",
    );
    self.postMessage({ type: "ready", model: currentModel, device: "wasm" });
  } catch (wasmErr) {
    self.postMessage({
      type: "error",
      message:
        "Both WebGPU and WASM pipeline init failed. " +
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
    const result = await asr(audio, {
      chunk_length_s: 30,
      stride_length_s: 5,
      // v0.4.8 — flipped from `false` to `"word"`. transformers.js now
      // returns `{ text, chunks: [{ text, timestamp: [tStartSec, tEndSec] }] }`
      // where each chunk corresponds to a Whisper-tokenized word. Adds
      // ~5-15% to decode time; adaptive-tick logic on the parent absorbs
      // the variance. Downstream code that only needs text reads
      // `result.text` (unchanged shape); v0.5 features read `result.chunks`.
      return_timestamps: "word",
      language: "english",
      task: "transcribe",
      // Streaming-friendly decode: greedy + deterministic so the
      // LocalAgreement-2 algorithm on the parent side can detect
      // consistent prefixes across overlapping windows. Random or
      // beam sampling would produce different text on identical input
      // and never trigger a commit.
      num_beams: 1,
      temperature: 0,
      // Anti-music-hallucination: Whisper has a known failure mode on
      // rhythmic vocal audio where it locks onto a 2-3 word phrase and
      // emits it 4-8 times in a row ("of thug of thug of thug ..." on
      // music with sustained vocals). no_repeat_ngram_size forces the
      // decoder to not emit any trigram that already appeared in the
      // output — kills the pattern at decode time so we don't have to
      // clean it up downstream. Set to 3 because:
      //   - 2 is too aggressive (real speech repeats bigrams: "of the",
      //     "and the", "in the" appear multiple times naturally)
      //   - 4+ doesn't catch the "of thug" case
      //   - 3 catches lyric loops without breaking natural speech.
      // Belt-and-suspenders: a downstream looksHallucinated() filter in
      // CaptionApp.script.ts still scans for residual patterns in case
      // the decoder slips one past.
      no_repeat_ngram_size: 3,
      // v0.4.3 — vocabulary biasing. transformers.js accepts an
      // `initial_prompt` string and tokenizes it internally before
      // each transcribe call. Empty string = noop. We always pass
      // it (even when empty) for shape consistency.
      initial_prompt: vocabularyPrompt || undefined,
    });
    const text = (result && result.text ? result.text : "").trim();
    const chunks = extractWordChunks(result);
    const durationMs = Math.round(performance.now() - start);
    self.postMessage({ type: "result", text, chunks, id, durationMs });
  } catch (e) {
    self.postMessage({ type: "error", message: (e && e.message) || String(e) });
  }
}

// Convert transformers.js word-timestamped output into our Word[] shape.
// Defensive against the known edge cases:
//   - `chunks` may be undefined entirely (older transformers.js versions
//     that ignore return_timestamps:"word" — silently fall back to empty)
//   - A chunk's `timestamp` may be `[start, null]` or `null` (tail tokens
//     when audio ends mid-word). Use previous chunk's end or 0.
//   - Whisper sometimes emits zero-width chunks (`tStart === tEnd`).
//     Keep them — agreement still works on the text; trimming would
//     break index alignment.
// Returns Word[] in worker-payload shape: tStartMs/tEndMs (ms, integer).
function extractWordChunks(result) {
  if (!result || !Array.isArray(result.chunks)) return [];
  const out = [];
  let prevEndMs = 0;
  for (const c of result.chunks) {
    if (!c || typeof c.text !== "string") continue;
    const ts = c.timestamp;
    let tStartSec = Array.isArray(ts) && typeof ts[0] === "number" ? ts[0] : null;
    let tEndSec = Array.isArray(ts) && typeof ts[1] === "number" ? ts[1] : null;
    const tStartMs = tStartSec !== null ? Math.round(tStartSec * 1000) : prevEndMs;
    const tEndMs = tEndSec !== null ? Math.round(tEndSec * 1000) : tStartMs;
    out.push({ text: c.text, tStartMs, tEndMs });
    prevEndMs = tEndMs;
  }
  return out;
}

self.onmessage = async (e) => {
  const data = e.data || {};
  switch (data.type) {
    case "init":
      await init(data.model);
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
