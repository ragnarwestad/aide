// Server-wide constants and the per-repo merge lock.

import type { QueueDefaults } from "../../queue/queue.ts";
import workflowStepsData from "../../../../core/scripts/lib/workflow-steps.json" with { type: "json" };

export const MAX_BODY = 4096;

/** What the save route accepts instead (spec 162). A description is not
 *  an action post: this spec's own `1-description.md` was 4182 raw
 *  bytes before a single character of form-urlencoding overhead, so
 *  `MAX_BODY` would have refused the very file the editor was written
 *  for. 64 KiB is roughly fifteen times that — headroom for a
 *  description that grows, without becoming an unbounded body on a
 *  token-gated internal server. */
export const MAX_SAVE_BODY = 65536;

/** How long the project's own install may run after its code merged.
 *  The same bounded-timeout discipline every git call already has
 *  (`createGitRunner`): a hung install must not tie up a request
 *  handler, whatever the server's idle timeout is set to. */
export const INSTALL_TIMEOUT_MS = 60_000;

// The caps decided in spec 81: deliberately tight. An `analyze` step
// fits; an `implement` on Opus will stop early, on purpose, until the
// per-step value is raised from a measurement.
export const QUEUE_DEFAULTS: QueueDefaults = {
  budgetUsd: 3,
  jobCapUsd: 10,
  dailyCapUsd: 20,
  // Per step since spec 152. 1200 is unchanged for everything else;
  // `implement` gets 5400 because 149's was killed at the 45-minute
  // mark with RED and GREEN done and its tests green, mid-way through
  // writing documentation on a twenty-file change. A correction from
  // two data points, not a measurement — it lives in `queue-config.json`
  // on the serving host and should be revisited once more have run.
  // `analyze` gets 2400 for the same reason (spec 181): the reviewer
  // routine that used to be its own `review-plan` step now runs inside
  // `analyze`, so one run does what used to be two, and the default
  // budget for one step is no longer enough for both.
  timeoutSec: { default: 1200, implement: 5400, analyze: 2400 },
  permissionMode: { implement: "bypassPermissions", default: "acceptEdits" },
  // `archive` falls to `default`, and that is a decision rather than an
  // accident of which key happens to be missing: it may now have a merge
  // conflict to resolve (spec 171), and a merge is not an implement.
  model: { implement: "opus", default: "sonnet" },
};

/** One repo, one merge at a time. Pressing Merge on two specs a few
 *  milliseconds apart ran two full `status`/`fetch`/`switch`/`pull`/
 *  `merge`/`push` sequences against the SAME working tree, and the
 *  second lost the race for `index.lock` — reported as "cannot
 *  fast-forward main … merge it by hand", which is what a genuinely
 *  diverged base says. Both went through on a retry, which is what
 *  told them apart.
 *
 *  Per repo ROOT, not global: two requests that touch no directory in
 *  common cannot collide, and serializing them would only add latency.
 *  This is additive to `branch-merge.ts`'s `index.lock` retry, which
 *  guards a collision this cannot see — `aide-run-spec` is a different
 *  process.
 *
 *  Exported so the lock can be proven on its own: that it serializes,
 *  that different roots do not wait for each other, that a thrown turn
 *  does not poison the next, and that the map lets go of a root once
 *  nothing is waiting on it. A map a server never empties is a map
 *  that grows for as long as the server is up. */
export function createRootLock() {
  const chains = new Map<string, Promise<unknown>>();
  return {
    run<T>(root: string, fn: () => Promise<T>): Promise<T> {
      const prev = chains.get(root) ?? Promise.resolve();
      // Settled either way: one request's failure is its own, and the
      // next request's turn must still come.
      const turn = prev.then(fn, fn);
      const done: Promise<void> = turn.then(clear, clear);
      function clear(): void {
        // Only the LAST chain clears the entry. An earlier waiter
        // deleting it would let the next request start beside the one
        // still running, which is the whole thing being prevented.
        if (chains.get(root) === done) chains.delete(root);
      }
      chains.set(root, done);
      return turn;
    },
    get size(): number {
      return chains.size;
    },
    /** Which roots have a merge in flight right now — named, not just
     *  counted, so a restart that has to proceed anyway (spec 287) can
     *  say specifically what it may have interrupted. */
    roots(): string[] {
      return [...chains.keys()];
    },
  };
}

/** How often `restartAfterLanding()` (spec 287) re-checks `mergeLock`
 *  while it waits for every in-flight merge to clear before restarting
 *  the dashboard server. */
export const RESTART_POLL_MS = 250;

/** Comfortably above the worst realistic `mergeBranchIntoDefault` run:
 *  up to 3 attempts (`branch-merge.ts`'s own retry) of up to ~8 git
 *  subcommands at up to `DEFAULT_TIMEOUT_MS` (4s) each. Bounded, not
 *  indefinite — a restart that waited forever for a landing that will
 *  never finish would just trade one silent failure for a dashboard
 *  that never comes back. */
export const RESTART_DEFER_TIMEOUT_MS = 90_000;
/** How long a restart waits for RUNNING JOBS to finish first: an implement
 *  step can take an hour and a half. */
export const RESTART_JOBS_DEFER_MS = 2 * 60 * 60_000;
/** The landing's test gate: both of aide's suites take about ten minutes
 *  on the serving host, plus the wait for the machine's test lock. */
export const LANDING_GATE_TIMEOUT_MS = 60 * 60_000;

/** How many steps may run at once, from the queue config's
 *  `concurrency`. FALLS BACK, it does not clamp: `mergeQueueDefaults`
 *  already ignores what it does not understand and keeps the built-in
 *  value, and one rule beats two. The upper bound of 4 is the only thing
 *  standing between a typo in a config file and sixteen `claude`
 *  sessions on the serving host. */
export const DEFAULT_QUEUE_CONCURRENCY = 2;

export function parseQueueConcurrency(raw: unknown): number {
  // 1..8: six is what the serving host runs now that a landing runs the
  // suite once and the timing tests tolerate a busy host (2026-09-03).
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > 8) {
    return DEFAULT_QUEUE_CONCURRENCY;
  }
  return raw;
}

/** The steps a dependency actually holds back (spec 122): the ones that
 *  BUILD on merged code. `analyze` and `create` write
 *  only the spec's own folder in the specs repo and conflict with
 *  nothing, so a chain of dependent specs can be analysed in parallel
 *  the moment it is queued.
 *
 *  Read from `core/scripts/lib/workflow-steps.json` (spec 349) — the
 *  same file `core/scripts/aide-run-spec` reads with jq, so the two
 *  sides can no longer drift apart. */
export const DEPENDENCY_GATED_STEPS: readonly string[] = workflowStepsData.dependencyGatedSteps;

export const GATED = new Set<string>(DEPENDENCY_GATED_STEPS);
