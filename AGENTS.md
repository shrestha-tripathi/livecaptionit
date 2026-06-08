# AGENTS.md — CaptionPip project rules

Read this before making any change to this repo.

## Project mission

CaptionPip is a browser-only live captions tool. The product IS the moat:
the moment we add an account, a server, an upload step, or a "premium" tier
that puts captioning behind a wall, we've lost the privacy differentiator.

## Mandatory reading

1. **SPEC.md** — v0.1 scope lock. Don't expand without explicit user signoff.
2. **DESIGN.md** — color tokens, type, anti-patterns.
3. This file.

## Hard rules

1. **Brand strings:** ONLY in `src/site.config.ts`. Before commit:
   ```bash
   grep -rln "CaptionPip" src/ | grep -v site.config.ts
   ```
   Empty = clean. Hits = inline brand string that breaks future renames.

2. **Tailwind v4 only.** No `tailwind.config.js`. No `@tailwind base;`.
   Use `@theme` directive and `@import "tailwindcss"`. v3 patterns silently no-op.

3. **Cyan brand exception.** Only `.brand-halo`, the start CTA, and the
   recording-state UI may use `--color-brand`. Everything else = neutral grays.

4. **Light + dark must both pass.** After any visual change, manually verify
   both themes via the toggle. ~50% of visitors get light by default via OS.

5. **No accounts, no server, no tracking beyond GA4 page-view count.** Anything
   that adds user data collection breaks the privacy/moat promise. Bring it to
   the user before opening a PR.

6. **One feature = one commit.** Rollback-safe. No combined feat+refactor commits.

7. **The Whisper worker lives in `public/whisper-worker.js`** and loads
   transformers.js from CDN. Don't bundle transformers.js — it's 15MB+ and the
   import in the page (in `Layout.astro`) would tank the LCP.

8. **`grep` test before claiming a rebrand is done:**
   ```bash
   grep -rln "CaptionPip" src/ public/ astro.config.* package.json 2>/dev/null \
     | grep -v site.config.ts
   ```

## Stack invariants

- Astro 6 MPA, static output, no SSR
- Tailwind v4 via `@tailwindcss/vite`
- TypeScript strict, Node 22+
- No backend. localStorage only. IndexedDB used by transformers.js for model cache.
- Document Picture-in-Picture API for the floating window
- Cloudflare Pages target

## SEO non-negotiables

- Every page has `<title>` + `<meta name="description">` via `Layout` props
- Index page has WebApplication + FAQPage JSON-LD inlined (handled in Layout/index)
- `/sitemap.xml` route enumerates all public pages
- `public/robots.txt` allows all + points at sitemap + disallows the worker JS
- Canonical URL on every page via `Layout` (auto from `Astro.url.pathname`)
- OG image present (regenerate when brand changes — v0.1 placeholder OK)
- `noindex` on 404

## Pitfalls already known (don't re-trip)

- **Cloudflare Pages dashboard env vars are sticky.** `PUBLIC_SITE_URL` set to
  `*.pages.dev` in CF dashboard during pre-domain deploy silently survives
  every subsequent deploy. `src/site.config.ts` + `astro.config.mjs` both have
  regex guards that reject `.pages.dev` — keep them.
- **`grep` will find brand mentions inside `node_modules/`.** Always restrict
  searches to `src/ public/ astro.config.* package.json`.
- **`browser_vision` lies about layout/contrast.** For pixel-precision
  checks, always cross-verify with DOM measurement.
- **Document PiP requires user gesture.** `documentPictureInPicture.requestWindow()`
  rejects if not called inside a `click` event handler.
- **ScriptProcessorNode is deprecated.** Works everywhere, used for v0.1
  simplicity. Migrate to AudioWorklet in v0.2.

## Verify command (run before every commit)

```bash
npm run build && npx astro check
```

Both must exit 0. Any TS strict-mode warnings = fix before commit.

## Commit message format

```
<type>(<scope>): <subject>

<optional body explaining "why">
```

Types: `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `perf`, `test`.

Scopes: `pip`, `capture`, `whisper`, `ui`, `nav`, `seo`, `theme`, `design`, `build`, `deps`, `meta`, `worker`.

## When in doubt

Ask the user before:
- Adding a third-party library (zero-deps preferred; transformers.js is the one big exception)
- Adding analytics beyond GA4 page-view
- Changing brand identity (cyan accent, speech-bubble icon)
- Adding new pages (impacts SEO sitemap)
- Touching the audio capture / worker boundary
- Pushing past v0.1 scope without an updated SPEC.md
