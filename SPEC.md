# CaptionPip — Spec

**Status:** v0.1 → v0.3.1 shipped · **v0.3.2 IN PROGRESS** (translate-mode removal + PiP substate bug fix)
**Date:** 2026-06-08 (v0.1) · 2026-06-09 (v0.1.1 → v0.3.0)
**Working domain:** `captionpip.com` (RDAP-verified available — buy before commit if you keep the name)
**Repo:** `github.com/shrestha-tripathi/captionpip` (private until shipped)
**Ship target:** v0.3.0 this week

## Changelog

| Version | Date | Highlights | Commit |
|---|---|---|---|
| v0.1 | 2026-06-08 | Functional prototype: capture → worker → caption box, light/dark, trust pages, SEO baseline | `f1c7305` |
| v0.1.1 | 2026-06-09 | Worker hang fix (onnx-community model + timeout); PiP-first flow (zero alt-tabs) | `15797ca`, `e807289` |
| v0.1.2 | 2026-06-09 | **Rolling-window real-time captions** — first word within ~700ms, in-place refresh, LocalAgreement-2 commit | `41e1e87` series |
| v0.1.3 | 2026-06-09 | UX polish: silence guard, hallucination filter, native PiP look, % size sliders, theme-aware PiP, live-tail preservation | `e2dd088` series |
| **v0.2.0** | 2026-06-09 | **Polish release** — model picker (tiny/base/small), caption customization (size/weight/position), transcript download (.txt/.vtt/.srt), microphone-only mode, FAQ refresh | `fbb98e8` → `b8a9883` |
| v0.2.1 | 2026-06-09 | Layout patch: nav + footer widened from max-w-5xl to max-w-7xl for better left-anchoring on big screens | `192c05e` |
| **v0.3.0** | 2026-06-09 | **Translation mode** — Whisper auto-detect any language → English captions (zero new model download) | `69b0713` → `8395fd0` |
| **v0.3.1** | 2026-06-09 | Bug fixes: stopped sub-state UI (Stop → Done, Start new btn) + music-hallucination filter (n-gram + `no_repeat_ngram_size: 3`) | `e1fb064` + `0e52ae1` |
| **v0.3.2** | _in progress_ | **Translate mode removed** (quality wasn't good enough on real-world music + Hindi content); **PiP substate bug fixed** (header stayed STOPPED after Start new because `setSubstate` queried from rootEl which doesn't contain the caption-box while PiP is open) | _see below_ |

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

---
---

# v0.1.2 — Rolling-window real-time captions

> **Answer to §9.1:** "3s feels too slow" — YES. This section is the fix.
> Replaces the fixed 3-second chunking pipeline with a sliding-window
> streaming transcriber that mirrors Xenova's `realtime-whisper-webgpu`
> reference demo. First word appears in **~700ms** instead of ~3s, with
> captions refreshing in-place as Whisper revises its hypothesis. Final
> committed text remains stable via the LocalAgreement-2 confirmation
> algorithm. No new dependencies. No new permissions. No model swap
> (still `onnx-community/whisper-base`).

## 1.2.0 Why this matters (the real motivation)

The user just got back from testing v0.1.1 on macOS. PiP-first flow works.
But: **3-second caption lag feels like delayed subtitles, not live
captioning.** When you're using captions to follow a conversation, every
extra second is one more sentence of context you've lost. The competitor
to beat here is Chrome Live Caption — which feels effectively instant on
ChromeOS — and the YouTube auto-CC, which feels real-time even though it's
also chunked behind the scenes.

Both achieve "real-time feel" via the same trick: **show your best guess
immediately, then refine it as more audio arrives.** That's what this
spec adds.

## 1.2.1 The model behind rolling-window streaming

Three concepts (borrowed from Xenova's reference demo + LocalAgreement
papers, but kept as simple as we can):

1. **Rolling buffer** — instead of dispatching a 3-second chunk every 3
   seconds, we maintain a sliding window of recent audio (e.g. last 10s)
   and transcribe **the entire window** on every tick. Tick rate is
   ~600ms. Whisper is fast enough on WebGPU (whisper-base does
   3-5s audio in 200-400ms on a mid-range GPU).

2. **Live (uncommitted) line** — the transcription of the rolling window
   is shown as a **single mutable line** at the bottom of the caption
   stream. Every tick the line gets replaced. So the user sees their
   captions visibly refining: "I think" → "I think we should" → "I think
   we should ship this" in three ticks. Feels like Live Caption.

3. **LocalAgreement-2 commit** — when the same prefix appears in two
   consecutive transcriptions, that prefix is "agreed" and gets promoted
   from the live line to a permanent caption (appended to the stream).
   This is the only correctness guard: never commit a word until the
   model has said it twice in a row across overlapping windows. After
   commit, the audio behind that prefix is trimmed from the rolling
   buffer to bound memory + transcription cost.

### Visual timeline

```
t=0.0s   user speaks "hello world"
t=0.6s   tick:    live = "Hello"
t=1.2s   tick:    live = "Hello world"               (no commit yet — never said before)
t=1.8s   tick:    live = "Hello world how are"        ↰
                  COMMIT "Hello world"  ← "Hello world" said twice → promoted
                  stream:
                    Hello world
                  live = "how are"
t=2.4s   tick:    live = "how are you"
t=3.0s   tick:    live = "how are you doing"
                  COMMIT "how are"
                  stream:
                    Hello world
                    how are
                  live = "you doing"
...
```

User sees the first word ~700ms after speaking; sees committed text
stabilize ~1.5-2s after speaking. Both are dramatically better than
"3 seconds of silence then a sentence appears".

## 1.2.2 Latency budget (target vs. allowable)

| Metric | Target | Hard cap |
|---|---|---|
| First word visible after speech start | 700ms | 1200ms |
| Live line refresh interval | 600ms | 1000ms |
| Time to "committed" (final text shown) | 1500ms | 2500ms |
| Memory ceiling after 10min continuous capture | 50MB | 80MB |
| Whisper inference per tick (WebGPU, whisper-base) | 250ms | 500ms |
| Whisper inference per tick (WASM fallback) | 800ms | 1500ms |

If WebGPU per-tick exceeds 500ms on the user's machine: **dynamically
extend tick interval** to (last_tick_ms × 1.5) so we never queue more
ticks than the worker can drain. This avoids the worker getting buried
under a backlog.

## 1.2.3 Architecture changes

### Files touched

| File | Change | Why |
|---|---|---|
| `public/whisper-worker.js` | Add streaming-mode transcribe (re-uses `pipeline()` with different chunk args; surfaces partial result) | Worker now distinguishes "windowed transcription" from "final transcription" |
| `src/lib/audioCapture.ts` | Replace fixed 3s chunker with rolling buffer + tick scheduler | The "tick on 600ms" cadence is the core change |
| `src/lib/whisperClient.ts` | Add `transcribeWindow(audio)` method, expose committed-prefix protocol | Parent needs a fast loop, not request-per-chunk |
| `src/lib/agreement.ts` (NEW) | LocalAgreement-2 algorithm + buffer trim logic | Isolated so it can be unit-tested independently of the worker |
| `src/components/CaptionApp.script.ts` | Wire new audioCapture + agreement; render live line + committed stream | UI semantics change: one live line + committed lines above it |
| `src/components/CaptionApp.astro` | Add `<p id="cp-caption-live">` slot under `#cp-caption-stream` | Live line lives outside the committed stream so we can refresh it without re-rendering committed text |

### Files NOT touched

- `src/lib/pipClient.ts` — PiP flow stays the same. The live line is a
  child of the caption box, so it moves with PiP for free.
- `src/site.config.ts`, `astro.config.mjs` — no env changes.
- Trust pages, SEO, headers — no change.
- The Whisper model (`onnx-community/whisper-base`) — no change.
  v0.1.2 ships latency win on the same model; **swapping to whisper-tiny
  for even more speed is deferred to v0.2** so we don't compound risk.

### What's intentionally NOT in v0.1.2

To keep risk bounded:

- ❌ Voice Activity Detection (Silero VAD) — would let us skip silence and
  save GPU cycles, but adds a 5MB model + new failure mode. **Deferred to
  v0.2** alongside the language picker (which needs VAD for hint).
- ❌ AudioWorklet upgrade — ScriptProcessorNode is deprecated but works,
  and refactoring it now would mix concerns with the rolling-window
  change. **Deferred to v0.2.**
- ❌ Model picker (tiny/base/small) — even though tiny would cut latency
  more, the user said in the prior session: "let's not pile changes."
  Single model for v0.1.2. **Deferred to v0.3 as already planned.**
- ❌ Punctuation polish / sentence segmentation. Whisper's output already
  has reasonable punctuation; investing in better is a v0.3 thing.
- ❌ Translation, transcript download, mic-only mode — all v0.2.

## 1.2.4 LocalAgreement-2 algorithm

The reference demo's algorithm in plain language:

```
state:
  committed_text: string   # everything we've promoted to the stream
  last_hypothesis: string  # the live line from the PREVIOUS tick

on each tick:
  1. transcribe(rolling_buffer) → new_hypothesis
  2. agreed_prefix = longest common word-prefix of last_hypothesis
                     and new_hypothesis
  3. if agreed_prefix is non-empty AND extends past committed_text:
       new_committed_words = words(agreed_prefix) - words(committed_text)
       append new_committed_words to caption stream
       committed_text = agreed_prefix
       trim rolling_buffer by (samples_per_word × new_committed_words.length)
  4. live_line = new_hypothesis stripped of committed_text prefix
  5. last_hypothesis = new_hypothesis
```

Key invariants the unit tests must enforce:

- **Monotonicity**: once a word is committed, it never gets retracted.
- **No duplicates**: committed words never appear in live line.
- **Buffer bound**: rolling buffer never exceeds `MAX_BUFFER_SECONDS` (15s).
  If a tick goes that long without any agreement (e.g. silence inside a
  hesitation), we force-commit the entire current hypothesis as a "best
  guess" line and reset the buffer. Better to risk one wrong line than
  let memory grow unbounded.
- **Word-boundary safe**: prefix comparison is at word boundaries, not
  character boundaries. ("Hello wor" should never commit "wor".)

## 1.2.5 Rolling buffer mechanics

```typescript
// src/lib/audioCapture.ts — new exports
export interface RollingBuffer {
  /** Append samples to the buffer. Called from the audio thread. */
  append: (samples: Float32Array) => void;
  /** Get a copy of current buffer contents (zero-copy view). */
  snapshot: () => Float32Array;
  /** Drop the first N samples from the front (after commit). */
  trimFront: (samples: number) => void;
  /** Current buffer length in samples. */
  length: () => number;
  /** Reset to empty (for force-commit edge case). */
  reset: () => void;
}

// Constants
export const ROLLING_MAX_SECONDS = 15;   // hard ceiling
export const ROLLING_TARGET_SECONDS = 10; // soft target after trim
export const TICK_INTERVAL_MS = 600;     // 1.67 ticks/sec
export const MIN_AUDIO_SECONDS = 0.5;    // don't tick until we have this much
```

The capture API changes from "fire onChunk every 3s" to:

```typescript
// OLD
opts.onChunk(audio: Float32Array)  // called every 3s with a chunk

// NEW
opts.onAudio(samples: Float32Array)  // called continuously, ~every 80ms
// + parent runs its own setInterval(TICK_INTERVAL_MS) to call worker.transcribe(buffer.snapshot())
```

This puts tick scheduling in the parent (caption script), which is the
right place because tick rate adapts based on observed Whisper latency.

## 1.2.6 Worker protocol changes

```javascript
// public/whisper-worker.js — new message handling

// NEW outgoing message:
//   { type: "result", text: string, id: number, durationMs: number }
//     ← durationMs lets parent adapt tick interval

// Transcribe args change to use streaming-friendly Whisper parameters:
const result = await asr(audio, {
  chunk_length_s: 30,        // unchanged — Whisper's native max
  stride_length_s: 5,        // unchanged
  return_timestamps: false,  // we don't need timestamps in v0.1.2
  language: "english",
  task: "transcribe",
  // NEW: tighter sampling for streaming
  num_beams: 1,              // greedy — fastest, only ~5% accuracy hit
  temperature: 0,            // deterministic — important for agreement!
});
```

`temperature: 0` is load-bearing for LocalAgreement: with random sampling,
two ticks would produce different outputs even on identical audio, so
agreement-based commit would never fire.

## 1.2.7 UI changes (CaptionApp.astro)

```html
<div id="cp-caption-stream" class="caption-text text-[var(--color-fg)]">
  <p class="text-[var(--color-fg-subtle)] text-sm italic">Listening… first word appears within ~1 second.</p>
</div>

<!-- NEW: live/uncommitted line, refreshed in-place every tick -->
<p
  id="cp-caption-live"
  class="caption-text text-[var(--color-fg-muted)] italic mt-2 hidden"
  aria-live="polite"
  aria-atomic="true"
></p>
```

CSS:
- Committed lines (`#cp-caption-stream > p`) — full opacity, normal weight
- Live line (`#cp-caption-live`) — muted color + italic, signals "tentative"
- `aria-live="polite"` so screen readers announce the live line as it
  refreshes (this is the accessibility win: screen-reader users get
  real-time-feel too)

## 1.2.8 Adaptive tick interval (safety net)

If user is on a weak WebGPU device (e.g. integrated graphics), per-tick
inference can blow past TICK_INTERVAL_MS. We must not queue ticks faster
than the worker can drain. Pseudocode:

```typescript
let nextTickMs = TICK_INTERVAL_MS;
const MAX_TICK_MS = 2000;

function scheduleNextTick() {
  setTimeout(tick, nextTickMs);
}

async function tick() {
  if (!whisperReady) return scheduleNextTick();
  if (rollingBuffer.length() / TARGET_SAMPLE_RATE < MIN_AUDIO_SECONDS) {
    return scheduleNextTick();
  }
  const audio = rollingBuffer.snapshot();
  const startMs = performance.now();
  const text = await whisper.transcribeWindow(audio);
  const durMs = performance.now() - startMs;
  // adapt: never tick faster than 1.2× last inference
  nextTickMs = Math.min(MAX_TICK_MS, Math.max(TICK_INTERVAL_MS, Math.ceil(durMs * 1.2)));
  agreement.ingest(text);  // does commit + buffer trim
  renderLiveLine(agreement.liveLine);
  for (const w of agreement.newlyCommitted) appendCaption(w);
  scheduleNextTick();
}
```

If WebGPU dies and we fall back to WASM (which can take 800-1500ms per
tick), the user just experiences ~1.5-2.5s update cadence — still better
than the old 3s, and the UI still feels "live" because the live line
shimmers in.

## 1.2.9 Stale-name cleanup (load-bearing — do not skip)

Two stale `Xenova/whisper-base` references survived the v0.1.1 worker
fix and must be updated as part of v0.1.2:

| File | Line | Current | Target |
|---|---|---|---|
| `src/lib/whisperClient.ts` | ~70 | `init(model = "Xenova/whisper-base")` | `init(model = "onnx-community/whisper-base")` |
| `src/components/CaptionApp.script.ts` | ~263 | `whisper.init("Xenova/whisper-base")` | `whisper.init()` (let default win) |

Reason: the worker's default is correct, but if either of these names
gets passed through it'd hit the same silent hang from before. Belt and
suspenders.

## 1.2.10 Testing strategy

Three layers:

1. **Unit tests for agreement.ts** (Vitest, new) — pure functions,
   deterministic, no DOM. Cover: empty hypothesis, full agreement,
   no agreement, agreed prefix shorter than committed (no-op), force-commit
   on buffer overflow.
2. **Visual smoke test** — `npm run dev`, captioning a known YouTube
   video (suggest: any TED talk, ~3min, clear speech). First word must
   appear within 1.5s of speech start (target 700ms).
3. **Stress test** — caption a 30-minute talk continuously. After end:
   - `performance.memory.usedJSHeapSize` increase should be < 80MB
   - No console errors
   - Caption stream has reasonable text, no obvious garbage
   - Live line ends cleanly (empty or last partial phrase)

## 1.2.11 Manual test checklist (run on Windows + Edge before declaring done)

- [ ] `npm run dev` → http://localhost:4321
- [ ] Click "Start captions"
- [ ] PiP window opens floating
- [ ] Pick a YouTube tab + tick "Share tab audio"
- [ ] Model loads — status visible inside PiP caption box
- [ ] Status: "Listening… (WEBGPU)"
- [ ] User starts video — **first word visible within 1.5s of speech**
- [ ] Live line visibly refines every ~600ms (italic, muted color)
- [ ] As words stabilize, they "commit" into the stream above (full color, not italic)
- [ ] Committed words NEVER change after they appear
- [ ] After 30s: live line + ~6-10 committed lines, no glitches
- [ ] Click "Stop captions" → live line clears, captures stops
- [ ] After 5min capture: console clean, no memory warnings
- [ ] In WASM fallback (force by disabling WebGPU): captions still appear,
      just slower cadence (~1.5s). Live-line feel still present.
- [ ] Both light + dark themes: live line is visibly distinct from
      committed (muted color + italic must work in both)
- [ ] All v0.1 + v0.1.1 functionality still works (PiP-first, stop, reset)

## 1.2.12 Success criteria

v0.1.2 is "done" when:
- First word appears within 1.5s of speech start on shrestha's WSL/Edge box
- Live line refresh is visibly continuous (not jumpy or stalled)
- Committed text is monotonic — no flickers, no retractions
- All v0.1 + v0.1.1 user journey items still pass
- `npm run build && npx astro check` exits 0
- Memory after 10-min continuous: < 80MB heap growth
- Vitest unit tests for `agreement.ts` all pass (deferred to plan)

**NOT required for v0.1.2:**
- Working on mobile (still doesn't apply — no PiP, no getDisplayMedia)
- Hindi / IndicWhisper (still v0.2)
- Transcript download (still v0.2)
- AudioWorklet migration (still v0.2)

## 1.2.13 Implementation plan

A bite-sized task-by-task implementation plan will live at
`docs/plans/2026-06-09-rolling-window-captions.md` once this spec is
approved. The plan covers:

1. Scaffold `src/lib/agreement.ts` + unit tests (TDD — failing tests first)
2. Refactor `audioCapture.ts` to rolling-buffer mode (keep old `onChunk` removed)
3. Add `transcribeWindow` + `durationMs` to whisperClient.ts
4. Update worker with greedy/deterministic sampling args
5. Update CaptionApp.astro DOM for live line
6. Update CaptionApp.script.ts to use new pipeline (tick scheduler + agreement)
7. Stale-name cleanup (the two Xenova refs)
8. Manual test + commit

Each task ends with a green test run + a commit. One feature, one commit
(per AGENTS.md rule 6).

## 1.2.14 Rollback plan

If v0.1.2 ships and breaks for someone:

- v0.1.1 lives at commit `e807289` — full revert is `git revert <range>`
- The model file is unchanged, so cached models on user's IndexedDB still work after revert
- No backend, no migrations, no user data → revert is purely a deploy step

This is a high-confidence change because the experimental piece
(agreement.ts) is isolated and unit-tested in pure-function form. The
worker change is additive (existing single-shot transcribe still works).
The capture refactor is the riskiest piece — covered by the explicit
manual test checklist + the rollback being a one-commit revert.

## 1.2.15 Open questions for shrestha (decide before plan execution)

1. **Live line styling — italic + muted color, OR a typing cursor "▋" suffix?**
   Reference demos use both. My pick: italic + muted (less visually noisy
   during fast refinement; clearer that it's "draft"). Pushback welcome.
2. **Tick interval — 600ms (1.67 Hz) or 400ms (2.5 Hz)?** 400ms feels
   more "live" but burns more GPU. My pick: 600ms is the safe default,
   tune down later if your machine handles it. Reference demo uses ~500ms.
3. **Commit immediately on first agreement, or wait for agreement
   on N=3 ticks?** Reference demo uses N=2 (what I've specced).
   N=3 is more conservative (lower hallucination risk, more lag-to-commit).
   My pick: N=2 — first agreement is enough; v0.2 can promote to N=3 if
   users complain about wrong text being committed.

---
---

# v0.2.0 — Polish release

> **Theme:** "Production-grade, not weekend prototype." Four user-visible
> upgrades that together transform CaptionPip from a clever demo into a
> tool people actually choose over Otter / YouTube CC / Chrome Live
> Caption. No new architecture, no model swaps, no scope creep.

## 2.0.1 Why now

Two months of v0.1.x shipped the core engine. Captions feel real-time,
the silent / hallucinated outputs are tamed, the PiP looks native, both
themes pass. What is missing is **the bar of expectations a user brings
from competing products** — they expect to pick a model, customize
caption look, save the transcript, and use a microphone instead of a
tab. v0.2.0 delivers all four.

## 2.0.2 IN SCOPE

### 1. Model picker (whisper-tiny / whisper-base / whisper-small)

| Model | Size | Speed (WebGPU) | Accuracy | Tradeoff |
|---|---|---|---|---|
| **whisper-tiny** | 39 MB | ~2x faster | ~5% worse WER | Fastest first-load, OK for clean English |
| **whisper-base** | 74 MB | baseline (current) | baseline | Default — balanced |
| **whisper-small** | 244 MB | ~2x slower | ~10% better WER | Best quality, slow first download |

UI:
- Dropdown in the idle screen prefs panel, BELOW the size sliders
- Each option shows its size + a cache indicator (checkmark if already in IndexedDB, arrow if download needed)
- Selection persists in `localStorage` key `captionpip:model-pref`
- Switching models mid-session is NOT supported in v0.2.0 — applies to next Start. Documented inline.
- All three are `onnx-community/whisper-{size}` (consistent dtype variants — critical, per existing skill notes)

Implementation:
- Constant `AVAILABLE_MODELS` in `whisperClient.ts` maps user labels to HF model IDs
- `init()` already accepts a model param — wire UI selection through
- IndexedDB cache check via the transformers.js standard cache key pattern

### 2. Caption customization

User controls (in the idle prefs panel, NEW collapsible "Caption style" section):

| Control | Range | Default |
|---|---|---|
| **Font size** | 80% to 200% (5% step) | 100% |
| **Font weight** | Regular / Medium / Bold | Regular |
| **Caption position** in PiP | Top / Middle / Bottom | Top (default, current) |
| **Text shadow** | toggle | ON (for over-video legibility) |

Implementation:
- All controls drive CSS custom properties on `.cp-caption-box`:
  `--caption-font-scale`, `--caption-font-weight`, `--caption-align`, `--caption-shadow`
- Existing `.caption-text` rule reads these vars with sensible fallbacks
- Position uses flex `align-items` on `#cp-caption-stream` (top/center/end)
- Persisted to `captionpip:caption-style` JSON in localStorage
- Live-applies when slider changes (works for both inline and PiP via CSS var)

### 3. Transcript download (.txt / .vtt / .srt)

After Stop, the active panel shows a "Download transcript" button group:

- **.txt** — plain text, one paragraph per detected pause / line cap
- **.vtt** — WebVTT, segment timestamps derived from agreement commits
- **.srt** — SubRip, same data as VTT in SRT format

Timestamps:
- We do not have word-level timestamps yet. For v0.2.0 we use **segment-level**
  timestamps recorded each time `appendCommittedWords()` fires, paired
  with `performance.now() - sessionStartMs`.
- VTT/SRT will be slightly imprecise (~600-1200ms granularity matching
  tick rate). Documented honestly in the UI tooltip.

Implementation:
- New module `src/lib/transcript.ts` — pure functions
- New buffer in `CaptionApp.script.ts` recording every commit with its timestamp
- Uses `URL.createObjectURL(new Blob(...))` + synthetic `<a download>` click

### 4. Microphone-only mode

Idle screen now has a source toggle:

- **"Tab / window"** — current `getDisplayMedia` flow (default)
- **"Microphone"** — new `getUserMedia({audio: true})` flow

Use cases unlocked:
- Voice notes / dictation
- Recording your own speech (interviews, podcast prep)
- Captioning a meeting where YOU are the speaker

Implementation:
- `audioCapture.ts` factor out the AudioContext/RollingBuffer wiring
- New `startMicCapture` uses `getUserMedia({audio: true, video: false})`
  with `echoCancellation: false` + `autoGainControl: false` so it
  does not process the speech before Whisper sees it
- Mic mode skips the tab picker — faster to first word

### 5. FAQ copy refresh

Stale claims to fix:
- "Why is there a ~3-second delay?" — updated to ~700ms with rolling-window explanation
- Add new Q: "Can I switch models?"
- Add new Q: "Can I download the transcript?"
- Add new Q: "Can I use my microphone?"

## 2.0.3 OUT OF SCOPE (still deferred)

- Language picker (defer to v0.2.1)
- IndicWhisper / Hindi (defer to v0.2.2)
- Translation (defer to v0.3)
- AudioWorklet migration (defer to v0.3)
- Silero VAD (defer to v0.3 — current silence guard is good enough)
- Speaker diarization (defer to v0.3)
- Browser-extension companion (defer to v0.3)
- Mid-session model switching (defer to v0.3)
- Demo video on landing page (separate marketing task)
- Live sample audio for "try without picking" (defer to v0.2.1)
- Keyboard shortcuts (defer to v0.2.1)
- "Continue from last session?" replay (defer to v0.2.1)
- Background-tab throttling fix (defer to v0.2.1 — needs investigation)

## 2.0.4 Architecture impact (minimal)

| Layer | Change |
|---|---|
| `whisperClient.ts` | New `AVAILABLE_MODELS` constant + cache-check helper |
| `audioCapture.ts` | Extract shared pipeline so `startMicCapture` can reuse |
| `pipClient.ts` | No change — caption customization is CSS-var driven |
| `agreement.ts` | No change |
| `CaptionApp.astro` | New prefs sub-panels + source toggle + download buttons |
| `CaptionApp.script.ts` | Wire new prefs + recording buffer + download/mic handlers |
| `transcript.ts` (NEW) | Pure formatter functions for .txt / .vtt / .srt |
| `global.css` | Caption-style CSS custom properties + defaults |

## 2.0.5 Persistence

```
captionpip:model-pref        — "tiny" | "base" | "small"
captionpip:caption-style     — { fontScale, fontWeight, position, textShadow }
captionpip:pip-prefs         — existing { widthPct, heightPct }
captionpip:inline-pref       — existing "0" | "1"
captionpip:theme             — existing "light" | "dark"
```

Forward-compat: each `loadXxx()` helper falls back to defaults on parse
failure or missing keys.

## 2.0.6 Manual test checklist (run on Windows + Edge)

- [ ] `npm run dev` -> http://localhost:4321
- [ ] Open Floating window prefs -> see Width / Height % + cap preview (existing)
- [ ] Open NEW "Model" panel -> see tiny / base / small dropdown, with size + cache indicator
- [ ] Open NEW "Caption style" panel -> font size slider, weight selector, position, shadow toggle
- [ ] Open NEW "Source" toggle on Start -> see "Tab" and "Microphone" options
- [ ] Pick whisper-tiny -> Start (tab) -> verify "TINY" appears in status briefly
- [ ] Pick whisper-base -> Start (tab) -> verify (default)
- [ ] Change font size to 150% -> captions visibly larger in real time
- [ ] Change position to Bottom -> captions bottom-aligned in PiP
- [ ] Stop captioning -> "Download" buttons appear -> click .txt -> file downloads
- [ ] Click .vtt -> file downloads with timestamps
- [ ] Click .srt -> file downloads with SRT format
- [ ] Reload page -> all prefs persist correctly
- [ ] Pick "Microphone" source -> permission prompt -> speak -> captions appear in PiP
- [ ] FAQ section: latency Q says ~700ms, has new model/transcript/mic Qs
- [ ] All v0.1.x functionality still works
- [ ] `npm run build && npx astro check` exits 0
- [ ] `npm test` exits 0

## 2.0.7 Success criteria

v0.2.0 ships when:
- All 4 features functional + tested
- All existing prefs (size sliders, theme, inline-pref) still work
- Transcript downloads produce valid .txt / .vtt / .srt files
- Both themes still pass for ALL new UI elements
- Build clean, 14/14 unit tests still green
- New skill notes added for: cache-check pattern, transcript format conventions

## 2.0.8 Estimated commits

| # | Scope | LOC est |
|---|---|---|
| 1 | Model picker | ~200 |
| 2 | Caption style controls | ~250 |
| 3 | Transcript download (incl. new `transcript.ts`) | ~300 |
| 4 | Microphone mode (incl. `startMicCapture` extract) | ~200 |
| 5 | FAQ copy refresh | ~50 |

Total: ~1000 LOC, 5 commits.


---

# v0.3.0 — Translation Mode

**Goal:** Make CaptionPip useful for users watching/consuming content in foreign languages. Whisper natively supports a `translate` task that takes any of 99 source languages and outputs English — no new model download, no bundle bloat, no API call. This is a structural moat play: Otter/Fireflies sell this as a $30/mo cloud feature; we ship it for $0, 100% local.

## 3.0.1 Why now

- **It's the cheapest "wow" we can ship.** transformers.js' `pipeline()` already accepts `task: "translate"` on the existing Whisper pipeline. ~2 lines of worker change + a UI toggle.
- **It demos viscerally.** "Open a Spanish YouTube video → live English captions floating in PiP, never uploads." Shareable as a 30s screen recording.
- **Brand reinforcement.** "Live captions" → "Live captions + translation" expands the TAM ~5× (non-English content consumption is the dominant use case globally).
- **Zero degradation for English users.** Default stays `transcribe`; users opt in.
- **Side-steps the IndicWhisper quality problem entirely.** OpenAI's Whisper translate-to-English is well-validated across 99 languages.

## 3.0.2 IN SCOPE

### 1. Worker task parameter

- `transcribe(audio, opts?)` in the worker accepts `{ task: "transcribe" | "translate" }`. Default `"transcribe"` (preserves current behavior).
- Pipeline call becomes:
  ```js
  await asr(audio, { ...existing, task })
  ```
  When `task === "translate"`, Whisper's special tokens force English output regardless of detected source language. `language: "english"` stays — it's the OUTPUT language hint for translate mode.
- Worker re-uses the same pipeline instance. No reload between mode switches.

### 2. Client + script wiring

- `WhisperClient.transcribeWindow(audio, opts?)` takes optional `{ task }`. Defaults preserved.
- `CaptionApp.script.ts` reads `currentTask` from a top-of-`init()` `let` (TDZ rule), persisted to `localStorage["captionpip:task"]`. Default `"transcribe"`.
- Each `tick()` passes `{ task: currentTask }` to `transcribeWindow`.
- Switching mode mid-session resets agreement + rolling buffer (different output language = stale committed text is wrong).

### 3. UI — segmented Transcribe/Translate toggle

- New `.cp-segment-radio` group above the source toggle on the idle screen:
  ```
  Output mode
  [ Transcribe ] [ Translate → English ]
  Tiny helper: "Translate auto-detects spoken language and outputs English."
  ```
- During active session: small badge in the caption box header showing current mode (so users in PiP know what they're seeing).
- Switching mode in active session: prompt-free, just trigger reset + re-init agreement.

### 4. FAQ + landing copy refresh

- Add Q: "How do I get English captions for a foreign-language video?" → A explaining Translate mode.
- Hero subhead updated: "Caption a YouTube video, a podcast, a web meeting — anything your browser can hear. Translate any of 99 languages into English captions, live."
- Use-cases: add "Foreign-language YouTube lectures · Spanish podcasts · French interviews · Japanese game streams".
- Open-source/local angle stays the marquee pitch.

## 3.0.3 OUT OF SCOPE (still deferred)

- Translate INTO non-English languages (would need a second model — NLLB or M2M, defer to v0.4)
- Language picker for source language hint (Whisper's auto-detect is good enough; explicit picker can come in v0.3.1 if users ask)
- IndicWhisper (defer indefinitely — current quality not good enough per shrestha 2026-06-09)
- Speaker diarization (defer to v0.4)
- AudioWorklet migration (defer to v0.4)
- Browser extension (defer to v0.5)

## 3.0.4 Architecture impact (minimal)

| Layer | Change |
|---|---|
| `public/whisper-worker.js` | Accept `task` from message, pass to `pipeline()` call. Default `"transcribe"`. |
| `src/lib/whisperClient.ts` | `transcribeWindow(audio, opts?)` signature change. Message envelope adds `task`. |
| `src/components/CaptionApp.astro` | New segmented radio above source toggle. New badge inside caption box header. |
| `src/components/CaptionApp.script.ts` | `currentTask` state (top of `init()`), persistence helpers, switch handler that resets pipeline state. |
| `src/styles/global.css` | No new classes — reuses `.cp-segment-radio` from v0.2.0. |
| `src/pages/index.astro` | FAQ Q&A, hero subhead, use-cases list. |

## 3.0.5 Persistence

```
captionpip:task = "transcribe" | "translate"
```

Default `"transcribe"`. Load helper falls back to default on parse failure / unknown value.

## 3.0.6 Manual test checklist (run in Edge on Mac)

- [ ] Start in transcribe mode (default) → English video → English captions. No regression.
- [ ] Toggle to translate → wait for active session → captions still English. No reload required.
- [ ] Reload → toggle persists.
- [ ] Open a Spanish YouTube video (Despacito music video lyrics) → translate mode → English captions appear.
- [ ] Open a French interview → translate mode → English captions appear.
- [ ] Switch from translate → transcribe mid-session on the same Spanish video → Spanish captions appear (Whisper detects).
- [ ] PiP shows mode badge correctly in both modes.
- [ ] Mic mode + translate: speak in Hindi → English captions appear.
- [ ] Both themes still pass for the new toggle.

## 3.0.7 Success criteria

- Translate mode produces English output on a Spanish/French test clip with >70% word accuracy.
- Mode switch in active session is < 500ms (no model reload).
- No regression on existing English transcribe path.
- Build clean, 26/26 unit tests still green.
- Brand-grep clean.

## 3.0.8 Estimated commits

| # | Scope | LOC est |
|---|---|---|
| 1 | docs: v0.3.0 SPEC section | ~120 |
| 2 | feat(whisper): task param plumbing (worker + client) | ~40 |
| 3 | feat(captions): Transcribe/Translate toggle UI + persistence | ~120 |
| 4 | docs(landing): FAQ + hero + use-cases for translation | ~60 |

Total: ~340 LOC, 4 commits.
