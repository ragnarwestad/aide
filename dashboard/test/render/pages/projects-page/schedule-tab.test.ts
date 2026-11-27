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
    tab: "schedule",
    schedule,
    scheduleSort,
  });
  const window = new Window();
  window.document.body.innerHTML = html;
  return window.document.querySelector("table.list") as unknown as HTMLElement;
}

describe("a project's Schedule tab", () => {
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
});
