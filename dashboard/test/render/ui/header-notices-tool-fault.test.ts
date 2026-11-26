// A tool the board checked and found wanting is said at the top of every
// page, with what is wrong and the one fix for it. An AI whose configured
// models its last Models reading no longer offers is said too, linking to
// the Models tab of the provider whose reading found it, worked out from
// the choices as they are now.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { headerNotices } from "../../../src/render/ui/header-notices.ts";
import { createToolReadings, withToolReadings } from "../../../src/render/ui/tool-checks.ts";
import type { ModelChoice } from "../../../src/queue/types.ts";
import type { ToolModels } from "../../../src/render";
import { providerTabPath } from "../../../src/render/pages/settings-page/provider-detail.ts";
import { t } from "../../../src/i18n";

const windows: Window[] = [];

// A store of each test's own, as each server has its own; the header
// reads it as the store of the request it is drawn for.
let readings = createToolReadings();
const drawn = () => withToolReadings(readings, () => headerNotices("en"));
beforeEach(() => {
  readings = createToolReadings();
});
afterEach(async () => {
  while (windows.length) await windows.pop()!.happyDOM.close();
});

function faultLines(html: string): Element[] {
  const win = new Window();
  windows.push(win);
  win.document.write(`<body>${html}</body>`);
  return Array.from(win.document.querySelectorAll(".tool-fault")) as unknown as Element[];
}

describe("the tool-fault line", () => {
  test("a provider that is not logged in gives the command that logs it in, not a page to go and look at", () => {
    readings.setConfiguredTools(() => ["claude"]);
    readings.recordCheck({
      tool: "claude", at: "2026-10-03T13:30:00.000Z", found: true,
      extra: [{
        question: "Is it logged in?", ok: false, detail: "", problem: "not logged in", provider: "Claude-2",
        answer: { key: "login.out", values: { command: "CLAUDE_CONFIG_DIR=~/.claude-2 claude auth login" } },
      }],
    });
    const [line, ...rest] = faultLines(drawn());
    expect(rest).toEqual([]);
    expect(line!.textContent).toContain("CLAUDE_CONFIG_DIR=~/.claude-2 claude auth login");
    expect(line!.querySelectorAll("a")).toHaveLength(0);
  });

  test("no tool with a fault draws no line", () => {
    readings.setConfiguredTools(() => ["claude"]);
    readings.recordCheck({ tool: "claude", at: "2026-10-03T13:30:00.000Z", found: true, extra: [] });
    expect(faultLines(drawn())).toEqual([]);
  });
});

describe("the models no longer offered", () => {
  const AT = "2026-10-03T13:30:00.000Z";
  const reading = (tool: ToolModels["tool"], offered: string[], more: Partial<ToolModels> = {}): ToolModels =>
    ({ tool, at: AT, offered: offered.map((model) => ({ model })), ...more });
  const choices = (c: Record<string, ModelChoice>) => readings.setModelChoices(() => c);

  test("a configured model the last reading does not offer is named for its AI alone (AC-4)", () => {
    choices({
      here: { tool: "opencode", model: "opencode/here" },
      gone: { tool: "opencode", model: "opencode/gone" },
      Opus: { model: "opus" },
    });
    readings.recordModels(reading("opencode", ["opencode/here"]));
    expect(readings.toolsMissingModels()).toEqual([{ tool: "opencode", models: ["gone (opencode/gone)"] }]);
  });

  test("a Claude name Claude Code answered for is not missing, a model it neither offers nor names is (AC-4)", () => {
    choices({ "opus[1m]": {}, "claude-opus-4-8": {}, Opus: { model: "opus" } });
    readings.recordModels(reading("claude", ["opus"], { named: [{ model: "opus[1m]", name: "Opus 5.5 (1M context)" }] }));
    expect(readings.toolsMissingModels()).toEqual([{ tool: "claude", models: ["claude-opus-4-8"] }]);
  });

  test("the notice follows the choices as they are now (AC-4)", () => {
    let live: Record<string, ModelChoice> = { gone: { tool: "opencode", model: "opencode/gone" } };
    readings.setModelChoices(() => live);
    readings.recordModels(reading("opencode", []));
    expect(readings.toolsMissingModels()).toHaveLength(1);
    live = {};
    expect(readings.toolsMissingModels()).toEqual([]);
  });

  test("no reading and a reading that failed name nothing (AC-6)", () => {
    choices({
      c: { model: "claude-opus-4-8" },
      x: { tool: "codex", model: "gpt-0" },
      o: { tool: "opencode", model: "opencode/gone" },
    });
    expect(readings.toolsMissingModels()).toEqual([]);
    readings.recordModels(reading("claude", [], { error: "claude -p timed out" }));
    readings.recordModels(reading("codex", [], { error: "app-server did not answer" }));
    expect(readings.toolsMissingModels()).toEqual([]);
  });

  test("each line links once, to the Models tab of the provider whose reading found it (AC-7)", () => {
    readings.setConfiguredTools(() => ["opencode"]);
    choices({ gone: { tool: "opencode", model: "opencode/gone" } });
    readings.recordModels(reading("opencode", [], { provider: "OpenCode Zen", providerKey: "zen" }));
    readings.recordCheck({
      tool: "opencode", at: AT, found: true,
      extra: [{ question: "Is it logged in?", ok: false, detail: "", problem: "not logged in" }],
    });
    const hrefs = faultLines(drawn()).map((line) =>
      Array.from(line.querySelectorAll("a")).map((a) => a.getAttribute("href")));
    expect(hrefs).toEqual([
      [],
      [providerTabPath("zen", "models")],
    ]);
  });

  test("a line says what is wrong and what to press, each on a line of its own", () => {
    choices({ gone: { tool: "opencode", model: "opencode/gone" } });
    readings.recordModels(reading("opencode", [], { provider: "OpenCode Zen", providerKey: "zen" }));
    const lines = (faultLines(drawn())[0]?.textContent ?? "").split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toStartWith(`${t("en", "message.problem")}: `);
    expect(lines[1]).toStartWith(`${t("en", "message.solution")}: `);
    expect(lines[1]).toContain(t("en", "project.remove"));
    expect(lines[1]).toContain("OpenCode Zen");
  });

  test("no line is drawn when nothing is missing", () => {
    choices({ here: { tool: "opencode", model: "opencode/here" } });
    readings.recordModels(reading("opencode", ["opencode/here"]));
    expect(faultLines(drawn())).toEqual([]);
  });
});
