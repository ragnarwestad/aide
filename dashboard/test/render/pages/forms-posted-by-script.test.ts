// The forms the page script posts and then loads the page again for, and
// the pages that reload themselves by the script's timer: each form
// carries the hook the script finds it by and a line for its refusal, and
// each page carries the marker the timer reads.

import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { renderJobDetailPage, renderProjectPage, toolPanel, type ProjectView } from "../../../src/render";
import { pageShell } from "../../../src/render/ui/shell.ts";
import { setBoardInfo } from "../../../src/render/ui/board-info.ts";
import { waitingForTestServerPage } from "../../../src/serve/routes/spec-edit/test-server-waiting.ts";
import { AWAITING_DRIFT_REFRESH_SECONDS } from "../../../src/render/pages/projects-page/project-page.ts";
import { lead, page, view } from "./spec-page-fixtures.ts";
import { detail, NAV } from "./fixtures.ts";

afterEach(() => setBoardInfo(undefined));

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

/** The form posting to `action` on the page, and where its refusal goes. */
function reloadForm(html: string, action: string): { hooked: boolean; line: boolean } {
  const doc = parse(html);
  const form = Array.from(doc.querySelectorAll("form")).find((f) => f.getAttribute("action") === action);
  expect(form).toBeDefined();
  const named = form!.dataset.line;
  return {
    hooked: form!.classList.contains("reloadform"),
    line: !!(named ? doc.getElementById(named) : form!.querySelector(".refused")),
  };
}

const SPEC = "/api/queue/specs/aide/150-one-page-shows-the-whole-spec";
const CHECKS = {
  checks: {
    phase: "Acceptance criteria",
    baseSha: "b7c40e2deadbeef",
    rows: [{ phase: "Acceptance criteria", line: "| AC-1: x | ⬜ | |", task: "AC-1: x", done: false }],
  },
};
const TEST_SERVER = {
  testServerStopAction: `${SPEC}/test-server/stop`,
  testServer: { status: "running" as const, branch: "aide/150", commit: "abc1234", url: "http://127.0.0.1:8801/" },
};

const project: ProjectView = { name: "aide", manifest: { ok: false, error: "no manifest" }, specs: [] };
const projectPage = (opts: Record<string, unknown>) =>
  renderProjectPage(project, { hasConfigFile: false, rows: [] }, null, "2026-09-20T00:00:00Z", [], {
    worktreeLinkCandidates: [],
    editingGroup: null,
    ...opts,
  });

describe("each form the page script posts and loads again", () => {
  const FORMS: [string, () => string, string][] = [
    ["Update", () => page(view(), "description"), `${SPEC}/update`],
    ["a document tab's Save", () => page(view(), "description"), `${SPEC}/save`],
    ["the banner's Depends on and acceptance form", () => page(view(), "description"), `${SPEC}/tracking`],
    ["the Status tab's tick", () => page(view(CHECKS), "status"), `${SPEC}/tick`],
    ["Stop test server", () => page(view(TEST_SERVER), "description"), `${SPEC}/test-server/stop`],
    ["a test board's Run test round", () => {
      setBoardInfo("round");
      return pageShell("x", NAV, "/", "", "2026-09-20T00:00:00Z", { lang: "en" });
    }, "/api/self-run"],
    ["Build wiki", () => projectPage({ tab: "wiki" }), "/api/queue/projects/aide/wiki"],
    ["a running build's Cancel", () => projectPage({ tab: "wiki", wikiBuild: { id: "w1", state: "running" } }), "/api/queue/w1/cancel"],
    ["an AI's Models Check", () => toolPanel("claude", undefined, undefined, 0, {}, "en", "models"), "/api/queue/settings/check"],
    ["an AI's Subscription Check", () => toolPanel("claude", undefined, undefined, 0, {}, "en", "subscription"), "/api/queue/settings/check"],
    ["an AI's Installation Check", () => toolPanel("claude", undefined, undefined, 0, {}, "en", "installation"), "/api/queue/settings/check"],
    ["an offered model's Add", () => toolPanel("codex", undefined, undefined, 0, {
      reading: { tool: "codex", at: "2026-10-03T13:30:00Z", offered: [{ model: "gpt-5.5" }] },
    }), "/api/queue/settings/models/add"],
    ["a choice no longer offered's Remove", () => toolPanel("codex", undefined, undefined, 0, {
      reading: { tool: "codex", at: "2026-10-03T13:30:00Z", offered: [] },
      choices: { "gpt-5.6-luna": { tool: "codex" } },
    }), "/api/queue/settings/models/remove"],
    ["a schedule entry's Delete", () => projectPage({
      tab: "schedule",
      schedule: [{ name: "nightly", cron: "0 3 * * *", prompt: "p", enabled: true }],
    }), "/api/queue/schedule/aide/nightly/delete"],
  ];
  for (const [name, draw, action] of FORMS) {
    test(`${name} carries the script's hook and a line for its refusal (AC-6)`, () => {
      expect(reloadForm(draw(), action)).toEqual({ hooked: true, line: true });
    });
  }
});

const marker = (html: string): string | null =>
  parse(html).querySelector("[data-reload-every]")?.getAttribute("data-reload-every") ?? null;

const follows = (html: string): boolean => parse(html).querySelector("[data-follow]") !== null;

describe("the pages that follow their job carry the marker the script reads", () => {
  test("a job page and a spec's Steps tab carry it while their job runs, and not once it is done (AC-1)", () => {
    const running = { state: "running" as const, runningStep: { step: "analyze", logs: [] } };
    expect(follows(renderJobDetailPage(detail(running), "2026-08-16T10:00:00Z", NAV))).toBe(true);
    expect(follows(page(view({ lead: lead(running) }), "steps"))).toBe(true);

    const done = { state: "done" as const };
    expect(follows(renderJobDetailPage(detail(done), "2026-08-16T10:00:00Z", NAV))).toBe(false);
    expect(follows(page(view({ lead: lead(done) }), "steps"))).toBe(false);
  });
});

describe("each page that reloads itself carries the script timer's marker", () => {
  test("a project's Deploy tab waiting for origin reloads at its own interval (AC-5)", () => {
    const html = projectPage({ tab: "deploy", drift: { behind: 0, checkedAt: null } });
    expect(marker(html)).toBe(String(AWAITING_DRIFT_REFRESH_SECONDS));
  });

  test("the Wiki tab's Build panel, drawn without the script, reloads while a build runs (AC-5)", () => {
    const html = projectPage({ tab: "wiki", wikiBuild: { id: "w1", state: "running" } });
    expect(marker(html)).toBe("10");
  });

  test("the test-server waiting page reloads by a script of its own (AC-5)", async () => {
    const html = await waitingForTestServerPage("aide", "150-one-page-shows-the-whole-spec").text();
    expect(marker(html)).not.toBeNull();
    expect(html).toContain("<script>");
  });
});
