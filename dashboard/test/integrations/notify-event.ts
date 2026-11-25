// A finished step's notification, as the notifier hands it to the
// configured command and the Slack wrapper reads it on stdin.
import type { NotifyEvent } from "../../src/integrations/notify.ts";

export const FINISHED_EVENT = {
  event: "finished",
  project: "aide",
  spec: "81-queue-and-runner",
  step: "analyze",
  jobId: "job-1",
  costUsd: 2.1,
  branchUrl: "https://github.com/example/aide/compare/main...aide/81-queue-and-runner",
  at: "2026-08-16T22:00:00Z",
} satisfies NotifyEvent;
