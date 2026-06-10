/**
 * Parent-side proxy for the Whisper worker. Hides postMessage protocol behind
 * a Promise-based API + EventTarget-style callbacks.
 */

import { coerceWords, type Word } from "./word";

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

/**
 * v0.4.8 — richer result shape including per-word timing. This is the shape
 * v0.5 features (sentence-grouped .vtt, confidence-coloured live tail,
 * transcript editor) consume. Use {@link WhisperClient.transcribeWindow2}
 * to access it; the legacy {@link WhisperClient.transcribeWindow} continues
 * to return the text-only shape for callers that haven't migrated yet.
 *
 * `chunks` may be empty if the worker is running with an older
 * transformers.js version that doesn't honor return_timestamps:"word",
 * or if the audio window was silent. Consumers must handle [] gracefully.
 */
export interface WindowResult2 {
  text: string;
  chunks: Word[];
  durationMs: number;
}

/**
 * v0.5.1 — init options. `forceDevice: "wasm"` skips the WebGPU
 * adapter probe entirely. The parent passes this when isMobileDevice()
 * returns true: mobile WebGPU adapters are unreliable (Android Chrome
 * often returns null after a long timeout, iOS Safari has no WebGPU
 * support at all), and the silent 120s hang waiting for the adapter
 * looked indistinguishable from a page crash to mobile users.
 * Desktop callers can omit this field — WebGPU-first is always tried.
 */
export interface WhisperInitOptions {
  forceDevice?: "wasm";
}

export interface WhisperClient {
  init: (model?: string, opts?: WhisperInitOptions) => Promise<{ model: string; device: "webgpu" | "wasm" }>;
  /** Single-shot transcription. Returns text only (legacy v0.1 API). */
  transcribe: (audio: Float32Array) => Promise<string>;
  /** Streaming transcription. Returns text + wall-clock inference duration. */
  transcribeWindow: (audio: Float32Array) => Promise<WindowResult>;
  /**
   * v0.4.8 — streaming transcription with per-word timing. Parallel API to
   * {@link transcribeWindow} that exposes the new richer shape. The two
   * methods share the same underlying worker call — calling either incurs
   * exactly one decode (no double work).
   */
  transcribeWindow2: (audio: Float32Array) => Promise<WindowResult2>;
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

/**
 * v0.5.1 — mobile-specific default model. Mobile devices (especially
 * mid-range Android + iOS Safari) have a much tighter JS heap budget
 * than desktop browsers — typically 1.5-2 GB total, with WebKit's
 * jetsam killing tabs that exceed ~70% of physical RAM. The default
 * `base` (74 MB) model + transformers.js runtime + ONNX/WASM workspace
 * routinely pushes a 4 GB iPhone into the kill zone within seconds of
 * starting capture. `tiny` (39 MB) leaves enough headroom for the
 * pipeline AND the audio rolling buffer to coexist safely.
 *
 * Used only when the user has NOT explicitly set a model preference —
 * if they pick base/small/large-turbo in the model picker we honour it
 * (with a one-time "this might be heavy on mobile" warning shown in
 * the support-warn banner). Stored under the same MODEL_PREF_KEY so
 * desktop ↔ mobile devices syncing prefs respect the user's pick.
 */
export const MOBILE_DEFAULT_MODEL_ID: ModelSpec["id"] = "tiny";

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
  // v0.4.8 — pending always stores the full rich payload (WindowResult2).
  // The legacy transcribeWindow() API just strips chunks before returning.
  // This means a single worker decode services both APIs (no double work)
  // and we don't need a discriminator on the pending entry.
  const pending = new Map<
    number,
    { resolve: (r: WindowResult2) => void; reject: (e: Error) => void }
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
            chunks: coerceWords(data.chunks),
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
    init(model = "onnx-community/whisper-base", opts?: WhisperInitOptions) {
      return new Promise((resolve, reject) => {
        initResolve = resolve;
        initReject = reject;
        // v0.5.1: forward forceDevice. The worker handles both legacy
        // (no opts) and v0.5.1 callers — undefined forceDevice means
        // "try WebGPU first" (default desktop behaviour).
        worker.postMessage({
          type: "init",
          model,
          forceDevice: opts?.forceDevice,
        });
      });
    },
    async transcribe(audio: Float32Array): Promise<string> {
      const r = await client.transcribeWindow(audio);
      return r.text;
    },
    async transcribeWindow(audio: Float32Array): Promise<WindowResult> {
      // Legacy text-only API — implemented on top of transcribeWindow2 so
      // both share a single worker call. Callers that don't need chunks
      // pay no cost beyond the postMessage discard of the extra array.
      const r = await client.transcribeWindow2(audio);
      return { text: r.text, durationMs: r.durationMs };
    },
    transcribeWindow2(audio: Float32Array) {
      return new Promise<WindowResult2>((resolve, reject) => {
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
