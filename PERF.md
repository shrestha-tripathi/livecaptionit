# LiveCaptionIt — Performance audit notes

Baseline measurement and shipped optimizations for v0.4.3+. Keep updated
when bundle sizes shift materially.

## Baseline (v0.4.2 → v0.4.3 pre-audit, June 10 2026)

| Asset | Raw size | Gzipped |
|---|---|---|
| `dist/index.html` | 67 KB | 14 KB |
| `dist/_astro/CaptionApp.script.js` | 57 KB | 19 KB |
| `dist/_astro/Layout.css` | 40 KB | 8 KB |
| `dist/whisper-worker.js` | 8 KB | (loaded on Start) |
| `dist/audio-worklet-capture.js` | 3 KB | (loaded on Start) |
| `dist/sw.js` | 1.6 KB | — |
| `dist/icon-192.png` | 8 KB → **3.8 KB** | — |
| `dist/icon-512.png` | 20 KB → **8.5 KB** | — |
| `dist/icon-maskable-512.png` | 20 KB → **6.6 KB** | — |
| `dist/sample.mp3` | 192 KB | (preload="none") |

Total critical-path payload (gzipped, parsed by browser BEFORE Start):
**~41 KB** (HTML + CSS + JS + manifest). Whisper model (74 MB for the
default `base` tier) is downloaded only on first Start and cached in
IndexedDB by transformers.js.

## Shipped optimizations (v0.4.3 perf-audit branch)

1. **Non-blocking Google Fonts** — switched from `rel="stylesheet"` to
   `rel="preload" as="style"` + `onload` promotion. Removes
   `fonts.googleapis.com` from the FCP critical path. Net: **~400-600 ms
   faster FCP on slow connections** (3G or worse). Has a `<noscript>`
   fallback so JS-disabled users still get the font (just blocking, as
   before).

2. **DNS prefetch + preconnect to `cdn.jsdelivr.net`** — Whisper worker
   loads transformers.js from there on first model load. Prewarming the
   TCP/TLS handshake saves **~200-400 ms** on the user's first Start
   click (idle-time hint, no payload fetched).

3. **Worker script prefetch on home page only** — `<link rel="prefetch"
   href="/whisper-worker.js" as="worker">` pulls the worker JS into HTTP
   cache before Start is clicked. Only emitted on `/` to avoid wasted
   bandwidth on /about, /contact, etc.

4. **PNG icon recompression** — palette quantization (PNG8) + adaptive
   filtering + level-9 deflate cuts icon weight by 52-67% across the
   board with zero visual loss. Total icons: 48 KB → 19 KB (saves
   **29 KB** per cold install, helpful for low-bandwidth mobile installs).

## Deferred / future optimizations

| Item | Effort | Win | Notes |
|---|---|---|---|
| Inline critical CSS | M | -100 ms FCP | Astro's `inlineStylesheets: "auto"` only inlines < 4 KB; our CSS is 40 KB. Would need a manual extraction pass for above-the-fold styles. |
| Code-split the help/session-view dialog code | M | -5 KB initial JS | The dialog markup is server-rendered (cheap) but the JS handlers for `cp-session-view`, `cp-history-import`, `cp-shortcuts-help` all run upfront. Could lazy-`import()` them on first dialog open. |
| Replace `transformers.js` CDN with self-hosted ESM | L | -100 ms latency, full control | Lose `@latest` auto-update vs jsDelivr, gain consistent COEP/COOP propagation. Defer until we hit a CDN-related bug. |
| Pre-compress with brotli (.br) for Cloudflare | S | -20 % over gzip on text | Cloudflare auto-brotli is on by default for HTML/CSS/JS. Verify in prod with `curl -H "Accept-Encoding: br" -sI`. |
| Convert sample.mp3 → opus (.ogg) | S | 192 KB → ~60 KB | Browser support universal. But sample only plays on click — bandwidth saved only for users who try the demo. |
| Idle-time worker warmup | M | -1.5 s on first Start | `requestIdleCallback` → `new Worker()` → wait for ready. Risk: spawns worker on every page view, even if user never clicks Start. Eats RAM. Punt unless engagement metrics justify. |

## Lighthouse target

On a fresh deploy, run `lighthouse https://livecaptionit.com --only-categories=performance,best-practices,accessibility,seo,pwa` and aim for:

- Performance: **≥ 95**
- Accessibility: **= 100**
- Best practices: **= 100**
- SEO: **= 100**
- PWA: **= 100** (we ship a valid manifest + SW + installable icons since v0.4.3)

If perf drops below 90, the culprit is almost certainly:

1. Newly-blocking external CSS (re-audit `<link>` tags)
2. Newly-added eager `<img>` without `loading="lazy"`
3. JS bundle growing past ~80 KB gzipped (split a feature out)
4. Adding analytics that block render (only GA4 ships, async)

## Re-measurement command

```bash
cd ~/projects/captionpip
npm run build && \
  echo "=== Sizes ===" && \
  ls -la dist/_astro/*.css dist/_astro/*.js dist/*.html dist/icon-*.png && \
  echo "=== Gzipped ===" && \
  for f in dist/index.html dist/_astro/*.js dist/_astro/*.css; do
    echo "$(gzip -c "$f" | wc -c) $f"
  done | sort -rn
```
