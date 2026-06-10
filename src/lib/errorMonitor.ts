/**
 * Error monitor — v0.4.3.
 *
 * Console-only telemetry. Buffers up to 50 most-recent errors in
 * sessionStorage so a user can paste a debug dump into a bug report
 * without needing to leave DevTools open from the moment of the
 * incident. Zero network requests; respects AGENTS.md rule 5
 * ("No tracking beyond GA4 page-view count").
 *
 * Auto-installs global handlers when initErrorMonitor() runs:
 *   - window.onerror      → uncaught exceptions
 *   - window.onunhandledrejection → unhandled promise rejections
 *
 * Module-level recordError() can also be called explicitly from
 * try/catch sites where we already know the source ("capture",
 * "whisper", "pip", "import", "export", "other").
 *
 * Exposes a debug helper on window: `__lcDebugErrors()` returns the
 * current buffer in a console-friendly format. We don't surface this
 * in the UI by default — too easy to look broken — but it's there for
 * "open DevTools, type that, screenshot the output, file a bug" flow.
 */

const STORAGE_KEY = "livecaptionit:errors";
const MAX_BUFFER = 50;

export type ErrorSource =
  | "capture"
  | "whisper"
  | "pip"
  | "import"
  | "export"
  | "sessionStore"
  | "other";

export interface ErrorRecord {
  ts: string;           // ISO timestamp
  source: ErrorSource;
  message: string;
  stack?: string;
  ctx?: Record<string, unknown>;
}

function safeGetBuffer(): ErrorRecord[] {
  if (typeof sessionStorage === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Light shape check — drop anything that doesn't look like a record.
    return parsed.filter(
      (r) =>
        r &&
        typeof r === "object" &&
        typeof r.ts === "string" &&
        typeof r.source === "string" &&
        typeof r.message === "string",
    );
  } catch {
    return [];
  }
}

function safeSetBuffer(buf: ErrorRecord[]): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(buf));
  } catch {
    // Quota exceeded or storage disabled — silently drop, console.error
    // still logs the actual error.
  }
}

/**
 * Record an error to the in-session buffer + console. Accepts an Error
 * or anything coerce-able to a string (rejections often pass non-Errors).
 *
 * Always calls console.error so the error is visible in DevTools even
 * if sessionStorage is unavailable (private window, quota exceeded, etc.).
 */
export function recordError(
  err: unknown,
  source: ErrorSource,
  ctx?: { ctx?: Record<string, unknown> },
): void {
  const e =
    err instanceof Error
      ? err
      : new Error(typeof err === "string" ? err : JSON.stringify(err));
  const rec: ErrorRecord = {
    ts: new Date().toISOString(),
    source,
    message: e.message || String(err),
    stack: e.stack,
    ...(ctx?.ctx ? { ctx: ctx.ctx } : {}),
  };
  // Console emit first — most important side effect.
  console.error(`[LiveCaptionIt:${source}]`, e, ctx?.ctx ?? "");
  const buf = safeGetBuffer();
  buf.push(rec);
  // Cap at MAX_BUFFER — drop oldest first.
  while (buf.length > MAX_BUFFER) buf.shift();
  safeSetBuffer(buf);
}

/** Return the current error buffer (copy, safe to mutate). */
export function getErrorBuffer(): ErrorRecord[] {
  return safeGetBuffer();
}

/** Clear the error buffer. */
export function clearErrorBuffer(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Install global error handlers. Idempotent — safe to call multiple
 * times. Returns an uninstall function (mostly for test cleanup).
 *
 * Skipped on non-browser environments (SSR / vitest node).
 */
export function initErrorMonitor(): () => void {
  if (typeof window === "undefined") return () => {};
  const onError = (event: ErrorEvent) => {
    recordError(event.error ?? new Error(event.message), "other", {
      ctx: {
        filename: event.filename,
        line: event.lineno,
        col: event.colno,
      },
    });
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    recordError(event.reason, "other", { ctx: { kind: "unhandledrejection" } });
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  exposeDebugHelper();
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}

/** Attach __lcDebugErrors() to window so users can paste a dump. */
function exposeDebugHelper(): void {
  if (typeof window === "undefined") return;
  (window as unknown as { __lcDebugErrors: () => ErrorRecord[] }).__lcDebugErrors =
    () => {
      const buf = getErrorBuffer();
      // Pretty-print to console for screenshot-friendly output, but
      // also return the array so it's inspectable.
      console.groupCollapsed(
        `[LiveCaptionIt] ${buf.length} error(s) buffered (most recent last)`,
      );
      for (const r of buf) {
        console.log(
          `${r.ts} [${r.source}] ${r.message}`,
          r.ctx ?? "",
        );
      }
      console.groupEnd();
      return buf;
    };
}
