/**
 * Document Picture-in-Picture wrapper.
 * Hides the document.head style-copy boilerplate and the DOM-move/return
 * orchestration.
 *
 * Important: the PiP window shares the same JS realm as the opener — any
 * scripts (workers, AudioContext, MediaStream, event listeners) created in
 * the opener continue to work and remain referenceable from the PiP DOM.
 * We just need to physically move (not copy) the DOM nodes we want shown
 * in the floating window, and copy stylesheets so they render correctly.
 */

export interface PipHandle {
  pipWindow: Window;
  close: () => void;
  /** Update the idle (non-hover) opacity in place. */
  setOpacity: (opacity: number) => void;
}

export interface PipOpenOptions {
  /** Element to move INTO the PiP window. Will be returned to `homeMount` on close. */
  movableEl: HTMLElement;
  /** Where to put `movableEl` back when PiP closes. */
  homeMount: HTMLElement;
  /** Width / height hints for the PiP window. Chrome may clamp. */
  width?: number;
  height?: number;
  /** If true, Chrome hides the "back to opener" button. Default false. */
  disallowReturnToOpener?: boolean;
  /** Initial opacity (0.2 – 1.0). Body becomes fully opaque on hover so
   *  controls stay easy to click. Default 1.0. */
  opacity?: number;
  /** Fired after the user (or browser) closes the PiP window. */
  onClose?: () => void;
}

export function isPipSupported(): boolean {
  return typeof window !== "undefined" && "documentPictureInPicture" in window;
}

export async function openPip(options: PipOpenOptions): Promise<PipHandle> {
  if (!isPipSupported()) {
    throw new Error("Document Picture-in-Picture not supported in this browser.");
  }

  const dpip: any = (window as any).documentPictureInPicture;
  const pipWindow: Window = await dpip.requestWindow({
    width: options.width ?? 480,
    height: options.height ?? 240,
    disallowReturnToOpener: options.disallowReturnToOpener ?? false,
  });

  // Copy stylesheets from opener so the PiP DOM renders the same.
  // Three cases to handle: <style> nodes, <link rel=stylesheet>, and
  // adopted CSSStyleSheets (Astro/Tailwind use a mix).
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = Array.from(sheet.cssRules).map((r) => r.cssText).join("\n");
      const style = pipWindow.document.createElement("style");
      style.textContent = rules;
      pipWindow.document.head.appendChild(style);
    } catch {
      // Cross-origin stylesheets throw on .cssRules access — fall back to a <link>
      if (sheet.href) {
        const link = pipWindow.document.createElement("link");
        link.rel = "stylesheet";
        link.href = sheet.href;
        pipWindow.document.head.appendChild(link);
      }
    }
  }

  // Inherit the opener's data-theme so dark/light matches.
  const theme = document.documentElement.getAttribute("data-theme");
  if (theme) pipWindow.document.documentElement.setAttribute("data-theme", theme);

  // Tag the PiP <body> so we can style it differently if needed.
  pipWindow.document.body.classList.add("pip-window");
  pipWindow.document.body.style.margin = "0";
  pipWindow.document.body.style.background = "var(--color-bg)";
  pipWindow.document.body.style.color = "var(--color-fg)";
  pipWindow.document.body.style.fontFamily = "var(--font-sans)";

  // ── Opacity (user-configurable) ──
  // Idle opacity comes from CSS var --pip-opacity so we can mutate it
  // live via setOpacity() without touching layout. The body fades to
  // that value, then snaps back to 1.0 on hover so the user can still
  // see controls clearly when they reach for Stop or interact.
  const initialOpacity = Math.max(0.2, Math.min(1, options.opacity ?? 1));
  pipWindow.document.body.style.setProperty("--pip-opacity", String(initialOpacity));
  pipWindow.document.body.style.opacity = "var(--pip-opacity)";
  pipWindow.document.body.style.transition = "opacity 200ms ease-out";
  const hoverStyle = pipWindow.document.createElement("style");
  hoverStyle.textContent =
    "body.pip-window:hover { opacity: 1 !important; }";
  pipWindow.document.head.appendChild(hoverStyle);

  // MOVE the element into PiP (this is the magic — same JS realm, same nodes)
  pipWindow.document.body.appendChild(options.movableEl);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    // Move element back BEFORE closing window (otherwise it gets destroyed)
    try {
      options.homeMount.appendChild(options.movableEl);
    } catch {}
    try {
      pipWindow.close();
    } catch {}
    options.onClose?.();
  };

  // User-driven close path (clicking native X)
  pipWindow.addEventListener("pagehide", close, { once: true });

  /** Live-update the idle opacity without re-opening the PiP window. */
  const setOpacity = (op: number) => {
    const clamped = Math.max(0.2, Math.min(1, op));
    pipWindow.document.body.style.setProperty("--pip-opacity", String(clamped));
  };

  return { pipWindow, close, setOpacity };
}
