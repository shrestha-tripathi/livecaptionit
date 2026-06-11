# BUILD_FLAGS.md — build-time feature flags

LiveCaptionIt uses a small set of `PUBLIC_*` env vars to flip behavior at
**build time**. They're read once by `src/lib/featureFlags.ts` and
statically replaced by Vite during `astro build` — meaning you cannot
toggle them from the running app, the URL, or `localStorage`. Changing a
flag requires:

1. Update the env var (locally in `.env`, or on Cloudflare Pages
   dashboard → Settings → Environment variables → Production).
2. Rebuild (`npm run build` locally, or trigger a redeploy on CF).
3. Wait for the CDN to refresh (CF Pages: ~1 min for HTML, but the
   `whisper-worker.js` file is on a separate cache key — see the
   `WORKER_VERSION` busting trick in `src/lib/whisperClient.ts`).

## Parsing rules

All flags use the same strict parser in `featureFlags.ts`:

- `"true"`, `"1"`, `"yes"` → `true` (case-insensitive, trimmed)
- Anything else (unset, `""`, `"false"`, `"0"`, garbage) → `false`

This is deliberate. "Any non-empty string is truthy" is the bug that
makes `PUBLIC_FOO=false` accidentally enable the feature — we avoid it.

## Production defaults

The repo defaults are tuned for `livecaptionit.com` production. **Do not
set any of these on Cloudflare Pages unless you're deliberately
overriding** — the safe defaults ship in the code itself.

## Catalog

### `PUBLIC_ALLOW_MOBILE_WEBGPU`

| | |
|---|---|
| **Default** | `false` |
| **Production value** | `false` |
| **Type** | boolean |
| **Affects** | Mobile only (UA = iOS/iPadOS/Android, or coarse pointer + narrow viewport). Desktop is untouched. |

When `false` (default) — Mobile devices skip the WebGPU adapter probe
entirely and run the Whisper worker on the WASM execution provider.
This is slower but reliable across iOS Safari 18.2+, Chrome Android
121+, and Android WebView.

When `true` — Mobile devices follow the same WebGPU-first code path as
desktop: probe `navigator.gpu.requestAdapter()`, fall back to WASM only
if no adapter is returned.

**Why default to `false`** even though mobile WebGPU "ships" in 2026:

- `navigator.gpu.requestAdapter()` can silently hang for ~120s before
  resolving on some Android devices and iOS 18.2 betas — looks like a
  page crash to the user.
- Mobile GPU drivers are immature compared to desktop. Random shader
  compile failures, black tabs, OOMs during weight transfer.
- WebGPU buffers compete with the page heap for the iOS Safari jetsam
  budget (~256-384 MB per tab in low-RAM mode). First inference often
  OOMs the tab even when the model loads fine.
- Thermal throttling kicks in within ~30s of WebGPU inference, and
  perf drops below the WASM path anyway.

**When to set `true`** — Testing. You want to see whether your specific
device + browser actually completes a session on WebGPU without crashing.
Useful for collecting data ahead of a future default flip (estimated 2027
once iOS Safari and Chrome Android stabilize).

**How to test:**

```bash
# Local dev — visit http://localhost:4321 on your phone via WiFi
PUBLIC_ALLOW_MOBILE_WEBGPU=true npm run dev -- --host

# Local prod build
PUBLIC_ALLOW_MOBILE_WEBGPU=true npm run build && npm run preview -- --host

# Cloudflare Pages — set in dashboard, redeploy, then visit
# livecaptionit.com/?debug=1 on phone to confirm
#   "flag PUBLIC_ALLOW_MOBILE_WEBGPU: true"
#   "→ forceWasmOnMobile: false"
# appear in the debug panel.
```

**Reverting** — Either delete the dashboard env var or set it to `false`,
then redeploy. The code default takes over.

### Pre-existing flags (not in `featureFlags.ts`)

For brand/SEO env vars (`PUBLIC_SITE_URL`, `PUBLIC_SITE_DOMAIN`,
`PUBLIC_GA_MEASUREMENT_ID`, etc.) see `src/site.config.ts` and the
header of `.env.example`. Those are resolved in `site.config.ts`, not
here, because they're consumed by SSR-time code (sitemap, OG meta,
canonical tags) and need their own defensive `.pages.dev` guard.

## Adding a new flag

1. Add the entry to the `featureFlags` object in
   `src/lib/featureFlags.ts` (always read via `parseBool`).
2. Add a section to this file with the same six-field template
   (default, production value, type, affects, when on/off, when to flip).
3. Add tests to `src/lib/featureFlags.test.ts` — at minimum verify
   default-false, `true → true`, garbage → `false`.
4. Add the optional override block to `.env.example` so anyone running
   the project locally sees the knob exists.
5. If the flag is dangerous or has a "STALE WORKER"-style debug check,
   gate the warning on the flag too (don't alert on intended state).
