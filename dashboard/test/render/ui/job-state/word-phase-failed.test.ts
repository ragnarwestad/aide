// A step whose newest run ended failed reads Failed, over an earlier Done,
// and reads Done again once a later run completes.
import { describe, expect, test } from "bun:test";
import { wordPhase } from "../../../../src/render/ui/job-state";
import type { QueueRowView } from "../../../../src/render/ui/job-state";

const attemptOf = (state: string, ok: boolean, extra: Record<string, unknown> = {}) =>
  ({ state, results: [{ step: "analyze", ok, costUsd: 0 }], ...extra }) as unknown as QueueRowView;

describe("a failed newest run speaks for the phase", () => {
  test("a done phase whose newest attempt failed on its own step reads Failed, in the refused state (AC-1)", () => {
    const w = wordPhase(true, undefined, attemptOf("failed", false), { step: "analyze" });
    expect(w.badge).toEqual({ variant: "refused", label: "Failed" });
    expect(w.pip).toBe("refused");
  });

  test("a step that succeeded and whose merge failed keeps its Done (AC-1)", () => {
    const w = wordPhase(true, undefined, attemptOf("failed", true), { step: "analyze" });
    expect(w.badge?.label).toBe("Done");
  });

  test("a failed stop from history reads Failed, and says the model declined (AC-1)", () => {
    const w = wordPhase(false, undefined, undefined, { stopped: "model-refused", step: "analyze" });
    expect(w.badge).toEqual({ variant: "refused", label: "Failed" });
    expect(w.pip).toBe("refused");
    expect(w.qualifier).toContain("declined");
  });

  test("a stop at the time limit from history stays amber Stopped (AC-1)", () => {
    const w = wordPhase(false, undefined, undefined, { stopped: "timeout", step: "analyze" });
    expect(w.badge).toEqual({ variant: "waiting", label: "Stopped" });
  });

  test("a done attempt over an older failed one reads Done (AC-5)", () => {
    const w = wordPhase(true, undefined, attemptOf("done", true), { step: "analyze" });
    expect(w.badge).toEqual({ variant: "done", label: "Done" });
    expect(w.pip).toBe("past");
  });

  test("a done phase with no stop in history reads Done (AC-5)", () => {
    expect(wordPhase(true, undefined, undefined, { step: "analyze" }).badge?.label).toBe("Done");
  });
});
