// Split out of archived-specs.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import {
  ARCHIVED, ARCHIVED_VIEW, LIVE, OTHER, SAME_DAY, STAMPED, harness, order, specsList, start,
} from "./archived-specs-fixtures.ts";

afterEach(() => harness.cleanup());

// --- The default view is the reading view, unchanged ----------

describe("the default filter", () => {
  test("is All, and it is the one the bare page resolves to", async () => {
    const html = await specsList(start().base);
    expect(html).toContain(">All");
    expect(html).toMatch(/aria-checked="true"><span class="check" aria-hidden="true"><\/span>All/);
  });
});

// --- The Archived chip ----------------------------------------

describe("the Archived chip", () => {
  // Same rule as `targets()`: the allowlist in queue-config.json is
  // what the dashboard shows, and a discovered project that is not on
  // it is not the dashboard's business.
  test("shows only the projects the queue is allowed to run", async () => {
    const html = await specsList(start({ queueProjects: ["skjer"] }).base, ARCHIVED_VIEW);
    expect(html).not.toContain(STAMPED);
    expect(html).toContain(OTHER);
  });
});

// --- The Not verified entry, read off each spec's 4-status.json ---

const stateFile = (rows: { done: boolean; notVerified?: boolean }[]) =>
  JSON.stringify({
    completedPhases: [], archived: null, reopened: null, phaseCounts: {},
    acceptanceCriteria: rows.map((r, i) => ({ task: `AC-${i + 1}: x`, ...r })),
  });
const marked = [{ done: true, notVerified: true }, { done: true, notVerified: true }];

describe("the Not verified entry", () => {
  const withMarks = () =>
    start({}, {
      ...ARCHIVED,
      [STAMPED]: { ...ARCHIVED[STAMPED], state: stateFile(marked) },
      // Ticked since: no flag left, so no mark and no match.
      [SAME_DAY]: { ...ARCHIVED[SAME_DAY], state: stateFile([{ done: true }]) },
    }, stateFile([marked[0]!]));

  test("lists the live spec and the archived spec with a count, and no other", async () => {
    const html = await specsList(withMarks().base, "?state=not-verified");
    expect(order(html).sort()).toEqual([LIVE, STAMPED].sort());
    expect(html).toContain("2 not verified");
    expect(html).toContain("1 not verified");
  });

  test("counts only the specs with a count, on a view that builds no archived row", async () => {
    const html = await specsList(withMarks().base, "?state=not-archived");
    expect(html).toMatch(/>Not verified \(2\)</);
  });
});
