import type { BoardMessage, Sentence } from "../../i18n/message.ts";
import { stepButton } from "../../format/step-label.ts";
import type { WorkflowStep } from "../queue.ts";
import { specNumber } from "../../project/spec-folder.ts";
import { toolLabel } from "../../format/tool-failure.ts";
import { providerError, sharedFiles, testsNotStarted, testsRed, timeLimit, type StepOutcome } from "./types.ts";

/** The bash cross-check's verdicts (run-spec/record/status-line.sh,
 *  run-spec/turn/step-tests.sh) — a step that made `no-progress`, an
 *  implement or archive whose own test run came back red, or an archive
 *  that left its open merge unfinished, or a step whose model declined to
 *  continue — as the board's own message for the step it was about,
 *  so the row reads it in the reader's language rather than in the
 *  script's English. Every other failure keeps the sentence the script
 *  wrote. */
export function noProgressMessage(step: WorkflowStep, outcome: Partial<StepOutcome>): Sentence | undefined {
  // A deploy runs in the board's own process, which words its failure itself.
  if (step === "deploy" && !outcome.ok) return outcome.sentence;
  if (outcome.terminalReason === "model-refused") {
    return { key: "runner.modelRefused", values: { button: stepButton(step) } };
  }
  if (outcome.terminalReason === "tests-red" && step === "implement") {
    return testsRedMessage(step, outcome);
  }
  if (outcome.terminalReason === "tests-not-started") return testsNotStartedMessage(step, outcome);
  if (outcome.terminalReason === "tests-red" && step === "archive") {
    return { key: "runner.testsRedArchive", values: { button: stepButton(step) } };
  }
  if (outcome.terminalReason === "merge-unfinished" && step === "archive") {
    return { key: "runner.mergeUnfinishedArchive", values: { button: stepButton(step) } };
  }
  if (outcome.terminalReason === "merge-unfinished" && step === "implement") {
    return { key: "runner.mergeUnfinishedImplement", values: { button: stepButton(step) } };
  }
  if (outcome.terminalReason === "scope-violation" && outcome.scopeViolation === "specs") {
    return { key: "runner.scopeSpecs", values: { button: stepButton(step) } };
  }
  if (outcome.terminalReason === "scope-violation" && outcome.scopeViolation === "analyze") {
    return { key: "runner.scopeAnalyze", values: { button: stepButton(step) } };
  }
  if (outcome.terminalReason === "short-analysis-over-limit") {
    return { key: "runner.shortAnalysisOverLimit", values: { button: stepButton(step) } };
  }
  if (outcome.terminalReason === "sent-back-refused") {
    return { key: "runner.sentBackRefused", values: { button: stepButton(step), analyze: stepButton("analyze") } };
  }
  if (outcome.terminalReason !== "no-progress") return undefined;
  if (step === "archive") return { key: "runner.noProgressArchive", values: { button: stepButton(step) } };
  if (step === "implement") return { key: "runner.noProgressImplement", values: { button: stepButton(step) } };
  if (step === "create") return { key: "runner.noProgressCreate", values: { button: stepButton(step) } };
  return undefined;
}

/** A red implement run names tests that remain red separately from tests
 *  that passed when their files were run again alone. */
export function testsRedMessage(step: WorkflowStep, outcome: Partial<StepOutcome>): BoardMessage {
  const button = stepButton(step);
  const red = testsRed(outcome.testsRed);
  if (!red) return { key: "runner.testsRedImplement", values: { button } };
  const list = (names: string[], count: number): string =>
    [...names, ...(count > names.length ? ["…"] : [])].join("; ");
  const tests = list(red.tests, red.failed);
  const counted = red.total !== undefined;
  const n = String(red.failed);
  const values = { tests, button, ...(counted ? { n, total: String(red.total) } : {}) };
  if (red.passedAloneCount === 0) {
    return { key: counted ? "runner.testsRedFailing" : "runner.testsRedFailingUncounted", values };
  }
  const k = String(red.passedAloneCount);
  const passed = list(red.passedAlone, red.passedAloneCount);
  if (red.failed === 0) return { key: "runner.testsRedPassedAlone", values: { k, passed, button } };
  return {
    key: counted ? "runner.testsRedFailingPassedAlone" : "runner.testsRedFailingPassedAloneUncounted",
    values: { ...values, k, passed },
  };
}

/** A test run that never started, as the board's sentence naming what
 *  stopped it: a port and who holds it, a server that did not answer in
 *  time, one that exited, or a recorder that did not run them. A cause the result does not carry gets the
 *  sentence that says only that the tests did not start. */
export function testsNotStartedMessage(step: WorkflowStep, outcome: Partial<StepOutcome>): Sentence {
  const button = stepButton(step);
  const cause = testsNotStarted(outcome.testsNotStarted);
  if (cause?.kind === "test-command-unresolved") return { key: "runner.testsNotStartedCommand", values: { button } };
  if (
    cause &&
    (cause.kind === "port-in-use" || cause.kind === "server-timeout" || cause.kind === "server-exited") &&
    cause.command &&
    cause.line
  ) {
    return { key: "runner.testsNotStartedServer", values: { command: cause.command, line: cause.line, button } };
  }
  if (cause?.kind === "port-in-use") {
    const port = String(cause.port);
    if (cause.holder?.spec) {
      return { key: "runner.testsNotStartedPortSpec", values: { port, spec: specNumber(cause.holder.spec), button } };
    }
    if (cause.holder) {
      return {
        key: "runner.testsNotStartedPortProcess",
        values: { port, command: cause.holder.command ?? "?", pid: String(cause.holder.pid), button },
      };
    }
    return { key: "runner.testsNotStartedPort", values: { port, button } };
  }
  if (cause?.kind === "server-timeout" && cause.ms !== undefined) {
    return { key: "runner.testsNotStartedTimeout", values: { seconds: String(Math.round(cause.ms / 1000)), button } };
  }
  if (cause?.kind === "server-exited") return { key: "runner.testsNotStartedExited", values: { button } };
  if (cause?.kind === "spec-folder-missing") {
    return { key: "runner.testsNotStartedNoSpecFolder", values: { folder: cause.folder, button } };
  }
  if (cause?.kind === "recorder-failed") {
    return { key: "runner.testsNotStartedRecorder", values: { reason: cause.error, button } };
  }
  return { key: "runner.testsNotStarted", values: { button } };
}

/** The outcome as the failure's detail should see it. A `no-progress`
 *  ending's own sentence says exactly what the board's message says, in
 *  English, so it is dropped rather than kept behind a "(?)" that only
 *  repeats the row — except a create's, which names the folder it looked
 *  for and where. A red test run's sentence is kept: it carries the
 *  failing lines. */
export function withoutRestatedError<T extends { terminalReason?: string; error?: unknown }>(outcome: T, step?: WorkflowStep): T {
  return outcome.terminalReason === "no-progress" && step !== "create" ? { ...outcome, error: undefined } : outcome;
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

/** A step the provider had no room for: the board's sentence naming the
 *  model the step ran on. Undefined without one: the runner's own
 *  sentence then stands. */
export function modelAtCapacityMessage(
  step: WorkflowStep,
  outcome: Partial<StepOutcome>,
  model: string | undefined,
): BoardMessage | undefined {
  if (outcome.terminalReason !== "model-at-capacity" || !model) return undefined;
  return { key: "runner.modelAtCapacity", values: { button: stepButton(step), model } };
}

/** The board's sentence for a run that stopped on a check of the spec
 *  itself — the acceptance criteria or the files other open specs share —
 *  or on a model the provider had no room for. */
export const runStopMessage = (step: WorkflowStep, outcome: Partial<StepOutcome>, model?: string): BoardMessage | undefined =>
  criteriaStopMessage(step, outcome) ??
  sharedFilesStopMessage(step, outcome) ??
  modelAtCapacityMessage(step, outcome, model) ??
  timeLimitMessage(step, outcome) ??
  sentBackMessage(step, outcome);

/** A step that sent its spec back to a full analysis: the board queues the
 *  Analyze round itself (`runner-setup.ts`). The step's own reason is the
 *  runner's English, behind the (?). */
export function sentBackMessage(step: WorkflowStep, outcome: Partial<StepOutcome>): BoardMessage | undefined {
  if (outcome.terminalReason !== "sent-back") return undefined;
  return { key: "runner.sentBack", values: { button: stepButton(step), analyze: stepButton("analyze") } };
}

/** A step stopped at its own time limit, as the board's sentence naming the
 *  limit and where it ran out: in the session, or in the runner's own run
 *  of the tests. In whole minutes, the unit Settings sets it in, else in
 *  seconds. Undefined when the result names no limit: the runner's own
 *  sentence then stands. */
export function timeLimitMessage(step: WorkflowStep, outcome: Partial<StepOutcome>): BoardMessage | undefined {
  if (outcome.terminalReason !== "timeout") return undefined;
  const limit = timeLimit(outcome.timeLimit);
  if (!limit) return undefined;
  const words = limit.seconds % 60 === 0 ? `${limit.seconds / 60} min` : `${limit.seconds} s`;
  return {
    key: limit.during === "tests" ? "runner.timeLimitTests" : "runner.timeLimitSession",
    values: { button: stepButton(step), limit: words },
  };
}

/** A step whose AI tool failed (`cli-error`), as the board's sentence for
 *  the error the runner sorted out of the provider's own words: the tool
 *  is not logged in on the machine that runs Aide, the provider's own side
 *  failed, or the error's own first line. Undefined when the runner sorted
 *  none, or the tool has no Settings tab to name: the sentence in
 *  `src/format/tool-failure.ts` then stands. */
export function cliErrorMessage(step: WorkflowStep, outcome: Partial<StepOutcome>): Sentence | undefined {
  if (outcome.terminalReason !== "cli-error") return undefined;
  const said = providerError(outcome.providerError);
  const tool = toolLabel(outcome.tool);
  if (!said || !tool) return undefined;
  const button = stepButton(step);
  if (said.kind === "silent") return { key: "runner.cliErrorSilent", values: { tool, button } };
  if (said.kind === "login") return { key: "runner.cliErrorLogin", values: { tool, cause: said.message, button } };
  if (said.kind === "forbidden") return { key: "runner.cliErrorForbidden", values: { tool, cause: said.message, button } };
  if (said.kind === "network") return { key: "runner.cliErrorNetwork", values: { tool, cause: said.message, button } };
  if (said.kind === "provider") return { key: "runner.cliErrorProvider", values: { tool, cause: said.message, button } };
  return { key: "runner.cliErrorOther", values: { tool, cause: said.message, button } };
}
