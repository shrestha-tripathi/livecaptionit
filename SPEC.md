# LiveCaptionIt — Spec

**Status:** v0.1 → v0.4.2 SHIPPED + rebrand SHIPPED
**Date:** 2026-06-08 (v0.1) · 2026-06-09 (v0.1.1 → v0.3.2) · 2026-06-10 (rebrand CaptionPip → LiveCaptionIt, v0.4.0 → v0.4.2)
**Domain:** `livecaptionit.com` (LIVE, CF Pages wired 2026-06-10)
**Repo:** `github.com/shrestha-tripathi/livecaptionit` (private until shipped)
**Ship target:** v0.4.2 SHIPPED 2026-06-10

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
| **v0.4.0** | 2026-06-09 | **Friction-removal trio:** bundled sample audio demo (zero-permission preview), keyboard shortcuts (Enter/Esc/P/R/D/?), 20-session IndexedDB history with viewer + .txt/.vtt/.srt re-download | `eea8fa7` → `2e3d343` |
| **v0.4.1** | 2026-06-10 | **AudioWorklet migration** (replaces deprecated ScriptProcessorNode, audio thread = no main-thread jitter) + **Space pause/resume capture** (deferred from v0.4.0, new CaptureHandle.pause/resume API via AudioContext.suspend, dedicated PAUSED substate works inline + inside PiP) | `255588d` + `018b918` |
| **v0.4.2** | 2026-06-10 | **Session search** (debounced filter over cached transcripts on idle screen, AND-match multi-term, hidden when <3 sessions) + **JSON export/import** (v1 versioned bundle, skip-on-duplicate-id merge, MAX_SESSIONS-aware pruning, Import reachable on empty store for cross-device restore) | `496fd91` + `abebab0` |

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
livecaptionit/
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

**Wordmark:** "LiveCaptionIt"
**Tagline:** "Live captions for any tab. Floats over anything. Never uploads."
**Brand icon:** Speech bubble (chat-like) with a small **PiP indicator** (mini speech bubble in the corner of the main bubble) — visually riffs on Document PiP itself
**Color identity:** dark default theme to match "designer/dev productivity tool" feel. Brand accent = a vibrant teal-cyan (`oklch(75% 0.15 200)`), distinct from screencolorpicker's VIBGYOR and FTN's blue
**Typography:** Geist Sans (UI) + Geist Mono (captions — feels like terminal, more readable for live streaming text)
**Brand exception rule:** the cyan accent is reserved for active/recording states. Idle UI = neutral grays.

(Full DESIGN.md to be written alongside scaffold.)

---

## 5. User journey (must verify each step works in v0.1 before declaring done)

```
1. Land on livecaptionit.com (or localhost:4321 in dev)
2. See hero: "Live captions for any tab. Floats over anything. Never uploads."
3. See 3-step explainer with icons:
   (a) Pick a tab → (b) Captions appear → (c) Pop out to float
4. Click big "Start captions" button
5. Browser permission prompt: "livecaptionit.com wants to share content from a tab"
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
3. **Domain pick:** stick with `livecaptionit.com` or pick from the available list?
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
> upgrades that together transform LiveCaptionIt from a clever demo into a
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
- Selection persists in `localStorage` key `livecaptionit:model-pref`
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
- Persisted to `livecaptionit:caption-style` JSON in localStorage
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
livecaptionit:model-pref        — "tiny" | "base" | "small"
livecaptionit:caption-style     — { fontScale, fontWeight, position, textShadow }
livecaptionit:pip-prefs         — existing { widthPct, heightPct }
livecaptionit:inline-pref       — existing "0" | "1"
livecaptionit:theme             — existing "light" | "dark"
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

**Goal:** Make LiveCaptionIt useful for users watching/consuming content in foreign languages. Whisper natively supports a `translate` task that takes any of 99 source languages and outputs English — no new model download, no bundle bloat, no API call. This is a structural moat play: Otter/Fireflies sell this as a $30/mo cloud feature; we ship it for $0, 100% local.

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
- `CaptionApp.script.ts` reads `currentTask` from a top-of-`init()` `let` (TDZ rule), persisted to `localStorage["livecaptionit:task"]`. Default `"transcribe"`.
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
livecaptionit:task = "transcribe" | "translate"
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

---

# v0.4.0 — Sample Demo + Keyboard Shortcuts + Session Replay (planned)

**Date:** 2026-06-10
**Status:** IN PROGRESS

## 4.0.0 Goal

Three polish features that together transform the landing-page first-impression
and the returning-user experience. Shipped together because each is small
(~50-150 LOC) and they share zero conflicting code paths.

The umbrella theme is **friction removal**:

1. **Sample demo** removes onboarding friction. A new visitor currently needs to
   (a) pick a tab, (b) tick "Share tab audio" in the picker, (c) wait ~5-10s
   for the Whisper model to download — all before seeing any captions. Most
   bounce before that. A "Try with sample audio" button plays a bundled short
   English clip through the same pipeline so the captions visibly stream in
   without the user permitting anything. **Onboarding magic in one click.**

2. **Keyboard shortcuts** remove power-user friction. Space=pause/resume
   capture, Escape=stop, P=popout. Tiny ship, professional feel.

3. **Session replay via IndexedDB** removes returning-user friction. Today every
   reload loses everything. After v0.4, the last 20 sessions are persisted
   locally (audio NOT stored — only the committed transcript text + metadata)
   and listed under a new "History" pane on idle screen with one-click reload
   of the full transcript view. Storage stays 100% on-device — no privacy
   regression.

## 4.0.1 Scope — Sample Demo

### What ships

A new button below the segmented source toggle on the idle screen:

```
[ 🎬 Try with sample audio ]
```

Clicking it:
1. Resets agreement / rolling buffer / live tail (same as normal start)
2. Switches state machine to `loading` then `active` (same as normal flow)
3. Sets `data-substate="live"` and a NEW attribute `data-source="sample"`
4. Fetches `/sample.mp3` (~15s pre-recorded clear English narration about what
   LiveCaptionIt does — "Welcome to LiveCaptionIt. This sample plays through
   the same Whisper pipeline that captions your real audio. Notice how words
   appear in muted italic as Whisper is still considering them, then solidify
   into bold as the rolling-window agreement algorithm confirms them...")
5. Feeds the decoded audio into the same `RollingBuffer` + tick scheduler as
   live capture (no separate code path — proves the real pipeline works)
6. Plays the audio through a hidden `<audio>` element so the user HEARS what's
   being captioned in sync
7. Auto-stops when the audio ends (`onended` listener) → transitions to
   `stopped` substate with the full transcript visible + download buttons
8. Optional: small toast "That's it! Click Start to caption a real video."

### Why a fake-feed approach instead of a real demo video?

A bundled WAV/MP3 gives us:
- Zero browser permission prompts (no `getDisplayMedia` or `getUserMedia`)
- Predictable, demo-able output — Whisper transcription of the same audio is
  ~95% identical run-to-run
- Same code path as production — proves the architecture works
- Bandwidth: ~150-300KB MP3 (15s at 96kbps), one-time CDN-cached load
- Works on ALL browsers regardless of Document PiP / screen-capture support

### Asset

`public/sample.mp3` — created via macOS `say` command or a free TTS service,
~15s clear narration. Mono 16kHz to match Whisper's expected input.

### Architecture

Reuses 100% of the existing pipeline:

```
[Try sample] click
    ↓
startSampleSession()
    ↓
fetch("/sample.mp3") → ArrayBuffer
    ↓
AudioContext.decodeAudioData → AudioBuffer (decoded Float32 samples)
    ↓
resample to 16kHz if needed (we already have helper in audioCapture.ts)
    ↓
new RollingBuffer + agreement.reset()
    ↓
playAudio() → <audio> element starts playing for user
    ↓
feedSamplesInChunks() → push ~80ms chunks into rolling buffer at real-time pace
    ↓
existing tick scheduler picks up + transcribes via worker
    ↓
existing UI receives committed/liveLine words via existing handlers
    ↓
on audio.onended → stopPipeline() (existing function works as-is)
```

### Architecture impact

| Layer | Change |
|---|---|
| `public/sample.mp3` | New asset (~250KB, gitignored from git LFS unless tiny) |
| `src/lib/sampleFeed.ts` | NEW module — pure function `playSampleThroughPipeline(audioContext, onChunk, onLevel, onEnded)` |
| `src/components/CaptionApp.astro` | NEW button below source toggle, hidden `<audio>` element |
| `src/components/CaptionApp.script.ts` | NEW `startSampleSession()` calling sampleFeed; reuses existing tick/agreement/UI |
| `src/lib/audioCapture.ts` | Export `resampleTo16k()` helper as a pure function (currently inline) for sampleFeed reuse |
| `src/pages/index.astro` | Hero update mentioning "Try with sample audio" no-permission CTA |
| `tests/sampleFeed.test.ts` | NEW (3-4 cases) — verify chunking math, real-time pacing, onEnded callback |

### Success criteria

- Sample button visible on idle screen for all users (no support gating)
- Click → captions visibly appear within ~2s of audio start
- Audio plays through speakers in sync with captions
- Auto-stops cleanly on `ended` → stopped substate with download buttons usable
- Existing `startPipeline()` (real capture) unaffected — full regression pass

## 4.0.2 Scope — Keyboard Shortcuts

### What ships

Active-session keyboard shortcuts. On idle screen, just one shortcut.

| Context | Key | Action |
|---|---|---|
| Idle | `Enter` | Click Start (matches "primary action on enter" convention) |
| Active (live) | `Escape` | Stop captures (same as Stop button) |
| Active (live) | `P` | Pop out to PiP (no-op if already in PiP) |
| Active (live, in PiP) | `P` | Close PiP, return to inline |
| Stopped | `R` | Start new (same as "Start new" button) |
| Stopped | `D` | Download last transcript (.txt) |
| Anywhere | `?` | Toggle keyboard shortcuts help overlay |

**Deferred to v0.4.1:** `Space` pause/resume capture. Pausing without
re-prompting the picker requires exposing `AudioContext.suspend()` /
`resume()` through a new `CaptureHandle.pause()` / `resume()` API.
That's a meaningful audioCapture refactor, kept out of this commit to
hold the "one feature = one commit" line.

### UI

Subtle help text bottom-right of the caption box when in active state:
"Space pause · Esc stop · P popout · ? for help"

Help overlay (triggered by `?`): centered modal listing all shortcuts grouped
by context. Esc to dismiss. Same style as existing `<dialog>` pattern (we
already have one for the prefs panel).

### Implementation gotchas

1. **Don't capture keystrokes when user is typing in an input/textarea/select**
   — early-out in the global listener via
   `if (target.matches("input,textarea,select,[contenteditable]")) return;`
2. **Don't capture keystrokes when the PiP window has focus** — Document PiP
   shares the parent realm BUT keydown events fire on the active document.
   We need to install the listener on BOTH `window.document` and
   `pipWindow.document`. Add/remove on PiP open/close.
3. **Space pause is tricky** — pausing the tick scheduler is straightforward,
   but the rolling buffer would keep growing and eventually OOM. Solution:
   stop the audioCapture, keep `audioContext` warm. On resume: restart
   capture from the same source (`getDisplayMedia` returns same stream if
   stream is still alive; else re-prompt user).
4. **Help overlay is a `<dialog>` element** — Astro pages can render
   `<dialog>` natively. Open via `.showModal()`, close via `<form
   method="dialog">`. Works in all evergreen browsers.

### Architecture impact

| Layer | Change |
|---|---|
| `src/lib/shortcuts.ts` | NEW — pure-function shortcut registry, returns add/removeListener pair |
| `src/components/CaptionApp.astro` | Add `<dialog id="cp-shortcuts-help">`, footer help text |
| `src/components/CaptionApp.script.ts` | Wire shortcut handlers per state (idle/loading/active+live/active+stopped). Register on mount, on PiP open also register on pipWindow.document |
| `tests/shortcuts.test.ts` | NEW (5-6 cases) — verify dispatch logic, input-element exclusion, state gating |

### Success criteria

- All shortcuts work in inline mode
- Space/Esc/P work inside PiP (PiP window focus → caption updates in PiP)
- Typing in any input doesn't trigger shortcuts
- Help overlay opens/closes via `?` / Esc
- No regression on click-based controls

## 4.0.3 Scope — Session Replay (IndexedDB)

### What ships

Past sessions persisted locally. New "Recent sessions" pane below the source
toggle on idle screen, shows last 5 sessions with timestamp + preview. One-click
to view the full transcript in a read-only mode (no replay of audio — audio
is NEVER stored). User can re-download or copy. "Clear history" button at
the bottom.

### What's stored

```ts
type StoredSession = {
  id: string;           // UUIDv4
  startedAt: number;    // epoch ms
  endedAt: number;      // epoch ms
  source: "tab" | "mic" | "sample";
  transcript: TranscriptSegment[];  // full committed words + timestamps
  preview: string;      // first ~100 chars of transcript text for the list view
  modelId: string;      // "tiny" / "base" / "small"
};
```

**NOT stored:** raw audio, level data, decoder state, agreement internal state.

### IndexedDB schema

Database: `livecaptionit-history`
Version: 1
Object store: `sessions`
Key path: `id`
Indexes:
- `startedAt` (for sort-by-recency)
- `source` (for future filtering)

Cap at 20 most-recent sessions; on insert when at cap, delete oldest (by
`startedAt` index).

### UI

Idle screen layout (additive to existing):

```
[ existing prefs collapsible <details> ]
[ existing source toggle ]
[ NEW: 🎬 Try with sample audio button ]
[ Start captions ▶ ]

[ NEW: Recent sessions ]
  - 2 min ago · Tab · "Welcome everyone to today's meeting we'll be..." [view]
  - 1 hour ago · Mic · "Testing testing one two three this is a..." [view]
  - 3 hours ago · Sample · "Welcome to LiveCaptionIt. This sample plays..." [view]
  ...
  [Clear all history]
```

When user clicks `[view]`: open a `<dialog>` showing the full transcript in
read-only mode + download buttons (same .txt/.vtt/.srt formats we already
support) + close button. NO audio replay (we never stored it).

### Privacy copy update

Add to FAQ:

> **Does LiveCaptionIt store anything?**
> Only your last 20 caption transcripts (the text only — never audio) are
> saved locally in your browser via IndexedDB so you can revisit them. Click
> "Clear all history" anytime. Nothing ever leaves your device.

Privacy page: add a sentence about transcript storage.

### Architecture impact

| Layer | Change |
|---|---|
| `src/lib/sessionStore.ts` | NEW — IndexedDB wrapper (`saveSession`, `listSessions`, `getSession`, `deleteSession`, `clearAll`) |
| `src/components/CaptionApp.astro` | NEW "Recent sessions" section on idle, NEW `<dialog id="cp-session-view">` for viewer |
| `src/components/CaptionApp.script.ts` | On `stopPipeline()`: persist session if transcript.length >= 5 words. On mount: render recent sessions list. Wire `[view]` click. |
| `src/pages/index.astro` | New FAQ Q&A |
| `src/pages/privacy.astro` | One-sentence addendum |
| `tests/sessionStore.test.ts` | NEW (5-6 cases via fake-indexeddb npm package or manual mock) |

### Success criteria

- Session persisted after Stop with >= 5 words of transcript
- Recent sessions list shows on idle screen after reload (verifying IndexedDB persistence)
- View dialog shows full transcript with all segments
- Download buttons in view dialog produce correct .txt / .vtt / .srt
- Clear all history empties the list + the IndexedDB store
- 20-session cap enforced (insert 21st → oldest dropped)

## 4.0.4 Out of scope (still deferred)

- AudioWorklet migration (defer to v0.4.1)
- Speaker diarization (defer to v0.4.2)
- Real translate via NLLB (defer to v0.5)
- Browser extension (defer to v0.5)
- Search across stored sessions (defer to v0.4.3 once enough sessions exist to matter)
- Session export-as-JSON / cross-browser import (defer to v0.4.3)

## 4.0.5 Persistence

```
livecaptionit-history (IndexedDB)         — session transcripts, 20-cap
                                            (object store: sessions)
livecaptionit:shortcuts-tooltip-seen      — "1" once user has dismissed
                                            the keyboard shortcuts footer
                                            (defer to user feedback first)
```

No new localStorage keys required for sample demo — the existing
`livecaptionit:source-pref` is reused with new value `"sample"` only during
active sample session, never persisted as the user's preference.

## 4.0.6 Manual test checklist

### Sample demo
- [ ] Idle screen shows "Try with sample audio" button
- [ ] Click → no permission prompt, sample plays through speakers, captions stream
- [ ] Auto-stop on audio end → stopped substate, full transcript visible
- [ ] Download .txt works post-sample
- [ ] Click "Start new" → back to idle, sample button still works
- [ ] Real "Start captions" still works (no regression)
- [ ] Sample works in PiP (click Pop Out after sample starts)

### Keyboard shortcuts
- [ ] Idle: Enter triggers Start captions
- [ ] Active+live: Space pauses (status banner reflects), Space resumes
- [ ] Active+live: Escape stops (same as Stop button)
- [ ] Active+live: P opens PiP
- [ ] Active+live in PiP: P closes PiP
- [ ] Stopped: R triggers Start new
- [ ] Stopped: D downloads .txt
- [ ] `?` opens help overlay, Esc closes it
- [ ] Typing in a text input doesn't trigger shortcuts

### Session replay
- [ ] After a >= 5 word session, reload page → "Recent sessions" shows entry
- [ ] Click [view] → dialog opens with full transcript
- [ ] Download .txt from dialog matches what was captured live
- [ ] Stop two sessions → both appear, most-recent first
- [ ] Run 21 sessions → only most-recent 20 retained
- [ ] Clear all history → list empties, reload confirms
- [ ] Privacy FAQ + page mention storage honestly

## 4.0.7 Success criteria (overall)

- Sample demo: visitor sees captions in < 3s without ANY permission prompts
- Keyboard shortcuts: all listed shortcuts functional + non-blocking on inputs
- Session replay: persistence + view + download + clear all green
- Brand-grep clean (no "captionpip" except intentional `_headers` legacy rule)
- 43/43 existing vitest tests still green + new tests for each module
- `npm run build` + `npx astro check` clean

## 4.0.8 Estimated commits

| # | Scope | LOC est |
|---|---|---|
| 1 | docs(spec): v0.4.0 scope lock | ~250 |
| 2 | feat(sample): public/sample.mp3 + sampleFeed.ts + tests | ~150 |
| 3 | feat(sample): wire Try button + UI integration | ~80 |
| 4 | feat(ui): keyboard shortcuts + help overlay + tests | ~180 |
| 5 | feat(history): sessionStore.ts + IndexedDB tests | ~200 |
| 6 | feat(history): UI integration (idle list + viewer dialog) | ~120 |
| 7 | docs(faq): privacy disclosure for session storage | ~30 |

Total: ~1010 LOC, 7 commits.


---

# v0.4.1 — AudioWorklet migration + Space pause/resume (SHIPPED)

**Status:** SHIPPED 2026-06-10 (3 commits)
**Plan doc:** `docs/plans/2026-06-10-v0.4.1-bundle.md`
**Predecessor:** v0.4.0 (commits `eea8fa7` → `2e3d343`, 2026-06-09)

## 4.1.0 Why bundle these two

Both features touched `wireAudioPipeline` in `src/lib/audioCapture.ts`,
so shipping them as parallel commit trains would have produced a
predictable merge conflict on every iteration. Bundling kept the edit
coherent: AudioWorklet first publishes a `CaptureHandle.pause()/resume()`
API that's a natural fit for `AudioContext.suspend/resume` semantics,
then the pause/resume UI is wired in the second commit without a single
overlapping line.

## 4.1.1 Scope — AudioWorklet migration (commit `255588d`)

Replaces deprecated `ScriptProcessorNode` with an AudioWorklet processor
at `public/audio-worklet-capture.js`. Behaviour is byte-equivalent for
downstream consumers — RollingBuffer, agreement.ts, and the Whisper
worker are all blind to the migration.

| Layer | Before | After |
|---|---|---|
| Node | `ctx.createScriptProcessor(4096, 1, 1)` | `new AudioWorkletNode(ctx, "capture-processor")` |
| Thread | Main (jitters under load) | Audio thread (real-time priority) |
| Frame size | 4096 samples per `onaudioprocess` | 4096-sample frames assembled by worklet from 128-sample blocks |
| Frame rate | ~125-375 callbacks/sec (depends on rate) | ~4-11 transferred frames/sec |
| Wireup | `wireAudioPipeline` was sync | Now `async` (`audioWorklet.addModule()`) |

The worklet itself is intentionally minimal: accumulates 128-sample
blocks into 4096-sample frames, posts each completed frame to the main
thread with `transferList: [out.buffer]` (zero-copy), repeats. Manual
16kHz downsample logic stays on the main thread message handler — the
worklet operates at the AudioContext's native rate, exactly as the old
ScriptProcessor did.

Pause/resume API is published on `CaptureHandle` (and `SampleCaptureHandle`
for parity) in this commit but **no callers exist yet** — the UI wires
in the next commit. This split makes the migration commit
independently revertable.

### Critical decision: behaviour-equivalent migration vs. opportunistic refactor

I considered moving the downsample into the worklet too (less main-thread
work, cleaner separation). Rejected: it would have made the commit
"chore + perf optimisation" instead of "chore only" — harder to debug
if the migration introduced a regression. Kept the downsample location
identical so any audio-quality change is provably NOT the worklet's
fault.

## 4.1.2 Scope — Space pause/resume (commit `018b918`)

| Element | Spec |
|---|---|
| Keybind | `Space` |
| Contexts where active | `active-live` + `active-paused` |
| Pause action | `captureHandle.pause()` → `AudioContext.suspend()` (worklet stops emitting → RollingBuffer freezes). For sample mode also `audioEl.pause()` so user hears it stop. |
| Resume action | `captureHandle.resume()` → `AudioContext.resume()`. Tick scheduler picks up naturally. |
| UI affordance (paused) | New PAUSED indicator in caption-box header (static gray dot, no pulse). Replaces LIVE indicator. |
| Status banner (paused) | `"Paused — press Space to resume"` (visible in main page + inside PiP) |
| Status banner (resumed) | Flashes `"Listening…"` for 800ms then auto-hides |
| Discoverability | New row in `?` help overlay: `Pause / resume capture · Space` |

### Architectural moves in this commit

1. **`setSubstate` now supports multi-value `data-when`.** Elements that
   should stay visible in BOTH `live` and `paused` (Stop button, Pop out
   button) use `data-when="live paused"`. The toggle logic splits on
   whitespace and tests for inclusion. Single-value `data-when="live"`
   /`"stopped"`/`"paused"` keeps working unchanged. This generalisation
   was the smallest blast-radius alternative to duplicating UI elements.

2. **`ShortcutContext` gains `"active-paused"`.** `Esc` and `P` shortcuts
   extend their `contexts` arrays to include it so you can still
   fully Stop or toggle PiP from a paused state. `R` and `D` stay
   `active-stopped`-only (no meaningful behaviour while paused).

3. **`tick()` early-returns when `isPaused`.** Still re-arms via
   `scheduleNextTick()` so the moment `isPaused` flips back to false
   the loop continues without a manual restart. No new GPU/CPU burn
   while paused.

4. **`togglePause()` is fully idempotent + state-gated.** No-op outside
   `currentState === "active"`, no-op if there's no `captureHandle`,
   no-op if substate is `"stopped"`. Defence in depth: even if a
   keybind context check fails, the handler refuses to desync UI vs.
   capture state.

5. **`isPaused` reset in three places**: `startPipeline()`,
   `startSampleSession()`, `stopPipeline()`. Without this, a paused
   session that Stops + restarts could leak `isPaused = true` into
   the new run — a "session starts paused with no visible cue" bug.

### Edge cases handled

| Case | Behaviour |
|---|---|
| `tick()` already in-flight when user pauses | Worker call completes after pause; its result still applies to pre-pause audio (semantically valid). `inFlight` guard already prevents overlap. No special handling. |
| Pause while in PiP | Space inside the PiP doc fires because `setPipShortcuts(handle)` installs the same SHORTCUTS list on `pipWindow.document`. PAUSED indicator is visible because the caption-box header is the same DOM node moved into the PiP window. |
| Stop while paused | `stopPipeline()` calls `captureHandle.stop()` which closes the AudioContext entirely; suspend state is moot. `isPaused` reset to false on the way out. |
| User pauses, then closes PiP | `setPipMode(false)` doesn't touch `isPaused` — PiP is just a presentation layer. Paused state persists; PAUSED pill renders inline. |
| Pause + long silence + resume | On resume, silence-guard fires next tick (silenceMs > 2.5s) and resets the rolling buffer + agreement. This is desired — pause is logically a session boundary. |
| Browser `<button>` Space-as-click | The shortcut module calls `preventDefault()` on Space, so focused buttons don't double-fire. User has to click physically or hit Enter to activate a focused button. Documented inline. |

## 4.1.3 Out of scope (still deferred)

- Speaker diarization (defer to v0.4.2)
- Real translate via NLLB (defer to v0.5)
- Browser extension (defer to v0.5)
- Search across stored sessions (defer to v0.4.3)
- Session export-as-JSON / cross-browser import (defer to v0.4.3)
- Pause hint UI as text-on-caption-box (defer until user feedback says discoverability is poor — currently `?` help dialog is the surface)

## 4.1.4 Manual test checklist (run on Edge + Chrome + Firefox)

### AudioWorklet
- [ ] Tab capture → captions render normally (no behaviour change visible to user)
- [ ] Mic capture → captions render normally
- [ ] Sample audio → captions render normally
- [ ] DevTools Performance: 30s capture → no main-thread audio-processing blocks ≥10ms
- [ ] DevTools Network: `/audio-worklet-capture.js` served with `Content-Type: application/javascript` (or `text/javascript`)
- [ ] No console warnings about deprecated `ScriptProcessorNode`

### Space pause/resume
- [ ] Active+live: Space → PAUSED indicator, status banner "Paused — press Space to resume", no new captions
- [ ] Active+paused: Space → LIVE indicator returns, status banner "Listening…" briefly then auto-hides, captions resume
- [ ] Sample mode: Space → audio playback actually stops, audible silence
- [ ] PiP open: Space inside PiP doc → pause works, PAUSED pill visible in PiP
- [ ] Paused → Esc → stopPipeline runs cleanly, substate → stopped
- [ ] Paused → Stop button click → same as Esc
- [ ] Paused → P → PiP toggle works
- [ ] Paused → Start new (after Stop) → fresh session starts in live, not paused
- [ ] Typing in any future input: Space doesn't hijack
- [ ] `?` help overlay shows "Pause / resume capture · Space" row

## 4.1.5 Success criteria (overall)

- AudioWorklet: zero user-visible regression on any of the 3 capture paths
- Space: pause-resume cycle works inline + inside PiP, no visual lies (UI substate always tracks capture state)
- Brand-grep clean
- 92/92 vitest pass (87 existing + 5 new for active-paused context)
- `npm run build` + `npx astro check` clean (0 errors)

## 4.1.6 Estimated vs. actual commits

| # | Planned | Actual | LOC |
|---|---|---|---|
| 1 | `chore(capture): AudioWorklet migration` | `chore(capture): migrate ScriptProcessorNode -> AudioWorklet + add pause/resume API` | +397 / -17 |
| 2 | `feat(capture): Space pause/resume` | `feat(ui): Space pause/resume capture (v0.4.1 final feature)` | +159 / -15 |
| 3 | `docs(spec): v0.4.1 retrospective` | (this commit) | ~varies |

Total: 3 commits, each independently revertable.


---

# v0.4.2 — Session Search + JSON Export/Import (SHIPPED)

**Status:** SHIPPED 2026-06-10 (3 commits)
**Plan doc:** `docs/plans/2026-06-10-v0.4.2-bundle.md`
**Predecessor:** v0.4.1 (commits `255588d` → `d9e8f35`, 2026-06-10)

## 4.2.0 Scope decisions

Original menu had 4 candidates (speaker diarization, search, export/import,
medium/large model tier). Dropped 2:

- **Diarization** — true speaker ID needs a voice-embedding model
  (pyannote / SpeakerNet, 200-400MB + 4-6h WebGPU port work). Energy
  heuristics on mono audio distinguish "loud vs quiet" not "speaker A
  vs B" — every speaker in a Zoom / Meet / YouTube stream arrives
  through the SAME channel at similar RMS. Gap-based "turn detection"
  was a possible cheap proxy (paragraph break on ≥1.5s silence) but
  the user opted to skip and keep v0.4.2 lean.
- **Medium/large Whisper model tier** — `onnx-community/whisper-large-v3-turbo`
  at q4f16 is actually viable (~564MB encoder + decoder) but adding a
  7.5× base-size model needs its OWN focused release: scary-size
  warning UI, better download-progress affordances, "this is a
  power-user upgrade" framing. Bundling into v0.4.2 would have buried
  that UX moment. Punted to a dedicated v0.5 model story.

What shipped: **2 features + 1 docs commit = 3 commits.**

## 4.2.1 Scope — Session search (commit `496fd91`)

New module `src/lib/sessionSearch.ts` (pure functions, no DOM/IDB):

```ts
sessionHaystack(s: StoredSession): string  // lowercased combined search string
searchSessions(sessions, query): StoredSession[]  // AND-match filter
debounce(fn, wait): (...args) => void
```

**Match rules:**
- Empty/whitespace query → return input unchanged
- Query lowercased + split on whitespace into terms
- Session matches iff EVERY term appears as substring in the haystack
- Haystack = preview + joined transcript words + source label
  ("tab"/"mic"/"sample" + a few synonyms) + ISO date + modelId
- Result preserves input order (caller already sorted)

**Why AND not OR:** matches Google's default behaviour for unquoted
multi-word queries — "standup tuesday" should return only sessions
containing BOTH terms, not anything matching either word.

**UX gates:**
- Search input HIDDEN when `cachedSessions.length < 3` (search adds
  friction on fresh installs; 1-2 sessions are scannable by eye).
- Empty-state `"No sessions match — try another search."` shown when
  query matches nothing. Panel + header + Clear all stay visible so
  user knows where they are.
- Debounce 150ms — re-filters at most ~6×/sec during typing. Filter
  itself is pure + cached so even without debounce it'd be cheap; this
  is just visual-flicker polish.
- On `clearAll()` or last-session delete, currentQuery and input value
  reset so a future panel re-open starts clean.

**Caching:** `applySearchFilter()` reads from a module-level
`cachedSessions` array refreshed only by `renderHistory()` (which hits
IDB). Keystrokes never touch IDB — pure-functional Array.filter is
sub-millisecond at our N ≤ 20.

## 4.2.2 Scope — JSON export/import (commit `abebab0`)

`sessionStore.ts` gains:

```ts
EXPORT_VERSION = 1 as const   // schema version

interface ExportBundle {
  version: 1
  exportedAt: string   // ISO timestamp
  appVersion: string   // informational
  sessions: StoredSession[]
}

interface ImportResult {
  imported: number
  skipped: number     // duplicate id
  pruned: number      // evicted by MAX_SESSIONS after insert
}

exportAllSessions(idb?, appVersion?) → Promise<ExportBundle>
validateExportBundle(input) → asserts ExportBundle | throws Error
importSessions(bundle, idb?) → Promise<ImportResult>
```

**Schema versioning contract:** `validateExportBundle` rejects any
`version !== EXPORT_VERSION` with a clear user-facing error. When
StoredSession shape changes in a future version, bump EXPORT_VERSION
and add an `if (bundle.version === N)` migration branch — never
silently break.

**Import semantics:**
- Skip-on-duplicate-id (non-destructive merge). Existing sessions are
  NEVER overwritten by import — user always retains live data.
- Each session goes through `saveSession()` individually (NOT a single
  bulk transaction). Reasons: skip-on-dup is cleaner per-row, partial
  failure leaves successful imports intact, N ≤ 20 so the tx-overhead
  concern is negligible.
- Per-insert prune-on-cap runs naturally — if importing 10 sessions
  brings total over MAX_SESSIONS (20), oldest by `startedAt` get
  evicted. `importSessions` snapshots `preCount` + `postCount` to
  report accurate `pruned` count back to caller.

**Validation:** zero-dep runtime checks. We do NOT use a schema library
(zod / valibot) — the validation surface is small enough that hand-
written checks stay readable and ship faster than the lib + types they'd
pull in.

**File format:** pretty-printed JSON (2-space indent) so users CAN
manually inspect / hand-edit if needed. ~5-10KB per session at typical
length — a 20-session bundle is well under 200KB even with verbose
transcripts.

**Filename:** `livecaptionit-history-YYYY-MM-DD.json` — sortable so
users with multiple backups see them in date order.

## 4.2.3 UI fix — Import is reachable on empty store

**Pre-v0.4.2:** if you had 0 sessions, the entire Recent sessions panel
was hidden. That meant Import was unreachable on a fresh device — the
exact moment you'd most need it for restoring a backup.

**v0.4.2:** panel stays visible when empty, but strips down to header
+ Import button + `"No sessions recorded yet — record one or Import a
backup."` hint. Export / Clear all / Search input all hidden when empty.

Two separate empty-state nodes (`#cp-history-empty` vs
`#cp-history-empty-zero`) so messaging stays accurate — "no match"
vs "no sessions" are different conditions.

## 4.2.4 Test infra

15 new vitest cases for `sessionSearch.test.ts`:
- haystack: case-folding, ISO date inclusion, source labels, modelId inclusion
- search: empty query → all, single-term, case-insensitive, multi-term AND,
  multi-match, no-match, source/model filters, order preservation
- debounce: trailing-fire on rapid calls, separate fire when spaced

10 new vitest cases for `sessionStore.test.ts` (export/import):
- exportAllSessions: empty-store shape, full roundtrip preservation
- importSessions: skip-on-duplicate-id, 20-cap pruning with accurate count
- validateExportBundle: valid input, null/string/number rejection,
  unknown version, missing sessions array, missing required fields,
  invalid source enum

Total: **92 → 117 vitest cases.**

## 4.2.5 Out of scope (still deferred)

- Speaker diarization (defer to v0.5 — needs voice embedding model)
- Gap-based "turn detection" paragraph breaks (potential v0.4.3 if
  user feedback says wall-of-text is a pain point)
- Medium/large Whisper model tier (defer to dedicated v0.5 model story
  with proper scary-size UX)
- Real translate via NLLB (defer to v0.5)
- Browser extension companion (defer to v0.5)
- Pause hint UI as inline text (defer until user feedback says `?`
  help overlay is insufficient)
- Replace native `alert()` for import result + errors with a proper
  toast component (polish work, not blocking)

## 4.2.6 Manual test checklist

### Session search
- [ ] With 0 sessions: search input hidden, panel shows "No sessions recorded yet" + Import button only
- [ ] With 1-2 sessions: list shows, search input HIDDEN (threshold)
- [ ] With ≥3 sessions: search input visible
- [ ] Type a word in 1+ session preview → only matching shown
- [ ] Type "Q3 plan" with 2 sessions matching → both shown
- [ ] Type "xyzzyfoobar" → "No sessions match" empty-state
- [ ] Clear input → all sessions return
- [ ] Type fast → re-filter is debounced (no flicker on every keystroke)
- [ ] Clear all → search input resets visibility + value

### JSON export
- [ ] With ≥1 sessions: Export button visible, click → JSON downloads as `livecaptionit-history-YYYY-MM-DD.json`
- [ ] Open JSON → see `version: 1`, `exportedAt`, `appVersion`, `sessions: [...]`
- [ ] Each session has id / startedAt / endedAt / source / modelId / transcript / preview

### JSON import
- [ ] With 0 sessions: Import button visible (KEY restore-on-fresh-device case)
- [ ] Click Import → file picker opens, accepts only .json
- [ ] Pick a valid bundle → "Import complete: N imported" alert, list re-renders
- [ ] Pick same bundle again → "N skipped (already present)"
- [ ] Pick bundle with 10 sessions when store already has 15 → "10 imported, 5 pruned (over 20-session cap)"
- [ ] Pick a non-JSON file → "File isn't valid JSON"
- [ ] Pick a JSON file with `version: 99` → "Unsupported export version: 99"
- [ ] Pick a JSON missing required fields → "missing required fields" error
- [ ] After error, list state unchanged (no partial corruption)
- [ ] Pick same file twice in a row → second pick still fires (input.value reset)

## 4.2.7 Success criteria (overall)

- Search across 20 sessions returns matching subset in <16ms (sub-frame)
- Export/import roundtrip preserves all StoredSession fields verbatim
- Import never overwrites existing sessions (data safety)
- v1 schema lock — future schema changes can be migrated without
  silently breaking older exports
- 117/117 vitest pass (92 baseline + 15 search + 10 export/import)
- Brand-grep clean
- `npm run build` + `npx astro check` clean (0 errors)

## 4.2.8 Estimated vs actual commits

| # | Planned | Actual | Files +/- |
|---|---|---|---|
| 1 | `feat(history): session search` | `feat(history): search across stored sessions (v0.4.2 part 1)` | +454/-3 |
| 2 | `feat(history): JSON export/import` | `feat(history): JSON export/import for sessions (v0.4.2 part 2)` | +482/-6 |
| 3 | `docs(spec): v0.4.2 retrospective` | (this commit) | ~varies |

Total: 3 commits, each independently revertable.
