# CaptionPip

> Live captions for any tab. Floats over anything. Never uploads.

CaptionPip turns any browser-shareable audio source (a YouTube tab, a web meeting,
a podcast, a live stream) into live captions, then pops them into a Document
Picture-in-Picture window so they stay visible while you switch to another app.

All speech recognition runs **locally in your browser** via
[transformers.js](https://huggingface.co/docs/transformers.js) + WebGPU, using
OpenAI's Whisper model. **Audio never leaves your device.**

## Status

**v0.1 (functional prototype).** See [`SPEC.md`](./SPEC.md) for the locked v0.1
scope and the deferred-feature roadmap.

## Stack

- **Astro 6** (static MPA, SEO-first)
- **Tailwind v4** (`@tailwindcss/vite`, `@theme` directive, no config file)
- **TypeScript** strict
- **transformers.js v3** (Whisper inference via WebGPU)
- **Document Picture-in-Picture API** (Chrome/Edge/Brave 116+)
- **Cloudflare Pages** deploy target

## Dev

```bash
git clone https://github.com/shrestha-tripathi/captionpip.git
cd captionpip
cp .env.example .env   # optional, overrides defaults
npm install
npm run dev            # http://localhost:4321
```

## Build

```bash
npm run build          # → dist/
npx astro check        # 0 TS errors expected
```

## Test the captions flow

1. Open the dev server in **Chrome, Edge, or Brave 116+**
2. Click **Start captions**
3. Pick a tab playing audio (a YouTube video with clear English speech is the easiest test)
4. Tick **"Share tab audio"** in the picker — captions won't work without it
5. Wait for model download (~75 MB, first time only)
6. Captions appear ~3 seconds after the speech begins
7. Click **Pop out** to move them into a floating window
8. Switch to any other app — the floating captions stay on top

## Architecture

```
Main page (opener realm)
 ├─ getDisplayMedia(audio) ──▶ AudioContext @ 16kHz ──▶ chunk every 3s
 │                                                         │
 │                                                         ▼
 ├─ Worker (whisper-worker.js) ◀── postMessage(Float32Array)
 │   └─ transformers.js + WebGPU + Whisper-base
 │                                                         │
 │                                                         ▼
 ├─ Caption DOM (#cp-caption-box)
 │   └─ Can be moved into Document PiP window via append()
 │     (PiP shares same JS realm, same scripts, same worker)
 │
 └─ on PiP close → caption DOM moved back to #cp-caption-mount
```

The PiP window does **not** have its own copy of the worker. Same opener realm
= same `Worker` reference = same in-flight audio chunks just keep streaming.

## Browser support

| Browser | Captures | Pop-out PiP |
|---|---|---|
| Chrome 116+, Edge 116+, Brave 116+ (desktop) | ✅ tab/window/screen + audio | ✅ |
| Firefox (desktop) | ⚠️ video only — audio capture limited | ❌ falls back to in-page captions |
| Safari (desktop) | ⚠️ video only — no system audio | ❌ falls back to in-page captions |
| Mobile (any browser) | ❌ no `getDisplayMedia` on mobile | n/a |

## License

MIT — see [`LICENSE`](./LICENSE).
