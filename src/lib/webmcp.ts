/**
 * WebMCP (navigator.modelContext) progressive enhancement.
 *
 * Exposes three tools to in-browser AI agents that drive the EXISTING caption
 * UI (no duplicate audio/Whisper logic):
 *   - start_captions({ lang?, source? })
 *   - stop_captions()
 *   - get_transcript()
 *
 * Honesty note: starting capture calls getDisplayMedia/getUserMedia and opens
 * a Document PiP window — browsers require a real user gesture (transient
 * activation) for those. An agent call has none, so start_captions only
 * clicks Start if the page currently has user activation; otherwise it
 * pre-selects options, focuses the Start button, and tells the agent to ask
 * the user to click it.
 *
 * Feature-detected, wrapped in try/catch, never throws. No-op when absent.
 */

type ToolResult = { content: { type: "text"; text: string }[] };
interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<ToolResult>;
}

const text = (t: string): ToolResult => ({ content: [{ type: "text", text: t }] });
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel);
const visible = (el: HTMLElement | null) => !!el && el.offsetParent !== null && !el.hidden;

function transcriptText(): string {
  const stream = $<HTMLDivElement>("#cp-caption-stream");
  if (!stream) return "";
  const clone = stream.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".italic").forEach((n) => n.remove()); // status placeholders
  return (clone.innerText || clone.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}

function buildTools(): Tool[] {
  return [
    {
      name: "start_captions",
      description:
        "Prepare and start live captions in this page. Optionally set the language (ISO code like 'en', 'hi', 'es' or 'auto') and source ('tab' = share a browser tab's audio, 'mic' = microphone). Browsers require a user click to grant audio capture, so this usually highlights the Start button and asks the user to click it.",
      inputSchema: {
        type: "object",
        properties: {
          lang: { type: "string", description: "Language code, e.g. 'auto', 'en', 'hi'." },
          source: { type: "string", enum: ["tab", "mic"] },
        },
      },
      async execute(args) {
        try {
          const notes: string[] = [];
          const lang = typeof args?.lang === "string" ? args.lang.trim().toLowerCase() : "";
          if (lang) {
            const sel = $<HTMLSelectElement>("#cp-language-select");
            const opt = sel && Array.from(sel.options).find((o) => o.value === lang && !o.disabled);
            if (sel && opt) {
              sel.value = lang;
              sel.dispatchEvent(new Event("change", { bubbles: true }));
              notes.push(`Language set to ${opt.textContent?.trim() ?? lang}.`);
            } else {
              const avail = sel ? Array.from(sel.options).filter((o) => !o.disabled).map((o) => o.value).join(", ") : "";
              notes.push(`Language '${lang}' is not available with the current model (available: ${avail}).`);
            }
          }
          const source = args?.source;
          if (source === "tab" || source === "mic") {
            const radio = $<HTMLInputElement>(`input[name="cp-source-toggle"][value="${source}"]`);
            if (radio) {
              radio.checked = true;
              radio.dispatchEvent(new Event("change", { bubbles: true }));
              notes.push(`Source set to ${source === "mic" ? "microphone" : "browser tab audio"}.`);
            }
          }
          const start = $<HTMLButtonElement>("#cp-start-btn");
          if (!visible(start)) {
            return text([...notes, "Captions appear to be already running or loading (Start button not visible)."].join(" "));
          }
          const nav = navigator as Navigator & { userActivation?: { isActive: boolean } };
          if (nav.userActivation?.isActive) {
            start!.click();
            notes.push("Clicked Start. The browser will show a permission/tab picker the user must confirm (tick 'Share tab audio' for tabs).");
          } else {
            start!.focus();
            start!.scrollIntoView({ behavior: "smooth", block: "center" });
            notes.push("Audio capture needs a real user click, so captions were NOT started automatically. The Start button is focused: ask the user to click 'Start captions' (or press Enter), then confirm the browser picker.");
          }
          return text(notes.join(" "));
        } catch (e) {
          return text(`Could not prepare captions: ${String(e)}`);
        }
      },
    },
    {
      name: "stop_captions",
      description: "Stop the running live-caption session. The transcript stays on the page for review/export.",
      inputSchema: { type: "object", properties: {} },
      async execute() {
        try {
          const stop = $<HTMLButtonElement>("#cp-stop-btn");
          if (!visible(stop)) return text("No caption session is running.");
          const doneSpan = stop!.querySelector<HTMLElement>('[data-when="stopped"]');
          if (doneSpan && !doneSpan.classList.contains("hidden")) return text("Captions are already stopped. Transcript is available via get_transcript.");
          stop!.click();
          return text("Captions stopped. The transcript remains on the page; call get_transcript to read it.");
        } catch (e) {
          return text(`Could not stop captions: ${String(e)}`);
        }
      },
    },
    {
      name: "get_transcript",
      description: "Return the caption text shown so far in the current or most recent session (plain text, processed locally).",
      inputSchema: { type: "object", properties: {} },
      async execute() {
        try {
          const t = transcriptText();
          return text(t || "No transcript yet. Start captions first.");
        } catch (e) {
          return text(`Could not read transcript: ${String(e)}`);
        }
      },
    },
  ];
}

export function registerWebMcp(): void {
  try {
    const mc = (navigator as Navigator & { modelContext?: any }).modelContext;
    if (!mc) return;
    const tools = buildTools();
    if (typeof mc.registerTool === "function") {
      for (const t of tools) {
        try { mc.registerTool(t); } catch { /* ignore */ }
      }
    } else if (typeof mc.provideContext === "function") {
      mc.provideContext({ tools });
    }
  } catch {
    /* never throw */
  }
}
