// A project's Schedule tab: the list of its entries, in the columns that
// fit on one line.
import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { renderProjectPage, type ProjectView } from "../../../../src/render";

const ENTRY = { name: "nightly", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true };

function scheduleTab(): HTMLElement {
  const project: ProjectView = { name: "aide", manifest: { ok: false, error: "no manifest" }, specs: [] };
  const html = renderProjectPage(project, { hasConfigFile: false, rows: [] }, null, "2026-09-30T00:00:00Z", [], {
    worktreeLinkCandidates: [],
    editingGroup: null,
    tab: "schedule",
    schedule: [ENTRY],
  });
  const window = new Window();
  window.document.body.innerHTML = html;
  return window.document.querySelector("table.list") as unknown as HTMLElement;
}

describe("a project's Schedule tab", () => {
  test("lists Name, Next run and Enabled, then Run now and Delete, and leaves out cron, prompt and last run (AC-1)", () => {
    const table = scheduleTab();
    const words = [...table.querySelectorAll("thead th")].map((th) => th.textContent).filter(Boolean);
    expect(words).toEqual(["Name", "Next run", "Enabled"]);
    const row = table.querySelector("tbody tr")!;
    expect(row.children.length).toBe(5);
    const text = row.textContent!;
    expect(text).not.toContain("0 3 * * *");
    expect(text).not.toContain("docs/nightly.md");
    expect(row.querySelector("[data-schedule-state]") === null).toBe(true);
  });
});
