import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto"; // installs fake-indexeddb as globalThis.indexedDB
import {
  saveSession,
  listSessions,
  getSession,
  deleteSession,
  clearAll,
  buildPreview,
  generateId,
  MAX_SESSIONS,
  _resetDbCacheForTests,
  DB_NAME,
} from "./sessionStore";
import type { TranscriptSegment } from "./transcript";

function mkSegment(text: string, tMs = 0): TranscriptSegment {
  return { words: text.split(" "), tMs };
}

// Wipe DB between tests so cases stay isolated. We DON'T use
// `deleteDatabase()` here — fake-indexeddb's connection-closing
// semantics don't reliably release the cached `dbPromise`, leading to
// the beforeEach hook hanging for 10s+ on every test after the first.
// Instead: reset the module's cached promise, then open a fresh handle
// and `clear()` the object store, then close. Fast + deterministic.
beforeEach(async () => {
  _resetDbCacheForTests();
  // Open (creating + upgrading if first time) and clear.
  await new Promise<void>((resolve, reject) => {
    const req = globalThis.indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("sessions")) {
        const store = db.createObjectStore("sessions", { keyPath: "id" });
        store.createIndex("startedAt", "startedAt", { unique: false });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction("sessions", "readwrite");
      tx.objectStore("sessions").clear();
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error ?? new Error("clear failed"));
      };
    };
    req.onerror = () => reject(req.error ?? new Error("open failed"));
  });
});

describe("buildPreview (pure)", () => {
  it("joins segments + truncates with ellipsis past 100 chars", () => {
    const long = mkSegment("x".repeat(120));
    const p = buildPreview([long]);
    expect(p.endsWith("…")).toBe(true);
    expect(p.length).toBe(101);
  });

  it("returns short transcripts as-is", () => {
    const p = buildPreview([mkSegment("hello world")]);
    expect(p).toBe("hello world");
  });

  it("returns empty string for empty input", () => {
    expect(buildPreview([])).toBe("");
  });
});

describe("generateId", () => {
  it("returns a unique-ish string of length 36", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) ids.add(generateId());
    expect(ids.size).toBe(100);
    for (const id of ids) expect(id.length).toBe(36);
  });
});

describe("sessionStore CRUD", () => {
  it("saves and lists a session", async () => {
    const saved = await saveSession({
      startedAt: 1000,
      endedAt: 5000,
      source: "tab",
      modelId: "base",
      transcript: [mkSegment("hello")],
    });
    expect(saved.id).toBeTruthy();
    expect(saved.preview).toBe("hello");
    const list = await listSessions();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(saved.id);
  });

  it("returns sessions newest-first", async () => {
    await saveSession({
      startedAt: 100,
      endedAt: 200,
      source: "tab",
      modelId: "base",
      transcript: [mkSegment("old")],
    });
    await saveSession({
      startedAt: 500,
      endedAt: 600,
      source: "mic",
      modelId: "base",
      transcript: [mkSegment("new")],
    });
    const list = await listSessions();
    expect(list[0].transcript[0].words.join(" ")).toBe("new");
    expect(list[1].transcript[0].words.join(" ")).toBe("old");
  });

  it("getSession returns the session by id", async () => {
    const saved = await saveSession({
      startedAt: 1,
      endedAt: 2,
      source: "tab",
      modelId: "base",
      transcript: [mkSegment("x")],
    });
    const got = await getSession(saved.id);
    expect(got?.id).toBe(saved.id);
  });

  it("getSession returns undefined for unknown id", async () => {
    expect(await getSession("nonexistent")).toBeUndefined();
  });

  it("deleteSession removes one session", async () => {
    const a = await saveSession({
      startedAt: 1,
      endedAt: 2,
      source: "tab",
      modelId: "base",
      transcript: [mkSegment("a")],
    });
    const b = await saveSession({
      startedAt: 3,
      endedAt: 4,
      source: "mic",
      modelId: "base",
      transcript: [mkSegment("b")],
    });
    await deleteSession(a.id);
    const list = await listSessions();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(b.id);
  });

  it("clearAll empties the store", async () => {
    await saveSession({
      startedAt: 1,
      endedAt: 2,
      source: "tab",
      modelId: "base",
      transcript: [mkSegment("x")],
    });
    await clearAll();
    expect(await listSessions()).toHaveLength(0);
  });

  it("prunes oldest when over MAX_SESSIONS", async () => {
    // Insert MAX_SESSIONS + 2 sessions; expect MAX_SESSIONS to remain,
    // and the oldest 2 to have been pruned.
    for (let i = 0; i < MAX_SESSIONS + 2; i++) {
      await saveSession({
        startedAt: i * 1000,
        endedAt: i * 1000 + 100,
        source: "tab",
        modelId: "base",
        transcript: [mkSegment(`session ${i}`)],
      });
    }
    const list = await listSessions();
    expect(list).toHaveLength(MAX_SESSIONS);
    // Newest is session #MAX_SESSIONS+1 (zero-indexed)
    expect(list[0].transcript[0].words.join(" ")).toBe(`session ${MAX_SESSIONS + 1}`);
    // The oldest 2 (session 0 and 1) should be gone
    expect(list.find((s) => s.transcript[0].words.join(" ") === "session 0")).toBeUndefined();
    expect(list.find((s) => s.transcript[0].words.join(" ") === "session 1")).toBeUndefined();
  });

  it("update via same id replaces without prune count change", async () => {
    const saved = await saveSession({
      startedAt: 1,
      endedAt: 2,
      source: "tab",
      modelId: "base",
      transcript: [mkSegment("first")],
    });
    await saveSession({
      id: saved.id,
      startedAt: 1,
      endedAt: 2,
      source: "tab",
      modelId: "base",
      transcript: [mkSegment("updated")],
    });
    const list = await listSessions();
    expect(list).toHaveLength(1);
    expect(list[0].transcript[0].words.join(" ")).toBe("updated");
  });
});


// ────────────────────────────────────────────────────────────────────────
// v0.4.2 — JSON export / import
// ────────────────────────────────────────────────────────────────────────

import {
  exportAllSessions,
  importSessions,
  validateExportBundle,
  EXPORT_VERSION,
  type ExportBundle,
} from "./sessionStore";

describe("exportAllSessions / importSessions roundtrip", () => {
  it("exports an empty store as a valid v1 bundle", async () => {
    const bundle = await exportAllSessions();
    expect(bundle.version).toBe(EXPORT_VERSION);
    expect(bundle.sessions).toEqual([]);
    expect(typeof bundle.exportedAt).toBe("string");
    expect(typeof bundle.appVersion).toBe("string");
    // exportedAt must be ISO parseable
    expect(Number.isNaN(new Date(bundle.exportedAt).getTime())).toBe(false);
  });

  it("full roundtrip preserves all fields", async () => {
    await saveSession({
      startedAt: 1000,
      endedAt: 2000,
      source: "tab",
      modelId: "base",
      transcript: [mkSegment("hello world")],
    });
    await saveSession({
      startedAt: 3000,
      endedAt: 4000,
      source: "mic",
      modelId: "small",
      transcript: [mkSegment("second one")],
    });

    const bundle = await exportAllSessions();
    expect(bundle.sessions).toHaveLength(2);

    // Clear, re-import, verify everything came back.
    await clearAll();
    expect(await listSessions()).toEqual([]);

    const result = await importSessions(bundle);
    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.pruned).toBe(0);

    const restored = await listSessions();
    expect(restored).toHaveLength(2);
    expect(restored.map((s) => s.source).sort()).toEqual(["mic", "tab"]);
    expect(restored.find((s) => s.source === "tab")?.transcript[0].words.join(" ")).toBe("hello world");
    expect(restored.find((s) => s.source === "mic")?.modelId).toBe("small");
  });

  it("skips duplicates by id (no overwrite)", async () => {
    const existing = await saveSession({
      startedAt: 1000,
      endedAt: 2000,
      source: "tab",
      modelId: "base",
      transcript: [mkSegment("original")],
    });

    // Build a bundle containing the existing id with DIFFERENT transcript.
    const bundle: ExportBundle = {
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      appVersion: "test",
      sessions: [
        {
          id: existing.id,
          startedAt: 9999,
          endedAt: 99999,
          source: "mic",
          modelId: "tiny",
          transcript: [mkSegment("overwrite attempt")],
          preview: "overwrite attempt",
        },
      ],
    };

    const result = await importSessions(bundle);
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);

    // Original is untouched.
    const got = await getSession(existing.id);
    expect(got?.transcript[0].words.join(" ")).toBe("original");
    expect(got?.source).toBe("tab");
  });

  it("enforces MAX_SESSIONS cap on import (oldest pruned)", async () => {
    // Pre-populate with 15 sessions (under cap).
    for (let i = 0; i < 15; i++) {
      await saveSession({
        startedAt: 1000 + i,
        endedAt: 2000 + i,
        source: "tab",
        modelId: "base",
        transcript: [mkSegment(`pre-${i}`)],
      });
    }
    expect(await listSessions()).toHaveLength(15);

    // Import 10 more — total would be 25, cap should bring it back to 20.
    const sessions = Array.from({ length: 10 }, (_, i) => ({
      id: `imported-${i}`,
      startedAt: 100000 + i, // all newer than pre-existing
      endedAt: 100001 + i,
      source: "mic" as const,
      modelId: "small",
      transcript: [mkSegment(`imp-${i}`)],
      preview: `imp-${i}`,
    }));
    const bundle: ExportBundle = {
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      appVersion: "test",
      sessions,
    };

    const result = await importSessions(bundle);
    expect(result.imported).toBe(10);
    expect(result.skipped).toBe(0);
    expect(result.pruned).toBe(5);

    const after = await listSessions();
    expect(after).toHaveLength(MAX_SESSIONS);
    // The 5 oldest pre-existing should have been pruned; all 10 imports survive.
    expect(after.filter((s) => s.id.startsWith("imported-"))).toHaveLength(10);
  });
});

describe("validateExportBundle", () => {
  it("accepts a valid v1 bundle", () => {
    const valid: ExportBundle = {
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      appVersion: "test",
      sessions: [],
    };
    expect(() => validateExportBundle(valid)).not.toThrow();
  });

  it("rejects non-object input", () => {
    expect(() => validateExportBundle(null)).toThrow(/expected a JSON object/i);
    expect(() => validateExportBundle("string")).toThrow(/expected a JSON object/i);
    expect(() => validateExportBundle(42)).toThrow(/expected a JSON object/i);
  });

  it("rejects unknown version (forward-compat)", () => {
    expect(() =>
      validateExportBundle({
        version: 99,
        exportedAt: "",
        appVersion: "",
        sessions: [],
      }),
    ).toThrow(/unsupported export version/i);
  });

  it("rejects missing sessions array", () => {
    expect(() =>
      validateExportBundle({
        version: EXPORT_VERSION,
        exportedAt: "",
        appVersion: "",
      }),
    ).toThrow(/sessions/i);
  });

  it("rejects session entry missing required fields", () => {
    expect(() =>
      validateExportBundle({
        version: EXPORT_VERSION,
        exportedAt: "",
        appVersion: "",
        sessions: [{ id: "x", source: "tab" }], // missing startedAt etc.
      }),
    ).toThrow(/missing required fields/i);
  });

  it("rejects session with invalid source enum", () => {
    expect(() =>
      validateExportBundle({
        version: EXPORT_VERSION,
        exportedAt: "",
        appVersion: "",
        sessions: [
          {
            id: "x",
            startedAt: 1,
            endedAt: 2,
            source: "stream", // not in enum
            modelId: "base",
            transcript: [],
            preview: "",
          },
        ],
      }),
    ).toThrow(/missing required fields/i);
  });
});
