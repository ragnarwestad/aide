// Shared fixtures for the render.test.ts split (7646 lines, 68
// describe blocks) into test/render/pages/, one file per theme.

import {
  navEntries,
  renderProjectsPage,
  type JobDetailView,
  type ProjectView,
  type QueueRowView,
} from "../../../src/render";

/** Every <link> on a page that is a second REQUEST rather than a data
 *  URI — what "self-contained" means here, since the site is published
 *  as plain files and opened from a folder as often as from a server. */
export function external(html: string): (string | undefined)[] {
  return [...html.matchAll(/<link[^>]+href="(?!data:)([^"]*)"/g)].map((m) => m[1]);
}

export function project(name: string, overrides: Partial<ProjectView> = {}): ProjectView {
  return {
    name,
    manifest: { ok: true, data: { name } },
    specs: [],
    ...overrides,
  };
}

export const healthy: ProjectView = {
  name: "goodproj",
  manifest: {
    ok: true,
    data: {
      name: "goodproj",
      description: "A healthy project",
      stack: { frontend: "TypeScript" },
      deployment: { url: "https://goodproj.example.com" },
      statistics: ["https://stats.example.com"],
      docs: ["README.md"],
    },
  },
  specs: [
    {
      folder: "01-active-spec",
      dir: "/x/01-active-spec",
      archived: false,
      closed: false,
      title: "Active spec",
      description: null,
      dependsOn: [],
      status: {
        progress: { percent: 50, done: 1, total: 2 },
        phase: "Phase 2: GREEN",
        acceptancePhase: null,
        checks: [],
        workflowSteps: ["create", "analyze", "implement"],
        stepModels: {},
      },
    },
    {
      folder: "02-archived-spec",
      dir: "/x/archive/02-archived-spec",
      archived: true,
      closed: false,
      title: "Archived spec",
      description: null,
      dependsOn: [],
      status: {
        progress: { percent: 100, done: 4, total: 4 },
        phase: "done",
        acceptancePhase: null,
        checks: [],
        workflowSteps: ["create", "analyze", "implement", "archive"],
        stepModels: {},
      },
    },
  ],
};

export const broken: ProjectView = {
  name: "brokenproj",
  manifest: { ok: false, error: "YAML parse error at line 3" },
  specs: [],
};

export const generatedAt = "2026-08-16T12:00:00+02:00";

// Every test below that loops `for (const page of site)` is really
// testing `pageShell()`'s own shared markup (nav, theme menu, About
// dialog, head tags) — a served page proves the same thing a generated
// one used to (spec 530), and the Projects page is the one every such
// test already expected as current.
export const site: string[] = [renderProjectsPage([healthy, broken], generatedAt, navEntries(), {})];

export const NAV = [{ label: "Overview", path: "projects.html" }];

export const detail = (extra: Partial<JobDetailView> = {}): JobDetailView => ({
  id: "job-1234",
  project: "aide-dashboard",
  specFolder: "02-job-detail-view",
  steps: ["analyze"],
  stepIndex: 0,
  state: "running",
  spentUsd: 0,
  timeoutSec: 1200,
  createdAt: "2026-08-16T10:00:00Z",
  results: [],
  ...extra,
});

export const row = (extra: Partial<QueueRowView> = {}): QueueRowView => ({
  id: "job-1234",
  project: "aide",
  specFolder: "81-queue-and-runner",
  steps: ["analyze"],
  stepIndex: 0,
  state: "running",
  spentUsd: 0,
  timeoutSec: 1200,
  createdAt: "2026-08-16T00:00:00Z",
  ...extra,
});

/** A row whose `step` reports that `gh` opened no pull request for its
 *  branch. On the step's own result, which is where that answer lives —
 *  a job field is rewritten by the next landing to finish. */
export const noPullRequest = (step: string, why = "gh auth login required"): Partial<QueueRowView> => ({
  results: [{ step, ok: true, costUsd: 0, costMeasured: true, terminalReason: "completed", prError: why }],
});

/** Since spec 103 a row is COLLAPSED unless the view names it: the
 *  phase lines, the run control and the "more" line come with opening
 *  it. A block that is about what an expanded row holds says so by
 *  opening every spec it renders. */
export const openKeys = (
  list: { project?: string; specFolder: string }[],
  targets: { project: string; specFolder: string }[] = [],
): string =>
  [
    ...new Set([
      ...list.map((r) => `${r.project ?? "aide"}/${r.specFolder}`),
      ...targets.map((t) => `${t.project}/${t.specFolder}`),
    ]),
  ].join(",");
