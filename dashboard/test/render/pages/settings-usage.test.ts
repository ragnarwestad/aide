// What an AI tab says of a usage reading. The rule that matters most is
// the one between "none" and "could not be read": a reading that failed,
// or an AI whose usage the board does not read, never says "none".

import { describe, expect, test } from "bun:test";
import { usageView, type ToolUsage } from "../../../src/render";

const AT = "2026-10-02T19:00:00.000Z";
const NOW = Date.parse("2026-10-02T19:05:00.000Z");

describe("usageView", () => {
  test("no reading yet is unread, since opening a page reads nothing (AC-6)", () => {
    expect(usageView(undefined, NOW).kind).toBe("unread");
  });

  test("each window is a row with its share used, its reset, and the reading's time (AC-1)", () => {
    const usage: ToolUsage = {
      tool: "codex",
      at: AT,
      windows: [
        { name: "five_hour", usedPercent: 51, resetsAt: "2026-10-02T21:54:46.000Z" },
        { name: "seven_day", usedPercent: 8, resetsAt: "2026-10-03T18:10:17.000Z" },
      ],
    };
    const view = usageView(usage, NOW);
    if (view.kind !== "windows") throw new Error(`expected windows, got ${view.kind}`);
    expect(view.at).toBe(AT);
    expect(view.rows.map((r) => r.usedPercent)).toEqual([51, 8]);
    for (const row of view.rows) {
      expect(row.label).toBeTruthy();
      expect(row.resets).toBeTruthy();
    }
    expect(view.rows[0]!.label).not.toBe(view.rows[1]!.label);
  });

  test("a label the tool wrote itself is kept, and so are its reset words (AC-1)", () => {
    const view = usageView({
      tool: "claude",
      at: AT,
      windows: [{ name: "Current session", usedPercent: 24, resets: "Oct 2 at 11:20pm (Europe/Oslo)" }],
    }, NOW);
    if (view.kind !== "windows") throw new Error(`expected windows, got ${view.kind}`);
    expect(view.rows).toEqual([{ label: "Current session", usedPercent: 24, resets: "Oct 2 at 11:20pm (Europe/Oslo)" }]);
  });

  test("text with no windows is shown as the tool gave it (AC-4)", () => {
    const view = usageView({ tool: "claude", at: AT, windows: [], text: "Not logged in · Please run /login" }, NOW);
    expect(view).toEqual({ kind: "text", at: AT, text: "Not logged in · Please run /login" });
  });

  test("an AI that reports no windows has none (AC-5)", () => {
    expect(usageView({ tool: "opencode", at: AT, windows: [] }, NOW).kind).toBe("none");
    expect(usageView({ tool: "codex", at: AT, windows: [] }, NOW).kind).toBe("none");
  });

  test("an AI whose usage is not read is not said to have none (AC-5)", () => {
    expect(usageView({ tool: "copilot", at: AT, windows: [], noSource: true }, NOW).kind).toBe("noSource");
  });

  test("a reading that failed keeps its reason and is never none (AC-5)", () => {
    const view = usageView({ tool: "codex", at: AT, windows: [], error: "codex app-server did not answer in time." }, NOW);
    expect(view).toEqual({ kind: "failed", at: AT, reason: "codex app-server did not answer in time." });
  });
});
