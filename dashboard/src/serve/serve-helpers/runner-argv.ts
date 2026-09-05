// Resolving a job's per-step timeout, permission mode and model, and
// building the argv `aide-run-spec` is started with from them. Split
// out of serve-helpers.ts by theme (split serve-helpers.ts by theme).

import type { Job, ModelChoice } from "../../queue/queue.ts";

/** This step's wall clock. The field is a per-step table since spec 152,
 *  but a job created before that change is still in the store across the
 *  deploy carrying a bare number — read as an index that would hand the
 *  runner the string "undefined" as its deadline. A transitional read
 *  for jobs already in flight, not a dual-format feature.
 *
 *  `live` is the config's own table, and it is what actually answers for
 *  a step ticked onto a running job's tail (spec 160): `parseJobRequest`
 *  resolves the config's `default` into a concrete entry for each step
 *  the request named, so a job's own table carries no `default` key of
 *  its own and a step added afterwards has no entry in it at all. The
 *  `t.default` branch below is kept for a job hand-written with one, not
 *  because any job the queue produces has it (spec 177). */
export function resolveTimeoutSec(t: Job["timeoutSec"], step: string, live: Record<string, number>): number {
  if (typeof t === "number") return t;
  return t[step] ?? t.default ?? live[step] ?? live.default!;
}

/** The same read for the other two per-step tables (spec 177). Named
 *  and exported rather than inlined at each site, so the argv the runner
 *  is started with and the values the row and the job page SHOW cannot
 *  answer the question differently. */
export function resolveStepPermissionMode(job: Job, step: string, live: Record<string, string>): string {
  // The `acceptEdits` literal stays last, so the function is total
  // without asserting on config shape — unreachable in practice, since
  // every path that builds a `QueueDefaults` carries a `default`.
  return job.permissionMode[step] ?? live[step] ?? live.default ?? "acceptEdits";
}

/** A whole-job model pick wins over the config's per-step default: at
 *  creation `parseJobRequest` copies `modelChoice` into EVERY step's own
 *  entry, so a step added later has to match its siblings rather than
 *  fall through to whatever the config says for that step alone. */
export function resolveStepModel(job: Job, step: string, live: Record<string, string>): string | undefined {
  return job.model[step] ?? job.modelChoice ?? live[step] ?? live.default;
}

/** The effort level a step runs at (spec 364) — `job.effort[step]` and
 *  nothing else. No config-default tier, unlike `resolveStepModel`'s
 *  four: there is nothing for a config to grant per level (2-analysis.md,
 *  "Config-vs-code precedence tables are for THINGS THAT COST MONEY"),
 *  and REQ-4 requires "unset" to stay a real, reachable answer. */
export function resolveStepEffort(job: Job, step: string): string | undefined {
  return job.effort?.[step];
}

/** The argv `aide-run-spec` is started with. Extracted so it can be read
 *  in a test: an unattended run's arguments are the whole contract, and
 *  a wrong one is a job that does the wrong thing with nobody watching. */
export function runnerArgv(
  job: Job,
  step: string,
  resultFile: string,
  o: {
    runnerBin: string;
    /** The checkout the step runs in, resolved by the caller. Since
     *  spec 205 that is the clone the DASHBOARD owns, and this function
     *  knows no path convention that could send it anywhere else. */
    projectDir: string;
    push: string;
    /** The file a `schedule` step's prompt is read from, relative to the
     *  project root (spec 259). Meaningless, and omitted, for every
     *  other step — `aide-run-spec` only ever reads `--prompt-file` for
     *  `--command schedule`. */
    promptFile?: string;
    /** The config's own table (spec 125). What a job stores per step is
     *  a NAME the request picked; what the CLI is handed — which tool,
     *  which model string — is looked up here, where the grants
     *  already live. */
    modelChoices?: Record<string, ModelChoice>;
    /** The config's three per-step tables, live (spec 177). What answers
     *  for a step the job's own tables never named — a phase ticked onto
     *  a running job's tail after the job was created. */
    timeoutSec?: Record<string, number>;
    permissionMode?: Record<string, string>;
    model?: Record<string, string>;
    /** Whether `analyze`'s own invocation should be told acceptance
     *  ticking is not required (spec 394) — resolved by the caller from
     *  a fresh read of the spec's own record, never from `job` itself.
     *  Meaningless, and ignored, for every step but `analyze`. */
    acceptanceNotRequiredForAnalyze?: boolean;
  },
  sessionId?: string,
  streamFile?: string,
): string[] {
  const choiceName = resolveStepModel(job, step, o.model ?? {});
  const choice = choiceName ? o.modelChoices?.[choiceName] : undefined;
  // The entry's own key stays the model unless the entry says otherwise
  // — which is exactly what every config written before this spec did.
  const model = choice?.model ?? choiceName;
  const tool = choice?.tool ?? "claude";
  const effort = resolveStepEffort(job, step);
  return [
    o.runnerBin,
    "--project-dir", o.projectDir,
    "--command", step,
    "--spec", job.specFolder,
    "--budget-usd", String(job.budgetUsd),
    "--timeout-sec", String(resolveTimeoutSec(job.timeoutSec, step, o.timeoutSec ?? {})),
    "--permission-mode", resolveStepPermissionMode(job, step, o.permissionMode ?? {}),
    "--result-file", resultFile,
    "--push", o.push,
    "--pull",
    // Only a `create` job has these, and it cannot run without them:
    // its `--spec` is a provisional key, not a folder on disk, so the
    // title and the description are the whole of what the step is for.
    ...(job.createTitle ? ["--title", job.createTitle] : []),
    ...(job.createDescription ? ["--description", job.createDescription] : []),
    // What the new spec builds on (spec 110): ONE flag, comma-joined,
    // because that is the shape the `Depends on:` line itself has on
    // disk — nothing downstream has to rejoin a list.
    ...(job.createDependsOn?.length ? ["--depends-on", job.createDependsOn.join(",")] : []),
    // Spec 386 introduced this as a whole-job field, read by
    // `aide-run-spec` for the `analyze` step alone; spec 394 narrows the
    // JOB field itself to `create`'s own invocation (REQ-8) — a second
    // job queued later for the same spec has no checkbox to carry it,
    // and `analyze` instead reads a fresh file read the caller resolves
    // into `acceptanceNotRequiredForAnalyze` below.
    ...(step === "create" && job.acceptanceNotRequired ? ["--acceptance-not-required"] : []),
    ...(step === "analyze" && o.acceptanceNotRequiredForAnalyze ? ["--acceptance-not-required"] : []),
    // Only a `schedule` step has this, and cannot run without it: its
    // `--spec` is a tracking key, never a folder on disk, so the file
    // is the whole of what the step is for.
    ...(o.promptFile ? ["--prompt-file", o.promptFile] : []),
    ...(model ? ["--model", model] : []),
    // Only when the job actually named one for this step (REQ-4): a job
    // with nothing chosen produces byte-for-byte the argv it produced
    // before this flag existed. `aide-run-spec` itself drops the flag
    // silently for `--tool codex` (no branch needed here).
    ...(effort ? ["--effort", effort] : []),
    // Only when it says something new. `aide-run-spec` defaults to
    // claude, so a choice that names no tool must produce byte-for-byte
    // the argv it produced before this flag existed — the same shape
    // `--model` itself has had all along.
    ...(tool !== "claude" ? ["--tool", tool] : []),
    // Chosen by the runner BEFORE the spawn, so the queue can watch the
    // session while the step runs instead of learning it from a result
    // that only exists once the step is over.
    ...(sessionId ? ["--session-id", sessionId] : []),
    ...(streamFile ? ["--stream-file", streamFile] : []),
  ];
}
