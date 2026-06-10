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

import type { AnyTranscriptSegment } from "./transcript";
import { toV2Segments } from "./transcript";

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
  /**
   * Committed transcript — same shape used by transcript.ts formatters.
   * Can be v1 (`TranscriptSegment[]` with `words: string[]`) for sessions
   * recorded in v0.4.x, OR v2 (`TranscriptSegment2[]` with `words: Word[]`)
   * for sessions recorded in v0.5+. The discriminator is on each segment
   * (see `isV2Segment` in transcript.ts) so a single session can't mix —
   * v0.5+ always writes v2; v0.4.x always wrote v1. Readers use
   * `toV2Segments()` / `toV1Segments()` to normalize as needed.
   */
  transcript: AnyTranscriptSegment[];
  /** First ~100 chars of transcript text. Pre-computed for fast list views. */
  preview: string;
  /**
   * v0.5 — session schema version. Optional for backward-compat: undefined
   * means v1 (sessions written before v0.5 don't have this field). v0.5+
   * always writes 2.
   */
  version?: 1 | 2;
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

/** Build the preview string from transcript segments. Pure function.
 *  Handles both v1 (`words: string[]`) and v2 (`words: Word[]`) shapes. */
export function buildPreview(transcript: AnyTranscriptSegment[]): string {
  const text = transcript
    .map((s) => {
      const w = s.words;
      if (!w || w.length === 0) return "";
      // v2: Word objects with .text; v1: bare strings.
      const first = w[0] as unknown;
      if (typeof first === "object" && first !== null && "text" in first) {
        return (w as Array<{ text: string }>).map((x) => x.text.trim()).join(" ");
      }
      return (w as string[]).join(" ");
    })
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
 *
 * v0.5: auto-detects version from the transcript shape. If any segment
 * has Word objects, session is stored as v2. Otherwise v1 (preserves
 * v0.4.x semantics for back-compat tests). Callers can still pass
 * `version` explicitly if they want to force a specific value (rare).
 */
export async function saveSession(
  partial: Omit<StoredSession, "id" | "preview" | "version"> & { id?: string; version?: 1 | 2 },
  idb?: IDBFactory,
): Promise<StoredSession> {
  // Detect v2 if any segment has a Word object in words[].
  const detectedVersion: 1 | 2 = partial.transcript.some((seg) => {
    if (!seg.words || seg.words.length === 0) return false;
    const first = seg.words[0] as unknown;
    return typeof first === "object" && first !== null && "text" in first;
  })
    ? 2
    : 1;
  const full: StoredSession = {
    id: partial.id ?? generateId(),
    startedAt: partial.startedAt,
    endedAt: partial.endedAt,
    source: partial.source,
    modelId: partial.modelId,
    transcript: partial.transcript,
    preview: buildPreview(partial.transcript),
    version: partial.version ?? detectedVersion,
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
// v0.5 — EXPORT_VERSION bumped 1 → 2 to carry per-word timing.
// Backward-compat: validateExportBundle accepts BOTH v1 and v2; importer
// silently migrates v1 sessions to v2 with synthetic per-word timing so
// users restoring a v0.4.x backup on v0.5+ don't hit a wall.
// ────────────────────────────────────────────────────────────────────────

/**
 * Schema version. Bumped 1 → 2 in v0.5 to carry per-word timing in
 * each TranscriptSegment. Future versions get a migration path via
 * `validateExportBundle` accepting the new version + `importSessions`
 * branching on `bundle.version` — never a silent break of old exports.
 */
export const EXPORT_VERSION = 2 as const;

/** v1 bundle shape — kept for backward-compat reads only. */
export interface ExportBundleV1 {
  version: 1;
  exportedAt: string;
  appVersion: string;
  sessions: StoredSession[];
}

/** v2 bundle shape — current. Same fields, different `sessions[].transcript`
 *  shape (Word[] instead of string[] in each segment's words). */
export interface ExportBundleV2 {
  version: 2;
  exportedAt: string;
  appVersion: string;
  sessions: StoredSession[];
}

/** Union accepted by importers. Producers always emit V2. */
export type ExportBundle = ExportBundleV1 | ExportBundleV2;

export interface ImportResult {
  /** Sessions newly inserted into the store. */
  imported: number;
  /** Sessions skipped because their id already existed. */
  skipped: number;
  /** Sessions pruned during import to honour MAX_SESSIONS cap. */
  pruned: number;
  /** v0.5 — sessions upgraded from v1 → v2 with synthetic per-word timing.
   *  Subset of `imported`. Useful for the post-import toast to be honest
   *  about which sessions have "real" word timing vs synthetic. */
  migrated: number;
}

/** Build an ExportBundle from the current store contents.
 *  v0.5+ always emits version 2; v1 sessions in the store get upgraded
 *  via `toV2Segments` at export time so the bundle has uniform shape. */
export async function exportAllSessions(
  idb?: IDBFactory,
  appVersion = "0.5.0",
): Promise<ExportBundleV2> {
  const sessions = await listSessions(idb);
  const v2Sessions: StoredSession[] = sessions.map((s) => ({
    ...s,
    transcript: toV2Segments(s.transcript),
    version: 2,
  }));
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    appVersion,
    sessions: v2Sessions,
  };
}

/**
 * Lightweight runtime validation for an imported bundle. Throws an Error
 * with a user-friendly message if the input is not a valid v1 OR v2 bundle.
 * v0.5: both versions accepted; v1 sessions get migrated to v2 at import
 * time via `toV2Segments` (synthetic uniform per-word timing).
 *
 * We deliberately don't use a schema library — keeps the lib zero-deps.
 */
export function validateExportBundle(input: unknown): asserts input is ExportBundle {
  if (typeof input !== "object" || input === null) {
    throw new Error("Invalid file: expected a JSON object.");
  }
  const obj = input as Record<string, unknown>;
  if (obj.version !== 1 && obj.version !== 2) {
    throw new Error(
      `Unsupported export version: ${String(obj.version)} (this build accepts versions 1 and 2). The file may have been created by a newer version of LiveCaptionIt.`,
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
    // v0.5: shape-check the transcript entries to catch malformed bundles
    // early. v1 transcripts have words: string[]; v2 transcripts have
    // words: Word[] (objects with text/tStartMs/tEndMs). Mixed within a
    // single session is not legal but we tolerate it on read — the
    // formatter union dispatch handles per-segment shape.
    for (const seg of ss.transcript) {
      if (typeof seg !== "object" || seg === null) {
        throw new Error("Invalid file: a transcript segment is not an object.");
      }
      const segObj = seg as Record<string, unknown>;
      if (typeof segObj.tMs !== "number" || !Array.isArray(segObj.words)) {
        throw new Error("Invalid file: a transcript segment is missing tMs or words.");
      }
      // Allow empty words[] (paragraph break placeholder). For non-empty,
      // ensure each element is either a string (v1) OR a Word-shaped object.
      for (const w of segObj.words) {
        const isV1Word = typeof w === "string";
        const isV2Word =
          typeof w === "object" &&
          w !== null &&
          typeof (w as Record<string, unknown>).text === "string" &&
          typeof (w as Record<string, unknown>).tStartMs === "number" &&
          typeof (w as Record<string, unknown>).tEndMs === "number";
        if (!isV1Word && !isV2Word) {
          throw new Error("Invalid file: a transcript word is neither a string nor a valid Word object.");
        }
      }
    }
  }
}

/**
 * Import sessions from a parsed-and-validated ExportBundle. Inserts each
 * session with skip-on-duplicate-id semantics, then prunes oldest by
 * `startedAt` if the store exceeds MAX_SESSIONS after the import. Returns
 * counts so the UI can surface a clear "X imported, Y skipped, Z migrated"
 * toast.
 *
 * v0.5: when the bundle is version 1, each session's transcript is
 * upgraded to v2 via `toV2Segments` (synthetic uniform per-word timing
 * within each segment). The migrated count is surfaced so users know
 * which sessions have synthetic vs real word timing.
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
  let migrated = 0;
  const isV1Bundle = bundle.version === 1;

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
    // v0.5 migration: if importing a v1 bundle, upgrade the transcript to
    // v2 shape with synthetic per-word timing. This keeps the store
    // monotonically v2 once v0.5+ has touched it — saves us from having
    // to handle mixed-version sessions on every read.
    const upgradedTranscript = isV1Bundle
      ? toV2Segments(session.transcript)
      : session.transcript;
    const wasMigrated = isV1Bundle && session.transcript.length > 0;
    // Use the canonical writer (saveSession) so preview is regenerated
    // and the prune-on-cap logic runs consistently with normal inserts.
    await saveSession(
      {
        id: session.id,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        source: session.source,
        modelId: session.modelId,
        transcript: upgradedTranscript,
        version: 2,
      },
      factory,
    );
    imported++;
    if (wasMigrated) migrated++;
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

  return { imported, skipped, pruned, migrated };
}

/**
 * Reset the cached DB promise — primarily for unit tests that swap in
 * `fake-indexeddb` between cases. Not used in production code.
 */
export function _resetDbCacheForTests(): void {
  dbPromise = null;
}
