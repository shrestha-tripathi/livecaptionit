/**
 * Pure keyboard-shortcut dispatcher. v0.4.0.
 *
 * Design contract:
 *
 *  - Pure data: `Shortcut[]` describes the bindings. No DOM access here.
 *  - `dispatch(event, shortcuts, context)` decides which handler (if any)
 *    fires for a given KeyboardEvent + current app state. Pure function,
 *    fully unit-testable.
 *  - `install(targetDoc, shortcuts, getContext)` wires it up to a real
 *    document. Returns an `uninstall()` callback. The caller can install
 *    on `window.document` AND on `pipWindow.document` whenever PiP opens.
 *  - We DO NOT capture keystrokes when the user is typing in an input,
 *    textarea, select, or contenteditable region — early-out in the
 *    listener.
 */

export type ShortcutContext = "idle" | "loading" | "active-live" | "active-paused" | "active-stopped";

export interface Shortcut {
  /** Stable identifier used by the override layer. NEVER reuse — if a
   *  shortcut's purpose changes, give it a new id and let the old override
   *  silently go unused (no breakage on upgrade). */
  id: string;
  /** Single key or modifier+key combo (e.g. "Space", "Escape", "?"). */
  key: string;
  /** App states where this shortcut should fire. Empty array = always. */
  contexts: ShortcutContext[];
  /** Human-readable description for the help overlay. */
  label: string;
  /** Section grouping in the help overlay. */
  section: "Capture" | "Playback" | "Window" | "Navigation" | "Help";
  /** Called when this shortcut fires. */
  handler: () => void;
}

/**
 * Return true if the keydown originated from an element where the user
 * is typing — text input, textarea, select, contenteditable — and so
 * we should NOT eat the keystroke.
 *
 * Duck-typed on `.matches()` (which only exists on Element / EventTarget
 * subclasses) so the function stays unit-testable without a real DOM.
 */
export function isTypingContext(target: EventTarget | null): boolean {
  if (!target) return false;
  const matches = (target as { matches?: (sel: string) => boolean }).matches;
  if (typeof matches !== "function") return false;
  try {
    return matches.call(target, "input, textarea, select, [contenteditable]");
  } catch {
    return false;
  }
}

/**
 * Match a KeyboardEvent against a shortcut key string. Supports plain keys
 * ("Escape", "p", " ") and well-known names ("Space", "?").
 * Pure function.
 */
export function matchesKey(event: KeyboardEvent, key: string): boolean {
  // Normalize Space — `event.key === " "` is the truth, but human-readable
  // shortcut tables prefer "Space".
  if (key === "Space") return event.key === " " || event.code === "Space";
  // `?` requires Shift+/ on US layouts. KeyboardEvent.key === "?" on press,
  // so direct compare works.
  if (key === "?") return event.key === "?";
  // Case-insensitive single-letter shortcuts (we don't differentiate Shift).
  if (key.length === 1) return event.key.toLowerCase() === key.toLowerCase();
  // Multi-character names (Escape, Enter, ArrowUp, etc.).
  return event.key === key;
}

/**
 * Find which shortcut (if any) should fire for the given KeyboardEvent
 * and current ShortcutContext. Returns the matched shortcut or null.
 * Does NOT call the handler — caller decides whether to fire + preventDefault.
 * Pure function.
 */
export function dispatch(
  event: KeyboardEvent,
  shortcuts: Shortcut[],
  context: ShortcutContext,
): Shortcut | null {
  if (event.altKey || event.ctrlKey || event.metaKey) {
    // Don't hijack browser/OS chords (Cmd+R, Ctrl+T, etc.).
    return null;
  }
  if (isTypingContext(event.target)) return null;
  for (const s of shortcuts) {
    if (!matchesKey(event, s.key)) continue;
    if (s.contexts.length > 0 && !s.contexts.includes(context)) continue;
    return s;
  }
  return null;
}

/**
 * Install a keydown listener on a document with the given shortcut list.
 * Returns a no-arg uninstaller. Idempotent — calling uninstall twice is fine.
 *
 * `getContext` is a function (NOT a value) because the caller's app state
 * changes over time and the listener needs the latest snapshot per keydown.
 */
export function install(
  targetDoc: Document,
  shortcuts: Shortcut[],
  getContext: () => ShortcutContext,
): () => void {
  const handler = (event: KeyboardEvent) => {
    const matched = dispatch(event, shortcuts, getContext());
    if (matched) {
      event.preventDefault();
      event.stopPropagation();
      matched.handler();
    }
  };
  targetDoc.addEventListener("keydown", handler, true);
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    targetDoc.removeEventListener("keydown", handler, true);
  };
}
