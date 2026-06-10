import { describe, it, expect, vi } from "vitest";
import type { StoredSession } from "./sessionStore";
import {
  searchSessions,
  sessionHaystack,
  debounce,
} from "./sessionSearch";

/** Minimal StoredSession factory — only fields the search reads. */
function makeSession(overrides: Partial<StoredSession>): StoredSession {
  const base: StoredSession = {
    id: "id-1",
    startedAt: Date.UTC(2026, 5, 10, 9, 30, 0), // 2026-06-10T09:30:00Z
    endedAt: Date.UTC(2026, 5, 10, 9, 31, 0),
    source: "tab",
    modelId: "base",
    transcript: [{ words: ["hello", "world"], tMs: 0 }],
    preview: "hello world",
  };
  return { ...base, ...overrides };
}

describe("sessionHaystack", () => {
  it("lowercases the combined haystack", () => {
    const s = makeSession({
      preview: "Project Standup Notes",
      transcript: [{ words: ["Project", "Standup", "Notes"], tMs: 0 }],
    });
    const hay = sessionHaystack(s);
    expect(hay).toContain("project standup notes");
    expect(hay).not.toContain("Project"); // case-folded
  });

  it("includes ISO date so date searches work", () => {
    const s = makeSession({ startedAt: Date.UTC(2026, 0, 15, 0, 0, 0) });
    const hay = sessionHaystack(s);
    expect(hay).toContain("2026-01-15");
  });

  it("includes source labels (tab/mic/sample)", () => {
    expect(sessionHaystack(makeSession({ source: "mic" }))).toContain("mic");
    expect(sessionHaystack(makeSession({ source: "sample" }))).toContain(
      "sample",
    );
    expect(sessionHaystack(makeSession({ source: "tab" }))).toContain("tab");
  });

  it("includes the modelId", () => {
    const s = makeSession({ modelId: "small" });
    expect(sessionHaystack(s)).toContain("small");
  });
});

describe("searchSessions", () => {
  const sessions: StoredSession[] = [
    makeSession({
      id: "s-1",
      preview: "Standup notes about Q3 plan and roadmap",
      transcript: [
        { words: ["standup", "notes", "about", "Q3", "plan", "and", "roadmap"], tMs: 0 },
      ],
    }),
    makeSession({
      id: "s-2",
      source: "mic",
      preview: "Voice memo about lunch plans",
      transcript: [{ words: ["voice", "memo", "about", "lunch"], tMs: 0 }],
    }),
    makeSession({
      id: "s-3",
      source: "sample",
      preview: "Sample demo audio",
      transcript: [{ words: ["sample", "demo", "audio"], tMs: 0 }],
      modelId: "tiny",
    }),
    makeSession({
      id: "s-4",
      preview: "Q3 budget review meeting transcript",
      transcript: [
        { words: ["Q3", "budget", "review", "meeting", "transcript"], tMs: 0 },
      ],
    }),
  ];

  it("returns input unchanged for empty query", () => {
    expect(searchSessions(sessions, "")).toEqual(sessions);
    expect(searchSessions(sessions, "   ")).toEqual(sessions);
  });

  it("filters by single substring (case-insensitive)", () => {
    const r = searchSessions(sessions, "lunch");
    expect(r.map((s) => s.id)).toEqual(["s-2"]);
  });

  it("filters by case-insensitive match", () => {
    const r = searchSessions(sessions, "STANDUP");
    expect(r.map((s) => s.id)).toEqual(["s-1"]);
  });

  it("multiple terms AND-match (every term must appear)", () => {
    const r = searchSessions(sessions, "Q3 plan");
    expect(r.map((s) => s.id)).toEqual(["s-1"]);
  });

  it("multi-term that matches multiple sessions", () => {
    const r = searchSessions(sessions, "Q3");
    expect(r.map((s) => s.id)).toEqual(["s-1", "s-4"]);
  });

  it("returns empty array on no match", () => {
    expect(searchSessions(sessions, "xyzzyfoobar")).toEqual([]);
  });

  it("filters by source label", () => {
    expect(searchSessions(sessions, "mic").map((s) => s.id)).toEqual(["s-2"]);
    expect(searchSessions(sessions, "sample").map((s) => s.id)).toEqual(["s-3"]);
  });

  it("filters by modelId", () => {
    expect(searchSessions(sessions, "tiny").map((s) => s.id)).toEqual(["s-3"]);
  });

  it("preserves input order (caller-sorted result respected)", () => {
    const r = searchSessions(sessions, "about");
    expect(r.map((s) => s.id)).toEqual(["s-1", "s-2"]);
  });
});

describe("debounce", () => {
  it("invokes fn once after wait period for rapid calls", async () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const d = debounce(spy, 100);
    d("a");
    d("b");
    d("c");
    expect(spy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("c");
    vi.useRealTimers();
  });

  it("invokes fn separately if calls are spaced beyond wait period", async () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const d = debounce(spy, 50);
    d("a");
    await vi.advanceTimersByTimeAsync(60);
    d("b");
    await vi.advanceTimersByTimeAsync(60);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(1, "a");
    expect(spy).toHaveBeenNthCalledWith(2, "b");
    vi.useRealTimers();
  });
});
