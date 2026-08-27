// Split out of archived-specs.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import {
  ARCHIVED, ARCHIVED_VIEW, ALL_VIEW, LIVE, LIVE_OTHER, OTHER, SAME_DAY, STAMPED, UNDATED,
  UNSTAMPED, harness, order, specsList, start,
} from "./archived-specs-fixtures.ts";

afterEach(() => harness.cleanup());

// --- criterion 1: the default view is the reading view, unchanged ----------

describe("the default filter", () => {
  test("is a chip of its own, and it is the one the bare page resolves to", async () => {
    const html = await specsList(start().base);
    expect(html).toContain(">Active");
    expect(html).toMatch(/aria-current="true"[^>]*>Active/);
  });

  // Every archived spec in this fixture has landed — `gitDated` answers
  // no `ls-remote` — which is what makes this the plain case. The one
  // exception is spec 193's, and it has a test of its own below.
  test("holds the live specs and no archived one at all (criterion 1)", async () => {
    const html = await specsList(start().base);
    expect(html).toContain(LIVE);
    for (const folder of Object.keys(ARCHIVED)) expect(html).not.toContain(folder);
    // Not the folder alone: the title and the description are what a
    // reader would see, and a row that leaked either would be a row.
    expect(html).not.toContain("One page shows the whole spec");
    expect(html).not.toContain("Every spec file on one page.");
  });

  test("still counts the archived specs on the chips that would show them", async () => {
    const html = await specsList(start().base);
    // Five archived specs exist and none of them is rendered — a chip
    // reading "Archived (0)" beside a list that has 150 of them is the
    // one thing a count must not say.
    expect(html).toMatch(/>Archived \(5\)</);
  });
});

// --- criterion 2: the Archived chip ----------------------------------------

describe("the Archived chip", () => {
  test("shows every archived spec and no live one (criterion 2)", async () => {
    const html = await specsList(start().base, ARCHIVED_VIEW);
    for (const folder of Object.keys(ARCHIVED)) expect(html).toContain(folder);
    expect(order(html)).not.toContain(LIVE);
  });

  // Same rule as `targets()`: the allowlist in queue-config.json is
  // what the dashboard shows, and a discovered project that is not on
  // it is not the dashboard's business.
  test("shows only the projects the queue is allowed to run", async () => {
    const html = await specsList(start({ queueProjects: ["skjer"] }).base, ARCHIVED_VIEW);
    expect(html).not.toContain(STAMPED);
    expect(html).toContain(OTHER);
  });

  test("names each spec's project on the link, the way every row does", async () => {
    const html = await specsList(start().base, ARCHIVED_VIEW);
    expect(html).toContain(`href="/specs/aide/${STAMPED}"`);
    expect(html).toContain(`href="/specs/skjer/${OTHER}"`);
  });
});

// --- criterion 5: All means all, in ONE order ------------------------------

describe("the All chip", () => {
  test("interleaves live and archived by the same sort key (criterion 5)", async () => {
    const rows = order(await specsList(start().base, ALL_VIEW));
    // Folder number, the list's own default, descending: 150, 92, 81,
    // 60, 31, 05. The live spec sits BETWEEN two archived ones, which a
    // list that concatenated the two sets could not produce.
    expect(rows).toEqual([STAMPED, UNSTAMPED, LIVE, SAME_DAY, UNDATED, OTHER, LIVE_OTHER]);
  });

  test("and its own chip is not the default one", async () => {
    const html = await specsList(start().base, ALL_VIEW);
    expect(html).toMatch(/aria-current="true"[^>]*>All/);
    expect(html).not.toMatch(/aria-current="true"[^>]*>Active/);
  });

  // The three chips that were here before this spec each list the states
  // they allow, and none of them lists `archived`.
  test("the three older chips keep their meaning", async () => {
    for (const state of ["active", "done", "problem"]) {
      const html = await specsList(start().base, `?state=${state}`);
      for (const folder of Object.keys(ARCHIVED)) expect(html).not.toContain(folder);
    }
  });
});
