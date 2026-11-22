// Grouping the jobs, the specs on disk and the archived records into one row
// per spec, for the keys it is given alone: a request for one row builds one
// group, and that group is the one the whole list builds for the spec.

import { describe, expect, test } from "bun:test";
import type { QueueRowView } from "../../../../../src/render";
import {
  groupBySpec, groupKey, type ArchivedSpecView, type SpecTarget,
} from "../../../../../src/render/pages/specs-list/data-model";

const NOW = Date.parse("2026-11-12T12:00:00Z");
const job = (o: Partial<QueueRowView>): QueueRowView => ({
  id: "j", project: "aide", specFolder: "01-one", steps: ["analyze"], stepIndex: 0, state: "done",
  spentUsd: 0, timeoutSec: 600, createdAt: "2026-11-10T10:00:00Z", results: [], ...o,
}) as QueueRowView;

const jobs = [
  job({ id: "a1" }),
  job({ id: "i2", specFolder: "02-two", steps: ["implement"], state: "failed" }),
  job({ id: "x9", specFolder: "90-old", steps: ["archive"] }),
  // No spec on disk, in a project the list knows specs of.
  job({ id: "g7", specFolder: "77-gone" }),
];
const targets: SpecTarget[] = ["01-one", "02-two", "03-three"].map((specFolder) => ({ project: "aide", specFolder }));
const archivedSpecs: ArchivedSpecView[] = [
  { project: "aide", folder: "90-old", title: "Old", done: ["create", "analyze", "implement", "archive"], models: {}, phaseOutcomes: {} },
];
const archived = ["aide/90-old", "aide/91-older"];

const build = (only?: ReadonlySet<string>) => groupBySpec(jobs, targets, archived, archivedSpecs, NOW, only);
const keysOf = (groups: ReturnType<typeof groupBySpec>): string[] => groups.map((g) => groupKey(g.project, g.specFolder));
const whole = build();

describe("groupBySpec given the keys to build for", () => {
  for (const key of ["aide/01-one", "aide/03-three", "aide/90-old"]) {
    test(`builds ${key}'s group alone, equal to the whole list's group for it (AC-3)`, () => {
      const one = build(new Set([key]));
      expect(keysOf(one)).toEqual([key]);
      expect(one[0]).toEqual(whole.find((g) => groupKey(g.project, g.specFolder) === key)!);
    });
  }

  test("a job whose key is no spec on disk gets no group, with the key and without it (AC-3)", () => {
    expect(keysOf(whole)).not.toContain("aide/77-gone");
    expect(build(new Set(["aide/77-gone"]))).toEqual([]);
  });

  test("an empty set of keys builds no group (AC-3)", () => {
    expect(whole.length).toBeGreaterThan(0);
    expect(build(new Set())).toEqual([]);
  });
});

test("automatic waiting fixes the phase choices for every group member until Stop", () => {
  const waiting = job({ state: "waiting", stopReason: "provider-limit",
    usageLimitWait: { until: "2099-01-01T12:00:00Z", resetKnown: true } });
  const group = { id: "g", project: "aide", name: "Release", members: ["01-one", "02-two"],
    branch: "group/release", state: "stopped" as const, currentMember: "01-one", completedMembers: [], jobs: [] };
  const build = (stoppedByUser: boolean) => groupBySpec([waiting], targets.slice(0, 2), undefined, undefined, NOW, undefined, [{ ...group, stoppedByUser }]);
  expect(build(false).map((member) => member.executionGroupAutomaticWait)).toEqual([true, true]);
  expect(build(true).map((member) => member.executionGroupAutomaticWait)).toEqual([false, false]);
});

test("summary projection preserves global search, state, ordering and membership facts without phase rows (AC-4, AC-5, AC-8, AC-10)", () => {
  const scenarios = [
    targets,
    targets.map((target) => ({ ...target, done: ["create", "analyze"], reopenedRound: true })),
    targets.map((target) => ({ ...target, notVerified: 2, failed: 1, group: { name: "Release", position: 1 } })),
  ];
  for (const source of scenarios) {
    const details = groupBySpec(jobs, source, archived, archivedSpecs, NOW);
    const summaries = groupBySpec(jobs, source, archived, archivedSpecs, NOW, undefined, [], true);
    const facts = (group: typeof details[number]) => ({
      key: groupKey(group.project, group.specFolder), state: group.state, createdAt: group.createdAt,
      title: group.title, description: group.description, done: group.done, spentUsd: group.spentUsd,
      duration: group.totalDurationMs, notVerified: group.notVerified, failed: group.failed, group: group.group,
      executionGroupActive: group.executionGroupActive,
    });
    expect(summaries.map(facts)).toEqual(details.map(facts));
    expect(summaries.every((group) => group.phases.length === 0)).toBe(true);
  }
});

describe("the details a row reads from files", () => {
  const counting = () => {
    const calls = { acceptance: 0, approach: 0 };
    const target: SpecTarget = {
      project: "aide", specFolder: "01-one",
      readAcceptance: () => { calls.acceptance++; return []; },
      readApproachChoice: () => { calls.approach++; return undefined; },
    };
    return { calls, target };
  };

  test("a summary row reads neither (AC-2)", () => {
    const { calls, target } = counting();
    groupBySpec([], [target], undefined, undefined, NOW, undefined, [], true);
    expect(calls).toEqual({ acceptance: 0, approach: 0 });
  });

  test("a full row reads each once (AC-2)", () => {
    const { calls, target } = counting();
    groupBySpec([], [target], undefined, undefined, NOW);
    expect(calls).toEqual({ acceptance: 1, approach: 1 });
  });
});
