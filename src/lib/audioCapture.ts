/**
 * Audio capture: getDisplayMedia (video required by API, video track dropped
 * immediately) + AudioContext piping into a continuous stream of 16kHz mono
 * Float32 samples.
 *
 * v0.1.2 streaming mode: the caller subscribes to `onAudio` and receives
 * ~80ms frames continuously. The parent buffers them in a RollingBuffer
 * (also exported from here) and runs its own tick scheduler to call the
 * Whisper worker.
 *
 * v0.2.0 adds startMicCapture() — same pipeline but sourced from
 * getUserMedia(audio) instead of getDisplayMedia. For dictation /
 * voice notes / "caption your own speech" use cases. Audio constraints
 * disable echo cancellation + auto gain control so Whisper sees the
 * raw speech (browser-side AGC mangles the signal in ways the model
 * wasn't trained on).
 *
 * Stop the capture via the returned `stop()` function — releases mic/tab
 * permission AND closes AudioContext to free resources.
 */

export const TARGET_SAMPLE_RATE = 16_000;

// Rolling-window streaming constants (v0.1.2). See SPEC.md §1.2.5.
export const ROLLING_SOFT_CAP_SECONDS = 8; // force-commit + reset when over this
export const TICK_INTERVAL_MS = 700; // ~1.4 ticks/sec — leaves headroom for inference
export const MIN_AUDIO_SECONDS = 1.5; // wait for enough context before first tick

export interface CaptureHandle {
  stop: () => void;
  /**
   * v0.4.1: pause/resume the audio thread via AudioContext.suspend/resume.
   * Worklet's process() stops being invoked while suspended, so the
   * RollingBuffer freezes cleanly with no half-frame edge cases.
   * Safe to call regardless of current state — no-op if already paused/running.
   */
  pause: () => Promise<void>;
  resume: () => Promise<void>;
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

  // Step 3: pipe into AudioContext via shared helper
  return await wireAudioPipeline(audioTracks, sourceLabel, opts);
}

// ────────────────────────────────────────────────────────────────────────
// startMicCapture — microphone-only source via getUserMedia (v0.2.0)
// ────────────────────────────────────────────────────────────────────────

export async function startMicCapture(opts: CaptureOptions): Promise<CaptureHandle> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // Critical: disable browser-side speech processing. Whisper is
        // trained on raw audio; AGC + noise suppression mangle the signal
        // in ways that hurt accuracy (especially the "metallic" filter that
        // some browsers apply with echoCancellation: true).
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });
  } catch (e) {
    const msg = (e as Error)?.message || String(e);
    if (msg.includes("Permission") || msg.includes("denied")) {
      throw new Error(
        "Mic permission denied. Click the camera icon in the address bar to allow microphone access, then try again.",
      );
    }
    if (msg.includes("NotFound") || msg.includes("Requested device not found")) {
      throw new Error("No microphone detected. Plug one in (or check OS audio settings) and try again.");
    }
    throw new Error(`Couldn't start microphone: ${msg}`);
  }

  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) {
    throw new Error("Microphone returned no audio tracks. Check OS permissions.");
  }
  const sourceLabel = audioTracks[0].label || "Microphone";

  return await wireAudioPipeline(audioTracks, sourceLabel, opts);
}

// ────────────────────────────────────────────────────────────────────────
// wireAudioPipeline — shared AudioContext + AudioWorklet wiring used by
// both startCapture (display) and startMicCapture (microphone).
// Extracted in v0.2.0 to avoid duplication when adding the mic source.
// v0.4.1: migrated from deprecated ScriptProcessorNode to AudioWorklet.
// Also exposes pause() / resume() on the returned handle for Space
// pause/resume (uses AudioContext.suspend/resume — the worklet's
// process() simply stops being invoked while suspended, so the rolling
// buffer freezes cleanly with no half-frame edge cases).
// ────────────────────────────────────────────────────────────────────────

const WORKLET_MODULE_URL = "/audio-worklet-capture.js";

async function wireAudioPipeline(
  audioTracks: MediaStreamTrack[],
  sourceLabel: string,
  opts: CaptureOptions,
): Promise<CaptureHandle> {
  // Pipe into AudioContext at 16kHz mono (Whisper's native rate)
  const ctx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
  const ctxRate = ctx.sampleRate;
  const needManualResample = ctxRate !== TARGET_SAMPLE_RATE;

  const audioStream = new MediaStream(audioTracks);
  const source = ctx.createMediaStreamSource(audioStream);

  // Mix to mono
  const merger = ctx.createChannelMerger(1);
  source.connect(merger);

  // Load + instantiate the AudioWorklet processor. Module URL is served
  // from /public/ so CF Pages caches it with correct JS MIME.
  try {
    await ctx.audioWorklet.addModule(WORKLET_MODULE_URL);
  } catch (err) {
    // Tear down on failure so we don't leak an open AudioContext + tracks.
    audioTracks.forEach((t) => t.stop());
    void ctx.close();
    throw new Error(
      `Couldn't load audio worklet (${WORKLET_MODULE_URL}): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const workletNode = new AudioWorkletNode(ctx, "capture-processor");

  let lastLevelTs = 0;

  workletNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
    const input = e.data;

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
      // Worklet already transferred us an owned buffer — no copy needed.
      processed = input;
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

  merger.connect(workletNode);
  workletNode.connect(ctx.destination);

  // Detect when user clicks browser's native "Stop sharing" button
  const onTrackEnded = () => opts.onSourceEnded();
  audioTracks.forEach((t) => t.addEventListener("ended", onTrackEnded));

  const stop = () => {
    audioTracks.forEach((t) => {
      t.removeEventListener("ended", onTrackEnded);
      t.stop();
    });
    try { workletNode.port.onmessage = null; } catch {}
    try { workletNode.disconnect(); } catch {}
    try { merger.disconnect(); } catch {}
    try { source.disconnect(); } catch {}
    void ctx.close();
  };

  // v0.4.1: pause/resume via AudioContext.suspend/resume.
  // - suspend() stops the audio thread → worklet.process() no longer
  //   fires → no new frames flow → RollingBuffer freezes at current length.
  // - resume() resumes the audio thread → frames flow again naturally.
  // - State is read from ctx.state directly (no local mirror to drift).
  const pause = async () => {
    if (ctx.state === "running") {
      await ctx.suspend();
    }
  };

  const resume = async () => {
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
  };

  return { stop, pause, resume, hasAudio: true, sourceLabel };
}

// ────────────────────────────────────────────────────────────────────────
// RollingBuffer — 15-second sliding window of recent audio samples
// ────────────────────────────────────────────────────────────────────────

export interface RollingBuffer {
  /** Append samples to the buffer (append-only, never auto-trims). */
  append: (samples: Float32Array) => void;
  /** Get an owned copy of current buffer contents (caller may transfer). */
  snapshot: () => Float32Array;
  /** Drop the first N samples from the front (only used by reset/force-commit). */
  trimFront: (samples: number) => void;
  /** Current buffer length in samples. */
  length: () => number;
  /** Convenience: current buffer length in seconds at TARGET_SAMPLE_RATE. */
  durationSeconds: () => number;
  /** Has the buffer reached or exceeded the soft cap? Caller should force-commit + reset. */
  isOverCap: () => boolean;
  /** Empty the buffer (e.g. on stop or force-commit recovery). */
  reset: () => void;
}

export function createRollingBuffer(
  maxSamples = ROLLING_SOFT_CAP_SECONDS * TARGET_SAMPLE_RATE,
): RollingBuffer {
  // v0.5.1 — fixed-capacity ring buffer. Replaces the v0.1.2 append-only
  // Float32Array that re-allocated buf.length + samples.length bytes on
  // EVERY frame, producing O(n²) allocation churn that OOM-crashed mobile
  // (Android Chrome / iOS Safari) within ~5-15 seconds of mic capture.
  // The new implementation pre-allocates a single Float32Array sized to
  // `maxSamples`, treats it as a circular buffer with read/write cursors,
  // and exposes the same external API. Per-frame cost is now O(samples)
  // instead of O(total) — zero allocation after warmup. The 21 pre-v0.5.1
  // contract tests in this file pin the external behaviour; the 3 new
  // tests pin the v0.5.1 ring-buffer-specific behaviour (cap is hard,
  // overflow drops oldest, no memory growth past cap).

  if (maxSamples <= 0) {
    throw new Error("createRollingBuffer: maxSamples must be > 0");
  }

  // Pre-allocate once. We never reallocate the storage during the
  // buffer's lifetime — this is the whole point of the v0.5.1 fix.
  const storage = new Float32Array(maxSamples);
  // `head` = next write index (mod maxSamples).
  // `count` = current logical length (always <= maxSamples).
  // When count < maxSamples, logical samples occupy storage[0..count].
  // When count === maxSamples, logical samples occupy storage as a ring
  // starting at storage[(head) % maxSamples] reading forward modulo.
  let head = 0;
  let count = 0;

  /** Internal: linearize the ring contents into a new Float32Array.
   *  Used by snapshot() (consumer needs owned contiguous buffer) and
   *  conceptually by trimFront (we shift cursors instead of copying). */
  function readAll(): Float32Array {
    if (count === 0) return new Float32Array(0);
    const out = new Float32Array(count);
    if (count < maxSamples) {
      // Storage is still in linear-fill mode — first `count` samples
      // are contiguous from index 0.
      out.set(storage.subarray(0, count));
    } else {
      // Ring is full — `head` is the oldest sample. Read tail then head.
      const tail = maxSamples - head;
      out.set(storage.subarray(head, maxSamples), 0);
      out.set(storage.subarray(0, head), tail);
    }
    return out;
  }

  return {
    append(samples) {
      if (samples.length === 0) return;

      // Case 1: incoming frame is larger than capacity. Keep only its
      // last `maxSamples` samples, reset state to ring-full at head 0.
      if (samples.length >= maxSamples) {
        storage.set(samples.subarray(samples.length - maxSamples));
        head = 0;
        count = maxSamples;
        return;
      }

      // Case 2: there's still linear-fill room left (count + samples
      // fits in the first maxSamples slots, no wrap needed). Fast path.
      if (count + samples.length <= maxSamples) {
        storage.set(samples, count);
        count += samples.length;
        // head stays at 0 until the buffer first fills — when it does,
        // any subsequent overflow is handled by the ring case below.
        return;
      }

      // Case 3: write would overflow the cap. Conceptually we "drop the
      // oldest" samples to make room. In the ring representation that
      // means we advance `head` so the new write tail aligns. The first
      // time we hit this, we ALSO normalize state to "ring is full at
      // head" by physically reordering the existing contents so the
      // ring invariant (always-full once we've ever overflowed) is
      // maintained cleanly. This only happens once per buffer lifetime,
      // not per frame — amortized O(1) per overflow frame after.
      if (count < maxSamples) {
        // Promote to ring-full: shift existing samples so the OLDEST
        // samples-that-will-survive sit at index 0. The samples we keep
        // are storage[count + samples.length - maxSamples .. count].
        const keepStart = count + samples.length - maxSamples;
        const kept = storage.slice(keepStart, count);
        storage.set(kept, 0);
        storage.set(samples, kept.length);
        head = 0;
        count = maxSamples;
        return;
      }

      // Case 4: ring is already full. Write `samples` at the current
      // head, advancing head modulo cap. This may wrap mid-write.
      const firstChunk = Math.min(samples.length, maxSamples - head);
      storage.set(samples.subarray(0, firstChunk), head);
      if (firstChunk < samples.length) {
        storage.set(samples.subarray(firstChunk), 0);
      }
      head = (head + samples.length) % maxSamples;
      // count stays at maxSamples (still full).
    },

    snapshot() {
      // Always returns an OWNED Float32Array — caller may mutate or
      // transfer (postMessage). This is load-bearing: the Whisper
      // worker takes ownership via the transferList in
      // whisperClient.transcribeWindow2().
      return readAll();
    },

    trimFront(samples) {
      if (samples <= 0) return;
      if (samples >= count) {
        // Drop everything — reset cursor state instead of copying zeros.
        head = 0;
        count = 0;
        return;
      }
      if (count < maxSamples) {
        // Linear-fill mode — physically shift the tail forward. Costs
        // O(count - samples) but only happens on force-commit (rare).
        const remaining = count - samples;
        // copyWithin handles overlap correctly (memmove semantics).
        storage.copyWithin(0, samples, count);
        count = remaining;
        // head remains 0 (we're still in linear-fill mode).
      } else {
        // Ring-full mode — advance head + shrink count. No data copy.
        head = (head + samples) % maxSamples;
        count -= samples;
        // Once count drops below maxSamples we COULD re-linearize for
        // cheaper snapshots, but trimFront is followed almost always
        // by more appends; let the ring handle it.
      }
    },

    length() {
      return count;
    },

    durationSeconds() {
      return count / TARGET_SAMPLE_RATE;
    },

    isOverCap() {
      return count >= maxSamples;
    },

    reset() {
      head = 0;
      count = 0;
      // Don't zero `storage` — readAll() only ever reads up to `count`
      // valid samples; stale data past `count` is unreachable.
    },
  };
}
