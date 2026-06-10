/**
 * RollingBuffer tests — pins the external contract before the v0.5.1
 * O(n²)-allocation fix (capped ring buffer). All existing consumers
 * (audioCapture.ts, sampleFeed.ts, CaptionApp.script.ts) depend on
 * these behaviours; if any assertion below breaks, downstream tick
 * scheduling / Whisper inference / agreement state machine breaks
 * silently. The new implementation MUST pass all these unchanged.
 */
import { describe, it, expect } from "vitest";
import {
  createRollingBuffer,
  ROLLING_SOFT_CAP_SECONDS,
  TARGET_SAMPLE_RATE,
} from "./audioCapture";

const MAX_SAMPLES_DEFAULT = ROLLING_SOFT_CAP_SECONDS * TARGET_SAMPLE_RATE;

describe("createRollingBuffer", () => {
  describe("append + length + snapshot", () => {
    it("starts at length 0", () => {
      const buf = createRollingBuffer();
      expect(buf.length()).toBe(0);
      expect(buf.durationSeconds()).toBe(0);
      expect(buf.snapshot()).toEqual(new Float32Array(0));
    });

    it("appending grows the buffer", () => {
      const buf = createRollingBuffer();
      buf.append(new Float32Array([1, 2, 3]));
      expect(buf.length()).toBe(3);
      expect(Array.from(buf.snapshot())).toEqual([1, 2, 3]);
    });

    it("appending an empty frame is a no-op", () => {
      const buf = createRollingBuffer();
      buf.append(new Float32Array([1, 2]));
      buf.append(new Float32Array(0));
      expect(buf.length()).toBe(2);
      expect(Array.from(buf.snapshot())).toEqual([1, 2]);
    });

    it("multiple appends accumulate in order", () => {
      const buf = createRollingBuffer();
      buf.append(new Float32Array([1, 2]));
      buf.append(new Float32Array([3, 4, 5]));
      buf.append(new Float32Array([6]));
      expect(buf.length()).toBe(6);
      expect(Array.from(buf.snapshot())).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it("durationSeconds matches length / TARGET_SAMPLE_RATE", () => {
      const buf = createRollingBuffer();
      buf.append(new Float32Array(16_000)); // exactly 1 second
      expect(buf.durationSeconds()).toBe(1);
      buf.append(new Float32Array(8_000)); // +0.5s
      expect(buf.durationSeconds()).toBe(1.5);
    });
  });

  describe("snapshot ownership", () => {
    it("snapshot returns an OWNED Float32Array (mutating it does NOT corrupt the buffer)", () => {
      // This is load-bearing: the snapshot is transferred to the Whisper
      // worker via postMessage with a transferable. If snapshot returned
      // a view into the internal buffer, that transfer would detach the
      // internal buffer and trimFront() on the next tick would silently
      // no-op (we lose all queued audio).
      const buf = createRollingBuffer();
      buf.append(new Float32Array([10, 20, 30]));
      const snap = buf.snapshot();
      // Mutate snap directly
      snap[0] = 999;
      // Internal buffer must be unchanged
      const snap2 = buf.snapshot();
      expect(snap2[0]).toBe(10);
    });

    it("two snapshots in a row return independent arrays", () => {
      const buf = createRollingBuffer();
      buf.append(new Float32Array([1, 2, 3]));
      const a = buf.snapshot();
      const b = buf.snapshot();
      expect(a).not.toBe(b);
      expect(Array.from(a)).toEqual(Array.from(b));
    });

    it("snapshot followed by append leaves the snapshot's view unchanged", () => {
      const buf = createRollingBuffer();
      buf.append(new Float32Array([1, 2]));
      const snap = buf.snapshot();
      buf.append(new Float32Array([3, 4]));
      expect(Array.from(snap)).toEqual([1, 2]);
      expect(Array.from(buf.snapshot())).toEqual([1, 2, 3, 4]);
    });
  });

  describe("trimFront", () => {
    it("removes the first N samples", () => {
      const buf = createRollingBuffer();
      buf.append(new Float32Array([1, 2, 3, 4, 5]));
      buf.trimFront(2);
      expect(buf.length()).toBe(3);
      expect(Array.from(buf.snapshot())).toEqual([3, 4, 5]);
    });

    it("trimFront(0) is a no-op", () => {
      const buf = createRollingBuffer();
      buf.append(new Float32Array([1, 2, 3]));
      buf.trimFront(0);
      expect(Array.from(buf.snapshot())).toEqual([1, 2, 3]);
    });

    it("trimFront(negative) is a no-op", () => {
      const buf = createRollingBuffer();
      buf.append(new Float32Array([1, 2, 3]));
      buf.trimFront(-5);
      expect(Array.from(buf.snapshot())).toEqual([1, 2, 3]);
    });

    it("trimFront(>=length) empties the buffer", () => {
      const buf = createRollingBuffer();
      buf.append(new Float32Array([1, 2, 3]));
      buf.trimFront(10);
      expect(buf.length()).toBe(0);
      expect(buf.snapshot()).toEqual(new Float32Array(0));
    });

    it("trim then append then snapshot returns correct ordered samples", () => {
      const buf = createRollingBuffer();
      buf.append(new Float32Array([1, 2, 3, 4]));
      buf.trimFront(2);
      buf.append(new Float32Array([5, 6]));
      expect(Array.from(buf.snapshot())).toEqual([3, 4, 5, 6]);
    });

    it("trim then trim then snapshot still ordered", () => {
      const buf = createRollingBuffer();
      buf.append(new Float32Array([1, 2, 3, 4, 5, 6]));
      buf.trimFront(2);
      buf.trimFront(2);
      expect(Array.from(buf.snapshot())).toEqual([5, 6]);
    });

    it("multiple appends + trims interleaved (production-like usage)", () => {
      // This emulates real tick-loop behaviour: audio frames arrive
      // continuously, force-commit trims occasionally.
      const buf = createRollingBuffer();
      buf.append(new Float32Array([1, 2, 3]));
      buf.append(new Float32Array([4, 5]));
      buf.trimFront(2);
      buf.append(new Float32Array([6, 7, 8]));
      buf.trimFront(3);
      buf.append(new Float32Array([9]));
      expect(Array.from(buf.snapshot())).toEqual([6, 7, 8, 9]);
      expect(buf.length()).toBe(4);
    });
  });

  describe("reset", () => {
    it("empties the buffer", () => {
      const buf = createRollingBuffer();
      buf.append(new Float32Array([1, 2, 3, 4, 5]));
      buf.reset();
      expect(buf.length()).toBe(0);
      expect(buf.snapshot()).toEqual(new Float32Array(0));
    });

    it("reset on an empty buffer is a no-op", () => {
      const buf = createRollingBuffer();
      buf.reset();
      buf.reset();
      expect(buf.length()).toBe(0);
    });

    it("reset then append works normally", () => {
      const buf = createRollingBuffer();
      buf.append(new Float32Array([1, 2, 3]));
      buf.reset();
      buf.append(new Float32Array([4, 5]));
      expect(Array.from(buf.snapshot())).toEqual([4, 5]);
    });
  });

  describe("isOverCap", () => {
    it("returns false when below cap", () => {
      const buf = createRollingBuffer(100);
      buf.append(new Float32Array(50));
      expect(buf.isOverCap()).toBe(false);
    });

    it("returns true when at or above cap", () => {
      const buf = createRollingBuffer(100);
      buf.append(new Float32Array(100));
      expect(buf.isOverCap()).toBe(true);
    });

    it("default cap == ROLLING_SOFT_CAP_SECONDS * TARGET_SAMPLE_RATE", () => {
      const buf = createRollingBuffer();
      // 1 sample below default cap → not over
      buf.append(new Float32Array(MAX_SAMPLES_DEFAULT - 1));
      expect(buf.isOverCap()).toBe(false);
      buf.append(new Float32Array(1));
      expect(buf.isOverCap()).toBe(true);
    });

    it("after trim, isOverCap reflects new length", () => {
      const buf = createRollingBuffer(100);
      buf.append(new Float32Array(100));
      expect(buf.isOverCap()).toBe(true);
      buf.trimFront(50);
      expect(buf.isOverCap()).toBe(false);
    });
  });

  describe("v0.5.1 — append never overflows the cap (defensive against runaway producers)", () => {
    // Pre-v0.5.1 the buffer would happily grow past the cap because
    // append was append-only and isOverCap() was an advisory check.
    // The new implementation is a true ring buffer: append silently
    // drops the OLDEST samples (front-trim) to maintain length <= cap.
    // The tick loop is still responsible for calling force-commit when
    // isOverCap() reports true, but if it doesn't (or can't fast enough),
    // the buffer no longer leaks memory.

    it("append beyond cap silently drops the oldest samples to maintain length <= cap", () => {
      const buf = createRollingBuffer(5);
      buf.append(new Float32Array([1, 2, 3]));
      expect(buf.length()).toBe(3);
      // Append 4 more — total would be 7 — should keep last 5 = [3,4,5,6,7]
      buf.append(new Float32Array([4, 5, 6, 7]));
      expect(buf.length()).toBe(5);
      expect(Array.from(buf.snapshot())).toEqual([3, 4, 5, 6, 7]);
    });

    it("appending a single huge frame larger than cap keeps only the tail of cap samples", () => {
      const buf = createRollingBuffer(3);
      buf.append(new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
      expect(buf.length()).toBe(3);
      expect(Array.from(buf.snapshot())).toEqual([8, 9, 10]);
    });

    it("sustained appends with no trim cap memory at exactly cap (regression vs O(n²) growth)", () => {
      const buf = createRollingBuffer(1000);
      // Simulate 100 frames of 50 samples each = 5000 samples total
      for (let i = 0; i < 100; i++) {
        const frame = new Float32Array(50);
        for (let j = 0; j < 50; j++) frame[j] = i * 50 + j;
        buf.append(frame);
      }
      // Buffer holds the last 1000 samples — values 4000..4999
      expect(buf.length()).toBe(1000);
      const snap = buf.snapshot();
      expect(snap[0]).toBe(4000);
      expect(snap[snap.length - 1]).toBe(4999);
    });
  });
});
