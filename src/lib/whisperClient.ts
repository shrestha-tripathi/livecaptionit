/**
 * Parent-side proxy for the Whisper worker. Hides postMessage protocol behind
 * a Promise-based API + EventTarget-style callbacks.
 */

export type WhisperStatus =
  | { type: "idle" }
  | { type: "loading"; message: string; progress?: number }
  | { type: "ready"; model: string; device: "webgpu" | "wasm" }
  | { type: "error"; message: string };

export interface WhisperClient {
  init: (model?: string) => Promise<{ model: string; device: "webgpu" | "wasm" }>;
  transcribe: (audio: Float32Array) => Promise<string>;
  dispose: () => void;
  onStatus: (cb: (s: WhisperStatus) => void) => void;
}

let _nextId = 1;

export function createWhisperClient(workerUrl = "/whisper-worker.js"): WhisperClient {
  const worker = new Worker(workerUrl, { type: "module" });

  let statusCb: ((s: WhisperStatus) => void) | null = null;
  let initResolve: ((r: { model: string; device: "webgpu" | "wasm" }) => void) | null = null;
  let initReject: ((e: Error) => void) | null = null;
  const pending = new Map<number, { resolve: (s: string) => void; reject: (e: Error) => void }>();

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
          pending.get(id)!.resolve(data.text ?? "");
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

  return {
    init(model = "Xenova/whisper-base") {
      return new Promise((resolve, reject) => {
        initResolve = resolve;
        initReject = reject;
        worker.postMessage({ type: "init", model });
      });
    },
    transcribe(audio: Float32Array) {
      return new Promise<string>((resolve, reject) => {
        const id = _nextId++;
        pending.set(id, { resolve, reject });
        // Transferable: surrender ownership of buffer to worker for zero-copy
        worker.postMessage({ type: "transcribe", audio, id }, [audio.buffer]);
      });
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
}
