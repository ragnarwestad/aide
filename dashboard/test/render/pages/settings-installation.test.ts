// What the Installation tab under a provider's Check shows of the last check:
// the preflight's lines and every command the check ran. The login answers
// the check also holds are not drawn there: the provider's page shows the
// login above the tab.

import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { toolPanel, type ToolCheck } from "../../../src/render";
import type { BoardMessage } from "../../../src/i18n/message.ts";

const AT = "2026-10-03T13:30:00.000Z";

const windows: Window[] = [];
afterEach(async () => {
  while (windows.length) await windows.pop()!.happyDOM.close();
});

function parse(html: string): Document {
  const win = new Window();
  windows.push(win);
  win.document.write(html);
  return win.document as unknown as Document;
}

const installation = (check: ToolCheck) =>
  parse(toolPanel({ key: "Claude", tool: check.tool }, check, {}, "en", "installation"));

const LOGGED_IN: BoardMessage = { key: "login.inWithAs", values: { method: "claude.ai", account: "someone@example.com, Max" } };

function claudeCheck(): ToolCheck {
  return {
    tool: "claude",
    at: AT,
    found: true,
    lines: ["Claude Code found (2.1.273)", "   skills -> ~/.claude/skills/ ok", "Installed files match the repository"],
    commands: ["aide-preflight claude", "claude auth status"],
    extra: [{ question: "Is it logged in?", ok: true, detail: "", answer: LOGGED_IN }],
  };
}

describe("the Installation tab", () => {
  test("shows every preflight line and every command it ran, and no login answer", () => {
    const check = claudeCheck();
    const doc = installation(check);
    const text = doc.body.textContent ?? "";
    for (const line of check.lines) expect(text).toContain(line.trim());
    for (const command of check.commands!) expect(text).toContain(command);
    expect(doc.querySelectorAll(".checklist li").length).toBe(0);
  });

  test("a check that could not be run says so", () => {
    const check: ToolCheck = { tool: "codex", at: AT, found: false, lines: [], extra: [], error: "The check did not finish in time." };
    expect(installation(check).body.textContent).toContain("The check did not finish in time.");
  });
});
