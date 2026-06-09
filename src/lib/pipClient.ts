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

  // Tag the PiP <body> + base styling. Note: bg is set to transparent by
  // the injected stylesheet below (for native-caption feel over videos).
  pipWindow.document.body.classList.add("pip-window");
  pipWindow.document.body.style.margin = "0";
  pipWindow.document.body.style.color = "var(--color-fg)";
  pipWindow.document.body.style.fontFamily = "var(--font-sans)";

  // ── Opacity (user-configurable, native-caption style) ──
  // The opacity slider now controls the caption BOX's background alpha
  // — NOT the content opacity. Text stays full white so it stays
  // readable; the dark panel fades to let the video underneath show
  // through. Mirrors how YouTube / Live Caption / VLC subtitles work.
  // Live-mutate via --pip-opacity CSS var; setOpacity() updates it.
  const initialOpacity = Math.max(0.2, Math.min(1, options.opacity ?? 1));
  pipWindow.document.body.style.setProperty("--pip-opacity", String(initialOpacity));

  // Inject PiP-specific styles: transparent window, dark translucent
  // caption box that fills the viewport edge-to-edge, hover-only
  // controls, text-shadow for over-video legibility.
  const pipStyle = pipWindow.document.createElement("style");
  pipStyle.textContent = `
    html, body.pip-window {
      background: transparent !important;
      overflow: hidden;
    }
    body.pip-window .cp-caption-box {
      background: rgba(20, 20, 20, var(--pip-opacity, 1)) !important;
      color: #ffffff !important;
      box-shadow: none !important;
      border-radius: 0 !important;
      height: 100vh !important;
      transition: background-color 200ms ease-out;
    }
    /* Text-shadow keeps captions readable even at low opacity over bright video frames */
    body.pip-window #cp-caption-stream {
      color: #ffffff !important;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.85), 0 0 8px rgba(0, 0, 0, 0.55);
    }
    body.pip-window #cp-caption-stream p { color: #ffffff !important; }
    body.pip-window #cp-caption-stream strong { color: #ffffff !important; font-weight: 700; }
    body.pip-window #cp-caption-stream span.live-tail { color: rgba(255, 255, 255, 0.55) !important; }
    /* Header (LIVE + Stop) hidden by default in PiP, fades in on hover.
       Long leave-delay so glancing away doesn't kill controls instantly. */
    body.pip-window .cp-caption-box > header {
      opacity: 0;
      transition: opacity 220ms ease-out 1s;
      border-bottom-color: rgba(255, 255, 255, 0.15) !important;
    }
    body.pip-window:hover .cp-caption-box > header,
    body.pip-window:focus-within .cp-caption-box > header {
      opacity: 1;
      transition: opacity 120ms ease-out 0s;
    }
    /* Status banner (loading model etc) — make legible against translucent dark bg */
    body.pip-window #cp-caption-status {
      background: rgba(255, 255, 255, 0.08) !important;
    }
    body.pip-window #cp-caption-status,
    body.pip-window #cp-caption-status * {
      color: rgba(255, 255, 255, 0.9) !important;
    }
    /* Source label (the long media-stream id) — keep dim in PiP */
    body.pip-window #cp-source-label { color: rgba(255, 255, 255, 0.55) !important; }
  `;
  pipWindow.document.head.appendChild(pipStyle);

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
