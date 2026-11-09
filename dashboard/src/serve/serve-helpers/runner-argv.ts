// Resolving a job's per-step timeout, permission mode and model, and
// building the argv `aide-run-spec` is started with from them. Split
// out of serve-helpers.ts by theme (split serve-helpers.ts by theme).

import { renderSentence } from "../../i18n/message.ts";
import type { Job, ModelChoice } from "../../queue/queue.ts";
import { resolveStepModel } from "../../queue/model-name.ts";
import { expandDir, providerLoginEnv, resolveStepProvider, runsModel, sharesSessions, type Provider } from "../../queue/providers/index.ts";
import { homedir } from "node:os";
import type { CheckableTool } from "../../render";
import { resolveSidePick, SIDE_PARTS } from "../../queue/providers/side-tools.ts";

/** This step's wall clock. The field is a per-step table,
 *  but a job created before that is still in the store across the
 *  deploy carrying a bare number — read as an index that would hand the
 *  runner the string "undefined" as its deadline. A transitional read
 *  for jobs already in flight, not a dual-format feature.
 *
 *  `live` is the config's own table, and it is what actually answers for
 *  a step ticked onto a running job's tail: `parseJobRequest`
 *  resolves the config's `default` into a concrete entry for each step
 *  the request named, so a job's own table carries no `default` key of
 *  its own and a step added afterwards has no entry in it at all. The
 *  `t.default` branch below is kept for a job hand-written with one, not
 *  because any job the queue produces has it. */
export function resolveTimeoutSec(t: Job["timeoutSec"], step: string, live: Record<string, number>): number {
  if (typeof t === "number") return t;
  return t[step] ?? t.default ?? live[step] ?? live.default!;
}

/** The same read for the other two per-step tables. Named
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
/** Which CLI a job's step runs on: its chosen model's tool, and claude
 *  when the choice names none. */
export function stepTool(
  job: Job,
  step: string,
  o: { model?: Record<string, string>; modelChoices?: Record<string, ModelChoice> },
): CheckableTool {
  const choiceName = resolveStepModel(job, step, o.model ?? {});
  return ((choiceName ? o.modelChoices?.[choiceName]?.tool : undefined) ?? "claude") as CheckableTool;
}

/** The independently chosen model for an implement's review and defect
 *  verification. A per-spec choice wins over Settings; no resolved choice
 *  leaves that part Off. */
export function reviewModelArgs(
  step: string,
  _tool: string,
  o: {
    model?: Record<string, string>; modelChoices?: Record<string, ModelChoice>; sidePicks?: Record<string, string>;
    sideProviders?: Record<string, string>; providers?: Record<string, Provider>; provider?: Record<string, string>; home?: string;
  },
): string[] {
  if (step !== "implement") return [];
  return SIDE_PARTS.flatMap((part) => {
    const name = resolveSidePick(part, o.sidePicks, o.model ?? {}, Object.keys(o.modelChoices ?? {}));
    if (!name) return [];
    const choice = o.modelChoices?.[name];
    const sideTool = choice?.tool ?? "claude";
    const ownProvider = o.sideProviders?.[part];
    const configuredProvider = o.provider?.[part];
    // A switched-off provider is passed over, as it is for a step's own
    // fallback: the review is best-effort and holds no step back.
    const usable = (key: string | undefined): key is string =>
      key !== undefined && o.providers?.[key] !== undefined && o.providers[key]!.enabled !== false;
    const providerKey = usable(ownProvider) ? ownProvider : (
      usable(configuredProvider) && runsModel(o.providers![configuredProvider]!, choice)
        ? configuredProvider
        : Object.entries(o.providers ?? {}).find(([, provider]) => provider.enabled !== false && runsModel(provider, choice))?.[0]
    );
    const provider = providerKey ? o.providers?.[providerKey] : undefined;
    const home = o.home ?? homedir();
    const env = provider ? providerLoginEnv(provider, home) : undefined;
    const account = sideTool === "claude" && env?.CLAUDE_CONFIG_DIR
      ? [`--${part}-claude-config-dir`, env.CLAUDE_CONFIG_DIR]
      : sideTool === "codex" && env?.CODEX_HOME ? [`--${part}-codex-home`, env.CODEX_HOME] : [];
    const bin = provider?.binary && sideTool !== "fake-claude" ? [`--${part}-bin`, expandDir(provider.binary, home)] : [];
    return [`--${part}-model`, choice?.model ?? name, `--${part}-tool`, sideTool, ...account, ...bin];
  });
}

/** How recent an analysis must be for its implement to continue its
 *  session: past that, the tool's cache of it is gone, and reading the
 *  whole session back at full price costs more than starting afresh. */
export const RESUME_ANALYSIS_WITHIN_MS = 60 * 60_000;

/** The session an implement continues: the latest finished analysis of the
 *  same spec, when it ran with the same AI the implement will and ended
 *  within the hour. When both name a provider, the two must share sessions:
 *  the same provider, or two Codex providers on one `CODEX_HOME`. Undefined
 *  means the implement starts afresh. */
export function analysisSessionToResume(
  job: Job,
  jobs: readonly Job[],
  tool: string,
  now: number,
  provider?: { key: string | undefined; providers: Record<string, Provider> | undefined },
): string | undefined {
  let latest: { sessionId?: string; tool?: string; at?: string; provider?: { key: string } } | undefined;
  for (const j of jobs) {
    if (j.project !== job.project || j.specFolder !== job.specFolder) continue;
    for (const r of j.results) {
      if (r.step !== "analyze" || !r.ok || !r.at) continue;
      if (!latest || r.at > (latest.at ?? "")) latest = r;
    }
  }
  if (!latest?.sessionId || (latest.tool ?? "claude") !== tool) return undefined;
  if (provider?.key && latest.provider && !sharesSessions(latest.provider.key, provider.key, provider.providers)) {
    return undefined;
  }
  return now - Date.parse(latest.at!) <= RESUME_ANALYSIS_WITHIN_MS ? latest.sessionId : undefined;
}

export { resolveStepModel };

/** The effort level a step runs at — `job.effort[step]` and
 *  nothing else. No config-default tier, unlike `resolveStepModel`'s
 *  four: there is nothing for a config to grant per level (2-analysis.md,
 *  "Config-vs-code precedence tables are for THINGS THAT COST MONEY"),
 *  and "unset" must stay a real, reachable answer. */
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
    /** The checkout the step runs in, resolved by the caller. It is
     *  the clone the DASHBOARD owns, and this function
     *  knows no path convention that could send it anywhere else. */
    projectDir: string;
    /** Where this project's spec folders live, in the checkout above —
     *  the dashboard's own answer (`machinerySpecsRoot`), handed over so
     *  the run makes a folder in the place the LANDING looks for it.
     *  Left out, `aide-run-spec` works it out from `.aide/config`, which
     *  is a file the dashboard writes itself: the two derivations
     *  disagreed on 2026-09-21 and a created spec fell between them.
     *  Undefined for a project whose specs the dashboard cannot resolve,
     *  where the script's own answer is still the best one available. */
    specsRoot?: string;
    push: string;
    /** The file a `schedule` step's prompt is read from, relative to the
     *  project root. Meaningless, and omitted, for every
     *  other step — `aide-run-spec` only ever reads `--prompt-file` for
     *  `--command schedule`. */
    promptFile?: string;
    /** Whether a `schedule` step asks for the logged-in Chrome (its
     *  entry's own `chrome`). Only ever true for that step. */
    chrome?: boolean;
    /** Whether a `schedule` step runs Claude without its sandbox (its
     *  entry's own `sandbox: false`). Only ever true for that step. */
    noSandbox?: boolean;
    /** The config's own table. What a job stores per step is
     *  a NAME the request picked; what the CLI is handed — which tool,
     *  which model string — is looked up here, where the grants
     *  already live. */
    modelChoices?: Record<string, ModelChoice>;
    /** The config's three per-step tables, live. What answers
     *  for a step the job's own tables never named — a phase ticked onto
     *  a running job's tail after the job was created. */
    timeoutSec?: Record<string, number>;
    permissionMode?: Record<string, string>;
    model?: Record<string, string>;
    /** The current spec's Review and Verify choices. */
    sidePicks?: Record<string, string>;
    /** The provider accounts chosen beside Review and Verify. */
    sideProviders?: Record<string, string>;
    /** The configured providers and the phase defaults' provider table: the
     *  folder a step's provider keeps its login in is looked up here. */
    providers?: Record<string, Provider>;
    provider?: Record<string, string>;
    /** The home directory `~/` is read against; the user's own by default. */
    home?: string;
    /** Whether `analyze`'s own invocation should be told acceptance
     *  ticking is not required — resolved by the caller from
     *  a fresh read of the spec's own record, never from `job` itself.
     *  Meaningless, and ignored, for every step but `analyze`. */
    acceptanceNotRequiredForAnalyze?: boolean;
    /** The analysis session an implement continues, when there is one. */
    resumeSession?: string;
  },
  sessionId?: string,
  streamFile?: string,
): string[] {
  const choiceName = resolveStepModel(job, step, o.model ?? {});
  const choice = choiceName ? o.modelChoices?.[choiceName] : undefined;
  // The entry's own key stays the model unless the entry says otherwise
  // — which is exactly what every config written before this spec did.
  const model = choice?.model ?? choiceName;
  const tool = stepTool(job, step, o);
  const effort = resolveStepEffort(job, step);
  return [
    o.runnerBin,
    "--project-dir", o.projectDir,
    "--project-name", job.project,
    ...(o.specsRoot ? ["--specs-root", o.specsRoot] : []),
    "--command", step,
    "--spec", job.specFolder,
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
    // Only a `close` job has this, exactly like the two above.
    ...(job.closeReason ? ["--reason", job.closeReason] : []),
    // What the new spec builds on: ONE flag, comma-joined,
    // because that is the shape the `Depends on:` line itself has on
    // disk — nothing downstream has to rejoin a list.
    ...(job.createDependsOn?.length ? ["--depends-on", job.createDependsOn.join(",")] : []),
    // The JOB field is for `create`'s own invocation alone — a second
    // job queued later for the same spec has no checkbox to carry it,
    // and `analyze` instead reads a fresh file read the caller resolves
    // into `acceptanceNotRequiredForAnalyze` below.
    ...(step === "create" && job.acceptanceNotRequired ? ["--acceptance-not-required"] : []),
    // Only a `create` job has this, and only when the New-spec
    // form's own "let AI formulate acceptance criteria" box was cleared
    // — absent produces byte-for-byte the argv every caller before this
    // flag existed already produces.
    ...(step === "create" && job.createNoAiFormulate ? ["--no-ai-formulate"] : []),
    // Only a `create` whose form chose a level: the runner records it in
    // the new spec's Tracking info, where analyze reads it.
    ...(step === "create" && job.createCriteriaChecks ? ["--criteria-checks", job.createCriteriaChecks] : []),
    // Every `create` from the form, ticked or not: the runner records
    // whether the new spec asks to choose between its approaches.
    ...(step === "create" && job.createChooseApproach !== undefined
      ? ["--choose-approach", job.createChooseApproach ? "yes" : "no"]
      : []),
    ...(step === "analyze" && o.acceptanceNotRequiredForAnalyze ? ["--acceptance-not-required"] : []),
    // Only a `reopen` job that asked for it — absent, the
    // runner keeps the analysis, the plan and the status.
    ...(step === "reopen" && job.resetFiles ? ["--reset-files"] : []),
    ...(step === "implement" && o.resumeSession ? ["--resume-session", o.resumeSession] : []),
    // Only a `schedule` step has this, and cannot run without it: its
    // `--spec` is a tracking key, never a folder on disk, so the file
    // is the whole of what the step is for.
    ...(o.promptFile ? ["--prompt-file", o.promptFile] : []),
    ...(o.chrome ? ["--chrome"] : []),
    ...(o.noSandbox ? ["--no-sandbox"] : []),
    ...(model ? ["--model", model] : []),
    // Only when the job actually named one for this step: a job
    // with nothing chosen produces byte-for-byte the argv it produced
    // before this flag existed. `aide-run-spec` itself drops the flag
    // silently for `--tool codex` (no branch needed here).
    ...(effort ? ["--effort", effort] : []),
    // Only when it says something new. `aide-run-spec` defaults to
    // claude, so a choice that names no tool must produce byte-for-byte
    // the argv it produced before this flag existed — the same shape
    // `--model` itself has had all along.
    ...(tool !== "claude" ? ["--tool", tool] : []),
    // The folder the step's provider keeps its login in, when it has one:
    // a provider on the tool's normal folder keeps byte-for-byte the argv
    // it had. A Codex step has no Claude turn, and a Claude review beside it
    // is left out (`reviewModelArgs`).
    ...providerFolderArgs(job, step, tool, o),
    ...reviewModelArgs(step, tool, o),
    // Chosen by the runner BEFORE the spawn, so the queue can watch the
    // session while the step runs instead of learning it from a result
    // that only exists once the step is over.
    ...(sessionId ? ["--session-id", sessionId] : []),
    ...(streamFile ? ["--stream-file", streamFile] : []),
  ];
}

/** `--claude-config-dir` for a Claude Code step whose provider has a config
 *  folder; `--codex-home` for a Codex step, the provider's shadow home when
 *  it has one, else its `CODEX_HOME`. Nothing for a provider on the tool's
 *  normal folder, or for a step with no provider. Then `--bin` for a
 *  provider with a binary path, and `--autocompact` for a Claude Code one
 *  with a threshold. */
function providerFolderArgs(
  job: Job,
  step: string,
  tool: string,
  o: Pick<Parameters<typeof runnerArgv>[3], "model" | "modelChoices" | "providers" | "provider" | "home">,
): string[] {
  const key = resolveStepProvider(job, step, { model: o.model ?? {}, modelChoices: o.modelChoices, providers: o.providers, provider: o.provider });
  const provider = key ? o.providers?.[key] : undefined;
  if (!provider) return [];
  const home = o.home ?? homedir();
  const env = providerLoginEnv(provider, home);
  // The stand-in model keeps its own program: a binary path is the real tool's.
  const runtime = [
    ...(provider.binary && tool !== "fake-claude" && provider.tool === tool
      ? ["--bin", expandDir(provider.binary, home)] : []),
    ...(tool === "claude" && provider.tool === "claude" && provider.autoCompact ? ["--autocompact", String(provider.autoCompact)] : []),
  ];
  if (tool === "claude" && provider.tool === "claude" && env.CLAUDE_CONFIG_DIR) {
    return ["--claude-config-dir", env.CLAUDE_CONFIG_DIR, ...runtime];
  }
  return [...(tool === "codex" && provider.tool === "codex" && env.CODEX_HOME ? ["--codex-home", env.CODEX_HOME] : []), ...runtime];
}

/** The evidence the spec's next implement is handed: the job of the spec
 *  that keeps the tests its last archive landing failed on the merge
 *  (`keepLandingFailedTests`, at most one), with that landing's sentence,
 *  its test output and the archive step's branch revisions. None kept,
 *  none handed. */
export function archiveFailureContext(job: Job, jobs: readonly Job[]): string | undefined {
  const source = jobs.find((j) => j.project === job.project && j.specFolder === job.specFolder && j.landingFailedTests?.length);
  if (!source) return undefined;
  const result = source.results.findLast((r) => r.step === "archive");
  const currentFailure = source.errorReason === "tests-red" && source.error;
  return JSON.stringify({
    jobId: source.id,
    at: result?.at,
    branchUrls: source.branchUrls,
    failure: renderSentence("en", currentFailure || source.landingError),
    detail: currentFailure ? source.errorDetail : source.landingErrorDetail,
    archiveStepRepos: result?.repos,
    failedTests: source.landingFailedTests,
  });
}

export function previousAttemptContext(job: Job): string | undefined {
  return job.retry?.previousAttempt ? JSON.stringify(job.retry.previousAttempt) : undefined;
}
