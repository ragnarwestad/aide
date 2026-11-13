import { describe, expect, test } from "bun:test";
import type { Provider } from "../../../../src/queue/providers/index.ts";
import type { ToolUsage } from "../../../../src/render";
import { Window } from "happy-dom";
import { t } from "../../../../src/i18n";
import { usageDialogBody } from "../../../../src/render/ui/usage-dialog/index.ts";
import { usageDialogView } from "../../../../src/render/ui/usage-dialog/view.ts";

const at = "2026-11-12T12:00:00.000Z";
const entry = (key: string, provider: Provider, usage?: ToolUsage) => ({ key, provider, usage });

describe("usageDialogView()", () => {
  test("groups Codex before Claude and leaves out OpenCode (AC-2, AC-9, AC-13)", () => {
    const view = usageDialogView([
      entry("claude", { name: "Claude Personal", tool: "claude", enabled: false }),
      entry("open", { name: "OpenCode", tool: "opencode" }),
      entry("codex", { name: "Codex", tool: "codex" }),
    ], Date.parse(at));
    expect(view.groups.map((group) => [group.tool, group.providers.map((provider) => provider.name)])).toEqual([
      ["codex", ["Codex"]],
      ["claude", ["Claude Personal"]],
    ]);
  });

  test("gives a window one row by its short name, with a bar only for each account that reported it (AC-1, AC-6)", () => {
    const view = usageDialogView([
      entry("work", { name: "Claude Work", tool: "claude" }, {
        tool: "claude", at, windows: [
          { name: "Current session", usedPercent: 24 },
          { name: "Current week (all models)", usedPercent: 42 },
        ],
      }),
      entry("personal", { name: "Claude Personal", tool: "claude" }, {
        tool: "claude", at, windows: [{ name: "Current session", usedPercent: 60 }],
      }),
    ], Date.parse(at));
    const group = view.groups[0]!;
    expect(group.rows.map((row) => row.label)).toEqual(["Session", "Weekly"]);
    expect(group.rows[0]!.bars.map((bar) => [bar.name, bar.leftPercent])).toEqual([["Claude Work", 76], ["Claude Personal", 40]]);
    expect(group.rows[1]!.bars.map((bar) => [bar.name, bar.leftPercent])).toEqual([["Claude Work", 58]]);
  });

  test("gives two accounts reporting the same window one row holding both bars (AC-6)", () => {
    const week = { name: "Current week (all models)", usedPercent: 10 };
    const view = usageDialogView([
      entry("work", { name: "Claude Work", tool: "claude" }, { tool: "claude", at, windows: [week] }),
      entry("personal", { name: "Claude Personal", tool: "claude" }, { tool: "claude", at, windows: [week] }),
    ], Date.parse(at));
    expect(view.groups[0]!.rows.map((row) => [row.label, row.bars.length])).toEqual([["Weekly", 2]]);
  });

  test("clamps shares and keeps failures and tool text as provider states (AC-5, AC-8, AC-14)", () => {
    const view = usageDialogView([
      entry("high", { name: "High", tool: "claude" }, { tool: "claude", at, windows: [{ name: "Session", usedPercent: 120, resets: "Oct 2 at 11:20pm" }] }),
      entry("failed", { name: "Failed", tool: "claude" }, { tool: "claude", at, windows: [], error: "not logged in" }),
      entry("text", { name: "Text", tool: "claude" }, { tool: "claude", at, windows: [], text: "Sign in first" }),
    ], Date.parse(at));
    expect(view.groups[0]!.rows[0]!.bars[0]).toMatchObject({ leftPercent: 0 });
    expect(view.groups[0]!.providers.map((provider) => provider.state)).toEqual(["windows", "failed", "text"]);
  });

  test("counts down to a Codex reset and draws no countdown for a reset it cannot read (AC-2, AC-3)", () => {
    const view = usageDialogView([
      entry("codex", { name: "Codex", tool: "codex" }, { tool: "codex", at, windows: [{ name: "five_hour", usedPercent: 25, resetsAt: "2026-11-12T12:09:00.000Z" }] }),
      entry("claude", { name: "Claude", tool: "claude" }, { tool: "claude", at, windows: [{ name: "Current week", usedPercent: 25, resets: "some day soon" }] }),
    ], Date.parse(at));
    expect(view.groups[0]!.rows[0]!.bars[0]).toMatchObject({ leftPercent: 75, resetsIn: "9m", pace: 3 });
    const claude = view.groups[1]!.rows[0]!.bars[0]!;
    expect(claude.resetsIn).toBeUndefined();
    expect(claude.pace).toBeUndefined();
  });
});

describe("usageDialogBody()", () => {
  test("draws each bar with its name, share, countdown and pace, the window's summary, and the state lines (AC-1, AC-2, AC-3, AC-4, AC-5, AC-9)", () => {
    const html = usageDialogBody([
      entry("work", { name: "Claude Work", tool: "claude" }, {
        tool: "claude", at, windows: [{ name: "Current week (all models)", usedPercent: 40, resets: "Nov 16 at 12am (UTC)" }],
      }),
      entry("reading", { name: "Claude Reading", tool: "claude" }),
      entry("failed", { name: "Claude Failed", tool: "claude" }, { tool: "claude", at, windows: [], error: "not logged in" }),
      entry("text", { name: "Claude Text", tool: "claude" }, { tool: "claude", at, windows: [], text: "Sign in first" }),
      entry("none", { name: "Claude None", tool: "claude" }, { tool: "claude", at, windows: [] }),
    ], Date.parse(at), "en");
    const doc = new Window().document;
    doc.body.innerHTML = html;
    const bar = doc.querySelector(".usagebar")!;
    expect(doc.querySelectorAll(".usagebar").length).toBe(1);
    expect(bar.textContent).toContain("Claude Work");
    expect(bar.textContent).toContain("60%");
    expect(bar.querySelector("[data-resets]")!.textContent).toBe("3d 12h");
    expect(bar.querySelector("[data-pace] line")!.getAttribute("x1")).toBe("50");
    const summary = doc.querySelector(".usagesummary")!;
    expect(summary.querySelector("h4")!.textContent).toBe("Weekly");
    expect(summary.textContent).toContain("60%");
    expect(summary.querySelector("[data-trend]")!.getAttribute("data-trend")).toBe("slower");
    expect(summary.textContent).toContain("+40%");
    expect(doc.querySelector(".sharebar")!.textContent).toContain("Claude Reading");
    for (const line of [t("en", "settings.usage.failed", { reason: "not logged in" }), "Sign in first", t("en", "settings.usage.none")]) {
      expect(doc.body.textContent).toContain(line);
    }
  });
});
