/**
 * Sample feed — plays a bundled MP3 through the same audio pipeline used
 * for live capture. Lets first-time visitors see captions stream in within
 * ~2-3s WITHOUT triggering any browser permission prompts.
 *
 * The bundled file lives at `public/sample.mp3`. It's pre-encoded as
 * mono 16kHz, ~25s of clear English narration, ~190 KB on the wire.
 *
 * Design contract: we never bypass the real pipeline. The decoded samples
 * are fed through the same RollingBuffer + tick scheduler used for live
 * `getDisplayMedia` / `getUserMedia` capture. The sample plays through
 * the user's speakers via a hidden `<audio>` element in sync, so the
 * user HEARS what's being transcribed.
 */
export type SampleFeedHandle = {
  /** Stop feeding samples + pause audio. Idempotent. */
  stop: () => void;
  /** Returns true if the feed is currently running. */
  isActive: () => boolean;
};

export type SampleFeedCallbacks = {
  /** Fired for every audio frame (~80ms). Same contract as audioCapture's onAudio. */
  onAudio: (samples: Float32Array) => void;
  /** Fired periodically (~10Hz). RMS level 0..1. Same contract as audioCapture's onLevel. */
  onLevel: (rms: number) => void;
  /** Fired when sample finishes (or errors). */
  onEnded: () => void;
};

/**
 * Frame size for audio chunks pushed into the pipeline. Matches the
 * default block size of AudioContext.createScriptProcessor and the
 * actual production capture path (4096 samples at 48kHz on most browsers).
 *
 * At 16kHz, 1280 samples = 80ms — close enough to the production cadence
 * that the rolling-buffer + tick scheduler behave identically.
 */
const FRAME_SAMPLES_16K = 1280;

/**
 * Compute RMS over a sample buffer. Pure function (same math as
 * audioCapture.ts level-meter for parity).
 */
export function computeRms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    sumSquares += s * s;
  }
  return Math.sqrt(sumSquares / samples.length);
}

/**
 * Split a long sample array into FRAME_SAMPLES_16K chunks.
 * Used for unit tests AND the runtime feeder.
 */
export function chunkSamples(
  samples: Float32Array,
  frameSize: number = FRAME_SAMPLES_16K,
): Float32Array[] {
  const chunks: Float32Array[] = [];
  for (let i = 0; i < samples.length; i += frameSize) {
    // Always copy into a fresh allocation — the consumer (RollingBuffer)
    // assumes it owns the buffer. Same gotcha as audioCapture.ts's
    // `new Float32Array(input)` pattern around onaudioprocess.
    const end = Math.min(i + frameSize, samples.length);
    chunks.push(new Float32Array(samples.subarray(i, end)));
  }
  return chunks;
}

/**
 * Resample mono PCM from any source rate to 16 kHz via linear interpolation.
 * Whisper expects 16 kHz mono input. Identical algorithm to audioCapture.ts's
 * inline downsampler — extracted for reuse.
 */
export function resampleTo16k(
  input: Float32Array,
  sourceRate: number,
): Float32Array {
  if (sourceRate === 16000) return input;
  const ratio = sourceRate / 16000;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, input.length - 1);
    const frac = srcIndex - srcIndexFloor;
    output[i] = input[srcIndexFloor] * (1 - frac) + input[srcIndexCeil] * frac;
  }
  return output;
}

/**
 * Load + decode the sample MP3, then feed it through the pipeline in
 * real time while simultaneously playing through speakers.
 *
 * The `audioEl` is the hidden `<audio>` element from the host page —
 * we set its `src`, play it, and listen for `ended`. The decoded
 * samples are pushed via `onAudio` at real-time pace (setInterval at
 * frame duration) so the captions appear in step with playback.
 *
 * @param audioEl Hidden audio element that plays sample through speakers
 * @param audioContext Shared AudioContext — for decoding only
 * @param fetchUrl Sample MP3 URL (default: "/sample.mp3")
 * @param callbacks onAudio / onLevel / onEnded
 * @returns Handle for early stop
 */
export async function playSampleThroughPipeline(
  audioEl: HTMLAudioElement,
  audioContext: AudioContext,
  fetchUrl: string,
  callbacks: SampleFeedCallbacks,
): Promise<SampleFeedHandle> {
  const { onAudio, onLevel, onEnded } = callbacks;

  // 1. Fetch + decode the sample
  const resp = await fetch(fetchUrl);
  if (!resp.ok) {
    throw new Error(
      `sampleFeed: fetch failed ${resp.status} ${resp.statusText}`,
    );
  }
  const arrayBuffer = await resp.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  // 2. Extract mono 16kHz Float32 samples
  const mono = mergeToMono(audioBuffer);
  const samples16k = resampleTo16k(mono, audioBuffer.sampleRate);
  const chunks = chunkSamples(samples16k);

  // 3. Configure the audio element to play
  audioEl.src = fetchUrl;
  audioEl.currentTime = 0;
  // Hide the element from screen readers; we describe it inline in the page
  audioEl.setAttribute("aria-hidden", "true");

  let active = true;
  let chunkIdx = 0;
  let timer: number | null = null;

  const frameDurationMs = (FRAME_SAMPLES_16K / 16000) * 1000;

  const tick = () => {
    if (!active) return;
    if (chunkIdx >= chunks.length) {
      stop();
      onEnded();
      return;
    }
    const chunk = chunks[chunkIdx++];
    onAudio(chunk);
    // Cheap level approximation (~10Hz instead of every frame to mirror
    // audioCapture's level cadence)
    if (chunkIdx % 2 === 0) {
      onLevel(computeRms(chunk));
    }
  };

  const stop = () => {
    if (!active) return;
    active = false;
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    try {
      audioEl.pause();
      audioEl.removeAttribute("src");
      audioEl.load();
    } catch {
      /* ignore — we're tearing down */
    }
  };

  // 4. Start playback and feed simultaneously
  try {
    await audioEl.play();
  } catch (err) {
    stop();
    throw new Error(
      `sampleFeed: audio.play() failed (autoplay policy?): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  audioEl.addEventListener(
    "ended",
    () => {
      stop();
      onEnded();
    },
    { once: true },
  );

  timer = window.setInterval(tick, frameDurationMs);

  return {
    stop,
    isActive: () => active,
  };
}

/** Sum (or copy) AudioBuffer channels to mono. */
function mergeToMono(buffer: AudioBuffer): Float32Array {
  const len = buffer.length;
  const mono = new Float32Array(len);
  if (buffer.numberOfChannels === 1) {
    mono.set(buffer.getChannelData(0));
    return mono;
  }
  // Average all channels
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }
  for (let i = 0; i < len; i++) {
    let sum = 0;
    for (let c = 0; c < channels.length; c++) sum += channels[c][i];
    mono[i] = sum / channels.length;
  }
  return mono;
}
