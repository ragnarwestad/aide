// Running one of aide's own installed scripts from inside a landing
// worktree, and finding it on disk — shared by the landing's test gate
// and its create-finalize step, neither of which can rely on the
// installer's own shell PATH (launchd does not reach ~/.local/bin).

import { runProcess, scriptFor } from "../process";
import { trackLandingProcess, untrackLandingProcess } from "./cancel-landing.ts";

/** Where the installer puts the scripts; launchd's PATH does not reach
 *  ~/.local/bin (the same resolution run-aide-write-spec.ts uses). */
/** Which copy of an aide script the landing runs. BESIDE THE RUNNER
 *  first: the board is started with `--runner-bin`, and the scripts in
 *  that same directory are the ones written together with this server's
 *  own code — a test board started from a branch serves that branch's
 *  TypeScript and must call that branch's bash, or a flag the branch
 *  added is "unknown" to the copy installed from main (2026-09-14).
 *  Then the installed copy under ~/.local/bin, then the bare name. An
 *  explicit override (a test's fake) wins over all three. */
export { scriptFor };

export async function runScript(
  argv: string[],
  cwd: string,
  timeoutMs: number,
  /** The job this script runs for, so Cancel can reach it. */
  owner?: string,
  /** Added to the step's own environment. */
  extraEnv: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  // The same PATH a step's own spawn gets (`tool-path.ts`). Without it
  // this server, under launchd, cannot see `~/.local/bin` — where aide's
  // scripts and Claude Code itself live — so a script run from here
  // would report a CLI missing that a real run finds.
  return runProcess(argv, cwd, timeoutMs, extraEnv, {
    started: owner ? (pid) => trackLandingProcess(owner, pid) : undefined,
    ended: owner ? (pid) => untrackLandingProcess(owner, pid) : undefined,
  });
}

/** The `git -c` arguments that make a merge in `work` merge the project's
 *  translation files key by key, as `root`'s .aide/project.yaml names them,
 *  from `aide-translation-merge-args`, so the rule for which files those
 *  are lives in one place. Any failure gives none: the merge is then git's
 *  own, exactly as without them. */
export async function translationMergeArgs(root: string, work: string, opts: { scriptDir?: string } = {}): Promise<string[]> {
  const script = scriptFor("aide-translation-merge-args", { beside: opts.scriptDir });
  try {
    const result = await runScript([script, root, work], work, 10_000);
    if (result.code !== 0) return [];
    return result.stdout.split("\n").filter((line) => line !== "");
  } catch {
    return [];
  }
}
