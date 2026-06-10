import { describe, it, expect } from "vitest";
import { chunkSamples, computeRms, resampleTo16k } from "./sampleFeed";

describe("computeRms", () => {
  it("returns 0 for empty input", () => {
    expect(computeRms(new Float32Array(0))).toBe(0);
  });

  it("returns 0 for silence", () => {
    expect(computeRms(new Float32Array(100))).toBe(0);
  });

  it("returns peak magnitude for constant signal", () => {
    const samples = new Float32Array(100).fill(0.5);
    expect(computeRms(samples)).toBeCloseTo(0.5, 5);
  });

  it("returns approx 0.707 for full-amplitude sine wave", () => {
    const samples = new Float32Array(1000);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.sin((i * Math.PI * 2) / 100);
    }
    expect(computeRms(samples)).toBeCloseTo(0.707, 2);
  });
});

describe("chunkSamples", () => {
  it("splits 1280-sample input into 1 chunk", () => {
    const input = new Float32Array(1280);
    const chunks = chunkSamples(input);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(1280);
  });

  it("splits 2560-sample input into 2 chunks", () => {
    const input = new Float32Array(2560);
    const chunks = chunkSamples(input);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(1280);
    expect(chunks[1]).toHaveLength(1280);
  });

  it("returns a final short chunk for non-multiple inputs", () => {
    const input = new Float32Array(1500);
    const chunks = chunkSamples(input);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(1280);
    expect(chunks[1]).toHaveLength(220);
  });

  it("returns fresh allocations (mutation isolation)", () => {
    // The consumer (RollingBuffer) assumes it owns the buffer. Confirm
    // that mutating the input AFTER chunking does NOT affect the chunks.
    const input = new Float32Array(1280);
    input.fill(0.5);
    const chunks = chunkSamples(input);
    input.fill(0); // mutate after
    expect(chunks[0][0]).toBe(0.5);
    expect(chunks[0][1279]).toBe(0.5);
  });

  it("preserves values across chunk boundary", () => {
    const input = new Float32Array(2560);
    for (let i = 0; i < input.length; i++) input[i] = i / 2560;
    const chunks = chunkSamples(input);
    expect(chunks[0][1279]).toBeCloseTo(1279 / 2560, 5);
    expect(chunks[1][0]).toBeCloseTo(1280 / 2560, 5);
  });

  it("returns empty array for empty input", () => {
    expect(chunkSamples(new Float32Array(0))).toEqual([]);
  });
});

describe("resampleTo16k", () => {
  it("returns input unchanged when source is already 16kHz", () => {
    const input = new Float32Array(100).fill(0.42);
    const out = resampleTo16k(input, 16000);
    // Same instance — no-copy fast path
    expect(out).toBe(input);
  });

  it("downsamples 48kHz to 16kHz with ~1/3 length", () => {
    const input = new Float32Array(48000); // 1 sec at 48kHz
    const out = resampleTo16k(input, 48000);
    expect(out.length).toBe(16000); // 1 sec at 16kHz
  });

  it("downsamples 44.1kHz to 16kHz", () => {
    const input = new Float32Array(44100); // 1 sec
    const out = resampleTo16k(input, 44100);
    // floor(44100 / 2.75625) = 16000
    expect(out.length).toBe(16000);
  });

  it("preserves DC value (constant signal stays constant)", () => {
    const input = new Float32Array(48000).fill(0.3);
    const out = resampleTo16k(input, 48000);
    // Every output sample is interpolation of two equal values → exact
    for (let i = 0; i < out.length; i++) {
      expect(out[i]).toBeCloseTo(0.3, 5);
    }
  });

  it("upsamples (8kHz → 16kHz) doubles length", () => {
    const input = new Float32Array(8000);
    const out = resampleTo16k(input, 8000);
    expect(out.length).toBe(16000);
  });
});
