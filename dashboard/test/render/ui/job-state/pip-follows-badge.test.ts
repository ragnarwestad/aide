// The pip on a phase line takes the colour of the badge beside it
// (2026-09-11): a phase held back or stopped is amber on both, a failed
// one red on both, a finished one green on both — the row never says a
// phase's state in two colours.
import { describe, expect, test } from "bun:test";
import { wordPhase } from "../../../../src/render/ui/job-state";

const noJob = undefined;

describe("the pip follows the badge", () => {
  test("held back: amber pip beside the amber badge", () => {
    const w = wordPhase(false, { reason: "depends on 1-x, which is not archived yet" }, noJob, {});
    expect([w.pip, w.badge?.variant]).toEqual(["waiting", "waiting"]);
  });

  test("stopped, from the file: amber on both", () => {
    const w = wordPhase(false, undefined, noJob, { fileResult: "stopped" });
    expect([w.pip, w.badge?.variant]).toEqual(["waiting", "waiting"]);
  });

  test("failed: red on both", () => {
    const attempt = { state: "failed", stopReason: undefined } as never;
    const w = wordPhase(false, undefined, attempt, {});
    expect([w.pip, w.badge?.variant]).toEqual(["refused", "refused"]);
  });

  // A step somebody cancelled was started and did not finish: amber like
  // stopped, never the grey of a step that never ran (2026-09-13).
  test("cancelled: amber on both, not the grey of never-ran", () => {
    const attempt = { state: "cancelled", stopReason: undefined } as never;
    const w = wordPhase(false, undefined, attempt, {});
    expect([w.pip, w.badge?.variant]).toEqual(["waiting", "waiting"]);
  });

  // The sentence names the phase and its own button, so the reader
  // knows what to press; it used to state the mismatch and stop.
  test("files that disagree with the record name the phase and the button to press", () => {
    const w = wordPhase(true, undefined, noJob, { fileDisagrees: true, step: "analyze" });
    expect(w.qualifier).toBe(
      "the files and the run record disagree about whether analyze ran — press Analyze to run it again",
    );
  });

  test("done: green on both, and nothing attempted stays grey with no badge", () => {
    const done = wordPhase(true, undefined, noJob, {});
    expect([done.pip, done.badge?.variant]).toEqual(["past", "done"]);
    const nothing = wordPhase(false, undefined, noJob, {});
    expect([nothing.pip, nothing.badge]).toEqual(["todo", undefined]);
  });
});
