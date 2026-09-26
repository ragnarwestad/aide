// The restart install-after-merge.sh used to do itself (spec 287): it
// killed the very process running the script, without ever asking
// whether some OTHER landing — a different repo, or the same one,
// queued right behind this landing's own merge — was still mid-`git
// push` when it fired. Moved here so the wait can hold the one piece
// of state that answers that question (`mergeLock`) without a second,
// file-based channel to go stale the way the launchd plist already
// has (2-analysis.md, REQ-4).

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { RESTART_DEFER_TIMEOUT_MS, RESTART_POLL_MS, type createRootLock } from "../serve-helpers";

export interface RestartHook {
  /** False on a laptop, and in every test: nothing is registered to
   *  restart. */
  registered(): Promise<boolean>;
  /** Kill-and-relaunch the dashboard server job. Fire-and-forget: it
   *  kills the very process calling it. */
  fire(): void;
}

const LABEL = (): string => process.env.AIDE_DASH_LABEL ?? "com.aide-dashboard.serve";

export function createLaunchdRestart(): RestartHook {
  return {
    async registered() {
      // No launchd (Linux): nothing restarts the dashboard, and a landed
      // change runs only once someone starts it again.
      if (!Bun.which("launchctl", { PATH: process.env.PATH ?? "" })) {
        console.error("queue: this machine has no launchd, so the dashboard is not restarted — restart it by hand to run the landed code");
        return false;
      }
      const proc = Bun.spawn({
        cmd: ["launchctl", "print", `gui/${process.getuid?.() ?? 0}/${LABEL()}`],
        stdout: "ignore",
        stderr: "ignore",
      });
      return (await proc.exited) === 0;
    },
    fire() {
      // Detached, in a process group of its own: the bootout takes this
      // process's group down with the job, and the bootstrap after it
      // has to outlive that.
      Bun.spawn({
        cmd: ["sh", "-c", reloadScript(LABEL())],
        stdout: "ignore",
        stderr: "ignore",
        detached: true,
      }).unref();
    },
  };
}

/** Takes the job down and loads it again from its plist, rather than
 *  `kickstart -k`, which restarts it on the arguments it was loaded with:
 *  an install that drops an option from the plist (repair-serve-plist.sh)
 *  only takes effect this way. The 1s sleep gives the caller's own output
 *  room to flush first; the wait for the label to go is the one
 *  `make install-serve` has, since a bootstrap into that gap fails and
 *  leaves nothing running; and the bootstrap is tried again, since a
 *  failed one leaves the dashboard down. */
export function reloadScript(label: string): string {
  const job = `gui/$(id -u)/${label}`;
  const plist = `"$HOME/Library/LaunchAgents/${label}.plist"`;
  return [
    "sleep 1",
    `launchctl bootout ${job}`,
    `for i in $(seq 1 50); do launchctl print ${job} >/dev/null 2>&1 || break; sleep 0.2; done`,
    `for i in 1 2 3 4 5; do launchctl bootstrap gui/$(id -u) ${plist} && break; sleep 2; done`,
  ].join("; ");
}

/** Wait for every in-flight merge to clear before restarting — bounded,
 *  so a landing that never finishes cannot hold the dashboard on old
 *  code forever. Past the bound, restart anyway (silence is what this
 *  spec exists to remove, not a hang), but say exactly what may have
 *  been interrupted first, on the one channel that already reaches a
 *  person: `console.error`, which `render-plist.ts` sends to
 *  `serve.log` alongside everything else. */
/** Whether a landed code root is the checkout this dashboard runs from.
 *  Compared as real paths: the serving host reaches its checkout through
 *  a symlinked home more often than not. */
export function isDashboardRoot(ctx: { dashboardRoot?: string }, root: string): boolean {
  if (!ctx.dashboardRoot) return false;
  const real = (p: string): string => {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p);
    }
  };
  return real(ctx.dashboardRoot) === real(root);
}

/** A running job's process is a child of this server: killing the server
 *  kills the job, and the queue goes on saying "running" about a step
 *  nothing is running any more (four jobs, 2026-09-03 00:13). So the
 *  restart waits until no job but the landing one is running AND no
 *  landing is in flight — in one loop, under one bound
 *  (`restartDeferTimeoutMs`), so a landing that starts while the jobs
 *  drain is covered by the same wait and never by a second one. */
/** Every job the restart is waiting on, by short id — the one check both
 *  this loop and the deploy route (spec 385) need to make, so the two
 *  can never disagree about what "running" means. */
/** What a restart is waiting for, named the way a reader knows it:
 *  `project:folder`, not the job's own id. A short id identifies the
 *  job to the machinery and nothing to the person reading the sentence
 *  it lands in — which is what "name the jobs it is waiting for" got
 *  built into on the first pass. A job with neither project nor folder
 *  keeps its id, since something is better than an empty name. */
export function runningJobNames(
  queue: { list(): { id: string; state: string; project?: string; specFolder?: string }[] } | undefined,
  exceptJobId?: string,
): string[] {
  return (queue?.list() ?? [])
    .filter((j) => j.state === "running" && j.id !== exceptJobId)
    .map((j) => (j.project && j.specFolder ? `${j.project}:${j.specFolder}` : j.id.slice(0, 8)));
}

export async function restartAfterLanding(ctx: {
  mergeLock: ReturnType<typeof createRootLock>;
  restart: RestartHook;
  restartPollMs?: number;
  restartDeferTimeoutMs?: number;
  queue?: { list(): { id: string; state: string }[] };
  exceptJobId?: string;
  /** Called with the current running-job list whenever it changes, and
   *  with `[]` once the wait is over one way or another (spec 385) — the
   *  one signal the Deploy tab's "waiting" sentence is drawn from. */
  onJobsWaitChange?: (jobs: string[]) => void;
  /** Told `true` while the restart waits and `false` once it fires, so
   *  the queue starts no new phase for the wait to outlast. */
  onRestartWait?: (waiting: boolean) => void;
}): Promise<void> {
  if (!(await ctx.restart.registered())) {
    ctx.onJobsWaitChange?.([]);
    return;
  }
  ctx.onRestartWait?.(true);
  const pollMs = ctx.restartPollMs ?? RESTART_POLL_MS;
  const running = (): string[] => runningJobNames(ctx.queue, ctx.exceptJobId);
  const deadline = Date.now() + (ctx.restartDeferTimeoutMs ?? RESTART_DEFER_TIMEOUT_MS);
  let waiting = running();
  if (waiting.length > 0) {
    console.error(`queue: a code change landed; the restart waits for running jobs: ${waiting.join(", ")}`);
    ctx.onJobsWaitChange?.(waiting);
  }
  while ((waiting.length > 0 || ctx.mergeLock.size > 0) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    waiting = running();
    ctx.onJobsWaitChange?.(waiting);
  }
  if (waiting.length > 0) {
    console.error(
      `queue: restarting the dashboard while jobs are still running: ${waiting.join(", ")} — they will have to be run again`,
    );
  }
  if (ctx.mergeLock.size > 0) {
    console.error(
      `queue: restarting the dashboard while a landing is still in flight for: ${ctx.mergeLock.roots().join(", ")} — verify those branches reached their default branch by hand`,
    );
  }
  // The success path used to be silent: nothing here told a reader of
  // serve.log whether this ever ran at all, so a restart that quietly
  // stopped firing and one that never needed to look identical. Logged
  // unconditionally once `registered()` is true — the laptop/test case
  // above already returned before this line.
  console.error("queue: restarting the dashboard to pick up a landed code change");
  ctx.onJobsWaitChange?.([]);
  ctx.restart.fire();
  ctx.onRestartWait?.(false);
}
