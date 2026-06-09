/**
 * Audio capture: getDisplayMedia (video required by API, video track dropped
 * immediately) + AudioContext piping into a continuous stream of 16kHz mono
 * Float32 samples.
 *
 * v0.1.2 streaming mode: the caller subscribes to `onAudio` and receives
 * ~80ms frames continuously. The parent buffers them in a RollingBuffer
 * (also exported from here) and runs its own tick scheduler to call the
 * Whisper worker. This replaces the v0.1 "chunk every 3 seconds" API.
 *
 * Stop the capture via the returned `stop()` function — releases mic/tab
 * permission AND closes AudioContext to free resources.
 */

export const TARGET_SAMPLE_RATE = 16_000;

// Rolling-window streaming constants (v0.1.2). See SPEC.md §1.2.5.
export const ROLLING_MAX_SECONDS = 15; // hard ceiling — buffer never grows past this
export const ROLLING_TARGET_SECONDS = 10; // soft target after trim
export const TICK_INTERVAL_MS = 600; // ~1.67 ticks/sec
export const MIN_AUDIO_SECONDS = 0.5; // don't transcribe until we have this much

export interface CaptureHandle {
  stop: () => void;
  hasAudio: boolean;
  sourceLabel: string;
}

export interface CaptureOptions {
  /** Called continuously with raw 16kHz mono samples (~80ms per callback). */
  onAudio: (samples: Float32Array) => void;
  onLevel?: (rms: number) => void; // optional audio-level meter
  onError: (err: Error) => void;
  onSourceEnded: () => void;
}

export async function startCapture(opts: CaptureOptions): Promise<CaptureHandle> {
  // Step 1: ask for screen+audio capture
  // selfBrowserSurface excludes our own tab from picker by default; user can override.
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
      // @ts-ignore — these options exist in Chrome but TS lib.dom may not type them
      preferCurrentTab: false,
      systemAudio: "include",
    });
  } catch (e) {
    throw new Error(
      (e as Error)?.message?.includes("Permission")
        ? "Permission denied — pick a tab/window and allow audio sharing to continue."
        : `Couldn't start capture: ${(e as Error).message}`,
    );
  }

  // Step 2: validate audio is actually present
  const audioTracks = stream.getAudioTracks();
  const videoTracks = stream.getVideoTracks();
  const hasAudio = audioTracks.length > 0;
  const sourceLabel = videoTracks[0]?.label || audioTracks[0]?.label || "selected source";

  // Always stop video tracks — we never need the pixels.
  videoTracks.forEach((t) => t.stop());

  if (!hasAudio) {
    audioTracks.forEach((t) => t.stop());
    throw new Error(
      "No audio in the picked source. Make sure you tick 'Share tab audio' in the picker. macOS users: system audio outside the browser isn't capturable.",
    );
  }

  // Step 3: pipe into AudioContext at 16kHz mono (Whisper's native rate)
  const ctx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
  const ctxRate = ctx.sampleRate;
  const needManualResample = ctxRate !== TARGET_SAMPLE_RATE;

  const audioStream = new MediaStream(audioTracks);
  const source = ctx.createMediaStreamSource(audioStream);

  // Mix to mono
  const merger = ctx.createChannelMerger(1);
  source.connect(merger);

  // ScriptProcessor is deprecated but universally supported; AudioWorklet
  // upgrade is a v0.2 refactor.
  const PROCESSOR_BUF = 4096;
  const processor = ctx.createScriptProcessor(PROCESSOR_BUF, 1, 1);

  let lastLevelTs = 0;

  processor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);

    // Optional manual downsample (linear) if ctx.sampleRate didn't match 16kHz.
    // Always allocates a fresh Float32Array we own, so it's safe to pass to
    // the rolling buffer or postMessage as transferable.
    let processed: Float32Array;
    if (needManualResample) {
      const ratio = ctxRate / TARGET_SAMPLE_RATE;
      const newLen = Math.floor(input.length / ratio);
      processed = new Float32Array(newLen);
      for (let i = 0; i < newLen; i++) {
        processed[i] = input[Math.floor(i * ratio)];
      }
    } else {
      // Copy because the input buffer is reused by Web Audio on the next callback.
      processed = new Float32Array(input);
    }

    // Level meter (RMS) — throttled to ~10 Hz
    if (opts.onLevel) {
      const now = performance.now();
      if (now - lastLevelTs > 100) {
        let sum = 0;
        for (let i = 0; i < processed.length; i++) sum += processed[i] * processed[i];
        opts.onLevel(Math.sqrt(sum / processed.length));
        lastLevelTs = now;
      }
    }

    try {
      opts.onAudio(processed);
    } catch (err) {
      opts.onError(err as Error);
    }
  };

  merger.connect(processor);
  processor.connect(ctx.destination);

  // Detect when user clicks browser's native "Stop sharing" button
  const onTrackEnded = () => opts.onSourceEnded();
  audioTracks.forEach((t) => t.addEventListener("ended", onTrackEnded));

  const stop = () => {
    audioTracks.forEach((t) => {
      t.removeEventListener("ended", onTrackEnded);
      t.stop();
    });
    try { processor.disconnect(); } catch {}
    try { merger.disconnect(); } catch {}
    try { source.disconnect(); } catch {}
    void ctx.close();
  };

  return { stop, hasAudio: true, sourceLabel };
}

// ────────────────────────────────────────────────────────────────────────
// RollingBuffer — 15-second sliding window of recent audio samples
// ────────────────────────────────────────────────────────────────────────

export interface RollingBuffer {
  /** Append samples to the buffer. Oldest data is dropped if cap exceeded. */
  append: (samples: Float32Array) => void;
  /** Get an owned copy of current buffer contents (caller may transfer). */
  snapshot: () => Float32Array;
  /** Drop the first N samples from the front (after agreement commits). */
  trimFront: (samples: number) => void;
  /** Current buffer length in samples. */
  length: () => number;
  /** Convenience: current buffer length in seconds at TARGET_SAMPLE_RATE. */
  durationSeconds: () => number;
  /** Empty the buffer (e.g. on stop or force-commit recovery). */
  reset: () => void;
}

export function createRollingBuffer(
  maxSamples = ROLLING_MAX_SECONDS * TARGET_SAMPLE_RATE,
): RollingBuffer {
  let buf: Float32Array = new Float32Array(0);

  return {
    append(samples) {
      if (samples.length === 0) return;
      const merged = new Float32Array(buf.length + samples.length);
      merged.set(buf, 0);
      merged.set(samples, buf.length);
      buf =
        merged.length > maxSamples
          ? new Float32Array(merged.subarray(merged.length - maxSamples))
          : merged;
    },
    snapshot() {
      return new Float32Array(buf);
    },
    trimFront(samples) {
      if (samples <= 0) return;
      if (samples >= buf.length) {
        buf = new Float32Array(0);
        return;
      }
      // Force a fresh allocation (no shared underlying ArrayBuffer) so the
      // worker's transferable from a prior snapshot doesn't haunt us.
      buf = new Float32Array(buf.subarray(samples));
    },
    length() {
      return buf.length;
    },
    durationSeconds() {
      return buf.length / TARGET_SAMPLE_RATE;
    },
    reset() {
      buf = new Float32Array(0);
    },
  };
}
