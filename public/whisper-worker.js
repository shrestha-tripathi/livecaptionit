// CaptionPip — Whisper transcription worker.
//
// Runs in a Web Worker spawned by src/lib/whisperClient.ts.
// Loads transformers.js from CDN (jsDelivr ESM) so we don't bundle the ~15MB
// runtime ourselves. The actual Whisper model is downloaded lazily from
// Hugging Face Hub and cached in browser IndexedDB.
//
// Message protocol:
//   incoming: { type: "init", model?: string }
//             { type: "transcribe", audio: Float32Array, id?: number }
//             { type: "dispose" }
//   outgoing: { type: "loading", message: string, progress?: number }
//             { type: "ready", model: string, device: "webgpu" | "wasm" }
//             { type: "result", text: string, id?: number }
//             { type: "error", message: string }

import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@latest/dist/transformers.min.js";

env.allowLocalModels = false;
env.useBrowserCache = true;

let asr = null;
let currentModel = "";

async function init(model = "Xenova/whisper-base") {
  if (asr && currentModel === model) {
    self.postMessage({ type: "ready", model: currentModel, device: "webgpu" });
    return;
  }
  currentModel = model;
  let device = "webgpu";
  try {
    asr = await pipeline("automatic-speech-recognition", model, {
      device: "webgpu",
      dtype: "fp16",
      progress_callback: (data) => {
        if (!data || data.status === "ready") return;
        const msg = data.file ? `${data.status} ${data.file}` : data.status;
        const progress =
          typeof data.progress === "number" ? data.progress / 100 : undefined;
        self.postMessage({ type: "loading", message: msg, progress });
      },
    });
  } catch (e) {
    // WebGPU may be missing or fail — fall back to WASM
    device = "wasm";
    self.postMessage({
      type: "loading",
      message: "WebGPU unavailable, falling back to WASM (will be ~3-5x slower).",
    });
    asr = await pipeline("automatic-speech-recognition", model, {
      device: "wasm",
      progress_callback: (data) => {
        if (!data || data.status === "ready") return;
        const msg = data.file ? `${data.status} ${data.file}` : data.status;
        const progress =
          typeof data.progress === "number" ? data.progress / 100 : undefined;
        self.postMessage({ type: "loading", message: msg, progress });
      },
    });
  }
  self.postMessage({ type: "ready", model: currentModel, device });
}

async function transcribe(audio, id) {
  if (!asr) {
    self.postMessage({ type: "error", message: "Worker not initialized." });
    return;
  }
  try {
    const result = await asr(audio, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false,
      language: "english", // v0.1 hardcoded; v0.2 makes it configurable
      task: "transcribe",
    });
    const text = (result && result.text ? result.text : "").trim();
    self.postMessage({ type: "result", text, id });
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
