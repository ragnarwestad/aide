import type { BoardMessage } from "../../i18n/message.ts";
import { stepButton } from "../../format/step-label.ts";
import type { WorkflowStep } from "../queue.ts";
import type { StepOutcome } from "./types.ts";

/** The bash cross-check's verdicts (run-spec-status-line.sh,
 *  run-spec-step-tests.sh) — a step that made `no-progress`, an
 *  implement whose own test run came back red, or an archive that left
 *  its open merge unfinished — as the board's own message for the step it was about,
 *  so the row reads it in the reader's language rather than in the
 *  script's English. Every other failure keeps the sentence the script
 *  wrote. */
export function noProgressMessage(step: WorkflowStep, outcome: Partial<StepOutcome>): BoardMessage | undefined {
  if (outcome.terminalReason === "tests-red" && step === "implement") {
    return { key: "runner.testsRedImplement", values: { button: stepButton(step) } };
  }
  if (outcome.terminalReason === "merge-unfinished" && step === "archive") {
    return { key: "runner.mergeUnfinishedArchive", values: { button: stepButton(step) } };
  }
  if (outcome.terminalReason !== "no-progress") return undefined;
  if (step === "archive") return { key: "runner.noProgressArchive", values: { button: stepButton(step) } };
  if (step === "implement") return { key: "runner.noProgressImplement", values: { button: stepButton(step) } };
  return undefined;
}
