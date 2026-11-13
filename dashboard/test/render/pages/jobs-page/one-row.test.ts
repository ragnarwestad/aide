// A › on the Jobs tab asks for one row. What that row is built from is
// `rowInputs`' to say: the one job, or the one spec and the other members of
// its group. The renderer then draws the asked row and no other.

import { describe, expect, test } from "bun:test";
import type { ExecutionGroup } from "../../../../src/queue/execution-groups";
import type { QueueRowView, SpecTarget } from "../../../../src/render";
import { renderJobsSpecRows, rowInputs, type JobsView } from "../../../../src/render/pages/jobs-page";

const NOW = Date.parse("2026-11-12T12:00:00Z");
const job = (o: Partial<QueueRowView>): QueueRowView => ({
  id: "j", project: "aide", specFolder: "81-alone", steps: ["analyze"], stepIndex: 0, state: "done",
  spentUsd: 0, timeoutSec: 600, createdAt: "2026-11-10T10:00:00Z", results: [], ...o,
}) as QueueRowView;

const release: ExecutionGroup = {
  id: "g1", project: "aide", name: "Release", members: ["82-first", "83-second"], branch: "group/82-first",
  state: "prepared", createdAt: "2026-11-10T12:00:00.000Z", completedMembers: [], jobs: [],
};
const olderReport = job({ id: "old", specFolder: "schedule-report", steps: ["schedule"], state: "failed", createdAt: "2026-11-10T03:00:00Z" });
const newerReport = job({ id: "new", specFolder: "schedule-report", steps: ["schedule"], state: "failed", createdAt: "2026-11-11T03:00:00Z" });
const deploy = job({ id: "dep", specFolder: "deploy", steps: ["deploy"], createdAt: "2026-11-11T09:00:00Z" });
const OLDER_KEY = "aide/schedule-report@old";

const ids = (jobs: { id: string }[]): string[] => jobs.map((j) => j.id).sort();
const rowsIn = (html: string): string[] => [...html.matchAll(/<tr\b[^>]*?\bclass="spechead\b[^>]*?\bid="spec-([^"]+)"/g)].map((m) => m[1]!);

describe("what one Jobs tab row is built from", () => {
  const specJobs = [
    job({ id: "a81" }),
    job({ id: "a82", specFolder: "82-first" }),
    job({ id: "a83", specFolder: "83-second" }),
    job({ id: "i84", specFolder: "84-closing", steps: ["implement"], state: "failed" }),
  ];
  const closing = job({ id: "c84", specFolder: "84-closing", steps: ["close"], state: "running", createdAt: "2026-11-11T10:00:00Z" });
  const shown = [closing, newerReport];
  const folders = ["81-alone", "82-first", "83-second", "84-closing"];
  const ungrouped = () => folders.map((specFolder) => ({ specFolder }));
  const named = () => folders.map((specFolder) => ({ specFolder, group: /^8[23]/.test(specFolder) ? "Release" : undefined }));

  test("a spec in a registered group keeps its group's members, and a spec in none keeps itself alone (AC-1)", () => {
    const member = rowInputs("aide/82-first", { shown, specJobs, groups: [release], specsOf: ungrouped })!;
    expect(ids(member.specJobs)).toEqual(["a82", "a83"]);
    expect(member.shown).toEqual([]);
    expect([...member.specs].sort()).toEqual(["aide/82-first", "aide/83-second"]);

    const alone = rowInputs("aide/81-alone", { shown, specJobs, groups: [release], specsOf: ungrouped })!;
    expect(ids(alone.specJobs)).toEqual(["a81"]);
    expect([...alone.specs]).toEqual(["aide/81-alone"]);
  });

  test("specs that share a group name are kept together where no group is registered (AC-1)", () => {
    const member = rowInputs("aide/83-second", { shown, specJobs, groups: [], specsOf: named })!;
    expect(ids(member.specJobs)).toEqual(["a82", "a83"]);
    expect([...member.specs].sort()).toEqual(["aide/82-first", "aide/83-second"]);
  });

  test("a spec's Close in flight stays among the jobs that are rows of their own (AC-1)", () => {
    const cut = rowInputs("aide/84-closing", { shown, specJobs, groups: [release], specsOf: ungrouped })!;
    expect(ids(cut.shown)).toEqual(["c84"]);
    expect(ids(cut.specJobs)).toEqual(["i84"]);
  });

  test("an earlier round's key keeps its spec, and a group card's key cuts nothing (AC-1)", () => {
    const round = rowInputs("aide/81-alone@2026-11-10T10%3A00%3A00Z", { shown, specJobs, groups: [release], specsOf: ungrouped })!;
    expect([...round.specs]).toEqual(["aide/81-alone"]);
    expect(rowInputs("execution-group:g1", { shown, specJobs, groups: [release], specsOf: ungrouped })).toBeUndefined();
  });

  test("an older run's key keeps that one job and no spec, under the key asked for (AC-2)", () => {
    const cut = rowInputs(OLDER_KEY, { shown: [olderReport, newerReport, deploy], specJobs, groups: [release], specsOf: ungrouped })!;
    expect(ids(cut.shown)).toEqual(["old"]);
    expect(cut.specJobs).toEqual([]);
    expect(cut.specs.size).toBe(0);
    expect(cut.rowKeys.get("old")).toBe(OLDER_KEY);
  });
});

describe("the Jobs tab draws the asked row alone", () => {
  /** A view of three specs whose rows each ask about a test server, two runs
   *  of a scheduled job and a deploy; `asked` and `pips` record whose row was drawn. */
  function tab(groups: ExecutionGroup[] = []) {
    const asked: string[] = [];
    const pips: string[] = [];
    const implemented = ["create", "analyze", "implement"];
    const targets: SpecTarget[] = ["81-alone", "82-first", "83-second"].map((specFolder) => ({
      project: "aide", specFolder, done: implemented, historyDone: implemented,
    }));
    const view: JobsView = {
      shown: [olderReport, newerReport, deploy],
      specJobs: [],
      executionGroups: groups,
      list: {
        runnerAvailable: true, createProjects: ["aide"], targets,
        testServerAvailable: (_project, specFolder) => {
          asked.push(specFolder);
          return true;
        },
        jobStepPips: (jobId) => {
          pips.push(jobId);
          return [];
        },
      },
      now: NOW,
    };
    return { view, asked, pips };
  }

  test("a spec's key draws that spec's row and no job's (AC-1)", () => {
    const { view, asked, pips } = tab();
    expect(rowsIn(renderJobsSpecRows(view, "aide/81-alone"))).toEqual(["aide/81-alone"]);
    expect([...new Set(asked)]).toEqual(["81-alone"]);
    expect(pips).toEqual([]);
  });

  test("a group member's key draws that member alone, and the card's key draws the card with its members (AC-1)", () => {
    const member = tab([release]);
    expect(rowsIn(renderJobsSpecRows(member.view, "aide/82-first"))).toEqual(["aide/82-first"]);
    expect([...new Set(member.asked)]).toEqual(["82-first"]);

    const card = renderJobsSpecRows(tab([release]).view, "execution-group:g1");
    expect(card).toContain('class="execution-group"');
    expect(rowsIn(card)).toEqual(["aide/82-first", "aide/83-second"]);
  });

  test("a job's key, in the view cut to it, draws that job alone under the key asked for (AC-2)", () => {
    const { view, pips } = tab();
    const cut = rowInputs(OLDER_KEY, { shown: view.shown, specJobs: [], groups: [], specsOf: () => [] })!;
    const html = renderJobsSpecRows({ ...view, shown: cut.shown, specJobs: cut.specJobs, specs: cut.specs, rowKeys: cut.rowKeys }, OLDER_KEY);
    expect(rowsIn(html)).toEqual([OLDER_KEY]);
    expect(pips).toEqual(["old"]);
  });
});
