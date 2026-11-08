// The Running tab offers the Specs list's New button: in its search row when it
// has a row or is empty, and not at all when no project may have a spec made in it.

import { describe, expect, test } from "bun:test";
import { t } from "../../../../src/i18n";
import type { FailedCreate } from "../../../../src/push/failed-creates.ts";
import type { QueueRowView } from "../../../../src/render";
import { renderJobsRows, type JobsView } from "../../../../src/render/pages/jobs-page";
import { newSpecLink } from "../../../../src/render/pages/specs-list/filter-bar.ts";

const close = {
  id: "c1", project: "aide", specFolder: "01-x", steps: ["close"], stepIndex: 0, state: "failed",
  spentUsd: 0, timeoutSec: 600, createdAt: "2026-10-14T19:48:00Z",
} as QueueRowView;

const view = (shown: QueueRowView[], createProjects: string[]): JobsView => ({
  shown,
  specJobs: [],
  list: { runnerAvailable: true, targets: [], createProjects },
  now: Date.parse("2026-10-14T20:00:00Z"),
});

const link = newSpecLink({ createProjects: ["aide"] }, "en");

describe("New on the Running tab", () => {
  test("a tab with a row offers New when a project may have a spec made in it", () => {
    expect(renderJobsRows(view([close], ["aide"]))).toContain(link);
  });

  test("an empty tab offers New", () => {
    const html = renderJobsRows(view([], ["aide"]));
    expect(html).toContain(t("en", "jobs.nothingRunning"));
    expect(html).toContain(link);
  });

  test("an empty tab with failed-create notices respects New eligibility", () => {
    const failed: FailedCreate = {
      id: "cr", project: "aide", title: "x", description: "",
      reason: { key: "runner.serverRestarted", values: { button: "Create" } }, failedAt: "2026-10-14T19:00:00Z",
    };
    const v = view([], ["aide"]);
    v.list.failedCreates = [failed];
    const html = renderJobsRows(v);
    expect(html).toContain(link);
    v.list.createProjects = [];
    expect(renderJobsRows(v)).not.toContain('href="/new"');
  });

  test("no project may have a spec made in it: no New, with a row or without", () => {
    const withRow = renderJobsRows(view([close], []));
    const empty = renderJobsRows(view([], []));
    expect(withRow).not.toContain('href="/new"');
    expect(empty).not.toContain('href="/new"');
    expect(empty).toContain(t("en", "jobs.nothingRunning"));
  });
});
