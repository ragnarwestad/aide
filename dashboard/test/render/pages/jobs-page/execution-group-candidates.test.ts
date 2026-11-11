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
