// Shared fixtures for the design-system.test.ts split, across
// design-system-brand-and-frame.test.ts, design-system-row-controls.test.ts,
// design-system-badges-and-buttons.test.ts and
// design-system-tokens-and-panels.test.ts (split out of design-system.test.ts
// by theme).

import {
  renderQueueRows,
  type JobDetailView,
  type QueuePageOptions,
  type QueueRowView,
  type QueueTarget,
} from "../../src/render.ts";

export const NAV = [{ label: "Overview", path: "projects.html" }];
export const AT = "2026-08-18T12:00:00Z";
export const NOW = Date.parse("2026-08-18T12:00:00Z");

export const row = (extra: Partial<QueueRowView> = {}): QueueRowView => ({
  id: "job-1",
  project: "aide",
  specFolder: "102-design-foundation",
  steps: ["analyze"],
  stepIndex: 0,
  state: "running",
  spentUsd: 0,
  timeoutSec: 1200,
  createdAt: "2026-08-18T10:00:00Z",
  ...extra,
});

export const target = (extra: Partial<QueueTarget> = {}): QueueTarget => ({
  project: "aide",
  specFolder: "102-design-foundation",
  ...extra,
});

// Spec 103: a row is collapsed unless the view names it, and the
// controls this file is about come with opening it — so every render
// here opens the one spec it draws.
export const rows = (list: QueueRowView[], opts: Partial<QueuePageOptions> = {}) =>
  renderQueueRows(
    list,
    {
      runnerAvailable: true,
      targets: [],
      filter: { open: "aide/102-design-foundation" },
      ...opts,
    },
    NOW,
  );

export const detail = (extra: Partial<JobDetailView> = {}): JobDetailView => ({
  ...row(),
  steps: ["analyze", "implement", "archive"],
  stepIndex: 1,
  results: [],
  ...extra,
});
