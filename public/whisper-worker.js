// CaptionPip — Whisper transcription worker.
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
//             { type: "result", text: string, id?: number, durationMs: number }
//             { type: "error", message: string }

import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5/dist/transformers.min.js";

env.allowLocalModels = false;
env.useBrowserCache = true;

let asr = null;
let currentModel = "";

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
        dtype: {
          encoder_model: "fp32",
          decoder_model_merged: "q4",
        },
        progress_callback,
      }),
      120_000,
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
  try {
    asr = await withTimeout(
      pipeline("automatic-speech-recognition", model, {
        device: "wasm",
        progress_callback,
      }),
      180_000,
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
      return_timestamps: false,
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
    });
    const text = (result && result.text ? result.text : "").trim();
    const durationMs = Math.round(performance.now() - start);
    self.postMessage({ type: "result", text, id, durationMs });
  } catch (e) {
    self.postMessage({ type: "error", message: (e && e.message) || String(e) });
  }
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
