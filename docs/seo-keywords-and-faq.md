# SEO — Keywords & FAQ Corpus

Curated keyword + FAQ research for LiveCaptionIt's SEO push (June 2026).
Built from Google autocomplete + "People also ask" + observed PAA behavior
on the `live captions` / `caption youtube` / `caption meeting` clusters.

**Filter rule:** only queries that match LiveCaptionIt's product surface —
in-browser real-time captions for ANY audio source via Whisper + WebGPU,
floating PiP window, zero upload. Enterprise transcription
(Otter/Rev/Trint AI Notes), branded captioner downloads
(Subtitle Edit / Aegisub install), live broadcast/OBS plugins,
and captioning-as-a-service queries are excluded.

---

## 0. Keyword difficulty cheat sheet

No external KD-tool screenshots were supplied for this project — these
ratings are estimates based on observed competitor density per phrase
(WebCaptioner ~15K MAU, transkribed.io, Web Captioner Alternative
landing pages, Speechnotes, Buzz Captions, etc.). Refine when real
Ahrefs/SEMrush data arrives.

### 🟢 EASY — go after these first
| Keyword | Notes |
|---|---|
| `whisper browser captions` | Direct match — Whisper-in-browser is rare |
| `webgpu speech to text` | Niche tech intent, no major competitor |
| `floating live captions window` | "PiP captions" framing has near-zero coverage |
| `caption youtube video in browser` | Most results are video downloaders, not captioners |
| `picture in picture captions` | Document PiP angle is novel |
| `live captions for any tab` | Self-CTA naming — direct slug match |
| `webcaptioner alternative` | Direct competitor switching intent |
| `free live captions no signup` | Decision-mode commercial intent |

### 🟡 MEDIUM — second wave
| Keyword | Notes |
|---|---|
| `live captions chrome` | Chrome Live Caption owns this; we position as "floats over apps, Chrome's doesn't" |
| `captions for zoom meeting` | Zoom has native — we offer free alt for free-tier users |
| `captions for google meet` | Google Meet has native — same wedge |
| `captions for podcast` | Podcasts have transcripts post-hoc; we do live |
| `transcribe youtube video free` | High intent but dominated by VEED/Notta |
| `live transcription browser` | Generic term, multiple competitors |
| `whisper live transcription` | Tech-leaning users, some competitors |

### 🔴 HARD — long game, don't lead with these
| Keyword | Notes |
|---|---|
| `live captions` | Dominated by Apple/Google Live Caption marketing pages |
| `speech to text online` | Otter / Rev / Notta AdWords-heavy |
| `meeting transcription` | Otter dominates; B2B intent |
| `transcribe audio` | Generic, enterprise-leaning |
| `voice to text` | Mobile keyboard intent, wrong audience |

---

## 1. Keywords (organized by intent + opportunity)

### A. Core / brand-defining
- `live captions in browser` 🟢
- `picture in picture captions` 🟢
- `floating caption window` 🟢
- `pip live captions`
- `whisper webgpu captions` 🟢
- `browser based live captions`
- `tab audio captions` 🟢
- `screen audio to text live`

### B. Free / no-signup / privacy intent
- `free live captions no signup` 🟢
- `live captions no install`
- `live captions without account`
- `private live captions` 🟢
- `local live captions no upload`
- `offline live captions browser`
- `live captions that don't upload audio` 🟢

### C. Source-specific intent (use-case landing pages)
- `caption youtube video` 🟡
- `youtube captions for non-english videos`
- `live captions for podcast` 🟡
- `caption a podcast in browser` 🟢
- `live captions for lectures` 🟢
- `live captions for online classes`
- `live captions for webinars` 🟢
- `caption a recorded lecture in browser`

### D. Platform-specific intent (platform landing pages)
- `live captions for zoom` 🟡
- `zoom captions free` 🟢
- `live captions for google meet` 🟡
- `google meet captions third party`
- `live captions for microsoft teams`
- `live captions for discord call` 🟢
- `live captions for slack huddle` 🟢
- `live captions for spotify`
- `captions for twitch stream viewer`

### E. Cross-device + accessibility intent
- `live captions for hearing impaired` 🟡
- `real time captions for deaf` 🟡
- `live captions for hard of hearing`
- `captions for someone hard of hearing on a video call` 🟢
- `live captions on second monitor`

### F. Comparison / competitor intent
- `webcaptioner alternative` 🟢
- `web captioner free alternative` 🟢
- `chrome live caption alternative` 🟡
- `apple live captions for windows` 🟢
- `chrome live caption for tab audio` 🟢 (the wedge — Chrome's is system-only)
- `chrome live caption floating window` 🟢

### G. Educational / "how" / "what is" intent
- `how to add live captions to youtube` 🟡
- `how to caption any audio in browser` 🟢
- `how does live captioning work` 🟡
- `what is webgpu speech recognition` 🟢
- `how to make captions float over video` 🟢
- `can i caption a tab in chrome` 🟢

### H. Technical / Whisper-leaning intent
- `whisper in browser webgpu`
- `transformers.js whisper streaming` 🟢
- `whisper.cpp browser alternative`
- `client side speech recognition` 🟢
- `localagreement whisper streaming` 🟢

---

## 2. FAQ (PAA voice — 24 questions)

These power both the home-page FAQ (existing 15) AND the new `/faq` page
JSON-LD. Mix matches Google PAA cadence: ~30% mention the brand
explicitly, 70% answer the generic question with a soft positioning
lead-in. Aim 80-120 words per answer.

### Q1. How do live captions work in a browser?

Modern browsers can capture audio from any tab, window, or
microphone using the Screen Capture API. That audio stream is fed
into a speech-recognition model — in the case of LiveCaptionIt,
OpenAI's Whisper, running locally via WebGPU and transformers.js.
The model emits transcribed text every ~700 milliseconds using a
"rolling window" approach, where each new chunk refines the
previous one. The result is captions that read like YouTube CC,
no internet uploads required, no installation, and works across
multiple operating systems.

### Q2. Are there free live captions for any tab?

Yes. LiveCaptionIt is free with no signup, no installation, and
no usage caps. Open the site, click Start, pick a tab, and
captions appear in a floating window that stays on top of any
app. The model runs entirely on your device, so there is no
per-minute pricing, no transcription quota, and no monthly bill.
The only network request is the one-time Whisper model download
(~75 MB), cached in your browser afterward.

### Q3. Can I caption a YouTube video that has no subtitles?

Yes. Open the YouTube video in one Chrome tab, open LiveCaptionIt
in another, click Start, pick the YouTube tab, and tick "Share
tab audio" on the picker. Captions appear in a floating PiP
window above the video. Useful for foreign-language YouTube
videos, live streams without CC, or older videos where YouTube's
auto-CC was disabled. Works on any tab Chrome can hear, including
embedded players and unlisted videos.

### Q4. How is this different from Chrome's built-in Live Caption?

Chrome's Live Caption is a system-level feature — captions appear
in a fixed bar at the bottom of the screen and disappear if you
switch apps. LiveCaptionIt opens captions in a Document
Picture-in-Picture window that stays visible no matter which app
you switch to. It also lets you caption a specific tab (not just
system audio), supports 99 languages via Whisper, and works on
Chrome, Edge, and Brave on multiple operating systems
(Chrome's native Live Caption availability varies by OS).

### Q5. Can I use live captions for Zoom or Google Meet without a paid plan?

Yes. Both Zoom and Google Meet have built-in captions but Zoom
requires a paid plan for some account types and Meet only
captions on certain plans. LiveCaptionIt captions any audio
Chrome can hear — including Zoom Web, Google Meet, Microsoft
Teams, Discord, Slack huddles, or any other meeting tool that
runs in a tab. Just share the meeting tab, tick "Share tab
audio," and captions appear in a floating PiP window above the
meeting itself.

### Q6. Does my audio get uploaded anywhere?

No. LiveCaptionIt runs Whisper locally in your browser via
WebGPU and transformers.js. Audio never leaves your device.
The only network requests are the one-time download of the
Whisper model file from Hugging Face Hub (cached locally) and
Google Fonts (the page font). There is no audio upload, no
audio retention, and no server-side processing of any kind. You
can verify this in Chrome DevTools — there's no audio outbound
traffic after the model loads.

### Q7. Will live captions work without internet?

Mostly. The first time you open LiveCaptionIt, your browser
downloads the Whisper model (~75 MB) from the Hugging Face CDN.
After that, the model is cached locally. Subsequent uses work
offline — Whisper runs in your browser, audio capture is local,
caption rendering is local. Network is only needed for the
initial cold load, the Google Fonts request, and the page HTML
on first visit.

### Q8. What is WebGPU speech recognition?

WebGPU is a modern browser API that exposes the GPU to JavaScript
for high-performance computation. Speech recognition models like
Whisper run 5-10× faster on a GPU than a CPU — WebGPU brings
that speed-up into the browser without requiring a native
install. LiveCaptionIt uses WebGPU via the transformers.js
library to run Whisper at near-real-time speed on consumer
laptops. Browsers that don't support WebGPU fall back to WASM
(slower but functional).

### Q9. Can I caption a podcast or Spotify audio live?

Yes if the audio plays in a browser tab. Spotify Web, Apple
Podcasts Web, Pocket Casts Web, Overcast Web, YouTube podcast
videos — anything that streams through Chrome can be captioned
live. Open the podcast in one tab, LiveCaptionIt in another,
share the podcast tab with "Share tab audio" ticked. The
floating PiP window stays visible while you switch to another
app, so you can read captions while doing something else.

### Q10. How accurate are the captions?

LiveCaptionIt ships four Whisper model tiers — Tiny (39 MB,
fastest, lower accuracy), Base (74 MB, default — balanced),
Small (244 MB, ~10% more accurate), and Large turbo (537 MB,
top accuracy for difficult audio). For clean conversational
English, Base is ~95% accurate. For accented speech, technical
jargon, or noisy audio, Small or Large turbo handles it better
at the cost of a larger one-time download. Custom vocabulary
support also lets you teach Whisper proper nouns and technical
terms it usually mishears.

### Q11. Can I download the transcript after the session?

Yes. After you click Stop, three download buttons appear in the
caption box: `.txt` (plain text), `.vtt` (WebVTT, for video
players that support subtitles), and `.srt` (SubRip, the
universal subtitle format). Timestamps are at segment level
(~700-1200 ms granularity), good enough for most use cases.
Your last 20 transcripts are also saved automatically to
browser IndexedDB and can be re-downloaded from the
"Recent sessions" panel on the home page.

### Q12. Does live captioning work on iPhone or Android?

Partially. Mobile browsers don't support Screen Capture API for
audio, so you can't caption a tab on mobile. However,
LiveCaptionIt's microphone mode works on iOS Safari and Android
Chrome — point your phone's microphone at any audio source
(a speaker, headphones, another device) and captions appear
live on your phone's screen. The floating PiP window is
Chromium-desktop-only; on mobile, captions appear inline on the
page instead.

### Q13. Can I caption a Microsoft Teams meeting?

Yes via Teams Web (not the desktop app). Open Teams in
teams.microsoft.com in Chrome, start your meeting, then open
LiveCaptionIt in another tab and share the Teams tab with
"Share tab audio" ticked. Captions appear in a floating PiP
window above the Teams call. Teams' own native captions also
work — LiveCaptionIt is useful if you're on a Teams plan that
doesn't include live captions or if you want a floating window
that stays visible when you switch to another app.

### Q14. Are live captions for hearing-impaired users different?

The captions themselves are the same, but accessibility users
often want extra features — bigger text, higher contrast,
fixed positioning. LiveCaptionIt supports all of these: caption
font size 80-200%, weight 400-700, text-shadow for legibility
over bright video, sepia / high-contrast / terminal themes, and
the floating window can be resized + dragged to any spot on
screen. Caption position (top/middle/bottom) also adjusts so
they don't cover important video content.

### Q15. Can I install live captions as an app on my phone or laptop?

Yes. LiveCaptionIt is a Progressive Web App (PWA). On Chrome,
Edge, and Brave you'll see an install pill on the home page
that adds it to your Start menu / Applications / Home Screen.
On iOS Safari, use Share → Add to Home Screen. Installed mode
opens in its own window without browser chrome, which makes the
floating PiP window feel like a native overlay app. No app store
download, no review delays, ~2 MB total install size.

### Q16. Can I share a transcript without uploading it?

Yes. After you Stop a session, click the Share button next to
the download options. LiveCaptionIt gzip-compresses the
transcript and packs it into the URL itself (no upload, no
server) — your friend opens the link and sees the full session
viewer with all download options. Works for transcripts up to
~16 KB (a few minutes of speech). Longer sessions show a "use
Export instead" toast.

### Q17. Why aren't captions appearing when I click Start?

A few common causes: (1) Chrome's picker has a "Share tab audio"
checkbox that's easy to miss — make sure it's ticked before
clicking Share. (2) Some YouTube videos use protected audio that
the browser refuses to share — try a non-protected video first.
(3) On macOS, you can't capture system audio outside a browser
tab — pick a specific Chrome tab, not "Entire screen."
(4) WebGPU may need enabling in Chrome flags on Linux. The model
loading status bar shows what step is running.

### Q18. Is there a way to teach Whisper words it usually mishears?

Yes. LiveCaptionIt's Custom Vocabulary panel on the home page
lets you list proper nouns, technical terms, brand names, or
foreign words you want preserved (e.g. `kubectl, NeurIPS,
Aishwarya, ₹`). They're fed to Whisper as an `initial_prompt`
so the decoder is primed to recognize them with correct spelling
and casing. Up to 200 characters. Works for any of the 99
languages Whisper supports.

### Q19. Can live captions tell who is speaking?

Not yet — speaker diarization needs a separate voice-
fingerprinting model (~300 MB) that LiveCaptionIt doesn't ship
to keep the app fast and lightweight. What it does ship is
turn detection — if there's silence for ≥1.5 seconds, captions
start a fresh paragraph, which reads like meeting notes (one
paragraph ≈ one person's turn) even without naming speakers.
Real diarization is on the v0.5+ roadmap.

### Q20. How fast do the first captions appear?

The first word usually appears within ~700 milliseconds of
speech. LiveCaptionIt uses a rolling-window streaming
transcriber: instead of waiting for fixed 3-second chunks, it
re-transcribes the recent audio every ~700 ms and shows
confident words in bold, uncertain words muted. Words "solidify
in place" as the model becomes confident. Feels like YouTube CC
rather than delayed subtitles. Adaptive timing backs off on
slower devices.

### Q21. Can I caption a Discord voice call or Slack huddle?

Yes via the web versions. Open Discord at discord.com/channels
or Slack at app.slack.com in Chrome, join the call/huddle, then
open LiveCaptionIt in another tab and share the Discord/Slack
tab with "Share tab audio" ticked. Captions appear in a floating
PiP window above the call. Useful for anyone on a Discord call
where someone's mic is muffled, or a Slack huddle where you
joined late and need to catch up. Microphone mode also works
if you want to caption only your own speech.

### Q22. What's the difference between live captioning and transcription?

Live captioning is real-time — text appears within ~1 second of
speech and you read it as the audio plays. Transcription is
post-hoc — you upload a recording, wait for processing, and
download a finished document. LiveCaptionIt does live captioning
in the browser. The transcript download is a side benefit, but
the primary use case is reading captions in real time. For
post-hoc transcription, tools like OpenAI Whisper API,
Whisper.cpp, or Otter.ai are a better fit.

### Q23. Why does it sometimes show "you you you" or filler words?

Whisper sometimes hallucinates filler text on near-silent or
musical audio — it's a known model failure mode. LiveCaptionIt
guards against this with three layers: (1) a 2.5-second silence
guard that resets the buffer if no real audio is detected,
(2) a downstream filter that detects 4+ consecutive identical
words and drops them, and (3) the `no_repeat_ngram_size: 3`
decoder constraint that prevents the model from emitting any
trigram that already appeared. Music with sustained vocals
sometimes slips past — that's a deeper Whisper limitation.

### Q24. Is LiveCaptionIt safe to use for confidential meetings?

Yes. The entire pipeline runs in your browser — audio capture
is local (Screen Capture API hands the stream to your tab, not
to any server), Whisper inference is local (WebGPU runs on your
GPU), and caption rendering is local (DOM updates in the same
tab). No audio is uploaded, no transcripts are uploaded, and
the captured audio never goes through any third party. Your
last 20 transcripts ARE saved to your browser's IndexedDB so
you can revisit them — those stay on your device and you can
clear them anytime via the "Clear all" button.

---

## 3. Page-mapping plan

| Page | Target keywords (primary in **bold**) |
|---|---|
| `/` (homepage) | **live captions for any tab**, browser live captions, floating live captions window, picture in picture captions |
| `/youtube-captions` | **caption youtube video**, youtube captions for non-english videos, transcribe youtube video free |
| `/meeting-captions` | **live captions for meetings**, live captions for webinars, live transcription browser |
| `/podcast-captions` | **live captions for podcast** 🟡, caption a podcast in browser 🟢 |
| `/lecture-captions` | **live captions for lectures** 🟢, live captions for online classes, caption a recorded lecture in browser |
| `/captions-for-zoom` | **live captions for zoom** 🟡, zoom captions free 🟢 |
| `/captions-for-google-meet` | **live captions for google meet** 🟡, google meet captions third party |
| `/install` | **install live captions app**, pwa live captions, add live captions to home screen |
| `/blog` | (listing — index page) |
| `/blog/how-pip-captions-work` | **picture in picture captions**, how to make captions float over video |
| `/blog/webcaptioner-alternative` | **webcaptioner alternative** 🟢, web captioner free alternative |
| `/blog/whisper-vs-chrome-live-caption` | **chrome live caption alternative**, apple live captions for windows |
| `/faq` | (consolidated FAQ — FAQPage schema) |

---

## 4. Usage notes & strategy

- **Lead with EASY KD keywords for quick wins.** The Q1–Q4 FAQ +
  `/youtube-captions` + `/captions-for-zoom` + `/install` are highest
  immediate-payoff. They convert PWA installs faster than enterprise
  intent.
- **Comparison + competitor pages = highest commercial intent.** Build
  `/blog/webcaptioner-alternative` and
  `/blog/whisper-vs-chrome-live-caption` as canonical "decision-mode"
  posts. Be honest about where competitors win (you lose nothing — they
  already know — and gain enormous trust signal).
- **Don't keyword-stuff the homepage.** The home page targets the
  brand-defining core. Long-tail intent lives on dedicated `/route`
  pages so the slug itself contributes to ranking.
- **FAQ JSON-LD goes on `/faq` AND on relevant landing pages.** Reuse
  4-6 Qs per landing page (filtered to topic). Google handles
  duplicate FAQ schema across same-domain pages fine.
- **Use Document Picture-in-Picture as the visual hook.** That's the
  feature with the lowest competitor coverage — own it in copy,
  schema `alternateName`, and meta descriptions.

---

*Sourced from observed PAA cadence on `live captions` / `caption youtube` /
`caption zoom` / `chrome live caption` / `webcaptioner` clusters in
mobile Chrome SERPs (June 2026). KD ratings are estimates pending real
Ahrefs/SEMrush data. Excluded: enterprise transcription services
(Otter / Rev / Trint), branded captioner installs (Subtitle Edit /
Aegisub), live-broadcast plugins (OBS captions), and B2B "meeting AI"
queries — wrong audience for a no-signup browser-native tool.*
