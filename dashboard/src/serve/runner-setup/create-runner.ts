// Constructing the queue's `Runner` — pulled out of `createServer`'s
// closure. The one thing that makes this different from the other
// setup stages: `spawn` needs the port `Bun.serve()` picked, and
// `Bun.serve()` itself is created AFTER the runner (`queueCtx`, built
// before it, already needs `runner`). `readServerPort` is a getter for
// exactly that reason — `spawn` is only ever CALLED later, from the
// polling `runner.tick()` timer, long after `Bun.serve()` has returned,
// so the read is never a TDZ error; a plain value captured at
// construction time would be.
import { resumeCutLandings } from "../../queue/runner/cut-landing.ts";
import { join } from "node:path";
import { homedir } from "node:os";
import { readFileSync, rmSync } from "node:fs";
import { Runner } from "../../queue/runner";
import { DEFAULT_QUEUE_CONCURRENCY } from "../serve-helpers";
import { createCleanupJob, hostCleanupDependencies } from "../process-cleanup";
import type { RunnerSetupContext } from "./context.ts";
import { stepSpawner } from "./spawn-step.ts";
import { stepDoneHandler } from "./step-done.ts";

/** A step's result file, or null while there is none. */
function readResultFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as unknown;
  } catch {
    return null;
  }
}

/** At boot, after `reconcile`: the landings the last process never finished. */
export function resumeCutLandingsAtBoot(ctx: RunnerSetupContext): void {
  resumeCutLandings({ store: ctx.store, readResult: readResultFile, onStepDone: stepDoneHandler(ctx) });
}

export function createQueueRunner(ctx: RunnerSetupContext): Runner | null {
  if (!ctx.queueRunnerBin) return null;
  const runnerBin = ctx.queueRunnerBin;
  const cleanupJob = createCleanupJob(hostCleanupDependencies(() => ctx.store.list(), ctx.testServerStore));
  return new Runner({
    store: ctx.store,
    projectDir: ctx.machineryProjectDir,
    specsRoot: ctx.machinerySpecsRoot,
    runnerBin,
    resultDir: ctx.queueResultDir ?? join(homedir(), ".aide", "dashboard", "jobs"),
    maxConcurrent: ctx.queueConcurrency ?? DEFAULT_QUEUE_CONCURRENCY,
    now: () => new Date().toISOString(),
    today: () => new Date().toISOString().slice(0, 10),
    spawn: stepSpawner(ctx, runnerBin, cleanupJob),
    isAlive: (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    },
    readResult: readResultFile,
    notify: (event) => ctx.notifier.notify(event),
    // A step's work is invisible to this page until its branch is on
    // the default branch of the checkout the page reads — so every
    // step lands the work it produced, and nobody merges by hand
    // `create` and `archive` already did; `analyze` writes in the specs
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
    onStepDone: stepDoneHandler(ctx),
    clearResult: (path) => {
      try {
        rmSync(path, { force: true });
      } catch {
        /* nothing to clear */
      }
    },
  });
}
