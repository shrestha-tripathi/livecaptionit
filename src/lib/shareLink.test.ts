/**
 * Unit tests for share link encoding/decoding (pure functions only).
 *
 * Note: encodeShareUrl/decodeShareUrl use CompressionStream which is
 * available in modern Node (≥18) — vitest's node env supports it.
 */

import { describe, expect, it } from "vitest";
import type { TranscriptSegment } from "./transcript";
import {
  base64UrlDecode,
  base64UrlEncode,
  buildBundle,
  decodeShareUrl,
  encodeShareUrl,
  expandBundle,
  MAX_PAYLOAD_BYTES,
  readSharePayloadFromLocation,
} from "./shareLink";

const segs = (n: number): TranscriptSegment[] =>
  Array.from({ length: n }, (_, i) => ({
    tMs: i * 1500,
    words: `Sample segment number ${i} with some captioned speech.`.split(" "),
  }));

describe("shareLink", () => {
  describe("base64UrlEncode / Decode round-trip", () => {
    it("round-trips arbitrary bytes", () => {
      const input = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
      const enc = base64UrlEncode(input);
      const dec = base64UrlDecode(enc);
      expect(Array.from(dec)).toEqual(Array.from(input));
    });

    it("emits URL-safe characters (no +, /, =)", () => {
      const input = new Uint8Array([0xff, 0xff, 0xff]); // produces +/= in standard base64
      const enc = base64UrlEncode(input);
      expect(enc).not.toMatch(/[+/=]/);
    });

    it("handles empty input", () => {
      expect(base64UrlEncode(new Uint8Array(0))).toBe("");
      expect(Array.from(base64UrlDecode(""))).toEqual([]);
    });
  });

  describe("buildBundle / expandBundle round-trip", () => {
    it("preserves segments", () => {
      const original = segs(3);
      const bundle = buildBundle(original);
      const restored = expandBundle(bundle);
      expect(restored).toEqual(original);
    });

    it("sets version to 1", () => {
      expect(buildBundle([]).v).toBe(1);
    });

    it("includes a preview from the first segment", () => {
      const original = segs(2);
      const bundle = buildBundle(original);
      expect(bundle.p).toContain("Sample segment");
    });

    it("preview is capped at 80 chars", () => {
      const long: TranscriptSegment = {
        tMs: 0,
        words: ["x".repeat(200)],
      };
      const bundle = buildBundle([long]);
      expect(bundle.p?.length).toBe(80);
    });
  });

  describe("encodeShareUrl / decodeShareUrl round-trip", () => {
    it("encodes + decodes a small transcript", async () => {
      const original = segs(5);
      const url = await encodeShareUrl(original, "https://livecaptionit.com");
      expect(url).toMatch(/^https:\/\/livecaptionit\.com\/\?t=.+&v=1$/);

      const params = new URL(url).searchParams;
      const payload = params.get("t")!;
      const { segments, bundle } = await decodeShareUrl(payload);
      expect(segments).toEqual(original);
      expect(bundle.v).toBe(1);
    });

    it("strips trailing slashes from baseUrl", async () => {
      const url = await encodeShareUrl(segs(1), "https://livecaptionit.com/");
      expect(url).toMatch(/^https:\/\/livecaptionit\.com\/\?t=/);
      // No double slash
      expect(url).not.toMatch(/\/\/\?t=/);
    });

    it("rejects oversized payloads with a useful error", async () => {
      const huge = segs(2000); // many long segments → over the cap
      await expect(encodeShareUrl(huge, "https://livecaptionit.com")).rejects.toThrow(/too long/);
    });

    it("rejects empty payload on decode", async () => {
      await expect(decodeShareUrl("")).rejects.toThrow(/empty/i);
    });

    it("rejects malformed base64 on decode", async () => {
      // base64UrlDecode is permissive (atop atob) — give it actually bad
      // gzip data: a single byte that decodes fine but isn't gzip.
      await expect(decodeShareUrl("AAAA")).rejects.toThrow(/corrupted|truncated|malformed|invalid/i);
    });

    it("compression actually shrinks repetitive content", async () => {
      const repetitive: TranscriptSegment[] = Array.from({ length: 50 }, (_, i) => ({
        tMs: i * 1000,
        words: "the cat sat on the mat ".repeat(5).split(" ").filter(Boolean),
      }));
      const json = JSON.stringify(buildBundle(repetitive));
      const url = await encodeShareUrl(repetitive, "https://x");
      const payload = url.split("?t=")[1].split("&")[0];
      // gzip should compress at least 3x on this
      expect(payload.length).toBeLessThan(json.length / 3);
    });
  });

  describe("readSharePayloadFromLocation", () => {
    it("returns the t param when present", () => {
      expect(readSharePayloadFromLocation({ search: "?t=hello&v=1" })).toBe("hello");
    });

    it("returns null when absent", () => {
      expect(readSharePayloadFromLocation({ search: "" })).toBeNull();
      expect(readSharePayloadFromLocation({ search: "?v=1" })).toBeNull();
    });

    it("returns empty string when t is set to empty", () => {
      expect(readSharePayloadFromLocation({ search: "?t=" })).toBe("");
    });
  });

  describe("constants", () => {
    it("MAX_PAYLOAD_BYTES is set reasonably", () => {
      expect(MAX_PAYLOAD_BYTES).toBeGreaterThanOrEqual(8192);
      expect(MAX_PAYLOAD_BYTES).toBeLessThanOrEqual(32768);
    });
  });
});
