/**
 * Shortcut customization layer.
 *
 * Lets users remap keys for any shortcut. Architecture:
 *
 *   1. `loadOverrides()` reads `{ [id]: key }` from localStorage.
 *   2. `applyOverrides(shortcuts, overrides)` returns a new shortcut array
 *      with overridden keys swapped in. Pure function — fully testable.
 *   3. `saveOverride(id, key)` / `clearOverride(id)` / `clearAllOverrides()`
 *      mutate localStorage. UI calls these and then re-renders.
 *   4. `detectConflict(id, key, shortcuts, overrides)` — given a candidate
 *      key for `id`, returns the conflicting shortcut id (if any) — same
 *      key, overlapping contexts. Pure function.
 *   5. `normalizeKey(event)` translates a KeyboardEvent into the canonical
 *      string form we store ("Space", "Escape", "p", etc.).
 *
 * Storage key: `livecaptionit:shortcut-overrides`
 * Format: JSON object `{ [shortcutId]: key }`. Invalid entries silently
 * dropped on load (defense against schema drift).
 */

import type { Shortcut } from "./shortcuts";

const STORAGE_KEY = "livecaptionit:shortcut-overrides";

/** Keys we refuse to remap because they'd break browser/OS behavior. */
const RESERVED_KEYS = new Set([
  "Tab",       // focus traversal
  "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
  "Meta", "Control", "Alt", "Shift",
  "ContextMenu",
  "PrintScreen",
]);

export type ShortcutOverrides = Record<string, string>;

export interface NormalizeResult {
  key: string;
  reserved: boolean;
  modifier: boolean;
}

/**
 * Translate a KeyboardEvent into the canonical key string we store.
 * Returns `null` if the keystroke shouldn't be assignable (Tab, Fn keys,
 * pure modifier press, etc.). The reason is surfaced via `reserved` /
 * `modifier` so the UI can show a clear message.
 */
export function normalizeKey(event: KeyboardEvent): NormalizeResult | null {
  // Pure modifier press (Shift / Ctrl / Alt / Meta on its own) — not
  // assignable; user is mid-chord.
  if (
    event.key === "Shift" ||
    event.key === "Control" ||
    event.key === "Alt" ||
    event.key === "Meta"
  ) {
    return { key: event.key, reserved: false, modifier: true };
  }

  // Block reserved keys outright.
  if (RESERVED_KEYS.has(event.key)) {
    return { key: event.key, reserved: true, modifier: false };
  }

  // We don't currently support modifier+key remaps (would collide with
  // browser/OS chords). If the user holds Ctrl/Cmd/Alt while pressing,
  // ignore the keystroke.
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return null;
  }

  // Canonical forms our matcher expects.
  if (event.key === " " || event.code === "Space") {
    return { key: "Space", reserved: false, modifier: false };
  }
  if (event.key === "Escape") {
    return { key: "Escape", reserved: false, modifier: false };
  }
  if (event.key === "Enter") {
    return { key: "Enter", reserved: false, modifier: false };
  }
  if (event.key === "?") {
    return { key: "?", reserved: false, modifier: false };
  }

  // Arrow keys and other multi-character names pass through as-is.
  if (event.key.length > 1) {
    return { key: event.key, reserved: false, modifier: false };
  }

  // Single character (letter, digit, punctuation) — lowercase for storage.
  return { key: event.key.toLowerCase(), reserved: false, modifier: false };
}

/** Read overrides from localStorage. Returns `{}` on parse failure. */
export function loadOverrides(): ShortcutOverrides {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    // Filter to string→string only.
    const out: ShortcutOverrides = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k === "string" && typeof v === "string" && v.length > 0) {
        out[k] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Persist a single override. */
export function saveOverride(id: string, key: string): void {
  if (typeof localStorage === "undefined") return;
  const current = loadOverrides();
  current[id] = key;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* private mode */
  }
}

/** Remove a single override (revert to default). */
export function clearOverride(id: string): void {
  if (typeof localStorage === "undefined") return;
  const current = loadOverrides();
  delete current[id];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* private mode */
  }
}

/** Wipe all overrides. */
export function clearAllOverrides(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode */
  }
}

/**
 * Apply overrides to a shortcut array. Returns a new array; original is
 * untouched. If an override references an unknown id, it's silently ignored.
 * Pure function.
 */
export function applyOverrides(
  shortcuts: Shortcut[],
  overrides: ShortcutOverrides,
): Shortcut[] {
  return shortcuts.map((s) =>
    overrides[s.id] ? { ...s, key: overrides[s.id] } : s,
  );
}

/**
 * Check if a candidate key would conflict with another shortcut once
 * applied. Two shortcuts conflict if they share a key AND share at least
 * one context. Returns the conflicting shortcut id or null.
 *
 * Empty `contexts` means "always" → conflicts with everything in that key.
 *
 * Pure function. Used by the UI to block a user from binding a key
 * that would silently shadow another.
 */
export function detectConflict(
  id: string,
  candidateKey: string,
  shortcuts: Shortcut[],
  overrides: ShortcutOverrides,
): string | null {
  const target = shortcuts.find((s) => s.id === id);
  if (!target) return null;
  // Apply overrides EXCEPT the one we're testing — otherwise we'd compare
  // the new key against an old value.
  const effective = shortcuts.map((s) => {
    if (s.id === id) return s; // ignore — we use candidateKey for it
    return overrides[s.id] ? { ...s, key: overrides[s.id] } : s;
  });
  for (const other of effective) {
    if (other.id === id) continue;
    if (other.key !== candidateKey) continue;
    // Context overlap check.
    const targetCtx = target.contexts;
    const otherCtx = other.contexts;
    // Empty context = "always" — overlaps with everything.
    if (targetCtx.length === 0 || otherCtx.length === 0) return other.id;
    if (targetCtx.some((c) => otherCtx.includes(c))) return other.id;
  }
  return null;
}

/** Pretty-print a stored key for UI display ("Space" → "Space", "p" → "P"). */
export function displayKey(key: string): string {
  if (key === " ") return "Space";
  if (key.length === 1) return key.toUpperCase();
  return key;
}
