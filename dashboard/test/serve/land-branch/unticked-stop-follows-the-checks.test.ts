// "Archive stopped: the Acceptance criteria are not all ticked" is what
// the last archive run's commit says — and it was drawn on every render
// after that, whatever the Checks tab said since. With every criterion
// ticked and archive not pressed again, the row went on telling the
// reader to go and tick. The stop is only as
// true as the criteria still open NOW; the commit names why the last
// run stopped, never whether that still holds.

import { describe, expect, test } from "bun:test";
import {
  withFreshness,
  type LandContext,
} from "../../../src/serve/land-branch";
import type { SpecTarget } from "../../../src/render";

const FOLDER = "02-selvregistrering-med-provetid";

function withHistory(
  stopped: Record<string, string>,
  target: Partial<SpecTarget>,
): SpecTarget {
  const ctx = {
    workflowHistory: {
      peekHistory: () => ({
        history: { done: ["create", "analyze", "implement"], stopped },
        checkedAt: 1,
      }),
    },
    specCreatedAt: { peekCreatedAt: () => ({ createdAt: null }) },
    freshness: { peekStale: () => ({ stale: false }) },
    branchFileSteps: {
      peekFileSteps: () => ({ steps: null, checkedAt: null }),
    },
  } as unknown as LandContext;
  const list: SpecTarget[] = [
    {
      project: "paceup",
      specFolder: FOLDER,
      dir: "/some/dir",
      fileSteps: {
        proseSteps: ["create", "analyze", "implement"],
        stateSteps: undefined,
      },
      ...target,
    },
  ];
  return withFreshness(ctx, list)[0]!;
}

describe("archive's unticked-criteria stop answers to the Checks tab", () => {
  test("every criterion ticked since: the old stop is not drawn", () => {
    const t = withHistory(
      { archive: "acceptance-criteria-unticked" },
      { acceptanceOpen: false },
    );
    expect(t.stopped?.archive).toBeUndefined();
  });

  test("a criterion still open: the stop stands", () => {
    const t = withHistory(
      { archive: "acceptance-criteria-unticked" },
      { acceptanceOpen: true },
    );
    expect(t.stopped?.archive).toBe("acceptance-criteria-unticked");
  });

  test("a stop for any other reason is left alone", () => {
    const t = withHistory(
      { archive: "conflict-open" },
      { acceptanceOpen: false },
    );
    expect(t.stopped?.archive).toBe("conflict-open");
  });

  test("another step's stop is left alone", () => {
    const t = withHistory(
      { implement: "tests-red" },
      { acceptanceOpen: false },
    );
    expect(t.stopped?.implement).toBe("tests-red");
  });
});

// A spec git has not been asked about yet keeps what its own files say:
// the done-set, the stops and the Started date stay as the disk scan
// found them until the schedule has warmed the spec.
describe("a spec the schedule has not reached yet", () => {
  test("keeps the target the disk scan made, unchanged", () => {
    const ctx = {
      workflowHistory: {
        peekHistory: () => ({ history: null, checkedAt: null }),
      },
      specCreatedAt: { peekCreatedAt: () => ({ createdAt: null }) },
      freshness: { peekStale: () => ({ stale: true }) },
      branchFileSteps: {
        peekFileSteps: () => ({ steps: null, checkedAt: null }),
      },
    } as unknown as LandContext;
    const target = {
      project: "skjera",
      specFolder: "28-reminders",
      dir: "/some/dir",
      done: ["create", "analyze"],
      fileSteps: { proseSteps: ["create", "analyze"], stateSteps: undefined },
    } as SpecTarget;
    expect(withFreshness(ctx, [target])[0]).toBe(target);
  });
});
