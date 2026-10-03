// A tool the board checked and found wanting is said at the top of every
// page, and the line takes the reader to the tab whose Check asks again:
// that AI's Installation tab.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { headerNotices } from "../../../src/render/ui/header-notices.ts";
import { forgetChecks, recordCheck, setConfiguredTools } from "../../../src/render/ui/tool-checks.ts";
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
  test("a Claude Code that is not logged in links to its Installation tab (AC-13)", () => {
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

  test("no tool with a fault draws no line (AC-13)", () => {
    setConfiguredTools(() => ["claude"]);
    recordCheck({ tool: "claude", at: "2026-10-03T13:30:00.000Z", found: true, lines: [], extra: [] });
    expect(faultLines(headerNotices("en"))).toEqual([]);
  });
});
