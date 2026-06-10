/**
 * First-run onboarding tour.
 *
 * Walks new users through the 4 key interactions on the idle screen:
 *   1. Try with sample audio (zero-friction demo)
 *   2. Source toggle (tab vs microphone)
 *   3. Start captions (main CTA)
 *   4. Customize button (theme/style — surfaces hidden controls)
 *
 * Design constraints:
 *   - Zero dependencies (no shepherd.js / introjs / driver.js — they're
 *     all 40-80KB gzipped for 4 tooltips).
 *   - Skippable any time (X button + Esc key + click outside).
 *   - Runs once. localStorage sticky bit. Won't pester returning users.
 *   - Respects prefers-reduced-motion.
 *   - Works in both themes (uses CSS vars from global.css).
 *
 * Anchor strategy: query by stable `id` on idle-panel elements. If an
 * anchor is missing (markup change), that step is skipped silently
 * rather than crashing the tour.
 */

const SEEN_KEY = "livecaptionit:tour-seen-v1";

type TourStep = {
  /** CSS selector for the element to spotlight. Step skipped if not found. */
  anchor: string;
  /** Anchor side relative to the spotlight element. */
  placement: "top" | "bottom" | "left" | "right";
  title: string;
  body: string;
};

const STEPS: TourStep[] = [
  {
    anchor: "#cp-sample-btn",
    placement: "bottom",
    title: "Try the sample first",
    body:
      "No permissions, no microphone — just a 25-second clip to show what the captions look like. Perfect for first impressions.",
  },
  {
    anchor: "#caption-app [data-panel='idle'] .cp-segment-radio:first-of-type",
    placement: "bottom",
    title: "Pick your audio source",
    body:
      "Tab/window captures any audio your browser can hear — YouTube, Meet, podcasts. Microphone captures your own voice.",
  },
  {
    anchor: "#cp-start-btn",
    placement: "bottom",
    title: "This kicks off live captions",
    body:
      "Your browser will ask permission, then a floating window pops up. Move it anywhere — it stays on top of any app.",
  },
];

type Anchored = {
  step: TourStep;
  el: HTMLElement;
};

function isFirstRun(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) !== "1";
  } catch {
    return false; // private mode → don't tour (we can't remember anyway)
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* ignore */
  }
}

function resolveSteps(): Anchored[] {
  const out: Anchored[] = [];
  for (const step of STEPS) {
    const el = document.querySelector<HTMLElement>(step.anchor);
    if (el) out.push({ step, el });
  }
  return out;
}

interface TourUI {
  backdrop: HTMLDivElement;
  spotlight: HTMLDivElement;
  popover: HTMLDivElement;
  titleEl: HTMLDivElement;
  bodyEl: HTMLDivElement;
  counterEl: HTMLDivElement;
  nextBtn: HTMLButtonElement;
  skipBtn: HTMLButtonElement;
  prevBtn: HTMLButtonElement;
}

function createTourUI(): TourUI {
  const backdrop = document.createElement("div");
  backdrop.className = "cp-tour-backdrop";
  backdrop.setAttribute("role", "presentation");

  const spotlight = document.createElement("div");
  spotlight.className = "cp-tour-spotlight";

  const popover = document.createElement("div");
  popover.className = "cp-tour-popover";
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-modal", "true");
  popover.setAttribute("aria-labelledby", "cp-tour-title");

  popover.innerHTML = `
    <div class="cp-tour-popover__head">
      <div id="cp-tour-title" class="cp-tour-popover__title"></div>
      <button type="button" class="cp-tour-popover__skip" aria-label="Skip onboarding">×</button>
    </div>
    <div class="cp-tour-popover__body"></div>
    <div class="cp-tour-popover__foot">
      <div class="cp-tour-popover__counter"></div>
      <div class="cp-tour-popover__actions">
        <button type="button" class="cp-tour-popover__prev">Back</button>
        <button type="button" class="cp-tour-popover__next">Next</button>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);
  document.body.appendChild(spotlight);
  document.body.appendChild(popover);

  return {
    backdrop,
    spotlight,
    popover,
    titleEl: popover.querySelector(".cp-tour-popover__title")!,
    bodyEl: popover.querySelector(".cp-tour-popover__body")!,
    counterEl: popover.querySelector(".cp-tour-popover__counter")!,
    nextBtn: popover.querySelector(".cp-tour-popover__next")!,
    skipBtn: popover.querySelector(".cp-tour-popover__skip")!,
    prevBtn: popover.querySelector(".cp-tour-popover__prev")!,
  };
}

function positionUI(ui: TourUI, item: Anchored, stepIndex: number, total: number): void {
  const rect = item.el.getBoundingClientRect();
  const pad = 8;

  // Spotlight box around the anchor element.
  Object.assign(ui.spotlight.style, {
    top: `${rect.top - pad}px`,
    left: `${rect.left - pad}px`,
    width: `${rect.width + pad * 2}px`,
    height: `${rect.height + pad * 2}px`,
  });

  // Place the popover. Default: below the anchor; flip above if it'd overflow viewport.
  const popoverWidth = 320;
  const popoverPad = 12;
  const viewportH = window.innerHeight;
  const viewportW = window.innerWidth;

  // Center horizontally on the anchor, clamped to viewport edges.
  let left = rect.left + rect.width / 2 - popoverWidth / 2;
  left = Math.max(popoverPad, Math.min(viewportW - popoverWidth - popoverPad, left));

  let top: number;
  const spaceBelow = viewportH - rect.bottom;
  const popoverEstimatedH = 180; // conservative — actual height resolved after paint
  if (item.step.placement === "top" || spaceBelow < popoverEstimatedH + 20) {
    // place above
    top = rect.top - popoverEstimatedH - 16;
    if (top < popoverPad) top = popoverPad;
  } else {
    top = rect.bottom + 16;
  }

  Object.assign(ui.popover.style, {
    top: `${top}px`,
    left: `${left}px`,
    width: `${popoverWidth}px`,
  });

  // Populate content.
  ui.titleEl.textContent = item.step.title;
  ui.bodyEl.textContent = item.step.body;
  ui.counterEl.textContent = `${stepIndex + 1} of ${total}`;
  ui.prevBtn.disabled = stepIndex === 0;
  ui.nextBtn.textContent = stepIndex === total - 1 ? "Got it" : "Next";
}

function teardown(ui: TourUI, cleanups: Array<() => void>): void {
  ui.backdrop.classList.add("cp-tour-backdrop--leaving");
  ui.popover.classList.add("cp-tour-popover--leaving");
  ui.spotlight.classList.add("cp-tour-spotlight--leaving");
  setTimeout(() => {
    ui.backdrop.remove();
    ui.popover.remove();
    ui.spotlight.remove();
  }, 200);
  cleanups.forEach((fn) => fn());
}

/**
 * Public entry point. Idempotent — no-op if seen before or no anchors found.
 * Returns true if the tour actually started, false otherwise.
 */
export function startTour(opts?: { force?: boolean }): boolean {
  if (typeof document === "undefined") return false;
  if (!opts?.force && !isFirstRun()) return false;

  const items = resolveSteps();
  if (items.length === 0) return false;

  // Avoid double-start.
  if (document.querySelector(".cp-tour-popover")) return false;

  const ui = createTourUI();
  let index = 0;

  const onResize = () => positionUI(ui, items[index], index, items.length);
  window.addEventListener("resize", onResize);
  window.addEventListener("scroll", onResize, { passive: true });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      finish();
    } else if (e.key === "ArrowRight" || e.key === "Enter") {
      e.preventDefault();
      advance();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      back();
    }
  };
  window.addEventListener("keydown", onKey);

  const cleanups: Array<() => void> = [
    () => window.removeEventListener("resize", onResize),
    () => window.removeEventListener("scroll", onResize),
    () => window.removeEventListener("keydown", onKey),
  ];

  function render() {
    positionUI(ui, items[index], index, items.length);
  }

  function advance() {
    if (index < items.length - 1) {
      index += 1;
      render();
    } else {
      finish();
    }
  }

  function back() {
    if (index > 0) {
      index -= 1;
      render();
    }
  }

  function finish() {
    markSeen();
    teardown(ui, cleanups);
  }

  ui.nextBtn.addEventListener("click", advance);
  ui.prevBtn.addEventListener("click", back);
  ui.skipBtn.addEventListener("click", finish);
  ui.backdrop.addEventListener("click", finish);

  // First paint.
  render();
  // After paint, re-measure popover to get accurate above/below placement.
  requestAnimationFrame(render);

  return true;
}

/** Reset the seen flag — exposed via window for support / debug only. */
export function resetTour(): void {
  try {
    localStorage.removeItem(SEEN_KEY);
  } catch {
    /* ignore */
  }
}

/** Auto-start helper: runs the tour after a small delay so layout settles. */
export function initOnboardingTour(): void {
  if (typeof window === "undefined") return;
  // Don't tour bots / prerender.
  if (typeof document === "undefined" || document.visibilityState === "hidden") return;
  if (!isFirstRun()) return;

  // Delay so other first-paint UI (manifest etc) finishes; also give the
  // user a half-second to take the page in before pop-ups appear.
  setTimeout(() => {
    // Only auto-start on the home page (idle panel must exist).
    if (!document.getElementById("cp-start-btn")) return;
    startTour();
  }, 1200);

  // Expose debug helper.
  (window as unknown as { __lcResetTour?: () => void }).__lcResetTour = () => {
    resetTour();
    console.info("[Tour] Reset. Refresh to see the tour again.");
  };
}
