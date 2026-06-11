/**
 * @vitest-environment node
 *
 * featureFlags is built from `import.meta.env.PUBLIC_*` which Vite
 * statically replaces at build time. To exercise the parser across
 * different env values within one test run, we stub `import.meta.env`
 * via vi.stubEnv and re-import the module after each change.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("featureFlags.allowMobileWebGPU", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadFlags() {
    const mod = await import("./featureFlags");
    return mod.featureFlags;
  }

  it("defaults to false when env var is unset", async () => {
    vi.stubEnv("PUBLIC_ALLOW_MOBILE_WEBGPU", "");
    const flags = await loadFlags();
    expect(flags.allowMobileWebGPU).toBe(false);
  });

  it('parses "true" → true', async () => {
    vi.stubEnv("PUBLIC_ALLOW_MOBILE_WEBGPU", "true");
    const flags = await loadFlags();
    expect(flags.allowMobileWebGPU).toBe(true);
  });

  it('parses "1" → true', async () => {
    vi.stubEnv("PUBLIC_ALLOW_MOBILE_WEBGPU", "1");
    const flags = await loadFlags();
    expect(flags.allowMobileWebGPU).toBe(true);
  });

  it('parses "yes" → true', async () => {
    vi.stubEnv("PUBLIC_ALLOW_MOBILE_WEBGPU", "yes");
    const flags = await loadFlags();
    expect(flags.allowMobileWebGPU).toBe(true);
  });

  it("is case-insensitive", async () => {
    vi.stubEnv("PUBLIC_ALLOW_MOBILE_WEBGPU", "TRUE");
    const flags = await loadFlags();
    expect(flags.allowMobileWebGPU).toBe(true);
  });

  it("trims whitespace", async () => {
    vi.stubEnv("PUBLIC_ALLOW_MOBILE_WEBGPU", "  true  ");
    const flags = await loadFlags();
    expect(flags.allowMobileWebGPU).toBe(true);
  });

  it('parses "false" → false', async () => {
    vi.stubEnv("PUBLIC_ALLOW_MOBILE_WEBGPU", "false");
    const flags = await loadFlags();
    expect(flags.allowMobileWebGPU).toBe(false);
  });

  it('parses "0" → false', async () => {
    vi.stubEnv("PUBLIC_ALLOW_MOBILE_WEBGPU", "0");
    const flags = await loadFlags();
    expect(flags.allowMobileWebGPU).toBe(false);
  });

  it("rejects garbage values → false", async () => {
    vi.stubEnv("PUBLIC_ALLOW_MOBILE_WEBGPU", "enable");
    const flags = await loadFlags();
    expect(flags.allowMobileWebGPU).toBe(false);
  });

  it("rejects numeric values other than 1", async () => {
    vi.stubEnv("PUBLIC_ALLOW_MOBILE_WEBGPU", "2");
    const flags = await loadFlags();
    expect(flags.allowMobileWebGPU).toBe(false);
  });
});
