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
