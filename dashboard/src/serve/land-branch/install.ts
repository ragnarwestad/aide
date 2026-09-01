// Running the project's own install once its code has landed. Split
// out of land-branch.ts by theme (split land-branch.ts by theme).

import { configValue } from "../../project/discover.ts";
import { SETTING_LABELS } from "../../project/setting-labels.ts";
import type { RepoMergeResult } from "../../git/branch-merge.ts";
import { INSTALL_TIMEOUT_MS } from "../serve-helpers.ts";
import type { LandContext } from "./types.ts";
import { restartAfterLanding } from "./restart.ts";

/** Run the project's own install, once its code has landed. Bounded by
 *  a timeout of its own — never trusting the server's idle timeout to
 *  bound it — and never fatal: the merge already happened, and a
 *  failed install is reported beside it rather than retroactively
 *  turning a successful merge into a failure. */
export async function installAfterMerge(ctx: LandContext, result: RepoMergeResult): Promise<void> {
  const cmd = configValue(result.root, "AIDE_INSTALL_CMD");
  if (!cmd) {
    // Said out loud for every project that has not configured one:
    // the alternative is a page that reads as "deployed" when nothing
    // was deployed, which is the whole complaint.
    result.installError = `merged, not installed — no ${SETTING_LABELS.AIDE_INSTALL_CMD.toLowerCase()} configured; deploying is a hand step`;
    return;
  }
  const timeoutMs = ctx.queueInstallTimeoutMs ?? INSTALL_TIMEOUT_MS;
  let failed = false;
  try {
    // argv, no shell — the same shape the notify command already has,
    // so nothing here has to get quoting right on someone's behalf.
    const proc = Bun.spawn({ cmd: cmd.split(/\s+/), cwd: result.root, stdout: "ignore", stderr: "pipe" });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeoutMs);
    let tail = "";
    try {
      tail = await new Response(proc.stderr).text();
    } finally {
      clearTimeout(timer);
    }
    const code = await proc.exited;
    if (timedOut) {
      result.installError = `merged, but the install timed out after ${timeoutMs}ms and was stopped`;
      failed = true;
    } else if (code !== 0) {
      result.installError = `merged, but the install failed (exit ${code}): ${tail.trim().slice(-200)}`;
      failed = true;
    }
  } catch (err) {
    result.installError = `merged, but the install could not be run: ${err instanceof Error ? err.message : String(err)}`;
    failed = true;
  }
  // The restart moved here from install-after-merge.sh (spec 287): a
  // failed install skips it, exactly as `set -e` used to skip the
  // script's own restart block on any earlier failure.
  if (!failed) await restartAfterLanding(ctx);
}
