/**
 * AudioWorklet processor for LiveCaptionIt capture pipeline.
 * v0.4.1: replaces the deprecated ScriptProcessorNode.
 *
 * Lives in /public/ (not bundled) so the browser loads it as a separate
 * module via `audioWorklet.addModule()`. AudioWorklet code runs in its
 * own realm with NO access to ES imports — must be standalone JS.
 *
 * Behavior contract (matches the old ScriptProcessor wiring exactly so
 * downstream consumers — RollingBuffer, agreement.ts, worker — are
 * blind to the migration):
 *
 *   - Receives audio at the AudioContext's native sample rate
 *     (typically 16kHz on our requested context, occasionally higher
 *     if browser refuses the rate).
 *   - process() is invoked every 128 samples (~2.7ms at 48k, ~8ms at
 *     16k). Posting per-frame would be ~125-375 msg/sec — wasteful.
 *   - We accumulate internally to FRAME_SIZE (4096 samples, same as
 *     the old PROCESSOR_BUF) and post that to the main thread. Yields
 *     ~4-11 msg/sec depending on context rate.
 *   - Each post is a freshly-allocated Float32Array transferred to
 *     the main thread (zero-copy). Reusing the internal buffer would
 *     be a data race — the audio thread overwrites it the next process()
 *     tick.
 *
 * Why accumulate here instead of on the main thread:
 *   - Less inter-thread message overhead (the main thread's tick
 *     scheduler can stay fully decoupled from the audio block size).
 *   - Pause/resume via AudioContext.suspend() naturally freezes
 *     accumulation — no half-frame edge cases on resume because
 *     process() simply isn't called while suspended.
 *
 * Manual 16kHz resampling (when ctx.sampleRate !== 16000) is still
 * done in the main-thread message handler, not here — keeps the
 * worklet simple and the resample logic in TypeScript where it's
 * unit-testable in principle.
 */

const FRAME_SIZE = 4096;

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = new Float32Array(FRAME_SIZE);
    this._pos = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input || input.length === 0) {
      // No input attached or first warm-up frame; keep processor alive.
      return true;
    }

    let i = 0;
    while (i < input.length) {
      const remaining = FRAME_SIZE - this._pos;
      const take = Math.min(remaining, input.length - i);
      this._buf.set(input.subarray(i, i + take), this._pos);
      this._pos += take;
      i += take;

      if (this._pos === FRAME_SIZE) {
        // Allocate a fresh buffer for transfer — internal _buf will be
        // overwritten on the next audio block.
        const out = new Float32Array(this._buf);
        this.port.postMessage(out, [out.buffer]);
        this._pos = 0;
      }
    }

    // Return true to keep the processor node alive across audio ticks.
    return true;
  }
}

registerProcessor("capture-processor", CaptureProcessor);
