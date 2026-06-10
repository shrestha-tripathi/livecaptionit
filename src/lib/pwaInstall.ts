/**
 * PWA install prompt orchestrator.
 *
 * Chrome / Edge fire `beforeinstallprompt` when the page meets installability
 * heuristics (manifest + SW + engagement). We:
 *  1. Capture the event so we can show our own button (better than the
 *     browser's mini-infobar which we can't style).
 *  2. Show a non-blocking pill UI ("Install LiveCaptionIt") + optional dismiss.
 *  3. On click, call prompt() → wait for user choice → fire toast.
 *  4. Persist a "dismissed_at" timestamp in localStorage so we don't pester.
 *
 * iOS Safari does NOT fire beforeinstallprompt. We detect Safari-on-iOS and
 * show a manual A2HS hint (Share → Add to Home Screen) one-time.
 *
 * Once `appinstalled` fires we hide the prompt forever (sticky bit in
 * localStorage).
 */

import { toast } from "./toast";
import { site } from "../site.config";

const DISMISS_KEY = "livecaptionit:pwa-dismissed-at";
const INSTALLED_KEY = "livecaptionit:pwa-installed";
const REMIND_AFTER_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let promptEl: HTMLElement | null = null;

function isAlreadyInstalled(): boolean {
  // 1. localStorage sticky bit (set on appinstalled).
  if (typeof localStorage !== "undefined") {
    try {
      if (localStorage.getItem(INSTALLED_KEY) === "1") return true;
    } catch {
      /* private mode — fall through */
    }
  }
  // 2. Running in standalone display mode (already launched as a PWA).
  if (typeof matchMedia !== "undefined" && matchMedia("(display-mode: standalone)").matches) {
    return true;
  }
  // 3. iOS Safari standalone flag.
  if (typeof navigator !== "undefined" && "standalone" in navigator && (navigator as unknown as { standalone?: boolean }).standalone) {
    return true;
  }
  return false;
}

function wasRecentlyDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const ts = Number.parseInt(raw, 10);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < REMIND_AFTER_MS;
  } catch {
    return false;
  }
}

function markDismissed(): void {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    /* private mode */
  }
}

function markInstalled(): void {
  try {
    localStorage.setItem(INSTALLED_KEY, "1");
  } catch {
    /* private mode */
  }
}

function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) && !("MSStream" in window);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  return isIos && isSafari;
}

function showPromptUI(opts: { ios?: boolean }): void {
  if (promptEl) return; // already showing
  const el = document.createElement("div");
  el.className = "cp-install-prompt";
  el.setAttribute("role", "region");
  el.setAttribute("aria-label", `Install ${site.name}`);
  if (opts.ios) {
    el.innerHTML = `
      <div class="cp-install-prompt__body">
        <span class="cp-install-prompt__icon" aria-hidden="true">📲</span>
        <span class="cp-install-prompt__text">
          Install: tap <strong>Share</strong> → <strong>Add to Home Screen</strong>.
        </span>
      </div>
      <button type="button" class="cp-install-prompt__dismiss" aria-label="Dismiss install hint">×</button>
    `;
  } else {
    el.innerHTML = `
      <div class="cp-install-prompt__body">
        <span class="cp-install-prompt__icon" aria-hidden="true">⬇️</span>
        <span class="cp-install-prompt__text">Install ${site.name} as an app</span>
      </div>
      <button type="button" class="cp-install-prompt__cta">Install</button>
      <button type="button" class="cp-install-prompt__dismiss" aria-label="Dismiss install prompt">×</button>
    `;
  }
  document.body.appendChild(el);
  promptEl = el;

  const dismissBtn = el.querySelector<HTMLButtonElement>(".cp-install-prompt__dismiss");
  dismissBtn?.addEventListener("click", () => {
    markDismissed();
    hidePromptUI();
  });

  const ctaBtn = el.querySelector<HTMLButtonElement>(".cp-install-prompt__cta");
  ctaBtn?.addEventListener("click", () => void triggerInstall());
}

function hidePromptUI(): void {
  if (!promptEl) return;
  promptEl.classList.add("cp-install-prompt--leaving");
  setTimeout(() => {
    promptEl?.remove();
    promptEl = null;
  }, 200);
}

async function triggerInstall(): Promise<void> {
  if (!deferredPrompt) return;
  try {
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      toast.success(`Installing ${site.name}…`);
    } else {
      markDismissed();
    }
  } catch (err) {
    console.warn("[PWA] install prompt failed:", err);
  } finally {
    deferredPrompt = null;
    hidePromptUI();
  }
}

export function initPwaInstall(): void {
  if (typeof window === "undefined") return;
  if (isAlreadyInstalled()) return;
  if (wasRecentlyDismissed()) return;

  // Chrome / Edge / Android Chrome path.
  window.addEventListener("beforeinstallprompt", (e: Event) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    showPromptUI({ ios: false });
  });

  // Set sticky bit on successful install.
  window.addEventListener("appinstalled", () => {
    markInstalled();
    hidePromptUI();
    toast.success(`${site.name} installed`);
  });

  // iOS Safari path — no beforeinstallprompt, show manual hint after 8s
  // so it doesn't crowd the first-paint experience.
  if (isIosSafari()) {
    setTimeout(() => {
      if (!isAlreadyInstalled() && !wasRecentlyDismissed()) {
        showPromptUI({ ios: true });
      }
    }, 8000);
  }
}

/** Manual trigger — for a future "Install app" link in the nav/footer. */
export function isInstallAvailable(): boolean {
  return deferredPrompt !== null;
}

export function triggerManualInstall(): Promise<void> {
  return triggerInstall();
}
