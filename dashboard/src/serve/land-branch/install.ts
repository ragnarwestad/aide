// Running the project's own install once its code has landed. Split
// out of land-branch.ts by theme (split land-branch.ts by theme).

import { resolveInstallCmd } from "../../project/discover";
import { SETTING_LABELS } from "../../project/setting-labels.ts";
import type { RepoMergeResult } from "../../git/branch-merge/index.ts";
import { INSTALL_TIMEOUT_MS } from "../serve-helpers";
import type { LandContext } from "./types.ts";
import { scriptArgv } from "../../integrations/script-argv.ts";
import { outputTail } from "../../format/output-tail.ts";

/** Run the project's own install, once its code has landed. Bounded by
 *  a timeout of its own — never trusting the server's idle timeout to
 *  bound it — and never fatal: the merge already happened, and a
 *  failed install is reported beside it rather than retroactively
 *  turning a successful merge into a failure.
 *
 *  Returns whether the dashboard should be restarted afterwards — it
 *  does NOT restart. Firing the restart from here killed the process
 *  in the middle of `landBranch`'s own repo loop, so an archive's
 *  specs root was never merged and nothing was left alive to say so.
 *  `landBranch` owns the restart now and fires it once the whole
 *  landing is reported. */
export async function installAfterMerge(ctx: LandContext, result: RepoMergeResult): Promise<boolean> {
  const cmd = resolveInstallCmd(result.root).value;
  if (!cmd) {
    // Said out loud for every project that has not configured one:
    // the alternative is a page that reads as "deployed" when nothing
    // was deployed, which is the whole complaint. Named in plain words,
    // not the raw env-var key; the sentence also says
    // where that setting lives, in the same plain words.
    const label = SETTING_LABELS.AIDE_INSTALL_CMD.toLowerCase();
    result.installError = { key: "landing.noInstallCommand", values: { label } };
    return false;
  }
  const timeoutMs = ctx.queueInstallTimeoutMs ?? INSTALL_TIMEOUT_MS;
  let failed = false;
  try {
    // argv, no shell — the same shape the notify command already has,
    // so nothing here has to get quoting right on someone's behalf.
    const proc = Bun.spawn({ cmd: scriptArgv(cmd.split(/\s+/)), cwd: result.root, stdout: "pipe", stderr: "pipe" });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeoutMs);
    let out = "";
    let err = "";
    try {
      [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    } finally {
      clearTimeout(timer);
    }
    const code = await proc.exited;
    // What the command printed, its last whole lines, behind the (?):
    // stderr when it wrote any, else stdout, where make and many
    // installers say why.
    const tail = outputTail(err) || outputTail(out);
    if (timedOut) {
      result.installError = { key: "landing.installCommandTimedOut", values: { command: cmd, seconds: timeoutMs / 1000 } };
      failed = true;
    } else if (code !== 0) {
      result.installError = { key: "landing.installCommandFailed", values: { command: cmd, code } };
      failed = true;
    }
    if (failed && tail) result.installDetail = tail;
  } catch (err) {
    result.installError = { key: "landing.installCommandNotRun", values: { command: cmd } };
    result.installDetail = err instanceof Error ? err.message : String(err);
    failed = true;
  }
  if (failed) console.error(`land-branch: install (${cmd}) failed${result.installDetail ? `:\n${result.installDetail}` : ""}`);
  // A failed install wants no restart, exactly as `set -e` used to skip
  // install-after-merge.sh's own restart block on any earlier failure.
  return !failed;
}
