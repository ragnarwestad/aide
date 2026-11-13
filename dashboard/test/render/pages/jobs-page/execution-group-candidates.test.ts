import { expect, test } from "bun:test";
import type { QueueRowView } from "../../../../src/render";
import { renderJobsRows, type JobsView } from "../../../../src/render/pages/jobs-page";
import { NEW_GROUP_DIALOG } from "../../../../src/render/pages/jobs-page/execution-group-editor.ts";

const running = {
  id: "job-1", project: "aide", specFolder: "1-running", steps: ["analyze"], stepIndex: 0,
  state: "running", spentUsd: 0, timeoutSec: 600, createdAt: "2026-11-11T12:00:00Z", results: [],
} as QueueRowView;

test("New group excludes a spec with an ordinary job in flight (AC-4)", () => {
  const view: JobsView = {
    shown: [], specJobs: [running], now: Date.parse("2026-11-11T12:01:00Z"),
    list: { runnerAvailable: true, targets: [{ project: "aide", specFolder: "1-running" }, { project: "aide", specFolder: "2-ready" }] },
  };
  const html = renderJobsRows(view);
  const editor = html.slice(html.indexOf("data-execution-group-editor"), html.indexOf("</dialog>"));
  expect(editor).not.toContain('value="1-running"');
  expect(editor).toContain('value="2-ready"');
});

/** The tab with a row and with none, in a project that may have a spec made in it. */
const TABS: JobsView[] = [
  {
    shown: [], specJobs: [running], now: Date.parse("2026-11-11T12:01:00Z"),
    list: { runnerAvailable: true, targets: [{ project: "aide", specFolder: "1-running" }], createProjects: ["aide"] },
  },
  { shown: [], specJobs: [], list: { runnerAvailable: true, targets: [], createProjects: ["aide"] } },
];

test("the search row ends in the button that opens the New group dialog, with a row and with none (AC-2)", () => {
  for (const view of TABS) {
    const html = renderJobsRows(view);
    const search = html.slice(html.indexOf(`class="specsearch"`), html.indexOf("</form>", html.indexOf(`class="specsearch"`)));
    expect(search).toContain(`data-ask="${NEW_GROUP_DIALOG}"`);
    expect(html).toContain(`id="${NEW_GROUP_DIALOG}"`);
  }
});

test("the Jobs tab offers no way to make a spec, with a row and with none (AC-6)", () => {
  for (const view of TABS) expect(renderJobsRows(view)).not.toContain('href="/new"');
});

test("specs that share a group name in their descriptions are drawn as one group card", () => {
  const membership = (specFolder: string, position: number) => ({
    project: "aide", specFolder, title: specFolder, done: ["create"], group: { name: "Release", position },
  });
  const html = renderJobsRows({
    shown: [], specJobs: [],
    list: { runnerAvailable: true, targets: [membership("1-first", 1), membership("2-second", 2)] },
  });
  expect(html).toContain('data-spec-group="aide\nRelease"');
});

test("a group's card is handed the specs its group can take (AC-2)", () => {
  const spec = (specFolder: string, extra: Record<string, unknown> = {}) => ({ project: "aide", specFolder, title: specFolder, done: ["create"], ...extra });
  const html = renderJobsRows({
    shown: [], specJobs: [],
    list: {
      runnerAvailable: true,
      targets: [
        spec("1-first", { group: { name: "Release", position: 1 }, dependsOn: ["4-required"] }),
        spec("2-second", { group: { name: "Release", position: 2 } }),
        spec("3-free"),
        spec("4-required"),
      ],
    },
  });
  const card = html.slice(html.indexOf('data-spec-group="aide\nRelease"'));
  const dialog = card.slice(card.indexOf('<dialog class="formdialog"'), card.indexOf("</dialog>"));
  expect(dialog).toContain('value="3-free"');
  expect(dialog).not.toContain('value="4-required"');
});
