---
title: "WebCaptioner alternative — free, in-browser, Whisper-powered live captions"
description: "WebCaptioner shut down in 2023. Here's how LiveCaptionIt fills the gap with WebGPU + Whisper — feature-by-feature comparison and a migration guide."
pubDate: 2026-06-10
tags: ["comparison", "webcaptioner"]
---

**WebCaptioner went offline in late 2023.** For years it was the
free-and-friendly tool that small churches, classrooms, low-budget
events, and accessibility users reached for when they needed live
captions for in-person speech. When the site went down — citing
sustainability — a sizable community was left with no good free
replacement.

LiveCaptionIt isn't a clone of WebCaptioner. The use cases overlap but
the architecture is fundamentally different. Here's the honest
comparison.

## What WebCaptioner did

- Browser-based, no install
- Free, no signup
- Used Chrome's Web Speech API (server-routed to Google's speech
  recognition)
- Output captions to a full-screen view or a customizable on-stage display
- Popular with houses of worship, conferences, classroom AT setups

The architecture had one big downside: Web Speech API requires a server
round trip. Audio was streamed from your browser to Google's
recognition service. Free but not private.

## What LiveCaptionIt does

- Browser-based, no install
- Free, no signup
- Runs Whisper locally via WebGPU + transformers.js
- Output to inline or floating Picture-in-Picture window
- Same use cases — churches, classrooms, accessibility, events

The key difference: audio never leaves your device. Whisper does the
recognition in your browser using your GPU. No server round trip. No
network dependency once the model is cached.

## Feature-by-feature

| Feature | WebCaptioner (RIP) | LiveCaptionIt |
|---|---|---|
| Recognition engine | Google Web Speech API (server) | Whisper (local) |
| Privacy | Audio sent to Google | Audio never leaves device |
| Languages | English + ~30 others | 99 (Whisper) |
| Offline | No (server required) | Yes (after first model load) |
| Floating window | No | Yes (Document PiP) |
| Source toggle | Mic only | Tab + Mic |
| Caption styling | Basic | Themes + size + position + opacity |
| Custom vocabulary | No | Yes (Whisper initial_prompt) |
| Transcript download | Yes (.txt) | Yes (.txt + .vtt + .srt) |
| Session history | No | Last 20 in browser |
| Shareable link | No | Yes (gzipped in URL) |
| Open source | Yes (archived) | Yes (active) |

## Where WebCaptioner did things better

Being honest:

- **Display flexibility.** WebCaptioner's "stage display" mode was
  optimized for projector setups — large fonts, customizable bg/fg,
  output via a secondary monitor. LiveCaptionIt's floating PiP works
  for desktop use but isn't designed for stage projection.
- **Lower hardware requirements.** WebCaptioner just needed audio
  capture and an internet connection. LiveCaptionIt needs WebGPU and
  ~75 MB of model download — meaning older laptops or
  Chromebooks-without-GPU are slower.

If you specifically need a projector-style display for in-person events
and don't care about audio leaving your venue, the WebCaptioner
archives may still partially work — some forks reportedly maintain
limited functionality.

## Where LiveCaptionIt is strictly better

For everything else:

- **Privacy is non-negotiable.** Hospitals, therapists, lawyers, school
  counselors — anyone whose audio shouldn't go to a third party — can
  use LiveCaptionIt without compromising compliance.
- **Floating window for one-on-one accessibility.** A hearing-impaired
  user can put LiveCaptionIt's PiP window above any meeting, video, or
  conversation app. WebCaptioner could only run as a full-screen
  display.
- **Better language coverage.** Whisper supports 99 languages out of
  the box — much wider than WebCaptioner's Google-API-backed list.
- **Custom vocabulary.** Teach the model your proper nouns, technical
  terms, jargon. Pre-prompt support means it knows "kubectl" is a
  word and not "cube control."
- **True offline.** Cache the model once, use forever without network.

## How to migrate

If you used WebCaptioner before its shutdown:

1. Open LiveCaptionIt in Chrome / Edge / Brave 116+
2. Click Start, pick your audio source (microphone for in-person events,
   tab for online meetings/videos)
3. Open the Caption Style panel and adjust font size + position to
   match your old WebCaptioner setup
4. For an "always-visible" display similar to WebCaptioner's stage
   mode, pop out the floating PiP window and resize edge-to-edge
   horizontally for a subtitle-bar look

For projector display, drag the PiP window onto your secondary monitor
and fullscreen it (most desktop OSes support fullscreening individual
windows).

## Closing thought

WebCaptioner's shutdown left a real gap. We're not the same tool, but
we're trying to serve the same community better — free, private,
multilingual, offline-capable. If you used WebCaptioner and have
specific workflows that don't translate, I'd genuinely like to hear
about them. Issues open on GitHub.
