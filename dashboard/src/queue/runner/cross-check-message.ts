import type { BoardMessage } from "../../i18n/message.ts";
import { stepButton } from "../../format/step-label.ts";
import type { WorkflowStep } from "../queue.ts";
import { sharedFiles, type StepOutcome } from "./types.ts";

/** The bash cross-check's verdicts (run-spec/record/status-line.sh,
 *  run-spec/turn/step-tests.sh) — a step that made `no-progress`, an
 *  implement or archive whose own test run came back red, or an archive
 *  that left its open merge unfinished, or a step whose model declined to
 *  continue — as the board's own message for the step it was about,
 *  so the row reads it in the reader's language rather than in the
 *  script's English. Every other failure keeps the sentence the script
 *  wrote. */
export function noProgressMessage(step: WorkflowStep, outcome: Partial<StepOutcome>): BoardMessage | undefined {
  if (outcome.terminalReason === "model-refused") {
    return { key: "runner.modelRefused", values: { button: stepButton(step) } };
  }
  if (outcome.terminalReason === "tests-red" && step === "implement") {
    return { key: "runner.testsRedImplement", values: { button: stepButton(step) } };
  }
  if (outcome.terminalReason === "tests-red" && step === "archive") {
    return { key: "runner.testsRedArchive", values: { button: stepButton(step) } };
  }
  if (outcome.terminalReason === "merge-unfinished" && step === "archive") {
    return { key: "runner.mergeUnfinishedArchive", values: { button: stepButton(step) } };
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

/** An analyze stopped on the project's acceptance criteria checks, as the
 *  board's own sentence naming each fault by kind. Undefined when the
 *  result sorted none (`criteriaFaults`, run-spec/record/criteria-check.sh):
 *  the runner's own sentence then carries the plan review's words. */
export function criteriaStopMessage(step: WorkflowStep, outcome: Partial<StepOutcome>): BoardMessage | undefined {
  if (outcome.terminalReason !== "acceptance-criteria") return undefined;
  const raw = outcome.criteriaFaults;
  if (raw === null || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const ids = (v: unknown): string =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "").join(", ") : "";
  const faults: BoardMessage[] = [];
  if (r.missing === true) faults.push({ key: "runner.criteriaMissing" });
  if (ids(r.notEars)) faults.push({ key: "runner.criteriaNotEars", values: { ids: ids(r.notEars) } });
  if (ids(r.noScenario)) faults.push({ key: "runner.criteriaNoScenario", values: { ids: ids(r.noScenario) } });
  if (ids(r.contradictions)) faults.push({ key: "runner.criteriaContradiction", values: { ids: ids(r.contradictions) } });
  if (ids(r.cannotBuild)) faults.push({ key: "runner.criteriaCannotBuild", values: { ids: ids(r.cannotBuild) } });
  if (!faults.length) return undefined;
  return { key: "runner.criteriaStopped", values: { button: stepButton(step) }, inner: faults };
}

/** An analyze stopped on files other open specs also change, as the
 *  board's own sentence naming each spec and the files it shares.
 *  Undefined when the result lists no spec: the runner's own sentence
 *  then stands. */
export function sharedFilesStopMessage(step: WorkflowStep, outcome: Partial<StepOutcome>): BoardMessage | undefined {
  if (outcome.terminalReason !== "shared-files") return undefined;
  const specs = sharedFiles(outcome.sharedFiles);
  if (!specs) return undefined;
  const inner: BoardMessage[] = specs.map((s) => ({
    key: "runner.sharedFilesSpec",
    values: { spec: s.spec, files: s.files.join(", ") },
  }));
  return { key: "runner.sharedFilesStopped", values: { button: stepButton(step) }, inner };
}

/** The board's sentence for a run that stopped on a check of the spec
 *  itself — the acceptance criteria or the files other open specs share. */
export const runStopMessage = (step: WorkflowStep, outcome: Partial<StepOutcome>): BoardMessage | undefined =>
  criteriaStopMessage(step, outcome) ?? sharedFilesStopMessage(step, outcome);
