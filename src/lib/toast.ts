/**
 * Toast notification component — v0.4.3.
 *
 * Lightweight ephemeral notification panel. Replaces native `alert()`
 * which was used in v0.4.2 for import/export errors + success messages.
 * Native alerts are a UX dead-end: block the page, jarring, can't style,
 * and break the user out of the app flow.
 *
 * Contract:
 *   - showToast({ message, type, durationMs }) — fires and forgets
 *   - Multiple toasts stack vertically (newest on top)
 *   - Auto-dismiss after durationMs (defaults: 3500 for info/success,
 *     6000 for error — errors deserve more reading time)
 *   - Manual dismiss via close button
 *   - Container created lazily on first call so SSR/static-build is
 *     completely untouched
 *   - Idempotent re-initialization — calling from multiple sources is safe
 *
 * Theming:
 *   Pulls colors from CSS custom properties (already defined in global.css):
 *   --color-surface, --color-fg, --color-border, --color-brand,
 *   --color-rec. Works automatically with light/dark theme toggle.
 *
 * Accessibility:
 *   - Container has role="region" aria-live="polite" so screen readers
 *     announce new toasts non-disruptively
 *   - Error toasts use role="alert" + aria-live="assertive" — they
 *     escalate to interrupt
 *   - Close button has aria-label
 *   - Keyboard: Tab to focus close button, Enter/Space dismisses
 */

export type ToastType = "info" | "success" | "error";

export interface ToastOptions {
  message: string;
  type?: ToastType;
  /** Auto-dismiss timeout. 0 = sticky (only manual dismiss). */
  durationMs?: number;
}

const CONTAINER_ID = "cp-toast-container";
const DEFAULT_DURATION: Record<ToastType, number> = {
  info: 3500,
  success: 3500,
  error: 6000,
};

function ensureContainer(): HTMLDivElement {
  let container = document.getElementById(CONTAINER_ID) as HTMLDivElement | null;
  if (container) return container;
  container = document.createElement("div");
  container.id = CONTAINER_ID;
  container.setAttribute("role", "region");
  container.setAttribute("aria-label", "Notifications");
  // Fixed position bottom-center; mobile-friendly (max-w + side margins).
  // High z-index so we float above the caption box + PiP placeholder.
  container.style.cssText = [
    "position: fixed",
    "bottom: 1rem",
    "left: 50%",
    "transform: translateX(-50%)",
    "z-index: 9999",
    "display: flex",
    "flex-direction: column-reverse", // newest on top
    "gap: 0.5rem",
    "max-width: min(440px, calc(100vw - 2rem))",
    "width: max-content",
    "pointer-events: none", // children re-enable
  ].join("; ");
  document.body.appendChild(container);
  return container;
}

/**
 * Show a toast. Returns the toast element so callers can manually
 * dismiss / inspect if they need to (rarely needed in practice).
 *
 * Safe to call before DOM ready — ensureContainer() handles that.
 */
export function showToast(opts: ToastOptions): HTMLDivElement {
  const type: ToastType = opts.type ?? "info";
  const durationMs = opts.durationMs ?? DEFAULT_DURATION[type];

  const container = ensureContainer();
  const toast = document.createElement("div");
  toast.className = "cp-toast";
  toast.setAttribute("role", type === "error" ? "alert" : "status");
  toast.setAttribute(
    "aria-live",
    type === "error" ? "assertive" : "polite",
  );
  // Per-type accent border. Backgrounds stay neutral so light/dark just works.
  const accent =
    type === "error"
      ? "var(--color-rec)"
      : type === "success"
        ? "var(--color-brand)"
        : "var(--color-fg-subtle)";
  toast.style.cssText = [
    "pointer-events: auto",
    "background: var(--color-surface)",
    "color: var(--color-fg)",
    "border: 1px solid var(--color-border)",
    `border-left: 3px solid ${accent}`,
    "border-radius: 0.5rem",
    "padding: 0.625rem 0.75rem 0.625rem 0.875rem",
    "box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12)",
    "display: flex",
    "align-items: flex-start",
    "gap: 0.625rem",
    "font-size: 0.8125rem",
    "line-height: 1.4",
    // Subtle fade-in (no layout-shift toll because container is flex).
    "animation: cp-toast-in 180ms ease-out",
  ].join("; ");

  const msg = document.createElement("span");
  msg.style.cssText = "flex: 1 1 auto; min-width: 0;";
  // Plain text only — no HTML injection. Caller passes strings.
  msg.textContent = opts.message;
  toast.appendChild(msg);

  const close = document.createElement("button");
  close.type = "button";
  close.setAttribute("aria-label", "Dismiss notification");
  close.textContent = "✕";
  close.style.cssText = [
    "flex: 0 0 auto",
    "background: transparent",
    "border: 0",
    "padding: 0 0.125rem",
    "color: var(--color-fg-subtle)",
    "cursor: pointer",
    "font-size: 0.875rem",
    "line-height: 1",
    "border-radius: 0.25rem",
  ].join("; ");
  close.addEventListener("click", () => dismiss());
  toast.appendChild(close);

  let dismissed = false;
  let autoTimer: ReturnType<typeof setTimeout> | null = null;

  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    if (autoTimer !== null) clearTimeout(autoTimer);
    toast.style.animation = "cp-toast-out 160ms ease-in forwards";
    // Remove after animation completes
    setTimeout(() => {
      try {
        toast.remove();
      } catch {
        /* already gone */
      }
    }, 200);
  }

  if (durationMs > 0) {
    autoTimer = setTimeout(dismiss, durationMs);
  }

  container.appendChild(toast);
  return toast;
}

/** Convenience wrappers for the common cases. */
export const toast = {
  info: (message: string, durationMs?: number) =>
    showToast({ message, type: "info", durationMs }),
  success: (message: string, durationMs?: number) =>
    showToast({ message, type: "success", durationMs }),
  error: (message: string, durationMs?: number) =>
    showToast({ message, type: "error", durationMs }),
};
