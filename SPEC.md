# CaptionPip — v0.1 Spec (LOCKED)

**Status:** v0.1 — functional core, not polished product
**Date:** 2026-06-08
**Working domain:** `captionpip.com` (RDAP-verified available — buy before commit if you keep the name)
**Repo:** `github.com/shrestha-tripathi/captionpip` (private until shipped)
**Ship target:** v0.1 functional prototype this weekend, polish + ship v0.2 the following weekend

---

## 0. One-line product pitch

> **Live captions for any audio your browser can hear — floats over any app, never uploads.**

## 1. Why this product (the real motivation)

| Dimension | Reality |
|---|---|
| **Pain frequency** | Daily — every Zoom call, every YouTube lecture, every podcast you want to skim |
| **Pain depth** | Real for hearing-impaired (430M globally), real for foreign-content viewers, real for non-native speakers consuming dense English content |
| **Existing solutions** | Chrome Live Caption (system-only, doesn't float, English-only on most platforms), Otter (paid + bot-join + uploads), YouTube CC (YouTube-only) |
| **Wedge** | Universal source × always-on PiP visibility × 100% local processing (Whisper via WebGPU + transformers.js) |
| **India unlock** | IndicWhisper (AI4Bharat) supports 22 Indic languages — Hindi captions for English content, English captions for Hindi content. Nobody else ships this |
| **Defensibility** | Web-native + privacy + PiP architecture creates structural lead. Otter/Fireflies' business model (upload + cloud STT) structurally can't pivot to local |
| **Why now** | Document PiP shipped Aug 2023 (Chrome 116). WebGPU shipped on iOS Safari 18.2 (Dec 2024). transformers.js v3 added WebGPU backend Q4 2024. The bricks just landed |

## 2. v0.1 scope — what ships THIS BUILD

### IN SCOPE (must-have for v0.1)

1. **Single landing page** at `/` with hero + 3-step explainer + start button
2. **Audio capture flow:**
   - Click "Start captions" → permission prompt → user picks tab/window/screen to share
   - Must capture audio from the picked source (video track silently discarded)
3. **Whisper transcription in browser:**
   - Default model: `Xenova/whisper-base` (74 MB, English-best, decent multi-lingual)
   - WebGPU backend via transformers.js v3
   - Caches model in IndexedDB after first download (instant on second visit)
4. **Live caption rendering:**
   - Captions appear in scrollable text area on the main page
   - If browser supports Document PiP → "Pop out" button opens floating window with same captions
   - PiP window stays visible when user switches to another app
5. **Controls (in PiP and main page both):**
   - Stop captions button
   - Caption text auto-scrolls to latest
6. **Fallback for non-Document-PiP browsers (Firefox, Safari):**
   - Captions render in main page only
   - "Pop out" button hidden + replaced with explainer "Floating window requires Chrome/Edge/Brave"
7. **Theme: light + dark** via `prefers-color-scheme` + manual toggle, both WCAG AA verified
8. **Brand strings via `site.config.ts`** — rename-safe per microtool playbook
9. **Trust shell:** about, privacy, contact, terms, disclaimer pages (basic, 1-paragraph each)
10. **SEO baseline:** title, meta description, canonical, OG image (placeholder OK for v0.1), sitemap, robots, `_headers` with `.pages.dev` noindex
11. **404 page**
12. **GitHub repo + initial commit + push**

### EXPLICITLY OUT OF SCOPE for v0.1 (do NOT build)

- ❌ Language picker (defaults to auto-detect/English)
- ❌ Translation (separate from transcription — v0.2)
- ❌ Transcript download / save / share
- ❌ Multiple model sizes (just whisper-base for v0.1)
- ❌ Speaker diarization
- ❌ Hindi/IndicWhisper integration (v0.2 wedge)
- ❌ Caption history / scrollback beyond ~20 lines
- ❌ Settings / preferences UI
- ❌ AdSense, analytics beyond GA4 placeholder
- ❌ Onboarding flow / tutorial overlay
- ❌ Mobile support (Document PiP doesn't work mobile anyway)
- ❌ Microphone-only mode (focus on tab audio for v0.1; mic-only goes in v0.2)
- ❌ Sentence-level segmentation / punctuation polish
- ❌ Word-level timestamps
- ❌ Resizable / draggable caption font

If user asks for any of the above during v0.1 build → defer to v0.2 / v0.3 by writing it in this doc, don't expand scope mid-build.

### Deferred to v0.2 (planned next ship)

- Language picker UI (English, Hindi, Spanish, Mandarin, French, German, Japanese — Whisper's strong languages)
- IndicWhisper model option (for Hindi accuracy)
- Mic capture mode (for dictation / voice notes)
- Transcript download (.txt + .vtt + .srt)
- Caption customization (font size, color, position in PiP)
- Translate caption to another language

### Deferred to v0.3 (the moat)

- Multiple model sizes user-selectable (tiny / base / small / medium based on device)
- Speaker diarization (who said what)
- AI summary at session end
- Save sessions to IndexedDB + history page
- Browser extension companion for system-wide capture
- Pip.tools portfolio integration

---

## 3. Architecture

### 3.1 Component diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                       MAIN PAGE (opener)                         │
│                                                                  │
│  ┌────────────────┐  ┌─────────────────┐  ┌──────────────────┐  │
│  │ getDisplayMedia│→ │  AudioContext   │→ │  Whisper Worker  │  │
│  │ (tab + audio)  │  │  resampler      │  │ (transformers.js)│  │
│  └────────────────┘  └─────────────────┘  └────────┬─────────┘  │
│                                                     │            │
│                                          ┌──────────▼─────────┐  │
│                                          │ Caption state      │  │
│                                          │ (array of strings) │  │
│                                          └──────────┬─────────┘  │
│                                                     │            │
│            ┌────────────────────────────────────────┘            │
│            ▼                                                     │
│  ┌──────────────────┐         ┌──────────────────────────────┐  │
│  │ Main page DOM    │  +OR+   │  Document PiP window         │  │
│  │ caption box      │  XOR    │  (same DOM nodes moved here) │  │
│  └──────────────────┘         └──────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

**Critical architecture decision:** the Whisper worker, AudioContext, MediaStream, and caption state ALL live in the main page realm. The PiP window borrows DOM nodes (via `pipWindow.document.body.append(captionEl)`) and shares the same JS scope. When PiP closes → caption box moves back to main page. **No `postMessage` boilerplate needed** because they share the same opener context (confirmed via Chrome docs).

### 3.2 Audio pipeline detail

```javascript
// Step 1: capture display + audio
const stream = await navigator.mediaDevices.getDisplayMedia({
  video: true,    // required by API even though we don't use video
  audio: true,    // ← captures the picked source's audio
  preferCurrentTab: false,
});

// Step 2: discard video, keep audio
stream.getVideoTracks().forEach(t => t.stop());
const audioStream = new MediaStream(stream.getAudioTracks());

// Step 3: pipe into Web Audio at Whisper's required 16kHz
const ctx = new AudioContext({ sampleRate: 16000 });
const source = ctx.createMediaStreamSource(audioStream);

// Step 4: chunk into 3-second buffers, send to worker
//   3s = sweet spot between latency (lower=better UX) and accuracy (longer=more context)
const CHUNK_MS = 3000;
const processor = ctx.createScriptProcessor(4096, 1, 1);
// (note: AudioWorklet is the modern path; for v0.1 use ScriptProcessor for simplicity)

let buffer = new Float32Array(CHUNK_MS * 16); // 3s @ 16kHz
let bufferPos = 0;

processor.onaudioprocess = (e) => {
  const input = e.inputBuffer.getChannelData(0);
  for (let i = 0; i < input.length && bufferPos < buffer.length; i++) {
    buffer[bufferPos++] = input[i];
  }
  if (bufferPos >= buffer.length) {
    worker.postMessage({ type: "transcribe", audio: buffer }, [buffer.buffer]);
    buffer = new Float32Array(CHUNK_MS * 16);
    bufferPos = 0;
  }
};
source.connect(processor);
processor.connect(ctx.destination);
```

**Gotchas to bake in:**
- ScriptProcessorNode is deprecated but works everywhere; AudioWorklet is cleaner but adds 1h of glue code. **For v0.1: use ScriptProcessor.** Upgrade to Worklet in v0.2.
- 3s chunks = ~3s caption lag. Acceptable for content but feels slow for conversation. **Document this honestly in the UI**: "captions appear ~3s after speech."
- Audio captured from `getDisplayMedia` is whatever the source sends — could be 48kHz stereo. Web Audio's resampler handles the downconversion automatically because we request `sampleRate: 16000` on the context.

### 3.3 Whisper worker

`public/whisper-worker.js` (loaded from CDN'd transformers.js):

```javascript
import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@latest";

env.allowLocalModels = false;
env.useBrowserCache = true;

let asr = null;

async function init(model = "Xenova/whisper-base") {
  asr = await pipeline("automatic-speech-recognition", model, {
    device: "webgpu",                // ← WebGPU acceleration
    dtype: "fp16",
  });
  self.postMessage({ type: "ready" });
}

self.onmessage = async (e) => {
  const { type, audio, model } = e.data;
  if (type === "init") return init(model);
  if (type === "transcribe") {
    const result = await asr(audio, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false,
      language: "english",   // v0.1: hardcoded English; v0.2 picks based on user setting
    });
    self.postMessage({ type: "result", text: result.text });
  }
};
```

### 3.4 Document PiP flow

```javascript
async function popOut() {
  if (!("documentPictureInPicture" in window)) {
    alert("Pop-out needs Chrome/Edge/Brave 116+. Captions still work in this tab.");
    return;
  }
  const pipWin = await window.documentPictureInPicture.requestWindow({
    width: 480, height: 240,
    disallowReturnToOpener: false,
  });
  // Copy our stylesheet into PiP
  document.querySelectorAll("style, link[rel=stylesheet]").forEach(node => {
    pipWin.document.head.appendChild(node.cloneNode(true));
  });
  // MOVE (not copy) the caption box into PiP
  const captionEl = document.getElementById("caption-box");
  pipWin.document.body.appendChild(captionEl);
  // Move back when PiP closes
  pipWin.addEventListener("pagehide", () => {
    document.getElementById("caption-mount").appendChild(captionEl);
  });
}
```

### 3.5 File structure

```
captionpip/
├── package.json
├── tsconfig.json (strict)
├── astro.config.mjs (Tailwind v4 via @tailwindcss/vite)
├── SPEC.md (this file)
├── DESIGN.md
├── AGENTS.md
├── README.md
├── LICENSE (MIT)
├── .env.example
├── .gitignore
├── public/
│   ├── favicon.svg
│   ├── favicon.ico
│   ├── apple-touch-icon.png
│   ├── icon-192.png
│   ├── icon-512.png
│   ├── manifest.webmanifest
│   ├── og-image.png (placeholder for v0.1)
│   ├── robots.txt
│   ├── _headers
│   └── whisper-worker.js
├── src/
│   ├── site.config.ts             # env-driven brand, .pages.dev guard
│   ├── layouts/
│   │   └── Layout.astro           # title, OG, JSON-LD, theme bootstrap, GA4-prod-gated
│   ├── components/
│   │   ├── Nav.astro
│   │   ├── Footer.astro
│   │   ├── ThemeToggle.astro
│   │   ├── BrandIcon.astro
│   │   ├── CaptionApp.astro        # the actual capture UI
│   │   └── CaptionApp.script.ts    # client-side TS that wires audio → worker → DOM
│   ├── lib/
│   │   ├── audioCapture.ts         # getDisplayMedia + AudioContext glue
│   │   ├── whisperClient.ts        # worker spawn + message proxy
│   │   ├── pipClient.ts            # Document PiP open/close
│   │   └── browserSupport.ts       # feature detection
│   ├── pages/
│   │   ├── index.astro             # hero + 3-step + CaptionApp
│   │   ├── about.astro
│   │   ├── contact.astro
│   │   ├── privacy.astro
│   │   ├── terms.astro
│   │   ├── disclaimer.astro
│   │   ├── 404.astro
│   │   └── sitemap.xml.ts
│   └── styles/
│       └── global.css              # Tailwind v4 @theme tokens + animations
```

---

## 4. Brand + design

**Wordmark:** "CaptionPip"
**Tagline:** "Live captions for any tab. Floats over anything. Never uploads."
**Brand icon:** Speech bubble (chat-like) with a small **PiP indicator** (mini speech bubble in the corner of the main bubble) — visually riffs on Document PiP itself
**Color identity:** dark default theme to match "designer/dev productivity tool" feel. Brand accent = a vibrant teal-cyan (`oklch(75% 0.15 200)`), distinct from screencolorpicker's VIBGYOR and FTN's blue
**Typography:** Geist Sans (UI) + Geist Mono (captions — feels like terminal, more readable for live streaming text)
**Brand exception rule:** the cyan accent is reserved for active/recording states. Idle UI = neutral grays.

(Full DESIGN.md to be written alongside scaffold.)

---

## 5. User journey (must verify each step works in v0.1 before declaring done)

```
1. Land on captionpip.com (or localhost:4321 in dev)
2. See hero: "Live captions for any tab. Floats over anything. Never uploads."
3. See 3-step explainer with icons:
   (a) Pick a tab → (b) Captions appear → (c) Pop out to float
4. Click big "Start captions" button
5. Browser permission prompt: "captionpip.com wants to share content from a tab"
6. User picks Chrome tab / window / screen + ticks "share audio" checkbox
7. Status changes to "Loading Whisper model... (one-time, ~75 MB)"
8. Progress bar fills as model downloads
9. Status changes to "Listening..."
10. User switches to YouTube tab + plays a video
11. ~3 seconds later, first caption appears in main page caption box
12. Captions stream live, auto-scrolling
13. User clicks "Pop out" button
14. Document PiP window opens (480x240)
15. Caption box now lives in PiP — main page shows placeholder
16. User can switch to ANY app — PiP stays on top
17. User clicks "Stop captions" in PiP — capture ends, PiP stays open showing last text
18. User closes PiP — caption box returns to main page
```

**Manual test checklist (run in Edge on Windows before declaring v0.1 done):**

- [ ] Page loads, no console errors
- [ ] Theme toggle works light↔dark
- [ ] "Start captions" triggers picker
- [ ] Selecting a tab with audio (e.g., YouTube playing) succeeds
- [ ] Model loads first time, cached second time
- [ ] First caption appears within ~5s of speech
- [ ] Subsequent captions stream
- [ ] "Pop out" opens floating window
- [ ] PiP window stays on top when switching to another app
- [ ] Captions continue updating in PiP
- [ ] "Stop captions" ends capture cleanly
- [ ] Closing PiP returns caption to main page (no orphan DOM)
- [ ] Selecting a tab WITHOUT audio shows "no audio detected" message after 10s
- [ ] Page works in Firefox: caption box shows, "Pop out" hidden with explainer
- [ ] All trust pages reachable + render correctly
- [ ] `npm run build` exits 0
- [ ] `npx astro check` exits 0 with 0 TS errors

---

## 6. Honest limitations (DISCLOSE in product copy)

1. **Browser support: Chromium-only for PiP.** Firefox + Safari show captions in-tab only.
2. **macOS users can't capture system audio outside browser** (e.g., desktop Zoom). Tab audio works fine. Documented in FAQ.
3. **iOS Safari: doesn't work.** No `getDisplayMedia` on mobile Safari. Hide CTA on mobile.
4. **English captions only in v0.1.** Other languages coming in v0.2.
5. **3-second latency** (chunk size). Real-time feeling is more like "delayed subtitles" than "live caption."
6. **Model is whisper-base (~75 MB)** — first load is slow on poor connections. Cached forever after.
7. **WebGPU required** for acceptable speed. Falls back to WASM (3-5x slower) on devices without WebGPU. Show warning.

---

## 7. Known unknowns to verify during build (validation gates)

- [ ] Whisper-base via WebGPU latency on shrestha's WSL/Windows machine — target: <2s per 3s chunk
- [ ] Does PiP window persist when entering full-screen video in another tab? (Spec says yes, need to confirm)
- [ ] Does `getDisplayMedia` audio survive when the captured tab is BACKGROUNDED? (critical — if not, the whole product breaks)
- [ ] Memory ceiling: does ~30min of continuous captioning leak?

These are gates. If any FAILS during v0.1 build, halt and re-plan before continuing.

---

## 8. v0.1 success criteria

**MVP is "done" when:**
- Shrestha can open localhost site in Edge, click Start, pick a YouTube tab playing English content, see live captions appear within 5s, click Pop Out, switch to another window, and see captions still updating in the floating window.
- All checklist items in §5 pass on Windows + Edge.
- Build is clean (`npm run build && npx astro check`).
- Repo pushed to GitHub, commit message references this spec.

**NOT required for v0.1:**
- Looking polished
- Working on Mac/Linux/Firefox/Safari (just don't crash; degraded experience OK with explainer)
- Hindi / IndicWhisper
- Any monetization
- Cloudflare Pages deploy (do it later when shrestha decides this product is alive)

---

## 9. Open questions for shrestha after v0.1 demo

1. **Latency acceptable?** If 3s feels too slow, we can drop chunk to 2s but accuracy drops noticeably.
2. **Hindi priority?** If YES → v0.2 leads with IndicWhisper integration. If NO → v0.2 focuses on transcript download + caption styling.
3. **Domain pick:** stick with `captionpip.com` or pick from the available list?
4. **Brand visual:** speech-bubble-with-pip vs something else?
5. **Pip.tools portfolio play** — should the next 2 tools (FloatPrompt, ScreenRecPip) live on separate domains or under a unified pip.tools umbrella?
