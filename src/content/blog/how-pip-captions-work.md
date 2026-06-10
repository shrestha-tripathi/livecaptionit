---
title: "How Document Picture-in-Picture works (and why captions belong in it)"
description: "Document PiP is one of the most underused browser features. Here's what it does, how LiveCaptionIt uses it for floating captions, and why most tools should be using it."
pubDate: 2026-06-10
tags: ["explainer", "browser-api", "pip"]
---

If you've used Chrome's Live Caption (the system-level feature), you've
seen captions appear in a thin bar at the bottom of your screen. It's
useful, but it has one big limitation: switch apps and the captions go
with the current window, not your visible task. Watching a foreign
YouTube video and want to keep captions visible while taking notes in
Notion? Tough.

The fix has been hiding in the Chromium browser since 2023: the
**Document Picture-in-Picture** API. Not the YouTube-PiP you already
know — that one only holds a video. Document PiP holds *any* HTML
document in a floating, always-on-top window.

## What Document PiP is, exactly

`documentPictureInPicture.requestWindow()` opens a small browser window
that floats above every other app on your system. The page rendered
inside is a full document with full DOM access, full JavaScript, full
CSS — it's a real browser window, just one that the OS treats as
"always on top."

```javascript
const pipWindow = await documentPictureInPicture.requestWindow({
  width: 480,
  height: 260,
});

// The PiP window shares the opener's JavaScript realm:
pipWindow.document.body.style.background = "rgba(20,20,20,0.85)";
pipWindow.document.body.appendChild(myExistingCaptionBox);
```

That last line is the magic. You don't *copy* DOM into the PiP window —
you literally **move** it. The same DOM node that was rendering in your
main page is now rendering in the floating window. Move it back when
you're done.

## The realm-sharing insight

The Document PiP window shares its opener's JavaScript realm. That
means:

- Web Workers you created in the main page are accessible from PiP
- AudioContext, MediaStream, IntersectionObserver — all keep working
- No `postMessage` boilerplate between opener and PiP needed
- Event listeners attached in the main page fire in the PiP too

For LiveCaptionIt this matters enormously. Whisper runs in a Web
Worker. Audio is captured via `getDisplayMedia` into an AudioContext.
Both keep working as the caption DOM is shuffled between the main page
and the PiP window. We don't need a separate worker per window or a
duplicate audio capture.

## Why captions specifically

Native browser PiP (the video kind) only works for `<video>` elements.
You can't put text-only content into it. The classic Chrome Live Caption
gets around this by being a system-level overlay rendered outside the
browser, but that means it can't capture audio from a specific tab —
it captures system audio for accessibility.

Document PiP fills the gap. You can:

- Render live captions in a small persistent window
- Caption a *specific* browser tab (YouTube, Zoom Web, Spotify Web)
- Apply your own styling, themes, fonts, position
- Resize and drag like any native overlay
- Hide opener-only UI when in PiP mode

## What you lose

Browser support is the obvious one. As of mid-2026, Document PiP works
in Chrome 116+, Edge 116+, Brave 116+, and Opera 102+. Safari and
Firefox don't ship it (Firefox has an experimental flag). Mobile
Chromium technically supports the API but the floating-window UX
doesn't make sense on mobile (the entire OS isn't built around overlays
the way desktop is).

For LiveCaptionIt's audience this is fine — Whisper-in-browser via
WebGPU already requires Chromium, so requiring Chromium for PiP doesn't
narrow the audience further. On non-Chromium browsers we fall back to
inline captions in the main page tab; on mobile we render inline by
default and hide the PiP UI entirely.

## The other thing PiP unlocks: persistent UI for any web app

Once you've internalized "PiP windows can hold any document," lots of
patterns open up:

- Spotify-style mini player (web app, not just video)
- Sticky calendar / meeting countdown
- Live sports score ticker
- Persistent chat window above other work
- AI assistant overlay

Most of these aren't shipped today because the API is still niche. The
opportunity is wide open for anyone willing to spend the 4 hours
learning it.

## Closing pitch

LiveCaptionIt is one example of what Document PiP makes possible:
captions for *any* audio your browser can hear, floating above any app,
free, with zero upload. If you want to see the full implementation
(audio capture → Whisper worker → caption DOM → PiP window), the source
is on GitHub.

If you're building anything where "persistent UI above other work"
matters, learn the Document PiP API. It's one of the cleanest browser
APIs shipped in years, it's stable, and almost nobody is using it.
