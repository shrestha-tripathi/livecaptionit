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

  // Tag the PiP <body> + base styling. Layout-only inline styles —
  // colors come from the injected stylesheet below so the theme switch
  // (light/dark via [data-theme]) works inside PiP just like on the
  // main page.
  pipWindow.document.body.classList.add("pip-window");
  pipWindow.document.body.style.margin = "0";
  pipWindow.document.body.style.fontFamily = "var(--font-sans)";

  // Tell the browser this surface supports both schemes so it doesn't
  // paint a default white background based on prefers-color-scheme.
  const colorSchemeMeta = pipWindow.document.createElement("meta");
  colorSchemeMeta.name = "color-scheme";
  colorSchemeMeta.content = "dark light";
  pipWindow.document.head.appendChild(colorSchemeMeta);

  // Inject PiP-specific styles: surface uses the SAME theme tokens as
  // the main site so light/dark toggles drive the PiP look. Header
  // (LIVE + controls) fades in on hover so the box reads as a clean
  // caption surface most of the time.
  const pipStyle = pipWindow.document.createElement("style");
  pipStyle.textContent = `
    html, body.pip-window {
      background: var(--color-bg);
      color: var(--color-fg);
      overflow: hidden;
      margin: 0;
      padding: 0;
      width: 100vw;
      height: 100vh;
    }
    body.pip-window .cp-caption-box {
      background: var(--color-surface) !important;
      color: var(--color-fg) !important;
      box-shadow: none !important;
      border-radius: 0 !important;
      /* PiP-fill: lock the box to the window dimensions so it reflows
         as the user resizes the PiP. width: 100vw + box-sizing border-box
         lets the inner padding stay inside the viewport (no horizontal
         scrollbar at any width). */
      width: 100vw !important;
      max-width: none !important;
      height: 100vh !important;
      box-sizing: border-box !important;
    }
    /* Captions + live tail follow the theme — bold confirmed in fg,
       muted live tail in fg-subtle. Light + dark both pass.
       min-width: 0 + overflow-wrap: anywhere together force flex children
       to wrap at the current width (otherwise a long unbreakable token
       can lock the layout to a stale width). */
    body.pip-window #cp-caption-stream {
      color: var(--color-fg) !important;
      min-width: 0 !important;
      width: 100% !important;
      overflow-wrap: anywhere !important;
      word-break: break-word !important;
    }
    body.pip-window #cp-caption-stream p {
      color: var(--color-fg) !important;
      max-width: 100% !important;
    }
    body.pip-window #cp-caption-stream strong {
      color: var(--color-fg) !important;
      font-weight: 700;
    }
    body.pip-window #cp-caption-stream span.live-tail {
      color: var(--color-fg-subtle) !important;
    }
    /* Header (LIVE + Stop) hidden by default, fades in on hover.
       Long leave-delay so glancing away doesn't kill controls instantly.
       min-width: 0 + flex-wrap keep the row from forcing horizontal scroll
       when the user resizes the PiP narrow. */
    body.pip-window .cp-caption-box > header {
      opacity: 0;
      transition: opacity 220ms ease-out 1s;
      background: var(--color-surface) !important;
      border-bottom-color: var(--color-line) !important;
      min-width: 0 !important;
      flex-wrap: wrap !important;
    }
    body.pip-window:hover .cp-caption-box > header,
    body.pip-window:focus-within .cp-caption-box > header {
      opacity: 1;
      transition: opacity 120ms ease-out 0s;
    }
    /* Status banner (loading model etc) — uses theme surface-strong */
    body.pip-window #cp-caption-status {
      background: var(--color-surface-strong) !important;
    }
    body.pip-window #cp-caption-status,
    body.pip-window #cp-caption-status * {
      color: var(--color-fg-muted) !important;
    }
    /* Source label (the long media-stream id) — keep dim */
    body.pip-window #cp-source-label { color: var(--color-fg-subtle) !important; }
    /* Surface-strong button bg for Pop/Stop, brand-hover for Pop, rec-hover for Stop */
    body.pip-window #cp-pip-btn,
    body.pip-window #cp-stop-btn {
      background: var(--color-surface-strong) !important;
      color: var(--color-fg) !important;
    }
    body.pip-window #cp-pip-btn:hover {
      background: var(--color-brand) !important;
      color: #ffffff !important;
    }
    body.pip-window #cp-stop-btn:hover {
      background: var(--color-rec) !important;
      color: #ffffff !important;
    }
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

  // Keep PiP theme in sync with main page theme. Theme toggle on the
  // main page sets [data-theme] on documentElement — observe and mirror.
  const themeObserver = new MutationObserver(() => {
    const t = document.documentElement.getAttribute("data-theme");
    if (t) pipWindow.document.documentElement.setAttribute("data-theme", t);
    else pipWindow.document.documentElement.removeAttribute("data-theme");
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  pipWindow.addEventListener("pagehide", () => themeObserver.disconnect(), { once: true });

  return { pipWindow, close };
}
