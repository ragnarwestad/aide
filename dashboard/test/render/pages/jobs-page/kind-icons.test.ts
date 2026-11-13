import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { QueueRowView } from "../../../../src/render";
import type { ExecutionGroup } from "../../../../src/queue/execution-groups";
import { renderJobsRows, renderJobsSpecRows, type JobsView } from "../../../../src/render/pages/jobs-page";
import { jobsFilterBar } from "../../../../src/render/pages/jobs-page/filter-bar.ts";
import { renderSpecsRows } from "../../../../src/render/pages/specs-list";

const row = (id: string, specFolder: string, step: string): QueueRowView => ({
  id, project: "aide", specFolder, steps: [step], stepIndex: 0, state: "failed",
  spentUsd: 0, timeoutSec: 600, createdAt: "2026-11-13T08:00:00Z", results: [],
}) as QueueRowView;

const group: ExecutionGroup = {
  id: "group-1", project: "aide", name: "Release", members: ["82-member"], branch: "group/82-member",
  state: "prepared", createdAt: "2026-11-13T07:00:00Z", completedMembers: [], jobs: [],
};

const view: JobsView = {
  shown: [
    row("schedule", "schedule-nightly", "schedule"),
    row("deploy", "deploy", "deploy"),
    row("cleanup", "cleanup", "cleanup"),
    row("close", "84-closing", "close"),
  ],
  specJobs: [row("active", "81-active", "implement"), row("member", "82-member", "analyze")],
  executionGroups: [group],
  list: {
    runnerAvailable: true,
    createProjects: ["aide"],
    targets: ["81-active", "82-member", "84-closing"].map((specFolder) => ({ project: "aide", specFolder })),
  },
  now: Date.parse("2026-11-13T09:00:00Z"),
};

/** Each row's name line: its kinds, after checking that the project's icon
 *  sits in the project's link and the one kind icon in the name's part. */
function rowKinds(html: string): string[] {
  const body = new Window().document.body;
  body.innerHTML = `<table>${html}</table>`;
  const names = [...body.querySelectorAll(".spec-name")];
  expect(names.length).toBeGreaterThan(0);
  return names.map((name) => {
    expect(name.querySelector('a[href="/projects/aide"] .kindicon[data-tab="projects"]')).not.toBeNull();
    const kinds = name.querySelectorAll(".kindicon[data-kind]");
    expect(kinds).toHaveLength(1);
    expect(kinds[0].closest(".specpart")).not.toBeNull();
    return kinds[0].getAttribute("data-kind")!;
  });
}

test("every Jobs tab row draws the project icon in its link and its kind icon by its name (AC-1)", () => {
  expect(new Set(rowKinds(renderJobsRows(view)))).toEqual(new Set(["spec", "deploy", "schedule", "cleanup", "group"]));
});

test("a group member fetched alone keeps the spec icon (AC-1)", () => {
  expect(renderJobsSpecRows(view, "aide/82-member")).toContain('aria-label="Spec"');
});

test("every Specs list row draws the project icon in its link and the spec icon by its name (AC-1)", () => {
  const archived = {
    project: "aide", folder: "80-archived", done: ["create"], models: {}, phaseOutcomes: {},
  };
  for (const html of [
    renderSpecsRows(view.specJobs, view.list),
    renderSpecsRows(view.specJobs, { ...view.list, filter: { open: "aide/81-active" } }),
    renderSpecsRows([], { ...view.list, archivedSpecs: [archived], filter: { state: "archived" } }),
  ]) {
    expect(new Set(rowKinds(html))).toEqual(new Set(["spec"]));
  }
});

test("the one State dropdown contains a headed Kind part and no second kind control (AC-1, AC-2, AC-7)", () => {
  const html = jobsFilterBar([], {}, "en");
  expect(html.match(/data-filter="state"/g)).toHaveLength(1);
  expect(html).not.toContain('data-filter="kind"');
  expect(html).toContain(">Kind</strong>");
  for (const name of ["All", "Specs", "Deploys", "Scheduled", "Cleanup", "Groups"]) {
    expect(html).toContain(`>${name} (0)</a>`);
  }

  const narrowed = jobsFilterBar([], { kind: "deploy" }, "en");
  expect(narrowed).toContain("Deploys (0)");
  expect(narrowed).toContain('<input type="hidden" name="kind" value="deploy">');
});

test("the trigger does not count the default Kind choice as a narrowed state", () => {
  const html = jobsFilterBar([], { state: "active:all,failed" }, "en");
  expect(html).toContain('<span data-state-count>2 states</span>');
  expect(html).not.toContain('<span data-state-count>3 states</span>');
});
