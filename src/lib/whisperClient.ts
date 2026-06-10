/**
 * Parent-side proxy for the Whisper worker. Hides postMessage protocol behind
 * a Promise-based API + EventTarget-style callbacks.
 */

export type WhisperStatus =
  | { type: "idle" }
  | { type: "loading"; message: string; progress?: number }
  | { type: "ready"; model: string; device: "webgpu" | "wasm" }
  | { type: "error"; message: string };

export interface WindowResult {
  text: string;
  /** Wall-clock inference time in ms — used by the parent to adapt tick rate. */
  durationMs: number;
}

export interface WhisperClient {
  init: (model?: string) => Promise<{ model: string; device: "webgpu" | "wasm" }>;
  /** Single-shot transcription. Returns text only (legacy v0.1 API). */
  transcribe: (audio: Float32Array) => Promise<string>;
  /** Streaming transcription. Returns text + wall-clock inference duration. */
  transcribeWindow: (audio: Float32Array) => Promise<WindowResult>;
  /** v0.4.3 — bias decoder toward custom vocabulary. Pass an empty
   *  string to clear. Capped at 200 chars worker-side. Safe to call
   *  before init() or mid-session. */
  setVocabulary: (text: string) => void;
  dispose: () => void;
  onStatus: (cb: (s: WhisperStatus) => void) => void;
}

// ────────────────────────────────────────────────────────────────────────
// Model catalog
// ────────────────────────────────────────────────────────────────────────

export interface ModelSpec {
  /** Short key used in UI + localStorage. */
  id: "tiny" | "base" | "small" | "large-turbo";
  /** User-facing label (capitalised). */
  label: string;
  /** Hugging Face model ID. ALL must be onnx-community/* so dtype variants
   *  exist for our WebGPU encoder=fp32 / decoder=q4 config. Using the
   *  Xenova/* port silently hangs (see livecaptionit-project skill notes). */
  hfId: string;
  /** Approximate download size — shown in UI to set expectations. */
  sizeMb: number;
  /** Relative speed multiplier vs base (1.0). Higher = faster. */
  relSpeed: number;
  /** One-line UX hint. */
  hint: string;
  /** v0.4.3: flag for the large tier so UI can show a size warning gate. */
  large?: boolean;
}

export const AVAILABLE_MODELS: ModelSpec[] = [
  {
    id: "tiny",
    label: "Tiny",
    hfId: "onnx-community/whisper-tiny",
    sizeMb: 39,
    relSpeed: 2.0,
    hint: "Fastest. Lowest accuracy — best for clean English.",
  },
  {
    id: "base",
    label: "Base",
    hfId: "onnx-community/whisper-base",
    sizeMb: 74,
    relSpeed: 1.0,
    hint: "Default. Balanced speed and accuracy.",
  },
  {
    id: "small",
    label: "Small",
    hfId: "onnx-community/whisper-small",
    sizeMb: 244,
    relSpeed: 0.5,
    hint: "Best accuracy. Slower + bigger first-time download.",
  },
  {
    id: "large-turbo",
    label: "Large turbo",
    hfId: "onnx-community/whisper-large-v3-turbo",
    sizeMb: 537,
    relSpeed: 0.35,
    hint: "Top-tier accuracy. ½GB download — first load only, cached after.",
    large: true,
  },
];

export const DEFAULT_MODEL_ID: ModelSpec["id"] = "base";

export function modelById(id: string): ModelSpec {
  return AVAILABLE_MODELS.find((m) => m.id === id) || AVAILABLE_MODELS[1];
}

/**
 * Best-effort check: is this model's primary weight file already cached
 * in the browser's Cache Storage by transformers.js? Cheap (no network),
 * lets us mark "✓ ready" vs "⬇ N MB" in the picker. False negatives are
 * fine — worst case the user sees the download bar they'd have seen anyway.
 *
 * transformers.js v3 caches under the "transformers-cache" Cache name,
 * with keys like:
 *   https://huggingface.co/{hfId}/resolve/main/onnx/encoder_model.onnx
 * We probe for the encoder_model file specifically — if that exists, the
 * model is effectively cached (decoder + tokenizer come together in our
 * pipeline call).
 */
export async function isModelCached(hfId: string): Promise<boolean> {
  if (typeof caches === "undefined") return false;
  try {
    const cache = await caches.open("transformers-cache");
    const probe = `https://huggingface.co/${hfId}/resolve/main/onnx/encoder_model.onnx`;
    const hit = await cache.match(probe);
    return !!hit;
  } catch {
    return false;
  }
}

let _nextId = 1;

export function createWhisperClient(workerUrl = "/whisper-worker.js"): WhisperClient {
  const worker = new Worker(workerUrl, { type: "module" });

  let statusCb: ((s: WhisperStatus) => void) | null = null;
  let initResolve: ((r: { model: string; device: "webgpu" | "wasm" }) => void) | null = null;
  let initReject: ((e: Error) => void) | null = null;
  const pending = new Map<
    number,
    { resolve: (r: WindowResult) => void; reject: (e: Error) => void }
  >();

  worker.onerror = (e) => {
    statusCb?.({ type: "error", message: `Worker error: ${e.message}` });
  };

  worker.onmessage = (e: MessageEvent) => {
    const data = e.data || {};
    switch (data.type) {
      case "loading":
        statusCb?.({ type: "loading", message: data.message, progress: data.progress });
        break;
      case "ready":
        statusCb?.({ type: "ready", model: data.model, device: data.device });
        initResolve?.({ model: data.model, device: data.device });
        initResolve = null;
        initReject = null;
        break;
      case "result": {
        const id = data.id as number | undefined;
        if (id !== undefined && pending.has(id)) {
          pending.get(id)!.resolve({
            text: data.text ?? "",
            durationMs: typeof data.durationMs === "number" ? data.durationMs : 0,
          });
          pending.delete(id);
        }
        break;
      }
      case "error": {
        const err = new Error(data.message ?? "Worker error");
        statusCb?.({ type: "error", message: err.message });
        if (initReject) {
          initReject(err);
          initResolve = null;
          initReject = null;
        }
        // Reject any pending transcriptions on error
        pending.forEach((p) => p.reject(err));
        pending.clear();
        break;
      }
    }
  };

  const client: WhisperClient = {
    init(model = "onnx-community/whisper-base") {
      return new Promise((resolve, reject) => {
        initResolve = resolve;
        initReject = reject;
        worker.postMessage({ type: "init", model });
      });
    },
    async transcribe(audio: Float32Array): Promise<string> {
      const r = await client.transcribeWindow(audio);
      return r.text;
    },
    transcribeWindow(audio: Float32Array) {
      return new Promise<WindowResult>((resolve, reject) => {
        const id = _nextId++;
        pending.set(id, { resolve, reject });
        // Transferable: surrender ownership of buffer to worker for zero-copy
        worker.postMessage({ type: "transcribe", audio, id }, [audio.buffer]);
      });
    },
    setVocabulary(text: string) {
      worker.postMessage({ type: "setVocabulary", text });
    },
    dispose() {
      worker.postMessage({ type: "dispose" });
      worker.terminate();
      pending.clear();
    },
    onStatus(cb) {
      statusCb = cb;
    },
  };

  return client;
}
