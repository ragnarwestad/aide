// Starting one step of a job: the providers it runs on, and the process
// (`aide-run-spec`, or the deploy, land or cleanup job) that runs it.
import { NORMAL_CODEX_HOME, expandDir, providerFolders, resolveStepProvider } from "../../queue/providers/index.ts";
import { prepareShadowHome } from "../providers/shadow-home.ts";
import { dirname, join } from "node:path";
import { spawnEnv } from "../tool-path.ts";
import { scriptArgv } from "../../integrations/script-argv.ts";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import { DEFAULT_SCHEDULE_OUTPUT_ROOT, scheduleRunOutputDir } from "../../queue/schedule.ts";
import type { Job, WorkflowStep } from "../../queue/queue.ts";
import type { SpawnResult, Spawner } from "../../queue/runner";
import { groupBranchForJob } from "../../queue/execution-groups";
import { runnerArgv } from "../serve-helpers";
import { analysisSessionToResume, archiveFailureContext, launchProviders, previousAttemptContext, stepTool } from "../serve-helpers/runner-argv.ts";
import { openRunLog } from "../../queue/runner/run-log-path.ts";
import { noteStartedGroup } from "../../queue/job-rules/started-groups.ts";
import { isSignallablePid } from "../serve-helpers/signal-group.ts";
import type { createCleanupJob } from "../process-cleanup";
import { PICK_PARTS } from "../../queue/providers/side-tools.ts";
import { forProject } from "../../queue/providers/project-defaults.ts";
import { acceptanceNotRequiredForAnalyze, type RunnerSetupContext } from "./context.ts";

type CleanupJob = ReturnType<typeof createCleanupJob>;
type Env = Record<string, string | undefined>;

/** Everything one step's start is worked out from. */
interface StepLaunch {
  job: Job;
  /** `job` with the providers this step was resolved to. */
  launchJob: Job;
  step: WorkflowStep;
  resultFile: string;
  sessionId: string;
  streamFile: string;
  defaults: RunnerSetupContext["store"]["defaults"];
  sidePicks: Record<string, string>;
  sideProviders: Record<string, string>;
  providers: Record<string, string>;
}

/** The runner's `spawn`: resolves the step's providers at once, and
 *  starts its process when the runner calls `start`. */
export function stepSpawner(ctx: RunnerSetupContext, runnerBin: string, cleanupJob: CleanupJob): Spawner {
  return (job, step, resultFile, sessionId, streamFile) => {
    const defaults = forProject(ctx.store.defaults, job.project);
    const sidePicks = { ...ctx.store.pendingModels[`${job.project}/${job.specFolder}`], ...Object.fromEntries(PICK_PARTS.flatMap((part) => job.model[part] ? [[part, job.model[part]]] : [])) };
    const sideProviders = { ...ctx.store.pendingProviders[`${job.project}/${job.specFolder}`], ...Object.fromEntries(PICK_PARTS.flatMap((part) => job.provider?.[part] ? [[part, job.provider[part]]] : [])) };
    const providers = launchProviders(job, step, { model: defaults.model, modelChoices: defaults.modelChoices, sidePicks, sideProviders, providers: defaults.providers, provider: defaults.provider });
    const launchJob = { ...job, provider: { ...job.provider, ...providers } };
    const launch: StepLaunch = { job, launchJob, step, resultFile, sessionId, streamFile, defaults, sidePicks, sideProviders, providers };
    return { providers, start: () => startStep(ctx, runnerBin, cleanupJob, launch) };
  };
}

function startStep(ctx: RunnerSetupContext, runnerBin: string, cleanupJob: CleanupJob, l: StepLaunch): SpawnResult {
  mkdirSync(dirname(l.resultFile), { recursive: true });
  if (l.step === "deploy") return ctx.startDeploy(l.launchJob, l.resultFile);
  if (l.step === "land") return ctx.startLand(l.launchJob, l.resultFile, l.streamFile);
  if (l.step === "cleanup") return cleanupJob.start(l.launchJob, l.resultFile, l.streamFile);
  return spawnRunner(ctx, runnerBin, l);
}

/** Starts `aide-run-spec` for the step, detached in its own group. */
function spawnRunner(ctx: RunnerSetupContext, runnerBin: string, l: StepLaunch): SpawnResult {
  const env = stepEnv(ctx, l);
  const proc = Bun.spawn({
    cmd: scriptArgv(runnerArgv(l.launchJob, l.step, l.resultFile, runnerOptions(ctx, runnerBin, l), l.sessionId, l.streamFile)),
    env,
    detached: true,
    // stdout is ignored (the result FILE is the contract), but
    // stderr goes to the step's own run log: when the runner died
    // mid-job the first time, nothing on this machine said why, and
    // the job page shows it in the step's Log.
    stdio: ["ignore", "ignore", openRunLog(l.streamFile)],
  });
  proc.unref();
  if (isSignallablePid(proc.pid)) noteStartedGroup(l.job.project, proc.pid);
  return { pid: proc.pid, pgid: proc.pid };
}

/** The step's environment: this server's own reporting address, the
 *  folders its sandbox protects, and a schedule run's output folder. */
function stepEnv(ctx: RunnerSetupContext, l: StepLaunch): Env {
  const { job, step } = l;
  // `aide-emit-run` reports each TDD phase and is
  // inert unless `AIDE_RUN_URL` says where — so a headless step
  // reported into silence, because nothing from launchd down to
  // the spawned `claude` ever set it. This server knows its own
  // address, so it tells the step where to report, and no
  // machine needs configuring for it.
  //
  // It has to be `readServerPort()` and not `opts.port`:
  // `port: 0` means "let the OS pick", and every test in this
  // suite starts that way.
  const selfRunUrl = `http://127.0.0.1:${ctx.readServerPort()}/api/aide-run`;
  // The spread is load-bearing. `Bun.spawn`'s `env`, once given at
  // all, REPLACES the child's environment rather than layering onto
  // it, and this call passed none before — so the child inherited
  // PATH, HOME and the credentials `git` and `claude` need
  // implicitly. An operator who has already pointed reporting at
  // another sink keeps it: the derived URL is a default, never an
  // override.
  // `~/.local/bin` on PATH, always. aide's own scripts are installed
  // there — `aide-create-spec`, `aide-archive-spec`, `aide-close-spec`
  // — and a step's session calls them BY NAME, as its skill tells it
  // to. A session that cannot find the script does not fail: it
  // searches the disk for it, minutes at a time, and then does the
  // job by hand or not at all. `tool-path.ts` is the one place that
  // decision is made, so a tool check and a real step cannot
  // disagree about which binaries exist.
  const env: Env = {
    ...spawnEnv(),
    AIDE_RUN_URL: process.env.AIDE_RUN_URL ?? selfRunUrl,
    AIDE_ARCHIVE_FAILURE_CONTEXT: step === "implement" ? archiveFailureContext(job, ctx.store.list()) : undefined,
    AIDE_PREVIOUS_ATTEMPT_CONTEXT: previousAttemptContext(job),
    ...(ctx.queueConfigFile ? { AIDE_QUEUE_CONFIG: ctx.queueConfigFile } : {}),
    ...(ctx.dashboardCheckoutRoot ? { AIDE_CHECKOUT_ROOT: ctx.dashboardCheckoutRoot } : {}),
    ...(ctx.queueMirrorPath ? { AIDE_QUEUE_MIRROR: ctx.queueMirrorPath } : {}),
  };
  addProviderHomes(env, l);
  if (step === "schedule") env.AIDE_SCHEDULE_OUTPUT_DIR = makeScheduleOutputDir(ctx, job);
  return env;
}

function addProviderHomes(env: Env, l: StepLaunch): void {
  const { defaults } = l;
  // Every folder a provider keeps a login in, so the runner's sandbox
  // keeps a step from writing to any of their settings.
  const folders = providerFolders(defaults.providers, homedir());
  if (folders.claude.length) env.AIDE_CLAUDE_CONFIG_DIRS = folders.claude.join("\n");
  if (folders.codex.length) env.AIDE_CODEX_HOMES = folders.codex.join("\n");
  // A Codex step on a provider with a shadow home links in whatever the
  // shared CODEX_HOME gained since it was saved. A conflict is left: the
  // step runs on its login without the shared sessions.
  const provider = defaults.providers?.[l.providers[l.step] ?? ""];
  if (provider?.tool === "codex" && provider.shadowHome) {
    prepareShadowHome(expandDir(provider.codexHome || NORMAL_CODEX_HOME, homedir()), expandDir(provider.shadowHome, homedir()));
  }
}

/** Only a `schedule` step's own spawn gets this: the
 *  directory THIS run's prompt writes its output to, made
 *  ahead of time so a prompt with no `mkdir -p` of its own still
 *  lands its file. `scheduleRunOutputDir()` is the one function both
 *  this write side and the serving route's read side import — see
 *  its own comment for why that matters. */
function makeScheduleOutputDir(ctx: RunnerSetupContext, job: Job): string {
  const outputDir = scheduleRunOutputDir(
    ctx.scheduleOutputRoot ?? DEFAULT_SCHEDULE_OUTPUT_ROOT,
    job.project,
    job.specFolder,
    job.id,
  );
  mkdirSync(outputDir, { recursive: true });
  return outputDir;
}

function runnerOptions(ctx: RunnerSetupContext, runnerBin: string, l: StepLaunch): Parameters<typeof runnerArgv>[3] {
  const { job, step, defaults } = l;
  return {
    runnerBin,
    projectDir: ctx.machineryProjectDir(job.project),
    // The same answer the landing uses to find the folder
    // afterwards (`machinerySpecsRoot`), so the two cannot
    // disagree about where a spec belongs.
    specsRoot: ctx.machinerySpecsRoot(job.project),
    branch: groupBranchForJob(ctx.store.executionGroups, ctx.machinerySpecsRoot(job.project), job),
    worktreeBase: join(dirname(ctx.queueResultDir ?? join(homedir(), ".aide", "dashboard", "jobs")), "worktrees"),
    scriptsDir: dirname(runnerBin),
    // The global setting speaks for every project
    // on this host at once; a project that reviews its code
    // says so in its own committed manifest, and that
    // answer wins. It only ever raises the mode TO `pr` —
    // `merge` is the absence of an opinion, not an
    // instruction to publish less than the host asked for.
    //
    // Both halves have to travel together: `landBranch`
    // stops merging this project's code root, and a
    // branch left open with no pull request describing it
    // is worse than either behaviour on its own. Read per
    // spawn, off disk, the same way `projectManifest` is
    // read per render — one small YAML file, and an edit
    // takes effect on the next job rather than the next
    // deploy.
    push: ctx.codeLanding(job.project) === "pr" ? "pr" : (ctx.queuePush ?? "branch"),
    promptFile: ctx.promptFileFor(job, step),
    chrome: ctx.chromeFor(job, step),
    noSandbox: ctx.noSandboxFor(job, step),
    modelChoices: defaults.modelChoices,
    timeoutSec: defaults.timeoutSec,
    permissionMode: defaults.permissionMode,
    model: defaults.model,
    sidePicks: l.sidePicks,
    sideProviders: { ...l.sideProviders, ...l.providers },
    providers: defaults.providers,
    provider: defaults.provider,
    acceptanceNotRequiredForAnalyze:
      step === "analyze" ? acceptanceNotRequiredForAnalyze(ctx, job) : false,
    resumeSession:
      step === "implement" && defaults.resumeAnalysis
        ? analysisSessionToResume(job, ctx.store.list(), stepTool(job, step, defaults), Date.now(), {
            key: resolveStepProvider(job, step, defaults),
            providers: defaults.providers,
          })
        : undefined,
  };
}
