// A step whose newest run ended failed reads Failed, over an earlier Done,
// and reads Done again once a later run completes.
import { describe, expect, test } from "bun:test";
import { wordPhase } from "../../../../src/render/ui/job-state";
import type { QueueRowView } from "../../../../src/render";

const attemptOf = (state: string, ok: boolean, extra: Record<string, unknown> = {}) =>
  ({ state, results: [{ step: "analyze", ok, costUsd: 0 }], ...extra }) as unknown as QueueRowView;

describe("a failed newest run speaks for the phase", () => {
  test("a done phase whose newest attempt failed on its own step reads Failed, in the refused state", () => {
    const w = wordPhase(true, undefined, attemptOf("failed", false), { step: "analyze" });
    expect(w.badge).toEqual({ variant: "refused", label: "Failed" });
    expect(w.pip).toBe("refused");
  });

  test("a step that succeeded and whose merge failed keeps its Done", () => {
    const w = wordPhase(true, undefined, attemptOf("failed", true), { step: "analyze" });
    expect(w.badge?.label).toBe("Done");
  });

  test("a failed stop from history reads Failed, and says the model declined", () => {
    const w = wordPhase(false, undefined, undefined, { stopped: "model-refused", step: "analyze" });
    expect(w.badge).toEqual({ variant: "refused", label: "Failed" });
    expect(w.pip).toBe("refused");
    expect(w.qualifier).toContain("declined");
  });

  test("a stop at the time limit from history stays amber Stopped", () => {
    const w = wordPhase(false, undefined, undefined, { stopped: "timeout", step: "analyze" });
    expect(w.badge).toEqual({ variant: "waiting", label: "Stopped" });
  });

  test("a done attempt over an older failed one reads Done", () => {
    const w = wordPhase(true, undefined, attemptOf("done", true), { step: "analyze" });
    expect(w.badge).toEqual({ variant: "done", label: "Done" });
    expect(w.pip).toBe("past");
  });

  test("a done phase with no stop in history reads Done", () => {
    expect(wordPhase(true, undefined, undefined, { step: "analyze" }).badge?.label).toBe("Done");
  });
});

describe("an analyze stopped on its acceptance criteria", () => {
  test("reads amber Stopped from history, in a sentence rather than the raw token", () => {
    const w = wordPhase(false, undefined, undefined, { stopped: "acceptance-criteria", step: "analyze" });
    expect(w.badge).toEqual({ variant: "waiting", label: "Stopped" });
    expect(w.qualifier).toBeDefined();
    expect(w.qualifier).not.toContain("acceptance-criteria");
  });
});

describe("an analyze whose short analysis was over a limit", () => {
  test("reads Failed from history, in a sentence rather than the raw token", () => {
    const w = wordPhase(false, undefined, undefined, { stopped: "short-analysis-over-limit", step: "analyze" });
    expect(w.badge).toEqual({ variant: "refused", label: "Failed" });
    expect(w.qualifier).toBeDefined();
    expect(w.qualifier).not.toContain("short-analysis-over-limit");
  });
});

describe("an analyze stopped because the model was at capacity", () => {
  test("reads amber Stopped from history, in a sentence rather than the raw token", () => {
    const w = wordPhase(false, undefined, undefined, { stopped: "model-at-capacity", step: "analyze" });
    expect(w.badge).toEqual({ variant: "waiting", label: "Stopped" });
    expect(w.qualifier).toContain("at capacity");
    expect(w.qualifier).not.toContain("model-at-capacity");
  });
});

describe("an analyze stopped on files another open spec changes", () => {
  test("reads amber Stopped from history, in a sentence rather than the raw token", () => {
    const w = wordPhase(false, undefined, undefined, { stopped: "shared-files", step: "analyze" });
    expect(w.badge).toEqual({ variant: "waiting", label: "Stopped" });
    expect(w.qualifier).toBeDefined();
    expect(w.qualifier).not.toContain("shared-files");
  });
});

describe("an implement sent back to a full analysis", () => {
  test("reads amber Stopped from history, in a sentence rather than the raw token", () => {
    const w = wordPhase(false, undefined, undefined, { stopped: "sent-back", step: "implement" });
    expect(w.badge).toEqual({ variant: "waiting", label: "Stopped" });
    expect(w.qualifier).toBeDefined();
    expect(w.qualifier).not.toContain("sent-back");
  });

  test("one refused, because its analysis was already full, reads Failed in a sentence of its own", () => {
    const w = wordPhase(false, undefined, undefined, { stopped: "sent-back-refused", step: "implement" });
    expect(w.badge).toEqual({ variant: "refused", label: "Failed" });
    expect(w.qualifier).toBeDefined();
    expect(w.qualifier).not.toContain("sent-back-refused");
    expect(w.qualifier).not.toBe(wordPhase(false, undefined, undefined, { stopped: "sent-back", step: "implement" }).qualifier);
  });
});
