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
import { RESTART_DEFER_TIMEOUT_MS, RESTART_JOBS_DEFER_MS, RESTART_POLL_MS, type createRootLock } from "../serve-helpers.ts";

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
      const proc = Bun.spawn({
        cmd: ["launchctl", "print", `gui/${process.getuid?.() ?? 0}/${LABEL()}`],
        stdout: "ignore",
        stderr: "ignore",
      });
      return (await proc.exited) === 0;
    },
    fire() {
      // The 1s sleep mirrors what the script used to give itself: room
      // for this call's own stdout/stderr to flush before the kill.
      Bun.spawn({
        cmd: ["sh", "-c", `sleep 1; launchctl kickstart -k gui/$(id -u)/${LABEL()}`],
        stdout: "ignore",
        stderr: "ignore",
      });
    },
  };
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
 *  restart also waits until no job but the landing one is running —
 *  bounded by `restartJobsDeferMs`, long enough for an implement. */
export async function restartAfterLanding(ctx: {
  mergeLock: ReturnType<typeof createRootLock>;
  restart: RestartHook;
  restartPollMs?: number;
  restartDeferTimeoutMs?: number;
  restartJobsDeferMs?: number;
  queue?: { list(): { id: string; state: string }[] };
  exceptJobId?: string;
}): Promise<void> {
  if (!(await ctx.restart.registered())) return;
  const pollMs = ctx.restartPollMs ?? RESTART_POLL_MS;
  const running = (): string[] =>
    (ctx.queue?.list() ?? [])
      .filter((j) => j.state === "running" && j.id !== ctx.exceptJobId)
      .map((j) => j.id.slice(0, 8));
  const jobsDeadline = Date.now() + (ctx.restartJobsDeferMs ?? RESTART_JOBS_DEFER_MS);
  if (running().length > 0) {
    console.error(`queue: a code change landed; the restart waits for running jobs: ${running().join(", ")}`);
  }
  while (running().length > 0 && Date.now() < jobsDeadline) {
    await new Promise((r) => setTimeout(r, pollMs));
  }
  if (running().length > 0) {
    console.error(
      `queue: restarting the dashboard while jobs are still running: ${running().join(", ")} — they will have to be run again`,
    );
  }
  const deadline = Date.now() + (ctx.restartDeferTimeoutMs ?? RESTART_DEFER_TIMEOUT_MS);
  while (ctx.mergeLock.size > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
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
  ctx.restart.fire();
}
