import { expect, test } from "bun:test";
import type { QueueRowView } from "../../../../src/render";
import { renderJobsRows, type JobsView } from "../../../../src/render/pages/jobs-page";

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
  const editor = html.slice(html.indexOf("data-execution-group-editor"), html.indexOf("</details>"));
  expect(editor).not.toContain('value="1-running"');
  expect(editor).toContain('value="2-ready"');
});

test("a legacy prepared group has a matching editor for its membership identity (AC-6, AC-10)", () => {
  const membership = (specFolder: string, position: number) => ({
    project: "aide", specFolder, title: specFolder, done: ["create"], group: { name: "Release", position },
  });
  const html = renderJobsRows({
    shown: [], specJobs: [],
    list: { runnerAvailable: true, targets: [membership("1-first", 1), membership("2-second", 2)] },
  });
  expect(html).toContain('data-edit-execution-group="membership:aide:Release"');
  expect(html).toContain('action="/api/queue/groups/membership%3Aaide%3ARelease"');
});
