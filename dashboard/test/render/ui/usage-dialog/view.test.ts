import { describe, expect, test } from "bun:test";
import type { Provider } from "../../../../src/queue/providers/index.ts";
import type { ToolUsage } from "../../../../src/render";
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

  test("merges windows in first-seen order and gives every provider a bar (AC-4, AC-5, AC-10)", () => {
    const view = usageDialogView([
      entry("work", { name: "Claude Work", tool: "claude" }, {
        tool: "claude", at, windows: [
          { name: "Current session", usedPercent: 24, resets: "4pm (Europe/Oslo)" },
          { name: "Current week", usedPercent: 20 },
        ],
      }),
      entry("personal", { name: "Claude Personal", tool: "claude" }, {
        tool: "claude", at, windows: [{ name: "Current session", usedPercent: 60 }],
      }),
    ], Date.parse(at));
    const group = view.groups[0]!;
    expect(group.rows.map((row) => row.label)).toEqual(["Current session", "Current week"]);
    expect(group.rows[0]!.bars.map((bar) => [bar.name, bar.leftPercent, bar.resets])).toEqual([
      ["Claude Work", 76, "4pm (Europe/Oslo)"],
      ["Claude Personal", 40, undefined],
    ]);
    expect(group.rows[1]!.bars.map((bar) => bar.leftPercent)).toEqual([80, undefined]);
  });

  test("clamps shares and keeps failures and tool text as provider states (AC-5, AC-8, AC-14)", () => {
    const view = usageDialogView([
      entry("high", { name: "High", tool: "claude" }, { tool: "claude", at, windows: [{ name: "Session", usedPercent: 120, resets: "Oct 2 at 11:20pm" }] }),
      entry("failed", { name: "Failed", tool: "claude" }, { tool: "claude", at, windows: [], error: "not logged in" }),
      entry("text", { name: "Text", tool: "claude" }, { tool: "claude", at, windows: [], text: "Sign in first" }),
    ], Date.parse(at));
    expect(view.groups[0]!.rows[0]!.bars[0]).toMatchObject({ leftPercent: 0, resets: "Oct 2 at 11:20pm" });
    expect(view.groups[0]!.providers.map((provider) => provider.state)).toEqual(["windows", "failed", "text"]);
  });

  test("marks a missing reset time instead of leaving it out (AC-14)", () => {
    const view = usageDialogView([
      entry("claude", { name: "Claude", tool: "claude" }, { tool: "claude", at, windows: [{ name: "Session", usedPercent: 25 }] }),
    ], Date.parse(at));
    expect(view.groups[0]!.rows[0]!.bars[0]).toMatchObject({ leftPercent: 75, resetReported: false });
  });
});
