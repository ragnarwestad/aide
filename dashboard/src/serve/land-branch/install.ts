// Running the project's own install once its code has landed. Split
// out of land-branch.ts by theme (split land-branch.ts by theme).

import { configValue } from "../../project/discover.ts";
import { SETTING_LABELS } from "../../project/setting-labels.ts";
import type { RepoMergeResult } from "../../git/branch-merge.ts";
import { errorSentence } from "../../render/ui/error-sentence.ts";
import { INSTALL_TIMEOUT_MS } from "../serve-helpers.ts";
import type { LandContext } from "./types.ts";

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
  const cmd = configValue(result.root, "AIDE_INSTALL_CMD");
  if (!cmd) {
    // Said out loud for every project that has not configured one:
    // the alternative is a page that reads as "deployed" when nothing
    // was deployed, which is the whole complaint. Named in plain words,
    // not the raw env-var key (spec 318, REQ-1) — REQ-3, spec 352 adds
    // where that setting lives, in the same plain words.
    const label = SETTING_LABELS.AIDE_INSTALL_CMD.toLowerCase();
    result.installError = errorSentence({
      what: `merged, not installed — no ${label} configured.`,
      resolve: `Set the ${label} in the project's .aide/config to enable it.`,
    }).text;
    return false;
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
      result.installError = errorSentence({
        what: `merged, but the install timed out after ${timeoutMs}ms and was stopped.`,
        resolve: "Check the install command in the checkout on the serving host.",
      }).text;
      failed = true;
    } else if (code !== 0) {
      // The stderr tail (spec 352, REQ-5) stays out of the board-facing
      // sentence — logged here instead, so the exact words are still on
      // the machine for whoever goes looking, just never the sentence.
      console.error(`land-branch: install exited ${code}: ${tail.trim().slice(-200)}`);
      result.installError = errorSentence({
        what: `merged, but the install failed (exit ${code}).`,
        resolve: "Check the install command in the checkout on the serving host.",
      }).text;
      failed = true;
    }
  } catch (err) {
    console.error(`land-branch: install could not be run: ${err instanceof Error ? err.message : String(err)}`);
    result.installError = errorSentence({
      what: "merged, but the install could not be run.",
      resolve: "Check the install command in the checkout on the serving host.",
    }).text;
    failed = true;
  }
  // A failed install wants no restart, exactly as `set -e` used to skip
  // install-after-merge.sh's own restart block on any earlier failure.
  return !failed;
}
