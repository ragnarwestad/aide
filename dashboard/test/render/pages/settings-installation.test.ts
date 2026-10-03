// What an AI's Installation tab shows of the last check: the preflight's
// lines, every command the check ran, and the login line as one sentence in
// the reader's language, with no mark and no question in front of it.

import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { toolPanel, type ToolCheck } from "../../../src/render";
import { renderSentence, type BoardMessage } from "../../../src/i18n/message.ts";
import type { Language } from "../../../src/i18n";

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

const capitalised = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

const installation = (check: ToolCheck, lang: Language = "en") =>
  parse(toolPanel(check.tool, check, undefined, Date.parse(AT), {}, lang, "installation"));

/** The answer lines the tab draws for the check's extra questions. */
const answerLines = (doc: Document): string[] =>
  Array.from(doc.querySelectorAll(".checklist li")).map((li) => (li.textContent ?? "").trim());

function claudeCheck(answer: BoardMessage, detail = ""): ToolCheck {
  return {
    tool: "claude",
    at: AT,
    found: true,
    lines: ["Claude Code found (2.1.273)", "   skills -> ~/.claude/skills/ ok", "Installed files match the repository"],
    commands: ["aide-preflight claude", "claude auth status"],
    extra: [{ question: "Is it logged in?", ok: true, detail, answer }],
  };
}

const LOGGED_IN: BoardMessage = {
  key: "login.inWithAs", values: { method: "claude.ai", account: "someone@example.com, Max" },
};

describe("the Installation tab", () => {
  test("shows every preflight line, every command it ran, and the login line (AC-8)", () => {
    const check = claudeCheck(LOGGED_IN);
    const doc = installation(check);
    const text = doc.body.textContent ?? "";
    for (const line of check.lines) expect(text).toContain(line.trim());
    for (const command of check.commands!) expect(text).toContain(command);
    expect(answerLines(doc)).toEqual([capitalised(renderSentence("en", LOGGED_IN)!)]);
  });

  test.each<[string, BoardMessage]>([
    ["logged in (AC-9)", LOGGED_IN],
    ["not logged in (AC-10)", { key: "login.out", values: { command: "claude auth login" } }],
    ["cannot say (AC-11)", { key: "login.noCommand", values: { tool: "Copilot" } }],
  ])("a login entry that is %s is its sentence alone, with no mark and no question", (_, answer) => {
    expect(answerLines(installation(claudeCheck(answer)))).toEqual([capitalised(renderSentence("en", answer)!)]);
  });

  test("what follows the answer is a sentence of its own after it (AC-9)", () => {
    const doc = installation(claudeCheck(LOGGED_IN, "Runs use another account."));
    expect(answerLines(doc)).toEqual([`${capitalised(renderSentence("en", LOGGED_IN)!)}. Runs use another account.`]);
  });

  test("a Norwegian reader gets the login line in Norwegian (AC-15)", () => {
    const line = answerLines(installation(claudeCheck(LOGGED_IN), "nb"))[0];
    expect(line).toBe(capitalised(renderSentence("nb", LOGGED_IN)!));
    expect(line).not.toBe(capitalised(renderSentence("en", LOGGED_IN)!));
  });

  test("an entry with no sentence of its own keeps its mark and question", () => {
    const check: ToolCheck = {
      tool: "opencode", at: AT, found: true, lines: [],
      extra: [{ question: "Do the configured models still exist?", ok: false, detail: "Not listed any more: x" }],
    };
    expect(answerLines(installation(check))).toEqual(["FAIL Do the configured models still exist? Not listed any more: x"]);
  });
});
