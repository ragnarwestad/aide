// A step whose newest run ended failed reads Failed, over an earlier Done,
// and reads Done again once a later run completes.
import { describe, expect, test } from "bun:test";
import { wordPhase } from "../../../../src/render/ui/job-state";
import type { QueueRowView } from "../../../../src/render";
import { formatSentence, withoutStepFailed } from "../../../../src/messages/format.ts";
import type { BoardMessage, Sentence } from "../../../../src/messages/types.ts";
import { getJobMessage } from "../../../../src/messages/jobs/get.ts";
import {
  getCriteriaStopMessage, getModelAtCapacityMessage, getNoProgressMessage, getSentBackMessage,
} from "../../../../src/messages/jobs/outcomes.ts";

const said = (w: ReturnType<typeof wordPhase>): string | undefined => formatSentence("en", w.qualifier);

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
    expect(said(w)).toContain("declined");
  });

  test("a stop at the time limit from history reads Failed", () => {
    const w = wordPhase(false, undefined, undefined, { stopped: "timeout", step: "analyze" });
    expect(w.badge).toEqual({ variant: "refused", label: "Failed" });
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

describe("an analyze stopped on files another open spec changes", () => {
  test("reads Failed from history, in a sentence rather than the raw token", () => {
    const w = wordPhase(false, undefined, undefined, { stopped: "shared-files", step: "analyze" });
    expect(w.badge).toEqual({ variant: "refused", label: "Failed" });
    expect(said(w)).toBeDefined();
    expect(said(w)).not.toContain("shared-files");
  });
});

describe("an implement sent back to a full analysis", () => {
  test("one refused, because its analysis was already full, reads Failed in a sentence of its own", () => {
    const w = wordPhase(false, undefined, undefined, { stopped: "sent-back-refused", step: "implement" });
    expect(w.badge).toEqual({ variant: "refused", label: "Failed" });
    expect(said(w)).toBeDefined();
    expect(said(w)).not.toContain("sent-back-refused");
    expect(said(w)).not.toBe(said(wordPhase(false, undefined, undefined, { stopped: "sent-back", step: "implement" })));
  });
});

// The spec page and Jobs word the same stop of a step alike: the job's own
// sentence when the attempt's result for the step ended the same way, else
// the sentence the runner builds for it from what the attempt records.
const stopped = (step: string, reason: string, error?: Sentence, extra: Partial<QueueRowView> = {}) =>
  ({
    id: "job-1", state: "failed", steps: [step], stepIndex: 0, model: "opus", error,
    results: [{ step, ok: false, costUsd: 0, terminalReason: reason }], ...extra,
  }) as unknown as QueueRowView;
const innerOf = (w: ReturnType<typeof wordPhase>) => (w.qualifier as BoardMessage).inner;
const specPage = (step: string, reason: string, attempt?: QueueRowView) =>
  wordPhase(false, undefined, attempt, { stopped: reason, step });

describe("the four outcomes Jobs and the spec page share", () => {
  test("a model at capacity reads the job's own sentence, model named (AC-1, AC-2)", () => {
    const error = getModelAtCapacityMessage("analyze", { terminalReason: "model-at-capacity" }, "opus")!;
    const attempt = stopped("analyze", "model-at-capacity", error);
    const w = specPage("analyze", "model-at-capacity", attempt);
    expect(innerOf(w)).toEqual(error);
    expect(said(w)).toContain("opus");
    expect(said(w)).toContain(formatSentence("en", error)!.split("\n")[1]!);
    expect(getJobMessage(attempt, "en")?.text).toBe(formatSentence("en", error));
  });

  test("a model at capacity with no stored sentence is built from the attempt's model (AC-1)", () => {
    const w = specPage("analyze", "model-at-capacity", stopped("analyze", "model-at-capacity", undefined, { stepModels: { analyze: "sonnet" } }));
    expect(innerOf(w)).toEqual(getModelAtCapacityMessage("analyze", { terminalReason: "model-at-capacity" }, "sonnet"));
  });

  test("an acceptance-criteria stop lists the faults the job recorded (AC-1, AC-2)", () => {
    const error = getCriteriaStopMessage("analyze", { terminalReason: "acceptance-criteria", criteriaFaults: { notEars: ["AC-2"] } })!;
    const w = specPage("analyze", "acceptance-criteria", stopped("analyze", "acceptance-criteria", error));
    expect(innerOf(w)).toEqual(error);
    expect(said(w)).toContain(formatSentence("en", error)!.split("\n")[0]!.replace(/^Problem: /, ""));
  });

  test("a short analysis over a limit reads Jobs' sentence, without its step-failed lead (AC-1)", () => {
    const own = getNoProgressMessage("analyze", { terminalReason: "short-analysis-over-limit" })!;
    const error: Sentence = { key: "runner.stepFailed", values: { step: "analyze", button: "Analyze" }, inner: own };
    const w = specPage("analyze", "short-analysis-over-limit", stopped("analyze", "short-analysis-over-limit", error));
    expect(innerOf(w)).toEqual(withoutStepFailed(error));
  });

  test("a sent-back implement reads the runner's sentence (AC-1)", () => {
    const error = getSentBackMessage("implement", { terminalReason: "sent-back" })!;
    const w = specPage("implement", "sent-back", stopped("implement", "sent-back", error));
    expect(innerOf(w)).toEqual(error);
  });

  test("an attempt whose result ended another way does not lend its sentence (AC-1)", () => {
    const attempt = stopped("analyze", "timeout", "the step timed out");
    expect(innerOf(specPage("analyze", "sent-back", attempt))).not.toEqual("the step timed out");
  });

  test("with no attempt, each reads the same advice Jobs gives (AC-1)", () => {
    const solution = (s: Sentence | undefined) => formatSentence("en", s)!.split("\n")[1];
    const capacity = getModelAtCapacityMessage("analyze", { terminalReason: "model-at-capacity" }, "opus");
    expect(said(specPage("analyze", "model-at-capacity"))!.split("\n")[1]).toBe(solution(capacity));
    const criteria = getCriteriaStopMessage("analyze", { terminalReason: "acceptance-criteria", criteriaFaults: { missing: true } });
    expect(said(specPage("analyze", "acceptance-criteria"))!.split("\n")[1]).toBe(solution(criteria));
    expect(innerOf(specPage("analyze", "short-analysis-over-limit"))).toEqual(
      getNoProgressMessage("analyze", { terminalReason: "short-analysis-over-limit" }));
    expect(innerOf(specPage("implement", "sent-back"))).toEqual(getSentBackMessage("implement", { terminalReason: "sent-back" }));
  });
});

describe("the four shared outcomes from history alone", () => {
  test.each([
    ["analyze", "acceptance-criteria"], ["analyze", "short-analysis-over-limit"],
    ["analyze", "model-at-capacity"], ["implement", "sent-back"],
  ])("%s stopped on %s reads Failed, in a sentence rather than the raw token", (step, reason) => {
    const w = specPage(step, reason);
    expect(w.badge).toEqual({ variant: "refused", label: "Failed" });
    expect(said(w)).toBeDefined();
    expect(said(w)).not.toContain(reason);
  });
});

describe("an outcome the board follows with a full analysis", () => {
  test("a sent-back implement names what runs next, as information on both views (AC-3)", () => {
    const error = getSentBackMessage("implement", { terminalReason: "sent-back" })!;
    const jobs = formatSentence("en", error)!;
    expect(jobs).not.toStartWith("Problem:");
    expect(jobs).toContain("Analyze");
    expect(jobs).toContain("Implement");
    expect(said(specPage("implement", "sent-back", stopped("implement", "sent-back", error)))).not.toContain("Problem:");
  });

  test("a short analysis over a limit names the full Analyze that runs next, as information on both views (AC-3)", () => {
    const own = getNoProgressMessage("analyze", { terminalReason: "short-analysis-over-limit" })!;
    const jobs = formatSentence("en", own)!;
    expect(jobs).not.toStartWith("Problem:");
    expect(jobs).toContain("Analyze");
    expect(said(specPage("analyze", "short-analysis-over-limit"))).not.toContain("Problem:");
  });
});
