/**
 * @vitest-environment jsdom
 *
 * Tests for getDebugPanel() — debug-panel factory contract.
 *
 * Coverage:
 *   - Disabled when `?debug=1` is absent → returns noop with enabled=false
 *   - Enabled when `?debug=1` present → mounts DOM, returns enabled=true
 *   - Idempotent factory: subsequent calls return the same instance
 *   - log/error append to the panel body when enabled
 *   - log/error are no-ops when disabled (no DOM mutation)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Important: we re-import in each test so the module-level singleton resets.
// vi.resetModules() drops the cached module so the next `import()` re-runs
// the file top-to-bottom, giving us a fresh singleton each time.
async function freshImport() {
  vi.resetModules();
  const mod = await import("./debugPanel");
  return mod as typeof import("./debugPanel");
}

function setSearch(qs: string) {
  // jsdom lets us mutate window.location.search via history.replaceState
  // without triggering navigation. We use a fresh URL each time so the test
  // is reproducible regardless of previous test's URL state.
  window.history.replaceState({}, "", "/test" + qs);
}

describe("getDebugPanel", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.getElementById("cp-debug-panel")?.remove();
  });

  it("returns disabled noop when ?debug=1 is absent", async () => {
    setSearch("");
    const { getDebugPanel } = await freshImport();
    const panel = getDebugPanel();
    expect(panel.enabled).toBe(false);
    expect(document.getElementById("cp-debug-panel")).toBeNull();
  });

  it("returns disabled noop when ?debug=0 (explicitly off)", async () => {
    setSearch("?debug=0");
    const { getDebugPanel } = await freshImport();
    const panel = getDebugPanel();
    expect(panel.enabled).toBe(false);
    expect(document.getElementById("cp-debug-panel")).toBeNull();
  });

  it("mounts panel + returns enabled=true when ?debug=1", async () => {
    setSearch("?debug=1");
    const { getDebugPanel } = await freshImport();
    const panel = getDebugPanel();
    expect(panel.enabled).toBe(true);
    const el = document.getElementById("cp-debug-panel");
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain("debug panel mounted");
  });

  it("is idempotent — repeated calls return the same instance", async () => {
    setSearch("?debug=1");
    const { getDebugPanel } = await freshImport();
    const a = getDebugPanel();
    const b = getDebugPanel();
    expect(a).toBe(b);
    // Only one panel in the DOM, not two.
    expect(document.querySelectorAll("#cp-debug-panel")).toHaveLength(1);
  });

  it("log() appends a row to the panel body when enabled", async () => {
    setSearch("?debug=1");
    const { getDebugPanel } = await freshImport();
    const panel = getDebugPanel();
    panel.log("isMobile", true);
    const body = document.getElementById("cp-debug-panel-body");
    expect(body?.textContent).toContain("isMobile: true");
  });

  it("log() with no value renders the label alone", async () => {
    setSearch("?debug=1");
    const { getDebugPanel } = await freshImport();
    const panel = getDebugPanel();
    panel.log("started");
    const body = document.getElementById("cp-debug-panel-body");
    expect(body?.textContent).toContain("started");
    // No trailing colon when value is undefined.
    expect(body?.textContent).not.toContain("started:");
  });

  it("log() serializes objects via JSON.stringify", async () => {
    setSearch("?debug=1");
    const { getDebugPanel } = await freshImport();
    const panel = getDebugPanel();
    panel.log("config", { model: "tiny", device: "wasm" });
    const body = document.getElementById("cp-debug-panel-body");
    expect(body?.textContent).toContain('"model":"tiny"');
    expect(body?.textContent).toContain('"device":"wasm"');
  });

  it("error() prefixes ⚠ and uses red color when enabled", async () => {
    setSearch("?debug=1");
    const { getDebugPanel } = await freshImport();
    const panel = getDebugPanel();
    panel.error("loadFailed", "OOM");
    const body = document.getElementById("cp-debug-panel-body");
    expect(body?.textContent).toContain("⚠ loadFailed: OOM");
    const lastRow = body?.lastElementChild as HTMLElement;
    expect(lastRow.style.color).toBe("rgb(253, 164, 175)"); // #fda4af
  });

  it("log()/error() are pure no-ops when disabled (no DOM mutation)", async () => {
    setSearch("");
    const { getDebugPanel } = await freshImport();
    const panel = getDebugPanel();
    const before = document.body.children.length;
    panel.log("nope");
    panel.error("also nope");
    expect(document.body.children.length).toBe(before);
  });
});
