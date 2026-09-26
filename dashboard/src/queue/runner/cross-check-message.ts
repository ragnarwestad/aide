import type { BoardMessage } from "../../i18n/message.ts";
import { stepButton } from "../../format/step-label.ts";
import type { WorkflowStep } from "../queue.ts";
import type { StepOutcome } from "./types.ts";

/** The bash cross-check's verdicts (run-spec-status-line.sh,
 *  run-spec-step-tests.sh) — a step that made `no-progress`, an
 *  implement or archive whose own test run came back red, or an archive
 *  that left its open merge unfinished — as the board's own message for the step it was about,
 *  so the row reads it in the reader's language rather than in the
 *  script's English. Every other failure keeps the sentence the script
 *  wrote. */
export function noProgressMessage(step: WorkflowStep, outcome: Partial<StepOutcome>): BoardMessage | undefined {
  if (outcome.terminalReason === "tests-red" && step === "implement") {
    return { key: "runner.testsRedImplement", values: { button: stepButton(step) } };
  }
  if (outcome.terminalReason === "tests-red" && step === "archive") {
    return { key: "runner.testsRedArchive", values: { button: stepButton(step) } };
  }
  if (outcome.terminalReason === "merge-unfinished" && step === "archive") {
    return { key: "runner.mergeUnfinishedArchive", values: { button: stepButton(step) } };
  }
  if (step === "schedule" && outcome.terminalReason === "scope-violation") {
    return { key: "runner.scheduleChangedRepository" };
  }
  if (step === "wiki" && outcome.terminalReason === "scope-violation") {
    return { key: "runner.wikiWroteOutsideItsScope" };
  }
  if (outcome.terminalReason !== "no-progress") return undefined;
  if (step === "wiki") return { key: "runner.wikiBuildUnfinished" };
  if (step === "archive") return { key: "runner.noProgressArchive", values: { button: stepButton(step) } };
  if (step === "implement") return { key: "runner.noProgressImplement", values: { button: stepButton(step) } };
  return undefined;
}

/** The outcome as the failure's detail should see it. A `no-progress`
 *  ending's own sentence says exactly what the board's message says, in
 *  English, so it is dropped rather than kept behind a "(?)" that only
 *  repeats the row. A red test run's sentence is kept: it carries the
 *  failing lines. */
export function withoutRestatedError<T extends { terminalReason?: string; error?: unknown }>(outcome: T): T {
  return outcome.terminalReason === "no-progress" ? { ...outcome, error: undefined } : outcome;
}
