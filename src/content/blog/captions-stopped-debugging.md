---
title: "Why my live captions stopped showing up (a debugging checklist)"
description: "When in-browser live captions silently stall — no error, no captions, just dead air — there are 7 common causes. Diagnostic checklist."
pubDate: 2026-06-10
tags: ["troubleshooting", "browser"]
---

You clicked Start, picked a tab, and... nothing. The status bar shows
"Listening" but captions never arrive. Or they show up for 5 seconds
and freeze. Or they appear once and stop.

This is almost always one of 7 specific issues. Here's the
checklist to walk through, ordered by frequency.

## 1. You didn't tick "Share tab audio" in the picker

By far the most common cause. Chrome's tab/screen picker has a small
checkbox at the bottom labeled **"Share tab audio"**. If you don't tick
it, only the video is shared — no audio. The captioner gets a stream
but no sound, so no captions.

**Fix:** Stop, click Start again, and look for the checkbox. It's
unticked by default. On macOS the checkbox might say "Share audio";
on Windows it's "Share tab audio." Always tick it.

## 2. The audio source is silent or paused

LiveCaptionIt and similar tools have a silence guard that resets the
buffer after 2.5 seconds of detected silence (RMS below a threshold).
If the YouTube video is paused, the podcast hasn't started, or the
meeting is in a "waiting room" state, no audio = no captions.

**Fix:** Confirm audio is actually playing. Look for the volume
indicator in your tab's title bar (the small speaker icon Chrome shows
on tabs producing audio). If it's not there, your source isn't
producing audio yet.

## 3. The model is still downloading

On first use, the Whisper model downloads from the Hugging Face CDN.
For Base it's ~75 MB; for Small it's 244 MB; for Large turbo it's
~537 MB. On a slow connection this can take 30 seconds to several
minutes. During this time the status bar shows download progress, not
captions.

**Fix:** Wait for the status to change from "Loading model" to
"Listening." If it's been over 3 minutes on Base, check your network
tab in DevTools — the model fetch may be failing silently (CORS or
network errors are reported separately).

## 4. WebGPU isn't enabled

If your browser doesn't support WebGPU (or you've disabled it),
LiveCaptionIt falls back to WASM. WASM is functional but ~3-5× slower
than WebGPU. On weak hardware the latency budget runs out before each
tick completes, and captions appear to stall while the worker
backlogs.

**Fix:**
- Check `chrome://gpu` in Chrome — look for "WebGPU: Hardware
  accelerated"
- On Linux, WebGPU may need a flag: `chrome://flags#enable-unsafe-webgpu`
- On older laptops without dedicated GPU, switch to the Tiny (39 MB)
  model tier — it runs fine on WASM

## 5. The Whisper worker silently crashed

Web Workers can crash and the parent page sometimes doesn't notice
(the worker stops responding but doesn't emit an error event by
default). LiveCaptionIt has explicit `error` and `unhandledrejection`
listeners inside the worker, plus a 120-second timeout on pipeline
init, but custom code or browser quirks can still create silent hangs.

**Fix:** Stop, refresh the page, start again. If it consistently
hangs, open DevTools → Console and look for messages prefixed
`[LiveCaptionIt:` — the error monitor buffers recent errors there.
Type `__lcDebugErrors()` to dump them.

## 6. macOS can't capture system audio

This is a platform limitation, not a bug. Apple's sandbox doesn't let
browsers capture system audio outside a specific tab. So picking
"Entire screen" on macOS gives you video but no audio.

**Fix:**
- Pick a specific Chrome tab instead, not "Entire screen"
- For native macOS apps like Spotify desktop or Zoom desktop, you
  can't capture them through the browser. Install BlackHole (free
  virtual audio device) and route the app's audio through it into a
  Chrome tab capture
- Or just use the web version of the app

## 7. The tab is producing protected audio

Some media (Netflix, certain Spotify content, some DRM-protected
videos) is flagged as "protected" by the browser. The browser refuses
to share its audio via tab capture even with consent. The tab capture
silently returns a video-only stream.

**Fix:** Use a non-DRM source. YouTube, Vimeo, most podcasts, all
meeting tools — these aren't protected. Netflix and some music streams
are. There's no workaround; this is intentional DRM enforcement.

## When none of the above apply

If you've checked all 7 and still no captions, the bug is likely in
LiveCaptionIt itself. Open an issue with:

- Browser + version (Chrome 130, Edge 130, etc.)
- OS + version
- What you were trying to caption (tab, mic, sample)
- Output of `__lcDebugErrors()` from DevTools console
- Any console errors with `[LiveCaptionIt:` prefix

We try to get back within a couple days. The captioning surface area
is small enough that most reported bugs are reproducible from a short
description.

## One more debug tip

If you suspect the audio capture is the problem (not Whisper), open
DevTools → Console and run:

```javascript
const s = await navigator.mediaDevices.getDisplayMedia({
  video: true,
  audio: true,
});
console.log("audio tracks:", s.getAudioTracks().length);
s.getTracks().forEach(t => t.stop());
```

Pick your tab + tick "Share tab audio" in the picker. If
`audio tracks: 0`, the picker didn't share audio. If
`audio tracks: 1`, capture is working — bug is downstream.
