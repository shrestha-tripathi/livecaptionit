/**
 * LiveCaptionIt service worker — install-only, no caching.
 *
 * Chrome's PWA install prompt requires a registered service worker that
 * controls the page. We don't actually want offline caching for this app:
 *  - Whisper model is cached by transformers.js via the Cache API itself
 *    (different cache name: "transformers-cache"). Reimplementing the
 *    same caching one layer up would only confuse things.
 *  - HTML/JS/CSS assets are served from Cloudflare's edge, very fast.
 *    Offline-mode-for-the-shell adds maintenance + invalidation pain
 *    for marginal benefit on an app that needs WebGPU and microphone
 *    access anyway.
 *
 * If we add an offline shell in v0.5+, swap "fetch-passthrough" for a
 * precache + runtime cache strategy here.
 */

const SW_VERSION = "v0.4.3-install-only";

self.addEventListener("install", () => {
  // skipWaiting so the install-only SW activates immediately on the very
  // first visit. No assets to pre-fetch, so there's nothing to wait for.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Claim all clients so the page is "controlled" without a reload.
  // Chrome's installability heuristic requires this on the first session.
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Intentionally pass through to network. We register the SW to enable
  // the PWA install prompt, not to intercept requests.
});

// Future hook: BroadcastChannel("livecaptionit:sw") could be wired for
// "new version available" toasts after upgrade. Not used in v0.4.3.
console.info(`[SW] LiveCaptionIt service worker installed: ${SW_VERSION}`);
