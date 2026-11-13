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
