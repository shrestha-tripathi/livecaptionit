# Rolling-Window Real-Time Captions — Implementation Plan

> **For Hermes:** This plan implements SPEC.md v0.1.2. Execute task-by-task; each task ends with a green build + a single commit.

**Goal:** Replace the 3s fixed-chunk pipeline with a sliding-window streaming transcriber so the first word appears ~700ms after speech (was ~3s).

**Architecture:** Continuous audio → RollingBuffer (10s) → tick every 600ms → worker.transcribeWindow → LocalAgreement-2 → commit stable prefix to stream + show in-flight tail as live line.

**Tech Stack:** Astro 6, Tailwind v4, TypeScript strict, `onnx-community/whisper-base` (no model change), Vitest for unit tests.

**Open-question answers (chosen by Hermes per user's "go with your picks"):**
1. Live line styling = **italic + muted color**
2. Tick interval = **600ms**
3. Commit threshold = **N=2** (LocalAgreement-2)

---

## Task 1 — Install Vitest + scaffold agreement.ts with failing tests

**Objective:** Create the unit-test harness and write all behavioural tests for LocalAgreement-2 BEFORE writing the implementation. Tests must fail because the module doesn't exist yet.

**Files:**
- Create: `vitest.config.ts`
- Create: `src/lib/agreement.test.ts`
- Modify: `package.json` (add vitest devDep + test script)

**Step 1: Install Vitest**

```bash
cd ~/projects/captionpip
npm install -D vitest
```

Expected: vitest added to devDependencies, no peer warnings.

**Step 2: Add test script + write `vitest.config.ts`**

`package.json` scripts:
```json
"test": "vitest run",
"test:watch": "vitest"
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
```

**Step 3: Write failing tests in `src/lib/agreement.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { Agreement } from "./agreement";

describe("Agreement (LocalAgreement-2)", () => {
  let a: Agreement;
  beforeEach(() => { a = new Agreement(); });

  it("starts empty", () => {
    expect(a.committed).toBe("");
    expect(a.liveLine).toBe("");
    expect(a.newlyCommitted).toEqual([]);
  });

  it("first tick: no commit, live shows hypothesis", () => {
    a.ingest("Hello");
    expect(a.committed).toBe("");
    expect(a.liveLine).toBe("Hello");
    expect(a.newlyCommitted).toEqual([]);
  });

  it("two ticks with matching prefix commits the prefix", () => {
    a.ingest("Hello");
    a.ingest("Hello world");
    expect(a.committed).toBe("Hello");
    expect(a.liveLine).toBe("world");
    expect(a.newlyCommitted).toEqual(["Hello"]);
  });

  it("growing prefix commits incrementally", () => {
    a.ingest("Hello world");
    a.ingest("Hello world how");
    expect(a.committed).toBe("Hello world");
    expect(a.newlyCommitted).toEqual(["Hello", "world"]);

    a.ingest("Hello world how are");
    expect(a.committed).toBe("Hello world how");
    expect(a.newlyCommitted).toEqual(["how"]);
  });

  it("disagreement on prefix: no new commit, live updates", () => {
    a.ingest("Hello world");
    a.ingest("Hello world");
    // committed = "Hello world", live = ""
    a.ingest("Goodbye now");
    expect(a.committed).toBe("Hello world");
    expect(a.newlyCommitted).toEqual([]);
    // live line is what's after committed in latest hypothesis (none agrees) — empty
    expect(a.liveLine).toBe("");
  });

  it("monotonicity: committed words never retract", () => {
    a.ingest("the quick brown");
    a.ingest("the quick brown fox");
    expect(a.committed).toBe("the quick brown");
    a.ingest("the slow brown fox"); // hypothesis disagrees with committed
    // committed remains, no rollback
    expect(a.committed).toBe("the quick brown");
  });

  it("word-boundary safe: partial word match does not commit", () => {
    a.ingest("Hello wor");
    a.ingest("Hello world");
    // "Hello" agrees, "wor" vs "world" disagrees at word level
    expect(a.committed).toBe("Hello");
    expect(a.newlyCommitted).toEqual(["Hello"]);
  });

  it("handles empty hypothesis gracefully", () => {
    a.ingest("Hello world");
    a.ingest("");
    expect(a.committed).toBe("");
    expect(a.newlyCommitted).toEqual([]);
    expect(a.liveLine).toBe("");
  });

  it("trim of leading/trailing whitespace before comparison", () => {
    a.ingest("  Hello  ");
    a.ingest(" Hello world ");
    expect(a.committed).toBe("Hello");
  });

  it("case-sensitive matching (Whisper is deterministic with temp=0)", () => {
    a.ingest("hello");
    a.ingest("Hello"); // capitalized differs — no agreement
    expect(a.committed).toBe("");
  });

  it("newlyCommitted is the per-tick delta only", () => {
    a.ingest("a b c");
    a.ingest("a b c d");
    expect(a.newlyCommitted).toEqual(["a", "b", "c"]);

    a.ingest("a b c d e");
    expect(a.newlyCommitted).toEqual(["d"]);
  });

  it("liveLine ends without trailing whitespace", () => {
    a.ingest("foo bar");
    a.ingest("foo bar baz");
    expect(a.liveLine).toBe("baz");
    expect(a.liveLine.endsWith(" ")).toBe(false);
  });

  it("samplesToTrim reports samples behind newly-committed words", () => {
    a.ingest("hello world");
    a.ingest("hello world how are you");
    // 2 committed words ("hello", "world"). At 16kHz Whisper rate,
    // approx samples = wordCount * AVG_SAMPLES_PER_WORD
    expect(a.samplesToTrim).toBeGreaterThan(0);
  });

  it("reset clears all state", () => {
    a.ingest("hello");
    a.ingest("hello world");
    a.reset();
    expect(a.committed).toBe("");
    expect(a.liveLine).toBe("");
    expect(a.newlyCommitted).toEqual([]);
  });
});
```

**Step 4: Run tests — expect FAIL**

```bash
npm test
```

Expected: All tests fail with `Cannot find module './agreement'` or similar. This is the "red" half of TDD.

**Step 5: Commit (test scaffold only)**

```bash
git add vitest.config.ts package.json package-lock.json src/lib/agreement.test.ts
git commit -m "test(whisper): add LocalAgreement-2 unit tests (failing — TDD red)"
```

---

## Task 2 — Implement Agreement class (make tests pass)

**Objective:** Write the minimum LocalAgreement-2 algorithm to turn all tests green.

**Files:**
- Create: `src/lib/agreement.ts`

**Step 1: Implementation**

```ts
/**
 * LocalAgreement-2: commit a transcribed word only when two consecutive
 * Whisper hypotheses agree on it at the word-prefix level. Once committed,
 * a word never retracts. The unconfirmed tail of the latest hypothesis
 * becomes the "live line" shown to the user in muted italic.
 *
 * Pure functional state machine — no DOM, no audio. Unit-testable in
 * isolation. See SPEC.md §1.2.4 for the algorithm in plain language.
 */

const AVG_SAMPLES_PER_WORD = 16_000 * 0.4; // 400ms per spoken word at 16kHz

function tokenize(s: string): string[] {
  return s.trim().split(/\s+/).filter(Boolean);
}

function commonWordPrefix(a: string[], b: string[]): string[] {
  const out: string[] = [];
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) out.push(a[i]);
    else break;
  }
  return out;
}

export class Agreement {
  /** Words confirmed and emitted. Joined with single spaces. */
  committed: string = "";
  /** Unconfirmed tail of the most recent hypothesis. */
  liveLine: string = "";
  /** Words promoted to `committed` during the most recent ingest(). */
  newlyCommitted: string[] = [];
  /** Samples to trim from the front of the rolling buffer after this tick. */
  samplesToTrim: number = 0;

  private lastTokens: string[] = [];
  private committedTokens: string[] = [];

  ingest(hypothesis: string): void {
    this.newlyCommitted = [];
    this.samplesToTrim = 0;
    const tokens = tokenize(hypothesis);

    // Compute commonality with previous hypothesis (LocalAgreement-2)
    const agreed = commonWordPrefix(this.lastTokens, tokens);

    // Only consider promoting words that extend BEYOND already-committed text
    if (agreed.length > this.committedTokens.length) {
      // Verify the agreed prefix is consistent with what's already committed
      const consistent = this.committedTokens.every(
        (w, i) => agreed[i] === w
      );
      if (consistent) {
        const newWords = agreed.slice(this.committedTokens.length);
        this.committedTokens = agreed;
        this.committed = this.committedTokens.join(" ");
        this.newlyCommitted = newWords;
        this.samplesToTrim = Math.floor(newWords.length * AVG_SAMPLES_PER_WORD);
      }
    }

    // Live line = whatever in the latest hypothesis comes AFTER what's committed
    const liveTokens = tokens.slice(
      tokens.length >= this.committedTokens.length &&
      this.committedTokens.every((w, i) => tokens[i] === w)
        ? this.committedTokens.length
        : tokens.length // hypothesis disagrees with committed prefix → no live tail
    );
    this.liveLine = liveTokens.join(" ");

    this.lastTokens = tokens;
  }

  reset(): void {
    this.committed = "";
    this.liveLine = "";
    this.newlyCommitted = [];
    this.samplesToTrim = 0;
    this.lastTokens = [];
    this.committedTokens = [];
  }
}
```

**Step 2: Run tests — expect PASS**

```bash
npm test
```

Expected: All 14 tests green.

**Step 3: Run typecheck**

```bash
npx astro check
```

Expected: 0 errors, 0 warnings.

**Step 4: Commit**

```bash
git add src/lib/agreement.ts
git commit -m "feat(whisper): implement LocalAgreement-2 algorithm

Pure-functional state machine that confirms transcribed words only when
two consecutive Whisper hypotheses agree at the word-prefix level. Once
committed, a word never retracts. Powers the v0.1.2 rolling-window flow.

Tests in src/lib/agreement.test.ts now pass (14/14 green)."
```

---

## Task 3 — Refactor audioCapture.ts to continuous-audio + RollingBuffer

**Objective:** Replace the 3s-chunk `onChunk` API with a continuous `onAudio` callback so the parent can run its own tick scheduler. Add an exported `RollingBuffer` helper.

**Files:**
- Modify: `src/lib/audioCapture.ts`

**Step 1: Update the interface and implementation**

Replace `CHUNK_SECONDS` chunking logic with continuous emit. Add `RollingBuffer`:

```ts
// At top of file, after TARGET_SAMPLE_RATE constant
export const ROLLING_MAX_SECONDS = 15;
export const ROLLING_TARGET_SECONDS = 10;
export const TICK_INTERVAL_MS = 600;
export const MIN_AUDIO_SECONDS = 0.5;

// Replace CaptureOptions
export interface CaptureOptions {
  /** Called continuously with raw 16kHz mono samples (~80ms per callback). */
  onAudio: (samples: Float32Array) => void;
  onLevel?: (rms: number) => void;
  onError: (err: Error) => void;
  onSourceEnded: () => void;
}

// Replace chunker block with simple forwarding
processor.onaudioprocess = (e) => {
  const input = e.inputBuffer.getChannelData(0);
  let processed: Float32Array;
  if (needManualResample) {
    const ratio = ctxRate / TARGET_SAMPLE_RATE;
    const newLen = Math.floor(input.length / ratio);
    processed = new Float32Array(newLen);
    for (let i = 0; i < newLen; i++) {
      processed[i] = input[Math.floor(i * ratio)];
    }
  } else {
    // Copy because the input buffer is reused by Web Audio
    processed = new Float32Array(input);
  }

  if (opts.onLevel) {
    const now = performance.now();
    if (now - lastLevelTs > 100) {
      let sum = 0;
      for (let i = 0; i < processed.length; i++) sum += processed[i] * processed[i];
      opts.onLevel(Math.sqrt(sum / processed.length));
      lastLevelTs = now;
    }
  }

  try { opts.onAudio(processed); }
  catch (err) { opts.onError(err as Error); }
};
```

Add `RollingBuffer` factory at end of file:

```ts
export interface RollingBuffer {
  append: (samples: Float32Array) => void;
  snapshot: () => Float32Array;
  trimFront: (samples: number) => void;
  length: () => number;
  durationSeconds: () => number;
  reset: () => void;
}

export function createRollingBuffer(maxSamples = ROLLING_MAX_SECONDS * TARGET_SAMPLE_RATE): RollingBuffer {
  // Pre-allocated ring? No — keep simple, just grow + slice when over cap.
  let buf: Float32Array = new Float32Array(0);

  return {
    append(samples) {
      const merged = new Float32Array(buf.length + samples.length);
      merged.set(buf, 0);
      merged.set(samples, buf.length);
      buf = merged.length > maxSamples
        ? merged.subarray(merged.length - maxSamples)
        : merged;
    },
    snapshot() {
      // Copy so caller owns the buffer (zero-copy transfer to worker)
      return new Float32Array(buf);
    },
    trimFront(samples) {
      if (samples <= 0) return;
      if (samples >= buf.length) { buf = new Float32Array(0); return; }
      buf = buf.subarray(samples);
    },
    length() { return buf.length; },
    durationSeconds() { return buf.length / TARGET_SAMPLE_RATE; },
    reset() { buf = new Float32Array(0); },
  };
}
```

**Remove:** `CHUNK_SECONDS` export and all chunking logic (`chunkSamples`, `buffer`, `bufferPos`, the append-to-buffer loop).

**Step 2: Verify build**

```bash
npx astro check
```

Expected: Will FAIL because CaptionApp.script.ts still references `onChunk` and `CHUNK_SECONDS`. That's expected — we fix in Task 7. For now confirm only `audioCapture.ts` itself typechecks (ignore downstream errors for this task).

**Step 3: Commit**

```bash
git add src/lib/audioCapture.ts
git commit -m "refactor(capture): continuous onAudio + RollingBuffer for streaming mode

Removes fixed 3s chunking. Now emits ~80ms continuous Float32 frames that
the caller buffers in a 15s ring. Adds createRollingBuffer() helper with
snapshot/trimFront primitives that the LocalAgreement-2 loop will drive.

Downstream consumers (CaptionApp.script.ts) intentionally broken in this
commit — fixed in the same series."
```

---

## Task 4 — Worker: greedy/deterministic decode + durationMs in result

**Objective:** Make Whisper output deterministic (required for agreement) and surface inference duration so the parent can adapt tick interval.

**Files:**
- Modify: `public/whisper-worker.js`

**Step 1: Update `transcribe()` to pass streaming-friendly args + measure duration**

Replace the `transcribe()` function body:

```js
async function transcribe(audio, id) {
  if (!asr) {
    self.postMessage({ type: "error", message: "Worker not initialized." });
    return;
  }
  const start = performance.now();
  try {
    const result = await asr(audio, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false,
      language: "english", // v0.1 hardcoded; v0.2 makes it configurable
      task: "transcribe",
      // Streaming-friendly: greedy + deterministic so LocalAgreement-2
      // can detect consistent prefixes across overlapping windows.
      num_beams: 1,
      temperature: 0,
    });
    const text = (result && result.text ? result.text : "").trim();
    const durationMs = Math.round(performance.now() - start);
    self.postMessage({ type: "result", text, id, durationMs });
  } catch (e) {
    self.postMessage({ type: "error", message: (e && e.message) || String(e) });
  }
}
```

**Step 2: Build to verify worker JS is still valid**

```bash
npm run build 2>&1 | tail -20
```

Expected: build passes (Astro doesn't typecheck the worker JS but bundling shouldn't break).

**Step 3: Commit**

```bash
git add public/whisper-worker.js
git commit -m "feat(worker): deterministic decode + emit durationMs in result

num_beams=1 + temperature=0 makes Whisper output deterministic across
identical input, which is required for LocalAgreement-2 to ever fire.
Also returns wall-clock inference time so the parent can adapt the
tick interval if the device is slower than budget."
```

---

## Task 5 — whisperClient.ts: add transcribeWindow + stale Xenova ref cleanup

**Objective:** Surface inference duration to caller via a new `transcribeWindow()` method that returns `{text, durationMs}`, and fix the stale default model name.

**Files:**
- Modify: `src/lib/whisperClient.ts`

**Step 1: Update types and impl**

```ts
// Add new return type
export interface WindowResult {
  text: string;
  durationMs: number;
}

export interface WhisperClient {
  init: (model?: string) => Promise<{ model: string; device: "webgpu" | "wasm" }>;
  /** Single-shot transcription. Returns text only (legacy / v0.1 API). */
  transcribe: (audio: Float32Array) => Promise<string>;
  /** Streaming transcription. Returns text + wall-clock inference duration. */
  transcribeWindow: (audio: Float32Array) => Promise<WindowResult>;
  dispose: () => void;
  onStatus: (cb: (s: WhisperStatus) => void) => void;
}
```

Inside `createWhisperClient()`:
- Change `pending` map value type from `{resolve: (s: string)=>void, reject}` to `{resolve: (r: WindowResult)=>void, reject}`.
- In the `case "result"` handler: build a `WindowResult` `{text: data.text ?? "", durationMs: data.durationMs ?? 0}` and resolve with it.
- Replace `init(model = "Xenova/whisper-base")` with `init(model = "onnx-community/whisper-base")` — **stale ref cleanup #1**.
- Implement `transcribeWindow(audio)` to mirror `transcribe()` but resolve with the `WindowResult`.
- Keep `transcribe(audio)` as a thin wrapper that calls `transcribeWindow` and returns just the text — preserves the v0.1 API for any future use.

```ts
return {
  init(model = "onnx-community/whisper-base") { ... },
  transcribe(audio) {
    return this.transcribeWindow(audio).then((r) => r.text);
  },
  transcribeWindow(audio: Float32Array): Promise<WindowResult> {
    return new Promise<WindowResult>((resolve, reject) => {
      const id = _nextId++;
      pending.set(id, { resolve, reject });
      worker.postMessage({ type: "transcribe", audio, id }, [audio.buffer]);
    });
  },
  dispose() { ... },
  onStatus(cb) { ... },
};
```

**Step 2: Verify typecheck**

```bash
npx astro check
```

Expected: `whisperClient.ts` itself typechecks. `CaptionApp.script.ts` still has errors from Task 3 — fix in Task 7. Just confirm there are no NEW errors in `whisperClient.ts`.

**Step 3: Commit**

```bash
git add src/lib/whisperClient.ts
git commit -m "feat(whisper): add transcribeWindow + fix stale Xenova model default

transcribeWindow returns {text, durationMs} so the tick scheduler can
adapt its interval based on observed inference latency.

Also fixes the stale 'Xenova/whisper-base' default that survived the
v0.1.1 worker fix — wrong model name silently hangs because the Xenova
port doesn't ship the dtype variants our WebGPU config requires."
```

---

## Task 6 — CaptionApp.astro: live line slot + updated copy

**Objective:** Add the `<p id="cp-caption-live">` mutable line slot under the committed stream, and update the user-facing copy that promised "~3 seconds".

**Files:**
- Modify: `src/components/CaptionApp.astro`

**Step 1: Modify the caption stream block (line ~95)**

Replace:
```html
<div id="cp-caption-stream" class="caption-text text-[var(--color-fg)]">
  <p class="text-[var(--color-fg-subtle)] text-sm italic">Listening… first caption usually appears within ~3 seconds.</p>
</div>
```

With:
```html
<div id="cp-caption-stream" class="caption-text text-[var(--color-fg)]">
  <p class="text-[var(--color-fg-subtle)] text-sm italic">Listening… first word usually appears within ~1 second.</p>
</div>

{/* Live (uncommitted) line — refreshes in-place every tick.
    Muted color + italic signals "draft / still refining". */}
<p
  id="cp-caption-live"
  class="caption-text text-[var(--color-fg-muted)] italic mt-2 hidden"
  aria-live="polite"
  aria-atomic="true"
></p>
```

**Step 2: Update the hint copy below the panel (line ~100-102)**

Replace:
```html
<p class="mt-3 text-xs text-[var(--color-fg-subtle)] text-center">
  Captions appear ~3s after speech (Whisper chunk window). Each line = one transcription pass.
</p>
```

With:
```html
<p class="mt-3 text-xs text-[var(--color-fg-subtle)] text-center">
  Italic line = best guess so far. Plain lines above = confirmed.
</p>
```

**Step 3: Verify build**

```bash
npm run build 2>&1 | tail -10
```

Expected: passes (Astro happy with the markup change).

**Step 4: Commit**

```bash
git add src/components/CaptionApp.astro
git commit -m "feat(ui): live-line slot + updated copy for streaming captions

Adds <p id='cp-caption-live'> below the committed stream — italic + muted
color signals 'still refining'. aria-live='polite' so screen readers also
get the real-time-feel.

Copy now promises ~1s first word + explains the italic-vs-plain
distinction the user will see."
```

---

## Task 7 — CaptionApp.script.ts: tick scheduler + agreement wiring

**Objective:** Replace the per-chunk pipeline with the rolling buffer + tick scheduler + LocalAgreement-2 rendering. Also: fix stale `Xenova/whisper-base` ref (#2).

**Files:**
- Modify: `src/components/CaptionApp.script.ts`

**Step 1: Add new imports**

```ts
import {
  startCapture,
  createRollingBuffer,
  TARGET_SAMPLE_RATE,
  TICK_INTERVAL_MS,
  MIN_AUDIO_SECONDS,
  type CaptureHandle,
  type RollingBuffer,
} from "../lib/audioCapture";
import { createWhisperClient, type WhisperClient } from "../lib/whisperClient";
import { openPip, isPipSupported, type PipHandle } from "../lib/pipClient";
import { detectSupport } from "../lib/browserSupport";
import { Agreement } from "../lib/agreement";
```

**Step 2: Add new DOM ref**

After `const captionStream = ...`:
```ts
const captionLive = rootEl.querySelector<HTMLParagraphElement>("#cp-caption-live")!;
```

**Step 3: Replace lifecycle state**

Remove:
```ts
let pendingAudio: Float32Array[] = [];
let whisperReady = false;
const PENDING_AUDIO_CAP = 5;
```

Add:
```ts
let whisperReady = false;
const rolling = createRollingBuffer();
const agreement = new Agreement();
let tickTimer: number | null = null;
let inFlight = false;
let nextTickMs = TICK_INTERVAL_MS;
const MAX_TICK_MS = 2000;
```

**Step 4: Replace `appendCaption()` to render words (not whole lines)**

```ts
function appendCommittedWords(words: string[]) {
  if (words.length === 0) return;
  // First commit clears placeholder + hides status banner
  if (captionCount === 0) {
    captionStream.innerHTML = "";
    hideCaptionStatus();
  }
  // Append words to the LAST <p> if it's still under MAX_LINE_WORDS;
  // otherwise start a new <p>. Roughly aligns with sentence-y chunks.
  const MAX_LINE_WORDS = 14;
  let lastP = captionStream.lastElementChild as HTMLParagraphElement | null;
  for (const word of words) {
    const lastWordCount = lastP ? (lastP.textContent || "").split(/\s+/).filter(Boolean).length : MAX_LINE_WORDS;
    if (!lastP || lastWordCount >= MAX_LINE_WORDS) {
      lastP = document.createElement("p");
      lastP.className = "mb-2";
      captionStream.appendChild(lastP);
    }
    lastP.textContent = (lastP.textContent ? lastP.textContent + " " : "") + word;
    captionCount++;
  }
  // Cap line history (count paragraphs, not words)
  while (captionStream.childElementCount > MAX_CAPTION_LINES) {
    captionStream.firstElementChild?.remove();
  }
  // Auto-scroll
  captionBox.scrollTop = captionBox.scrollHeight;
}

function renderLiveLine(text: string) {
  if (!text) {
    captionLive.classList.add("hidden");
    captionLive.textContent = "";
    return;
  }
  captionLive.textContent = text;
  captionLive.classList.remove("hidden");
  // Keep view glued to the live tail
  captionBox.scrollTop = captionBox.scrollHeight;
}
```

**Step 5: Replace `processChunk` and `drainPendingAudio` with the tick loop**

Delete both functions. Replace with:

```ts
function scheduleNextTick() {
  if (tickTimer !== null) {
    clearTimeout(tickTimer);
  }
  tickTimer = window.setTimeout(() => {
    tickTimer = null;
    void tick();
  }, nextTickMs);
}

async function tick() {
  if (!whisper || !whisperReady || inFlight) return scheduleNextTick();
  if (rolling.durationSeconds() < MIN_AUDIO_SECONDS) return scheduleNextTick();

  inFlight = true;
  try {
    const audio = rolling.snapshot();
    const { text, durationMs } = await whisper.transcribeWindow(audio);

    // Adapt tick interval — never tick faster than 1.2× last inference
    nextTickMs = Math.min(
      MAX_TICK_MS,
      Math.max(TICK_INTERVAL_MS, Math.ceil(durationMs * 1.2)),
    );

    if (text) {
      agreement.ingest(text);
      if (agreement.samplesToTrim > 0) rolling.trimFront(agreement.samplesToTrim);
      if (agreement.newlyCommitted.length > 0) appendCommittedWords(agreement.newlyCommitted);
      renderLiveLine(agreement.liveLine);
    }
  } catch (e) {
    console.warn("[CaptionPip] tick failed:", e);
  } finally {
    inFlight = false;
    scheduleNextTick();
  }
}
```

**Step 6: Update `startPipeline()` to use new capture API + reset agreement + start tick**

Inside `startPipeline()`, change the capture wiring from `onChunk` to `onAudio`:

```ts
captureHandle = await startCapture({
  onAudio: (samples) => rolling.append(samples),
  onError: (err) => showError(err.message),
  onSourceEnded: () => stopPipeline("Source ended."),
});
```

Also: change the `whisper.init("Xenova/whisper-base")` call to just `whisper.init()` — **stale ref cleanup #2** (let the client default win).

Reset state at start of pipeline:
```ts
whisperReady = false;
rolling.reset();
agreement.reset();
nextTickMs = TICK_INTERVAL_MS;
```

After capture succeeds + state set to active, kick off the tick loop:
```ts
scheduleNextTick();
```

Update the "Listening…" placeholder copy:
```ts
captionStream.innerHTML = `<p class="text-[var(--color-fg-subtle)] text-sm italic">Listening… first word usually appears within ~1 second.</p>`;
```

**Step 7: Update `stopPipeline()` to stop tick + clear live**

Inside `stopPipeline()`, add:
```ts
if (tickTimer !== null) {
  clearTimeout(tickTimer);
  tickTimer = null;
}
agreement.reset();
rolling.reset();
renderLiveLine("");
```

**Step 8: Verify build + tests**

```bash
npm test && npx astro check && npm run build 2>&1 | tail -15
```

Expected: tests pass (14/14), astro check 0 errors, build succeeds.

**Step 9: Grep guard**

```bash
grep -rln "CaptionPip" src/ public/ astro.config.* package.json 2>/dev/null \
  | grep -v site.config.ts
# Empty = clean
grep -rln "Xenova" src/ public/ 2>/dev/null
# Empty = clean (both stale refs gone)
```

Expected: both grep outputs empty.

**Step 10: Commit**

```bash
git add src/components/CaptionApp.script.ts
git commit -m "feat(capture): wire rolling-window pipeline + LocalAgreement-2

Replaces the 3s-chunk processing loop with:
- Continuous audio → 10s rolling buffer
- 600ms tick scheduler (adapts up if Whisper inference lags)
- LocalAgreement-2 commits stable prefix to caption stream
- Mutable 'live line' shows in-flight hypothesis (muted italic)
- Buffer trims behind committed words to bound memory

First word now visible ~700ms after speech start vs. ~3s previously.

Also fixes the second stale 'Xenova/whisper-base' reference (the model
name no longer needs to be passed explicitly — the client default is
correct since the v0.1.1 worker fix)."
```

---

## Task 8 — Final verification + push

**Objective:** End-to-end sanity check before declaring v0.1.2 done.

**Step 1: Full verify**

```bash
npm test && npx astro check && npm run build 2>&1 | tail -5
```

All three: green.

**Step 2: Manual test (Edge, Windows)**

Walk through the checklist in SPEC.md §1.2.11.

**Step 3: Push to origin**

```bash
cd ~/projects/captionpip
TOKEN=$(grep "^GITHUB_TOKEN=" ~/.hermes/.env | head -1 | cut -d= -f2- | tr -d '\n\r"')
git remote set-url origin "https://shrestha-tripathi:${TOKEN}@github.com/shrestha-tripathi/captionpip.git"
git push origin main 2>&1 | tail -5
git remote set-url origin "https://github.com/shrestha-tripathi/captionpip.git"
```

---

## Verification matrix

| Task | Test command | Pass criteria |
|---|---|---|
| 1 | `npm test` | All tests fail (red) |
| 2 | `npm test` | 14/14 tests pass |
| 3 | `npx astro check src/lib/audioCapture.ts` | audioCapture.ts itself clean |
| 4 | `npm run build` | Build succeeds |
| 5 | `npx astro check src/lib/whisperClient.ts` | whisperClient.ts itself clean |
| 6 | `npm run build` | Build succeeds |
| 7 | `npm test && npx astro check && npm run build` | All green |
| 8 | Manual checklist | All ✅ on Edge |

## Rollback

Each task = one commit. To revert any single task: `git revert <commit-sha>`.
To revert all of v0.1.2: `git revert <task1>..<task7>` (the agreement
module is purely additive so reverting it is safe).
