/**
 * Local session-history store (v0.4.0).
 *
 * Persists the last N caption-session transcripts to IndexedDB so users
 * can revisit and re-download past work. Audio is NEVER stored — only
 * the committed text + timestamps + metadata. This is honestly disclosed
 * in the privacy page and FAQ.
 *
 * Database: `livecaptionit-history`
 * Version: 1
 * Object store: `sessions`
 * Key path: `id` (UUIDv4)
 * Indexes: `startedAt` (for sort-by-recency)
 *
 * Cap: when inserting beyond `MAX_SESSIONS` (20), oldest by startedAt is
 * dropped in the same transaction.
 *
 * NOTE: Implementation deliberately uses callbacks-over-Promise for
 * the IndexedDB request layer so the module remains usable in older
 * browsers without an `idb` wrapper dep, and so the unit tests can mock
 * `indexedDB` via the `fake-indexeddb` package if we add it. All exported
 * fns are async + Promise-returning.
 */

import type { TranscriptSegment } from "./transcript";

export const DB_NAME = "livecaptionit-history";
export const DB_VERSION = 1;
export const STORE_NAME = "sessions";
export const MAX_SESSIONS = 20;

export type SessionSource = "tab" | "mic" | "sample";

export interface StoredSession {
  /** UUIDv4. */
  id: string;
  /** Epoch ms. */
  startedAt: number;
  /** Epoch ms. */
  endedAt: number;
  source: SessionSource;
  /** Whisper model used (e.g. "base"). */
  modelId: string;
  /** Committed transcript — same shape used by transcript.ts formatters. */
  transcript: TranscriptSegment[];
  /** First ~100 chars of transcript text. Pre-computed for fast list views. */
  preview: string;
}

/** Opens (and migrates) the DB. Cached promise so we don't re-open per call. */
let dbPromise: Promise<IDBDatabase> | null = null;
function openDB(idb: IDBFactory = globalThis.indexedDB): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = idb.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("startedAt", "startedAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("openDB failed"));
  });
  return dbPromise;
}

/** Promisify an IDBRequest. */
function reqAsync<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IDBRequest failed"));
  });
}

/** Build the preview string from transcript segments. Pure function. */
export function buildPreview(transcript: TranscriptSegment[]): string {
  const text = transcript
    .map((s) => s.words.join(" "))
    .join(" ")
    .trim();
  if (text.length <= 100) return text;
  return text.slice(0, 100).trimEnd() + "…";
}

/** Generate a UUIDv4. Uses crypto.randomUUID when available, falls back to
 *  RFC4122-style hex pattern otherwise. Pure function modulo crypto access. */
export function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback (rare — older browsers/runtimes)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Save a session and prune oldest if over MAX_SESSIONS. Returns the
 * stored session (with assigned id + preview).
 *
 * Idempotency contract: a session with the SAME id will replace the
 * existing entry without bumping the prune count (put → no count change).
 */
export async function saveSession(
  partial: Omit<StoredSession, "id" | "preview"> & { id?: string },
  idb?: IDBFactory,
): Promise<StoredSession> {
  const full: StoredSession = {
    id: partial.id ?? generateId(),
    startedAt: partial.startedAt,
    endedAt: partial.endedAt,
    source: partial.source,
    modelId: partial.modelId,
    transcript: partial.transcript,
    preview: buildPreview(partial.transcript),
  };
  const db = await openDB(idb ?? globalThis.indexedDB);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const wasAlreadyThere = new Promise<boolean>((r) => {
      const g = store.get(full.id);
      g.onsuccess = () => r(g.result !== undefined);
      g.onerror = () => r(false);
    });
    void wasAlreadyThere.then((existed) => {
      store.put(full);
      if (existed) return; // no prune needed for an update
      // Count current entries; if over cap after this insert, drop oldest by startedAt.
      const countReq = store.count();
      countReq.onsuccess = () => {
        if (countReq.result <= MAX_SESSIONS) return;
        // Walk index in ascending order, delete the first one (= oldest).
        const idx = store.index("startedAt");
        const cur = idx.openCursor();
        cur.onsuccess = () => {
          const c = cur.result;
          if (c) {
            store.delete(c.primaryKey);
          }
        };
      };
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("saveSession tx failed"));
    tx.onabort = () => reject(tx.error ?? new Error("saveSession aborted"));
  });
  return full;
}

/** List all sessions, newest first. */
export async function listSessions(
  idb?: IDBFactory,
): Promise<StoredSession[]> {
  const db = await openDB(idb ?? globalThis.indexedDB);
  const tx = db.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);
  const all = await reqAsync(store.getAll() as IDBRequest<StoredSession[]>);
  return [...all].sort((a, b) => b.startedAt - a.startedAt);
}

/** Get a single session by id, or undefined if not found. */
export async function getSession(
  id: string,
  idb?: IDBFactory,
): Promise<StoredSession | undefined> {
  const db = await openDB(idb ?? globalThis.indexedDB);
  const tx = db.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);
  const result = await reqAsync(
    store.get(id) as IDBRequest<StoredSession | undefined>,
  );
  return result;
}

/** Delete one session by id. */
export async function deleteSession(
  id: string,
  idb?: IDBFactory,
): Promise<void> {
  const db = await openDB(idb ?? globalThis.indexedDB);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("delete failed"));
  });
}

/** Clear all sessions. */
export async function clearAll(idb?: IDBFactory): Promise<void> {
  const db = await openDB(idb ?? globalThis.indexedDB);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("clear failed"));
  });
}

// ────────────────────────────────────────────────────────────────────────
// v0.4.2 — JSON export / import
// ────────────────────────────────────────────────────────────────────────

/**
 * Version-1 export bundle shape. Future versions get a migration path
 * via `importSessions` rejecting unknown versions explicitly — never a
 * silent break. Bump the schema version + add an `if (bundle.version === N)`
 * branch in importSessions whenever you change StoredSession.
 */
export const EXPORT_VERSION = 1 as const;

export interface ExportBundle {
  /** Schema version. Locked at 1 for v0.4.2. */
  version: 1;
  /** ISO timestamp of when the export was generated. Informational only. */
  exportedAt: string;
  /** App version that produced the bundle. Informational only. */
  appVersion: string;
  /** All sessions, ordered newest first (same as listSessions). */
  sessions: StoredSession[];
}

export interface ImportResult {
  /** Sessions newly inserted into the store. */
  imported: number;
  /** Sessions skipped because their id already existed. */
  skipped: number;
  /** Sessions pruned during import to honour MAX_SESSIONS cap. */
  pruned: number;
}

/** Build an ExportBundle from the current store contents. */
export async function exportAllSessions(
  idb?: IDBFactory,
  appVersion = "0.4.2",
): Promise<ExportBundle> {
  const sessions = await listSessions(idb);
  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion,
    sessions,
  };
}

/**
 * Lightweight runtime validation for an imported bundle. Throws an Error
 * with a user-friendly message if the input is not a valid v1 bundle.
 * We deliberately don't use a schema library — keeps the lib zero-deps.
 */
export function validateExportBundle(input: unknown): asserts input is ExportBundle {
  if (typeof input !== "object" || input === null) {
    throw new Error("Invalid file: expected a JSON object.");
  }
  const obj = input as Record<string, unknown>;
  if (obj.version !== EXPORT_VERSION) {
    throw new Error(
      `Unsupported export version: ${String(obj.version)} (this build expects version ${EXPORT_VERSION}). The file may have been created by a newer version of LiveCaptionIt.`,
    );
  }
  if (!Array.isArray(obj.sessions)) {
    throw new Error("Invalid file: missing or malformed `sessions` array.");
  }
  for (const s of obj.sessions) {
    if (typeof s !== "object" || s === null) {
      throw new Error("Invalid file: `sessions` contains a non-object entry.");
    }
    const ss = s as Record<string, unknown>;
    if (
      typeof ss.id !== "string" ||
      typeof ss.startedAt !== "number" ||
      typeof ss.endedAt !== "number" ||
      (ss.source !== "tab" && ss.source !== "mic" && ss.source !== "sample") ||
      typeof ss.modelId !== "string" ||
      !Array.isArray(ss.transcript) ||
      typeof ss.preview !== "string"
    ) {
      throw new Error("Invalid file: a session entry is missing required fields.");
    }
  }
}

/**
 * Import sessions from a parsed-and-validated ExportBundle. Inserts each
 * session with skip-on-duplicate-id semantics, then prunes oldest by
 * `startedAt` if the store exceeds MAX_SESSIONS after the import. Returns
 * counts so the UI can surface a clear "X imported, Y skipped" toast.
 *
 * Implementation note: each session goes through a SEPARATE add — we
 * deliberately do NOT use a single transaction for the whole import.
 * Reasons:
 *   - Skip-on-duplicate-id is easier to express per-row (one `get` +
 *     conditional `add`) than as a bulk operation
 *   - On partial failure (e.g. one malformed session slips past validation),
 *     successful imports survive instead of the whole bundle rolling back
 *   - The 20-session cap means N <= 20, so transaction-overhead concern
 *     is negligible
 */
export async function importSessions(
  bundle: ExportBundle,
  idb?: IDBFactory,
): Promise<ImportResult> {
  const factory = idb ?? globalThis.indexedDB;
  const db = await openDB(factory);

  // Snapshot the pre-import count so we can compute `pruned` accurately
  // after saveSession's per-insert prune-on-cap fires.
  const preCount = await new Promise<number>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("count failed"));
  });

  let imported = 0;
  let skipped = 0;

  for (const session of bundle.sessions) {
    const existed = await new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(session.id);
      req.onsuccess = () => resolve(req.result !== undefined);
      req.onerror = () => reject(req.error ?? new Error("get failed"));
    });
    if (existed) {
      skipped++;
      continue;
    }
    // Use the canonical writer (saveSession) so preview is regenerated
    // and the prune-on-cap logic runs consistently with normal inserts.
    await saveSession(
      {
        id: session.id,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        source: session.source,
        modelId: session.modelId,
        transcript: session.transcript,
      },
      factory,
    );
    imported++;
  }

  const postCount = await new Promise<number>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("count failed"));
  });
  // pruned = sessions that landed but got immediately evicted by the
  // per-insert MAX_SESSIONS cap. = (pre + imported) - post.
  const pruned = Math.max(0, preCount + imported - postCount);

  return { imported, skipped, pruned };
}

/**
 * Reset the cached DB promise — primarily for unit tests that swap in
 * `fake-indexeddb` between cases. Not used in production code.
 */
export function _resetDbCacheForTests(): void {
  dbPromise = null;
}
