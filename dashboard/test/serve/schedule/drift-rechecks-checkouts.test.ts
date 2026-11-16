// A checkout whose last check git did not finish is asked again on the
// drift poll, every thirty seconds, rather than left to the five-minute
// sweep. Started, never awaited: the poll and every page go on without it.

import { afterEach, expect, test } from "bun:test";
import { clearCheckoutFaults, setCheckoutFault } from "../../../src/render/ui/checkout-faults.ts";
import { refreshDrift, type ScheduleContext } from "../../../src/serve/schedules/index.ts";

afterEach(() => {
  clearCheckoutFaults();
});

test("the drift poll starts a check for a marked checkout, and does not wait for it (AC-4)", async () => {
  const asked: string[] = [];
  const ctx = {
    projectRoot: undefined,
    allowed: new Set(["woodstack", "aide", "atlas"]),
    // A check that never settles: the poll must not hold on it.
    ensureCheckout: (project: string) => {
      asked.push(project);
      return new Promise<undefined>(() => {});
    },
  } as unknown as ScheduleContext;
  setCheckoutFault("woodstack", "not checked yet", true);
  setCheckoutFault("aide", "git says no");

  const outcome = await Promise.race([
    refreshDrift(ctx).then(() => "returned"),
    Bun.sleep(1000).then(() => "held"),
  ]);

  expect(outcome).toBe("returned");
  expect(asked).toEqual(["woodstack"]);
});
