// A project's Schedule tab: the list of its entries, in the columns that
// fit on one line.
import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { renderProjectPage, type ProjectView } from "../../../../src/render";

const ENTRY = { name: "nightly", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true };

function scheduleTab(
  schedule: { name: string; cron: string; prompt: string; enabled: boolean }[] = [ENTRY],
  scheduleSort?: { sort?: string; dir?: "asc" | "desc" },
): HTMLElement {
  const project: ProjectView = { name: "aide", manifest: { ok: false, error: "no manifest" }, specs: [] };
  const html = renderProjectPage(project, { hasConfigFile: false, rows: [] }, null, "2026-09-30T00:00:00Z", [], {
    worktreeLinkCandidates: [],
    editingGroup: null,
    tab: "schedule",
    schedule,
    scheduleSort,
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

  test("Name, Next run and Enabled are sort links that stay on the tab, the sorted one turned round", () => {
    const heads = (table: HTMLElement) =>
      [...table.querySelectorAll("thead th")].slice(0, 3).map((th) => [
        th.querySelector("a")?.getAttribute("href") ?? null,
        th.getAttribute("aria-sort"),
      ]);
    expect(heads(scheduleTab())).toEqual([
      ["/projects/aide?tab=schedule&sort=name&dir=desc", "ascending"],
      ["/projects/aide?tab=schedule&sort=next", null],
      ["/projects/aide?tab=schedule&sort=enabled", null],
    ]);
    expect(heads(scheduleTab([ENTRY], { sort: "enabled", dir: "asc" }))[2]).toEqual([
      "/projects/aide?tab=schedule&sort=enabled",
      "ascending",
    ]);
  });

  test("the rows follow the sort the address names", () => {
    const entries = [
      { ...ENTRY, name: "b-off", enabled: false },
      { ...ENTRY, name: "c-on" },
      { ...ENTRY, name: "a-on" },
    ];
    const names = (sort?: { sort?: string; dir?: "asc" | "desc" }) =>
      [...scheduleTab(entries, sort).querySelectorAll("tbody tr td:first-child a")].map((a) => a.textContent);
    expect(names()).toEqual(["a-on", "b-off", "c-on"]);
    expect(names({ sort: "name", dir: "desc" })).toEqual(["c-on", "b-off", "a-on"]);
    expect(names({ sort: "enabled" })).toEqual(["a-on", "c-on", "b-off"]);
  });
});
