// The Deploy button's wait for the restarted service (forms.ts,
// `waitForServer`): probes the page until it answers again, sleeping
// between probes, and never mistakes a thrown fetch for an answer.

import { describe, expect, test } from "bun:test";
import { waitForServer } from "../../src/queue-client/forms.ts";

describe("waitForServer", () => {
  test("keeps probing through refused connections until the page answers, then resolves", async () => {
    const answers: (() => Promise<{ ok: boolean }>)[] = [
      () => Promise.reject(new Error("connection refused")),
      () => Promise.resolve({ ok: false }),
      () => Promise.resolve({ ok: true }),
    ];
    let probes = 0;
    const slept: number[] = [];
    const back = await waitForServer(
      () => answers[Math.min(probes++, answers.length - 1)]!(),
      async (ms) => {
        slept.push(ms);
      },
    );
    expect(back).toBe(true);
    expect(probes).toBe(3);
    // The initial wait for the kickstart, then one sleep per failed probe.
    expect(slept).toEqual([2000, 1500, 1500]);
  });

  test("gives up after the bound, and says so", async () => {
    const back = await waitForServer(() => Promise.reject(new Error("down")), async () => {}, 3);
    expect(back).toBe(false);
  });
});
