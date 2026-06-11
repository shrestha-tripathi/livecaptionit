/**
 * Build-time feature flags read from PUBLIC_* env vars.
 *
 * These are STATICALLY REPLACED by Vite/Astro at build time — flipping
 * them requires a rebuild + redeploy (Cloudflare Pages: change the env
 * var in dashboard → trigger redeploy → wait for build). They are NOT
 * runtime-toggleable from the browser.
 *
 * For a list of every flag, defaults, and the rationale, see
 * `docs/BUILD_FLAGS.md` in the repo root.
 *
 * Env-var parsing rules (kept identical for every flag here):
 *  - Vite exposes vars as strings; "true" / "1" / "yes" → true.
 *    Anything else (including unset, "", "false", "0") → false.
 *  - This is deliberately strict: we never want "any non-empty string
 *    → true" semantics, because that bites the first time someone sets
 *    PUBLIC_FOO=false expecting it to disable a feature.
 */

const env = import.meta.env;

function parseBool(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  const v = raw.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

export const featureFlags = {
  /**
   * Allow Whisper to attempt WebGPU on mobile devices.
   *
   * Default: `false`. On mobile (iOS Safari, Chrome Android), we force
   * the Whisper worker to use the WASM execution provider instead of
   * probing for a WebGPU adapter. Mobile WebGPU support is technically
   * present (iOS Safari 18.2+, Chrome Android 121+) but:
   *  - `navigator.gpu.requestAdapter()` can hang for ~120s before
   *    returning, which looks like a page crash to the user
   *  - Driver instability causes random shader-compile failures
   *  - GPU buffer allocations compete with the page heap → first
   *    inference often OOMs the tab
   *  - Thermal throttling kicks in mid-session
   *
   * Set `PUBLIC_ALLOW_MOBILE_WEBGPU=true` at build time to enable the
   * WebGPU path on mobile for testing. Production stays `false` until
   * mobile WebGPU is reliable enough to default-on (estimated 2027).
   *
   * Desktop is unaffected — WebGPU-first remains the default there
   * regardless of this flag.
   */
  allowMobileWebGPU: parseBool(env.PUBLIC_ALLOW_MOBILE_WEBGPU),
} as const;

export type FeatureFlags = typeof featureFlags;
