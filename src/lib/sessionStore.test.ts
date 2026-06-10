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
  it("exports an empty store as a valid v2 bundle (v0.5+ default)", async () => {
    const bundle = await exportAllSessions();
    expect(bundle.version).toBe(EXPORT_VERSION);
    expect(EXPORT_VERSION).toBe(2);
    expect(bundle.sessions).toEqual([]);
    expect(typeof bundle.exportedAt).toBe("string");
    expect(typeof bundle.appVersion).toBe("string");
    // exportedAt must be ISO parseable
    expect(Number.isNaN(new Date(bundle.exportedAt).getTime())).toBe(false);
  });

  it("full roundtrip preserves all fields (v1 input upgrades to v2 via export)", async () => {
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
    expect(bundle.version).toBe(2);

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
    // v0.5: exported segments are v2 (Word[]), not v1 (string[]).
    // Read out the .text from each Word to reconstruct the original string.
    const tabSession = restored.find((s) => s.source === "tab")!;
    const tabSegment = tabSession.transcript[0];
    const tabWords = tabSegment.words as Array<{ text: string }>;
    expect(tabWords.map((w) => w.text).join(" ")).toBe("hello world");
    expect(tabSession.version).toBe(2);
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

// ────────────────────────────────────────────────────────────────────────
// v0.5 — schema migration (v1 ↔ v2 sessions in storage + import)
// ────────────────────────────────────────────────────────────────────────

describe("v0.5 session schema migration", () => {
  // Reuse the same beforeEach via the outer describe — vitest's beforeEach
  // runs for ANY top-level describe in this file.

  it("saveSession auto-detects v1 transcripts (no version field bump)", async () => {
    const saved = await saveSession({
      startedAt: 1000,
      endedAt: 2000,
      source: "tab",
      modelId: "base",
      transcript: [mkSegment("plain strings only")],
    });
    expect(saved.version).toBe(1);
  });

  it("saveSession auto-detects v2 transcripts when words are Word objects", async () => {
    const saved = await saveSession({
      startedAt: 1000,
      endedAt: 2000,
      source: "tab",
      modelId: "base",
      transcript: [
        {
          tMs: 0,
          words: [
            { text: "hi", tStartMs: 0, tEndMs: 100 },
            { text: "there", tStartMs: 100, tEndMs: 250 },
          ],
        },
      ],
    });
    expect(saved.version).toBe(2);
  });

  it("buildPreview works on v2 transcripts (Word objects with .text)", () => {
    const v2Transcript = [
      {
        tMs: 0,
        words: [
          { text: "the", tStartMs: 0, tEndMs: 100 },
          { text: " quick", tStartMs: 100, tEndMs: 300 },
          { text: " brown", tStartMs: 300, tEndMs: 500 },
          { text: " fox", tStartMs: 500, tEndMs: 700 },
        ],
      },
    ];
    expect(buildPreview(v2Transcript)).toBe("the quick brown fox");
  });

  it("buildPreview handles mixed v1 + v2 segments in one transcript", () => {
    // While we don't expect mixed sessions in practice, the function is
    // defensive — verify it doesn't blow up + concatenates both shapes.
    const mixed = [
      { tMs: 0, words: ["v1", "first"] },
      {
        tMs: 1000,
        words: [
          { text: "v2", tStartMs: 0, tEndMs: 100 },
          { text: " second", tStartMs: 100, tEndMs: 300 },
        ],
      },
    ];
    expect(buildPreview(mixed)).toBe("v1 first v2 second");
  });

  it("validateExportBundle accepts v1 bundles (back-compat)", () => {
    const v1Bundle = {
      version: 1,
      exportedAt: new Date().toISOString(),
      appVersion: "0.4.2",
      sessions: [
        {
          id: "a",
          startedAt: 1000,
          endedAt: 2000,
          source: "tab",
          modelId: "base",
          transcript: [{ tMs: 0, words: ["hello", "world"] }],
          preview: "hello world",
        },
      ],
    };
    expect(() => validateExportBundle(v1Bundle)).not.toThrow();
  });

  it("validateExportBundle accepts v2 bundles", () => {
    const v2Bundle = {
      version: 2,
      exportedAt: new Date().toISOString(),
      appVersion: "0.5.0",
      sessions: [
        {
          id: "b",
          startedAt: 1000,
          endedAt: 2000,
          source: "mic",
          modelId: "base",
          transcript: [
            {
              tMs: 0,
              words: [{ text: "hi", tStartMs: 0, tEndMs: 100 }],
            },
          ],
          preview: "hi",
        },
      ],
    };
    expect(() => validateExportBundle(v2Bundle)).not.toThrow();
  });

  it("validateExportBundle rejects bundles with malformed Word objects", () => {
    const badBundle = {
      version: 2,
      exportedAt: new Date().toISOString(),
      appVersion: "0.5.0",
      sessions: [
        {
          id: "c",
          startedAt: 1000,
          endedAt: 2000,
          source: "tab",
          modelId: "base",
          transcript: [
            // tStartMs is wrong type
            { tMs: 0, words: [{ text: "hi", tStartMs: "0", tEndMs: 100 }] },
          ],
          preview: "hi",
        },
      ],
    };
    expect(() => validateExportBundle(badBundle)).toThrow(/word/i);
  });

  it("importSessions migrates v1 bundle sessions → v2 with synthetic timing", async () => {
    const v1Bundle: ExportBundle = {
      version: 1,
      exportedAt: new Date().toISOString(),
      appVersion: "0.4.2",
      sessions: [
        {
          id: "old-1",
          startedAt: 100,
          endedAt: 200,
          source: "tab",
          modelId: "base",
          transcript: [
            { tMs: 0, words: ["aa", "bb", "cc"] },
            { tMs: 500, words: ["dd"] },
          ],
          preview: "aa bb cc dd",
        },
        // Empty session — shouldn't bump migrated count
        {
          id: "old-2",
          startedAt: 300,
          endedAt: 400,
          source: "mic",
          modelId: "base",
          transcript: [],
          preview: "",
        },
      ],
    };
    const result = await importSessions(v1Bundle);
    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.migrated).toBe(1); // only the non-empty one counts

    const restored = await listSessions();
    const old1 = restored.find((s) => s.id === "old-1")!;
    expect(old1.version).toBe(2);
    // First segment: 3 words → synthetic 333ms each
    const seg0Words = old1.transcript[0].words as Array<{ text: string; tStartMs: number; tEndMs: number }>;
    expect(seg0Words).toHaveLength(3);
    expect(seg0Words[0].text).toBe("aa");
    expect(seg0Words[0].tStartMs).toBe(0);
    expect(seg0Words[0].tEndMs).toBeGreaterThan(0);
    expect(seg0Words[2].text).toBe("cc");
  });

  it("importSessions doesn't migrate v2 bundles (migrated = 0)", async () => {
    const v2Bundle: ExportBundle = {
      version: 2,
      exportedAt: new Date().toISOString(),
      appVersion: "0.5.0",
      sessions: [
        {
          id: "new-1",
          startedAt: 100,
          endedAt: 200,
          source: "tab",
          modelId: "base",
          transcript: [
            {
              tMs: 0,
              words: [
                { text: "a", tStartMs: 0, tEndMs: 100 },
                { text: "b", tStartMs: 100, tEndMs: 200 },
              ],
            },
          ],
          preview: "a b",
          version: 2,
        },
      ],
    };
    const result = await importSessions(v2Bundle);
    expect(result.imported).toBe(1);
    expect(result.migrated).toBe(0);

    const restored = await listSessions();
    expect(restored[0].version).toBe(2);
    // Per-word timing was real, not synthetic — values match what we sent.
    const w0 = restored[0].transcript[0].words[0] as { text: string; tStartMs: number; tEndMs: number };
    expect(w0).toEqual({ text: "a", tStartMs: 0, tEndMs: 100 });
  });

  it("importSessions rejects unknown bundle versions (forward-compat)", () => {
    expect(() =>
      validateExportBundle({
        version: 99,
        exportedAt: new Date().toISOString(),
        appVersion: "5.0.0",
        sessions: [],
      }),
    ).toThrow(/unsupported export version/i);
  });
});
