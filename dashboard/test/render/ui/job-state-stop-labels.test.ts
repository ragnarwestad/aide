// A stopped job says WHY on the row, and that half was English on a
// Norwegian page: `stateLabel` held the five texts as string literals
// while everything else on the row went through the translations.

import { describe, expect, test } from "bun:test";
import { stateLabel } from "../../../src/render/ui/job-state/format.ts";
import type { QueueRowView } from "../../../src/render/ui/job-state/types.ts";

const stopped = (stopReason: string, timeoutSec = 2700): QueueRowView =>
  ({ state: "stopped", stopReason, timeoutSec }) as unknown as QueueRowView;

describe("why a job stopped, in the reader's own language", () => {
  test("each reason has its own words in both languages", () => {
    expect(stateLabel(stopped("provider-limit"), "en")).toBe("stopped — provider limit");
    expect(stateLabel(stopped("provider-limit"), "nb")).toBe("stoppet — grense hos leverandøren");
    expect(stateLabel(stopped("job-cap"), "nb")).toBe("stoppet — jobbtak");
    expect(stateLabel(stopped("tests-red"), "nb")).toBe("stoppet — røde tester");
    expect(stateLabel(stopped("budget"), "nb")).toBe("stoppet — budsjett");
  });

  // The one with a number in it: the minutes are the job's own timeout,
  // filled into whichever language's sentence.
  test("a timeout carries its minutes into either sentence", () => {
    expect(stateLabel(stopped("timeout", 2700), "en")).toBe("stopped — 45 min");
    expect(stateLabel(stopped("timeout", 2700), "nb")).toBe("stoppet — 45 min");
  });

  // Every other state is the state's own word, which is not a sentence
  // to translate — it is what the queue calls it.
  test("a state that is not 'stopped' is its own word", () => {
    expect(stateLabel({ state: "running" } as QueueRowView, "nb")).toBe("running");
  });

  test("English is what a caller that names no language gets", () => {
    expect(stateLabel(stopped("job-cap"))).toBe("stopped — job cap");
  });
});
