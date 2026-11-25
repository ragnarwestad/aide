// Shared fixtures for the render.test.ts split (7646 lines, 68
// describe blocks) into test/render/pages/, one file per theme.

import { afterEach } from "bun:test";
import { Window } from "happy-dom";
import {
  navEntries,
  renderProjectsPage,
  renderSpecsRows,
  type ProjectView,
  type QueueRowView,
  type SpecsPageOptions,
  type SpecTarget,
} from "../../../src/render";

/** Registers the `afterEach` that closes every window it opened, in the
 *  calling file, and returns `parse(html)`: the document a browser
 *  builds from that HTML. */
export function documents(): (html: string) => Document {
  const windows: Window[] = [];
  afterEach(async () => {
    while (windows.length) await windows.pop()!.happyDOM.close();
  });
  return (html) => {
    const win = new Window();
    windows.push(win);
    win.document.write(html);
    return win.document as unknown as Document;
  };
}

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
// one used to, and the Projects page is the one every such
// test already expected as current.
export const site: string[] = [renderProjectsPage([healthy, broken], generatedAt, navEntries(), {})];

export const NAV = [{ label: "Overview", path: "projects.html" }];

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

/** A row is COLLAPSED unless the view names it: the
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

/** A spec on the specs list, in project aide. */
export const specTarget = (specFolder: string, extra: Partial<SpecTarget> = {}): SpecTarget => ({
  project: "aide",
  specFolder,
  ...extra,
});

/** The specs list's rows as drawn at `at`, with the runner available and
 *  every spec they name opened; `defaultTargets` when a test names none. */
export const openRowsAt = (at: string, defaultTargets: SpecTarget[] = []) =>
  (list: QueueRowView[], targets: SpecTarget[] = defaultTargets, opts: Partial<SpecsPageOptions> = {}): string =>
    renderSpecsRows(list, { runnerAvailable: true, targets, filter: { open: openKeys(list, targets) }, ...opts }, Date.parse(at));

/** `openRowsAt` for the tests that read the pickers: every render starts
 *  from `base`, and takes its own options before its targets. */
export const pickerRowsAt = (at: string, base: Partial<SpecsPageOptions>, defaultTargets: SpecTarget[]) =>
  (list: QueueRowView[] = [], opts: Partial<SpecsPageOptions> = {}, targets: SpecTarget[] = defaultTargets): string =>
    renderSpecsRows(
      list,
      { runnerAvailable: true, targets, ...base, filter: { open: openKeys(list, targets) }, ...opts },
      Date.parse(at),
    );

/** An open row's header and the lines it reveals under it, up to the
 *  next spec's header: where the run control and the phase boxes are. */
export const runLine = (html: string, folder: string): string =>
  html.match(
    new RegExp(
      `<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?` +
        `(?=<tr class="[^"]*spechead|</tbody>|$)`,
    ),
  )?.[0] ?? "";

/** One phase's checkbox and its label, from the line it sits on. */
export const phaseBox = (line: string, step: string): string =>
  line.match(new RegExp(`<label class="phase[^"]*" data-phase="${step}"[^>]*>.*?</label>`))?.[0] ?? "";
