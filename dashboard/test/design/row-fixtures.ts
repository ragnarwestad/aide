// A spec row and the rows renderer, for the row-action tests.

import {
  renderSpecsRows,
  type SpecsPageOptions,
  type QueueRowView,
  type SpecTarget,
} from "../../src/render";

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

export const target = (extra: Partial<SpecTarget> = {}): SpecTarget => ({
  project: "aide",
  specFolder: "102-design-foundation",
  ...extra,
});

// Spec 103: a row is collapsed unless the view names it, and the
// controls this file is about come with opening it — so every render
// here opens the one spec it draws.
export const rows = (list: QueueRowView[], opts: Partial<SpecsPageOptions> = {}) =>
  renderSpecsRows(
    list,
    {
      runnerAvailable: true,
      targets: [],
      filter: { open: "aide/102-design-foundation" },
      ...opts,
    },
    NOW,
  );
