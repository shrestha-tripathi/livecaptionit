/**
 * Audio capture: getDisplayMedia (video required by API, video track dropped
 * immediately) + AudioContext piping into 16kHz mono Float32 buffers,
 * chunked at CHUNK_SECONDS for Whisper.
 *
 * Caller subscribes to `onChunk` and receives one Float32Array per chunk.
 * Stop the capture via the returned `stop()` function — releases mic/tab
 * permission AND closes AudioContext to free resources.
 */

export const TARGET_SAMPLE_RATE = 16_000;
export const CHUNK_SECONDS = 3;

export interface CaptureHandle {
  stop: () => void;
  hasAudio: boolean;
  sourceLabel: string;
}

export interface CaptureOptions {
  onChunk: (audio: Float32Array) => void;
  onLevel?: (rms: number) => void; // optional mic-level/audio-level meter
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
    // Stop audio tracks too so we don't leave anything dangling
    audioTracks.forEach((t) => t.stop());
    throw new Error(
      "No audio in the picked source. Make sure you tick 'Share tab audio' in the picker. macOS users: system audio outside the browser isn't capturable.",
    );
  }

  // Step 3: pipe into AudioContext at 16kHz mono (Whisper's native rate)
  const ctx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
  // If browser refuses 16kHz (some do), we'll resample manually. Check:
  const ctxRate = ctx.sampleRate;
  const needManualResample = ctxRate !== TARGET_SAMPLE_RATE;

  const audioStream = new MediaStream(audioTracks);
  const source = ctx.createMediaStreamSource(audioStream);

  // Mix to mono
  const merger = ctx.createChannelMerger(1);
  source.connect(merger);

  // Chunker: accumulate samples until CHUNK_SECONDS worth, then dispatch
  const chunkSamples = CHUNK_SECONDS * TARGET_SAMPLE_RATE;
  let buffer = new Float32Array(chunkSamples);
  let bufferPos = 0;

  // ScriptProcessor is deprecated but universally supported; AudioWorklet
  // upgrade is a v0.2 refactor.
  const PROCESSOR_BUF = 4096;
  const processor = ctx.createScriptProcessor(PROCESSOR_BUF, 1, 1);

  let lastLevelTs = 0;

  processor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);

    // Optional manual downsample (linear) if ctx.sampleRate didn't match 16kHz
    let processed: Float32Array;
    if (needManualResample) {
      const ratio = ctxRate / TARGET_SAMPLE_RATE;
      const newLen = Math.floor(input.length / ratio);
      processed = new Float32Array(newLen);
      for (let i = 0; i < newLen; i++) {
        processed[i] = input[Math.floor(i * ratio)];
      }
    } else {
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

    // Append to chunk buffer
    let off = 0;
    while (off < processed.length) {
      const space = buffer.length - bufferPos;
      const take = Math.min(space, processed.length - off);
      buffer.set(processed.subarray(off, off + take), bufferPos);
      bufferPos += take;
      off += take;

      if (bufferPos >= chunkSamples) {
        const chunk = buffer;
        buffer = new Float32Array(chunkSamples);
        bufferPos = 0;
        try {
          opts.onChunk(chunk);
        } catch (err) {
          opts.onError(err as Error);
        }
      }
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
