// A deploy held back by a landing says which spec is landing and which step,
// in the words its row uses, so the reader can find it on the board.

import { describe, expect, test } from "bun:test";
import { formatMessage } from "../../../src/messages/format.ts";
import { gerund } from "../../../src/format/gerund.ts";
import { deployHold } from "../../../src/serve/deploy-job/landing-hold.ts";
import type { Job } from "../../../src/queue/queue.ts";

const job = (o: Partial<Job>): Job =>
  ({ id: "j", project: "aide", specFolder: "745-list-the-ways", steps: ["analyze", "implement", "archive"], stepIndex: 2, state: "running", ...o }) as Job;

describe("deployHold", () => {
  test("names each landing spec as project:number with the step that is landing", () => {
    const hold = deployHold([
      job({ id: "a", landing: true }),
      job({ id: "b", project: "skjera", specFolder: "96-code-health", state: "queued", stepIndex: 2, landing: true }),
      job({ id: "c" }),
    ]);
    expect(hold.key).toBe("runner.landingPause");
    expect(hold.inner).toEqual([
      { key: "runner.landingRunning", values: { doing: "archive", spec: "aide:745" } },
      { key: "runner.landingRunning", values: { doing: "implement", spec: "skjera:96" } },
    ]);
  });

  test("leaves out the deploy job itself", () => {
    const hold = deployHold([job({ id: "d", specFolder: "deploy", steps: ["deploy"], stepIndex: 0, landing: true })], "d");
    expect(hold.inner).toEqual({ key: "runner.landingUnnamed" });
  });

  test("with no landing job to name, it says that something is still finishing", () => {
    expect(deployHold([]).inner).toEqual({ key: "runner.landingUnnamed" });
  });
});

describe("a {doing} value", () => {
  test("is drawn as the step's word on the row, not as the step's id", () => {
    const text = formatMessage("nb", { key: "runner.landingRunning", values: { doing: "archive", spec: "aide:745" } });
    expect(text.toLowerCase()).toContain(gerund("nb", "archive").toLowerCase());
    expect(text).toContain("aide:745");
  });
});
