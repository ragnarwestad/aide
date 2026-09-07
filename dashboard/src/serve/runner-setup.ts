// Constructing the queue's `Runner` — pulled out of `createServer`'s
// closure the same way the earlier clusters were (spec: split serve.ts,
// step 9). The one thing that makes this different from every earlier
// extraction: `spawn` below needs the port `Bun.serve()` picked, and
// `Bun.serve()` itself is created AFTER the runner (`queueCtx`, built
// before it, already needs `runner`). `readServerPort` is a getter for
// exactly that reason — `spawn` is only ever CALLED later, from the
// polling `runner.tick()` timer, long after `Bun.serve()` has returned,
// so the read is never a TDZ error; a plain value captured at
// construction time would be.

import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { Runner } from "../queue/runner.ts";
import { DEFAULT_SCHEDULE_OUTPUT_ROOT, scheduleOutputDir } from "../queue/schedule.ts";
import type { QueueStore, Job, WorkflowStep } from "../queue/queue.ts";
import type { StepOutcome } from "../queue/runner.ts";
import type { Notifier } from "../integrations/notify.ts";
import { specAcceptanceNotRequired, type CodeLanding } from "../project/discover.ts";
import { runnerArgv, DEFAULT_QUEUE_CONCURRENCY } from "./serve-helpers.ts";

export interface RunnerSetupContext {
  store: QueueStore;
  machineryProjectDir: (project: string) => string;
  /** `machineryProjectDir`'s sibling for the specs root (spec 402) —
   *  `setupLand()` already takes this for the identical reason; passed
   *  here too so `Runner.tick()` can scope its landing pause to a
   *  project's actual repos rather than holding the whole board. */
  machinerySpecsRoot: (project: string) => string | undefined;
  queueRunnerBin: string | undefined;
  queueResultDir: string | undefined;
  scheduleOutputRoot: string | undefined;
  queueConcurrency: number | undefined;
  /** `Bun.serve()`'s own choice — a getter because it does not exist
   *  yet when this context is built. See the file-level comment. */
  readServerPort: () => number | undefined;
  codeLanding: (project: string) => CodeLanding;
  queuePush: string | undefined;
  promptFileFor: (job: Job, step: string) => string | undefined;
  notifier: Notifier;
  landNewSpec: (job: Job, outcome: Partial<StepOutcome>) => Promise<void>;
  landStepBranch: (job: Job, step: WorkflowStep, outcome: Partial<StepOutcome>) => Promise<void>;
  landArchivedSpec: (job: Job, outcome: Partial<StepOutcome>) => Promise<void>;
  landClosedSpec: (job: Job, outcome: Partial<StepOutcome>) => Promise<void>;
  landStoppedStepBranch: (job: Job, step: WorkflowStep, outcome: Partial<StepOutcome>) => Promise<void>;
  /** The spec's own on-disk folder (spec 394) — the same `specDir` →
   *  `peekMachinerySpecDir` chain `spec-views/spec-page.ts` already uses
   *  to reach it, added here so `analyze`'s own spawn can read the
   *  spec's RECORDED acceptance choice fresh, rather than trusting a
   *  job field that may belong to a job created long before this one. */
  specDir: (project: string, specFolder: string) => string | undefined;
  peekMachinerySpecDir: (project: string, dir: string) => string;
}

/** Whether `analyze`'s own invocation of `job` should be told acceptance
 *  ticking is not required (spec 394, REQ-8) — read fresh off the
 *  spec's own `1-description.md` at spawn time, never off `job` itself:
 *  a job queued from the specs list long after `create` finished has no
 *  checkbox of its own to carry the choice on. `false`, never a throw,
 *  for a spec `specDir` cannot resolve — the same defensive shape
 *  `specAcceptanceNotRequired` already has for a missing file. */
export function acceptanceNotRequiredForAnalyze(
  ctx: Pick<RunnerSetupContext, "specDir" | "peekMachinerySpecDir">,
  job: Job,
): boolean {
  const found = ctx.specDir(job.project, job.specFolder);
  if (!found) return false;
  return specAcceptanceNotRequired(ctx.peekMachinerySpecDir(job.project, found));
}

export function createQueueRunner(ctx: RunnerSetupContext): Runner | null {
  if (!ctx.queueRunnerBin) return null;
  const runnerBin = ctx.queueRunnerBin;
  return new Runner({
    store: ctx.store,
    projectDir: ctx.machineryProjectDir,
    specsRoot: ctx.machinerySpecsRoot,
    runnerBin,
    resultDir: ctx.queueResultDir ?? join(homedir(), "aide-dashboard", "jobs"),
    maxConcurrent: ctx.queueConcurrency ?? DEFAULT_QUEUE_CONCURRENCY,
    now: () => new Date().toISOString(),
    today: () => new Date().toISOString().slice(0, 10),
    spawn: (job, step, resultFile, sessionId, streamFile) => {
      mkdirSync(dirname(resultFile), { recursive: true });
      // Spec 222. `aide-emit-run` reports each TDD phase and is
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
      // to. This server runs under launchd, whose PATH carries neither
      // that directory nor mise's shims, and a session that cannot find
      // the script does not fail: it searches the disk for it, minutes
      // at a time, and then does the job by hand or not at all.
      // Prepended to whatever is there, never replacing it: an operator
      // running the server from a shell keeps their own PATH.
      const localBin = `${process.env.HOME ?? ""}/.local/bin`;
      const path = process.env.PATH ?? "";
      const env: Record<string, string | undefined> = {
        ...process.env,
        PATH: path.split(":").includes(localBin) ? path : `${localBin}:${path}`,
        AIDE_RUN_URL: process.env.AIDE_RUN_URL ?? selfRunUrl,
      };
      // Spec 272. Only a `schedule` step's own spawn gets this: the
      // directory a schedule job's prompt writes its output to, made
      // ahead of time so a prompt with no `mkdir -p` of its own still
      // lands its file. `scheduleOutputDir()` is the one function both
      // this write side and the serving route's read side import — see
      // its own comment for why that matters.
      if (step === "schedule") {
        const outputDir = scheduleOutputDir(
          ctx.scheduleOutputRoot ?? DEFAULT_SCHEDULE_OUTPUT_ROOT,
          job.project,
          job.specFolder,
        );
        mkdirSync(outputDir, { recursive: true });
        env.AIDE_SCHEDULE_OUTPUT_DIR = outputDir;
      }
      const proc = Bun.spawn({
        cmd: runnerArgv(
          job,
          step,
          resultFile,
          {
            runnerBin,
            projectDir: ctx.machineryProjectDir(job.project),
            // Spec 220. The global setting speaks for every project
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
            modelChoices: ctx.store.defaults.modelChoices,
            timeoutSec: ctx.store.defaults.timeoutSec,
            permissionMode: ctx.store.defaults.permissionMode,
            model: ctx.store.defaults.model,
            acceptanceNotRequiredForAnalyze:
              step === "analyze" ? acceptanceNotRequiredForAnalyze(ctx, job) : false,
          },
          sessionId,
          streamFile,
        ),
        env,
        detached: true,
        // stdout is ignored (the result FILE is the contract), but
        // stderr goes to a per-job log: when the runner died
        // mid-job the first time, nothing on this machine said why.
        stdio: ["ignore", "ignore", Bun.file(`${resultFile}.log`)],
      });
      proc.unref();
      return { pid: proc.pid, pgid: proc.pid };
    },
    isAlive: (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    },
    readResult: (path) => {
      try {
        return JSON.parse(readFileSync(path, "utf-8")) as unknown;
      } catch {
        return null;
      }
    },
    notify: (event) => ctx.notifier.notify(event),
    // A step's work is invisible to this page until its branch is on
    // the default branch of the checkout the page reads — so every
    // step lands the work it produced, and nobody merges by hand
    // (spec 149). `create` and `archive` already did (specs 93 and
    // 136); `analyze` writes in the specs
    // repo exactly as those two do, so the same argument covers it
    // and it was simply never given it.
    //
    // `implement` is the one exception, and it is deliberate: the
    // code stays on the pushed branch, which is where a person tests
    // it — by leaving `archive` unticked. `archive` is therefore the
    // one step that sends CODE to a default branch, which is why it
    // has a landing of its own.
    //
    // The returned promise holds the queue for as long as the
    // landing takes; see `Runner.tick()`.
    onStepDone: (job, step, outcome) => {
      if (outcome.ok) {
        if (step === "create") return ctx.landNewSpec(job, outcome);
        // `reopen` lands for exactly the reason `analyze` does, and
        // for it the argument is not an improvement but the whole
        // feature (spec 198): the un-archived folder is what makes
        // the spec active again, this page reads the MAIN checkout,
        // and a reopen left on its branch would show nowhere at all
        // — "reopening is one action" would then still end with
        // somebody in a terminal.
        if (step === "analyze" || step === "reopen" || step === "reset") {
          return ctx.landStepBranch(job, step, outcome);
        }
        // `archive` lands on `completed` alone. A refusal from
        // `aide-archive-spec` (not implemented yet, an acceptance row
        // unticked) is ok — the row reads the hold-back from
        // 4-status.md — but nothing was archived, and landing it merged
        // implement's code branch into main with the spec still active.
        // `already-landed` has nothing left to land either.
        if (step === "archive") {
          return outcome.terminalReason === "completed" ? ctx.landArchivedSpec(job, outcome) : undefined;
        }
        // spec 406: `close` lands on `closed` alone, the same rule
        // `archive` follows for `completed` — every other terminalReason
        // (`already-closed`, `already-archived`, `conflict-open`,
        // `refused`) moved nothing, so there is nothing to land.
        if (step === "close") {
          return outcome.terminalReason === "closed" ? ctx.landClosedSpec(job, outcome) : undefined;
        }
        // `implement`, `explore` and `manifest` fall through: the first
        // by design, the other two because neither leaves a spec branch
        // for anyone to land.
        return undefined;
      }
      // A step stopped by its own clock still committed and pushed
      // whatever it had written before the deadline — `aide-run-spec`'s
      // commit loop runs on every path and the push is gated on the
      // push mode, not on `ok` (spec 187). Left on the branch, that
      // work is readable only by checking it out by hand: spec 184
      // stopped with a finished analysis nothing on this page
      // mentioned.
      //
      // What decides is what the run TOUCHED, never which step it
      // was. A run that moved a code root's HEAD is left exactly
      // where a failed run is left — the code waits on its branch for
      // `archive`, whether the step ran out of time or not — and there
      // is no second list of "which steps are safe" to keep in step
      // with the first.
      //
      // The wall clock and a provider limit both stop after the
      // runner has committed the work. A cost cap and a CLI error
      // have no such safe landing promise.
      if (
        !step ||
        (outcome.terminalReason !== "timeout" && outcome.terminalReason !== "provider-limit")
      ) return undefined;
      const codeRoots = new Set([ctx.machineryProjectDir(job.project)]);
      const pushed = outcome.branchUrls ?? [];
      if (pushed.length === 0 || pushed.some((r) => codeRoots.has(r.root))) return undefined;
      return ctx.landStoppedStepBranch(job, step, outcome);
    },
    clearResult: (path) => {
      try {
        rmSync(path, { force: true });
      } catch {
        /* nothing to clear */
      }
    },
  });
}
