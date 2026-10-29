// A tool the board checked and found wanting is said at the top of every
// page, and the line takes the reader to that AI's Installation tab. An AI
// whose configured models its last Models reading no longer offers is said
// the same way, with a line to its Models tab, worked out from the choices
// as they are now.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { headerNotices } from "../../../src/render/ui/header-notices.ts";
import {
  forgetChecks, recordCheck, recordModels, setConfiguredTools, setModelChoices, toolsMissingModels,
} from "../../../src/render/ui/tool-checks.ts";
import type { ModelChoice } from "../../../src/queue/types.ts";
import type { ToolModels } from "../../../src/render";
import { t } from "../../../src/i18n";

const windows: Window[] = [];

// Process-lifetime state: a check left behind here would reach the next
// file's pages, and one left by an earlier file would reach this one's.
beforeEach(() => {
  forgetChecks();
});
afterEach(async () => {
  forgetChecks();
  while (windows.length) await windows.pop()!.happyDOM.close();
});

function faultLines(html: string): Element[] {
  const win = new Window();
  windows.push(win);
  win.document.write(`<body>${html}</body>`);
  return Array.from(win.document.querySelectorAll(".tool-fault")) as unknown as Element[];
}

describe("the tool-fault line", () => {
  test("a Claude Code that is not logged in links to its Installation tab", () => {
    setConfiguredTools(() => ["claude"]);
    recordCheck({
      tool: "claude", at: "2026-10-03T13:30:00.000Z", found: true, lines: [],
      extra: [{ question: "Is it logged in?", ok: false, detail: "", problem: "not logged in" }],
    });
    const [line, ...rest] = faultLines(headerNotices("en"));
    expect(rest).toEqual([]);
    const links = Array.from(line!.querySelectorAll("a"));
    expect(links.map((a) => [a.getAttribute("href"), a.textContent])).toEqual([
      ["/settings?tab=claude&aitab=installation", t("en", "shell.toolFaultWhere")],
    ]);
  });

  test("no tool with a fault draws no line", () => {
    setConfiguredTools(() => ["claude"]);
    recordCheck({ tool: "claude", at: "2026-10-03T13:30:00.000Z", found: true, lines: [], extra: [] });
    expect(faultLines(headerNotices("en"))).toEqual([]);
  });
});

describe("the models no longer offered", () => {
  const AT = "2026-10-03T13:30:00.000Z";
  const reading = (tool: ToolModels["tool"], offered: string[], more: Partial<ToolModels> = {}): ToolModels =>
    ({ tool, at: AT, offered: offered.map((model) => ({ model })), ...more });
  const choices = (c: Record<string, ModelChoice>) => setModelChoices(() => c);

  test("a configured model the last reading does not offer is named for its AI alone (AC-4)", () => {
    choices({
      here: { tool: "opencode", model: "opencode/here" },
      gone: { tool: "opencode", model: "opencode/gone" },
      Opus: { model: "opus" },
    });
    recordModels(reading("opencode", ["opencode/here"]));
    expect(toolsMissingModels()).toEqual([{ tool: "opencode", models: ["gone (opencode/gone)"] }]);
  });

  test("a Claude name Claude Code answered for is not missing, a model it neither offers nor names is (AC-4)", () => {
    choices({ "opus[1m]": {}, "claude-opus-4-8": {}, Opus: { model: "opus" } });
    recordModels(reading("claude", ["opus"], { named: [{ model: "opus[1m]", name: "Opus 5.5 (1M context)" }] }));
    expect(toolsMissingModels()).toEqual([{ tool: "claude", models: ["claude-opus-4-8"] }]);
  });

  test("the notice follows the choices as they are now (AC-4)", () => {
    let live: Record<string, ModelChoice> = { gone: { tool: "opencode", model: "opencode/gone" } };
    setModelChoices(() => live);
    recordModels(reading("opencode", []));
    expect(toolsMissingModels()).toHaveLength(1);
    live = {};
    expect(toolsMissingModels()).toEqual([]);
  });

  test("no reading, a reading that failed, and an AI the board cannot ask name nothing (AC-6)", () => {
    choices({
      c: { model: "claude-opus-4-8" },
      x: { tool: "codex", model: "gpt-0" },
      o: { tool: "opencode", model: "opencode/gone" },
    });
    expect(toolsMissingModels()).toEqual([]);
    recordModels(reading("claude", [], { error: "claude -p timed out" }));
    recordModels(reading("codex", [], { error: "app-server did not answer" }));
    recordModels(reading("opencode", [], { noSource: true }));
    expect(toolsMissingModels()).toEqual([]);
  });

  test("the line links once, to that AI's Models tab, and apart from the Installation line (AC-7)", () => {
    setConfiguredTools(() => ["opencode"]);
    choices({ gone: { tool: "opencode", model: "opencode/gone" } });
    recordModels(reading("opencode", []));
    recordCheck({
      tool: "opencode", at: AT, found: true, lines: [],
      extra: [{ question: "Is it logged in?", ok: false, detail: "", problem: "not logged in" }],
    });
    const hrefs = faultLines(headerNotices("en")).map((line) =>
      Array.from(line.querySelectorAll("a")).map((a) => a.getAttribute("href")));
    expect(hrefs).toEqual([
      ["/settings?tab=opencode&aitab=installation"],
      ["/settings?tab=opencode&aitab=models"],
    ]);
  });

  test("no line is drawn when nothing is missing", () => {
    choices({ here: { tool: "opencode", model: "opencode/here" } });
    recordModels(reading("opencode", ["opencode/here"]));
    expect(faultLines(headerNotices("en"))).toEqual([]);
  });
});
