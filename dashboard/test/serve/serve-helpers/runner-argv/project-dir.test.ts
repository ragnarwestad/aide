// `--project-dir` is what decides which checkout a run branches, switches
// and cuts its worktree from: the dashboard's own, never the person's.

import { expect, test } from "bun:test";
import { runnerArgv } from "../../../../src/serve/serve-helpers";

test("the runner is pointed at the dashboard's own checkout, never the person's", () => {
  const job = {
    id: "j1", project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"], stepIndex: 0,
     model: {}, timeoutSec: {}, permissionMode: {}, state: "queued", createdAt: "", results: [],
  } as unknown as Parameters<typeof runnerArgv>[0];
  const argv = runnerArgv(job, "analyze", "/tmp/r.json", {
    runnerBin: "/bin/aide-run-spec",
    projectDir: "/home/dev/aide-dashboard/checkouts/aide/code",
    push: "branch",
  });
  expect(argv[argv.indexOf("--project-dir") + 1]).toBe("/home/dev/aide-dashboard/checkouts/aide/code");
});
