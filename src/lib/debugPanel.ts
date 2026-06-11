/**
 * On-page debug panel — gated entirely on `?debug=1` in the URL.
 *
 * Purpose: when a user reports "page crashes on mobile", we need a way to see
 * WHAT THE BROWSER ACTUALLY DID, on their actual device. iOS Safari's web
 * inspector requires a Mac + USB cable; Chrome Android's remote debugging
 * requires desktop adb. Most indie-tool users have neither.
 *
 * Strategy: render a fixed-position dark panel pinned to the bottom of the
 * page with a chronological log of lifecycle events. User can screenshot it
 * and send the screenshot. We see exactly which step blew up.
 *
 * Design rules:
 *   - Zero impact when `?debug=1` is NOT present (factory short-circuits).
 *   - No imports from other app modules — avoids dependency cycles.
 *   - Self-contained styling (inline) so it works even if global.css fails to
 *     load. CSS variables are dropped; everything uses literal colors.
 *   - Tap-to-collapse so a curious non-debug user can dismiss it if they hit
 *     the URL by accident.
 *   - Captures `console.error` + `window.onerror` + `unhandledrejection` and
 *     appends to the panel. This is the whole point — JS errors that fire
 *     before a crash are otherwise invisible on mobile.
 */

export interface DebugPanel {
  /** Append a log line to the panel. No-op if debug is disabled. */
  log(label: string, value?: unknown): void;
  /** Append an error line (red). No-op if debug is disabled. */
  error(label: string, value?: unknown): void;
  /** True if `?debug=1` is in the URL. */
  readonly enabled: boolean;
}

let singleton: DebugPanel | null = null;

/**
 * Returns the singleton debug panel, creating + mounting it on first call
 * when `?debug=1` is present. Subsequent calls return the same instance.
 * When debug is disabled, returns a no-op stub (zero perf cost).
 */
export function getDebugPanel(): DebugPanel {
  if (singleton) return singleton;

  const enabled =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("debug") === "1";

  if (!enabled || typeof document === "undefined") {
    singleton = noopPanel();
    return singleton;
  }

  singleton = mountPanel();
  return singleton;
}

function noopPanel(): DebugPanel {
  return {
    enabled: false,
    log: () => {},
    error: () => {},
  };
}

function mountPanel(): DebugPanel {
  const container = document.createElement("div");
  container.id = "cp-debug-panel";
  container.setAttribute("role", "log");
  container.setAttribute("aria-live", "polite");
  container.style.cssText = [
    "position: fixed",
    "left: 8px",
    "right: 8px",
    "bottom: 8px",
    "max-height: 45vh",
    "overflow-y: auto",
    "background: rgba(8, 8, 12, 0.92)",
    "color: #e7eaf3",
    "font-family: ui-monospace, SFMono-Regular, Menlo, monospace",
    "font-size: 11px",
    "line-height: 1.35",
    "padding: 8px 10px 10px",
    "border: 1px solid #2a2f3a",
    "border-radius: 8px",
    "z-index: 99999",
    "box-shadow: 0 4px 14px rgba(0,0,0,0.45)",
    "-webkit-backdrop-filter: blur(6px)",
    "backdrop-filter: blur(6px)",
  ].join("; ");

  const header = document.createElement("div");
  header.style.cssText = [
    "display: flex",
    "justify-content: space-between",
    "align-items: center",
    "margin-bottom: 6px",
    "padding-bottom: 6px",
    "border-bottom: 1px solid #2a2f3a",
    "font-weight: 600",
    "color: #67e8f9",
  ].join("; ");
  header.textContent = "▼ debug";

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "×";
  closeBtn.setAttribute("aria-label", "Close debug panel");
  closeBtn.style.cssText = [
    "background: transparent",
    "border: 1px solid #3a4050",
    "color: #e7eaf3",
    "border-radius: 4px",
    "width: 22px",
    "height: 22px",
    "cursor: pointer",
    "font-size: 14px",
    "line-height: 1",
    "padding: 0",
  ].join("; ");
  closeBtn.addEventListener("click", () => container.remove());
  header.appendChild(closeBtn);

  const body = document.createElement("div");
  body.id = "cp-debug-panel-body";
  body.style.cssText = "white-space: pre-wrap; word-break: break-word;";

  container.appendChild(header);
  container.appendChild(body);

  // Tap header to collapse/expand the body.
  let collapsed = false;
  header.addEventListener("click", (ev) => {
    if (ev.target === closeBtn) return;
    collapsed = !collapsed;
    body.style.display = collapsed ? "none" : "block";
    header.firstChild!.textContent = (collapsed ? "▶" : "▼") + " debug";
  });

  document.body.appendChild(container);

  const append = (line: string, color?: string) => {
    const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
    const row = document.createElement("div");
    if (color) row.style.color = color;
    row.textContent = `[${ts}] ${line}`;
    body.appendChild(row);
    // Auto-scroll to the newest line; user can scroll up to inspect history.
    container.scrollTop = container.scrollHeight;
  };

  const fmt = (value: unknown): string => {
    if (value === undefined) return "";
    if (value === null) return "null";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };

  const api: DebugPanel = {
    enabled: true,
    log(label, value) {
      const v = fmt(value);
      append(v ? `${label}: ${v}` : label);
    },
    error(label, value) {
      const v = fmt(value);
      append("⚠ " + (v ? `${label}: ${v}` : label), "#fda4af");
    },
  };

  // Hook globals so uncaught errors land in the panel too. We do NOT
  // intercept console.log (would create infinite loop with our own logger);
  // only error/warn that the user would otherwise never see on mobile.
  window.addEventListener("error", (e) => {
    api.error("window.onerror", e.message || String(e));
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = (e as PromiseRejectionEvent).reason;
    api.error("unhandledRejection", (reason && reason.message) || String(reason));
  });
  const origConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    api.error("console.error", args.map(fmt).join(" "));
    origConsoleError(...args);
  };

  // Initial banner so the user knows the panel is alive on page load.
  api.log("debug panel mounted (v0.5.2)");

  return api;
}
